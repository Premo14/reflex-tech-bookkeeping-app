package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
)

// createSyntheticReceiptPNG creates a clean receipt placeholder PNG on disk and returns its path and SHA-256 hash.
func createSyntheticReceiptPNG(receiptID uint, seedIndex int) (string, string, error) {
	processedDir := constants.GetProcessedPath()
	if err := os.MkdirAll(processedDir, 0777); err != nil {
		return "", "", err
	}

	outPath := filepath.Join(processedDir, fmt.Sprintf("seed_receipt_%d.png", receiptID))

	width, height := 520, 680
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	// Warm paper background
	bg := color.RGBA{250, 248, 242, 255}
	draw.Draw(img, img.Bounds(), &image.Uniform{bg}, image.Point{}, draw.Src)

	// Header bar & decorative receipt lines so it renders clearly in the Receipt Modal
	headerColor := color.RGBA{35, 38, 45, 255}
	lineColor := color.RGBA{190, 188, 180, 255}
	accentColor := color.RGBA{16, 185, 129, 255}

	draw.Draw(img, image.Rect(40, 40, width-40, 95), &image.Uniform{headerColor}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(40, 115, width-40, 118), &image.Uniform{accentColor}, image.Point{}, draw.Src)

	for row := 0; row < 12; row++ {
		y := 150 + row*34
		barWidth := 280 + ((seedIndex*37 + row*53) % 140)
		draw.Draw(img, image.Rect(50, y, 50+barWidth, y+12), &image.Uniform{lineColor}, image.Point{}, draw.Src)
		draw.Draw(img, image.Rect(width-130, y, width-50, y+12), &image.Uniform{lineColor}, image.Point{}, draw.Src)
	}

	// Total bar
	draw.Draw(img, image.Rect(40, height-110, width-40, height-65), &image.Uniform{headerColor}, image.Point{}, draw.Src)

	f, err := os.Create(outPath)
	if err != nil {
		return "", "", err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return "", "", err
	}
	f.Close()
	_ = os.Chmod(outPath, 0666)

	sum := sha256.Sum256([]byte(fmt.Sprintf("seed-receipt-v2-%d-%d-%d", receiptID, seedIndex, time.Now().UnixNano())))
	return outPath, hex.EncodeToString(sum[:]), nil
}

func attachReceipt(exp *models.Expense, seedIndex int) {
	rec := models.Receipt{
		ExpenseID:   &exp.ID,
		DocumentURI: "",
		FileExt:     ".png",
		FileHash:    fmt.Sprintf("seed-temp-%d-%d", exp.ID, time.Now().UnixNano()),
	}
	if err := db.DB.Create(&rec).Error; err != nil {
		log.Printf("⚠️ Failed to create receipt row for expense %d: %v", exp.ID, err)
		return
	}
	path, hash, err := createSyntheticReceiptPNG(rec.ID, seedIndex)
	if err != nil {
		log.Printf("⚠️ Failed to write receipt image for receipt %d: %v", rec.ID, err)
		return
	}
	rec.DocumentURI = path
	rec.FileHash = hash
	db.DB.Save(&rec)
}

func findTxByDateAndAmount(dateStr string, amount float64) *models.BankTransaction {
	var txs []models.BankTransaction
	db.DB.Where("deleted_at IS NULL").Find(&txs)
	for i := range txs {
		if txs[i].Date.Format("2006-01-02") == dateStr && math.Abs(txs[i].Amount-amount) < 0.01 {
			return &txs[i]
		}
	}
	return nil
}

func main() {
	db.Connect()

	// Sync active DocumentDropboxPath from app_settings so seed_receipt_*.png files
	// are written to the active host processed directory (e.g. /Users/aj/Desktop/document-data/processed).
	var dropboxSetting models.AppSetting
	if err := db.DB.Where("key = ?", "DocumentDropboxPath").First(&dropboxSetting).Error; err == nil && dropboxSetting.Value != "" {
		_, _ = constants.SetDropboxLocation(dropboxSetting.Value)
	}

	log.Println("🌱 Starting June–August 2026 Bookkeeping Scenario Seeder...")

	// Lookup active Chart of Accounts categories
	var checking, savings, capOneCard, bankLoan, utilities, supplies, meals, software, travel, salesRev, serviceRev models.ChartAccount
	db.DB.Where("code = ?", "1010").First(&checking)
	db.DB.Where("code = ?", "1020").First(&savings)
	db.DB.Where("code = ?", "2020").First(&capOneCard)
	db.DB.Where("code = ?", "2510").First(&bankLoan)
	db.DB.Where("code = ?", "5030").First(&utilities)
	db.DB.Where("code = ?", "5050").First(&supplies)
	db.DB.Where("code = ?", "5090").First(&meals)
	db.DB.Where("code = ?", "5210").First(&software)
	db.DB.Where("code = ?", "5410").First(&travel)
	db.DB.Where("code = ?", "4010").First(&salesRev)
	db.DB.Where("code = ?", "4110").First(&serviceRev)

	// Deduplicate repeated or 32-char truncated-prefix "Name Memo" descriptions on existing OFX bank_transactions
	var allTxs []models.BankTransaction
	db.DB.Find(&allTxs)
	for _, tx := range allTxs {
		desc := strings.Join(strings.Fields(tx.Description), " ")
		cleaned := desc
		for i := 5; i < len(desc)-5; i++ {
			if desc[i] == ' ' {
				left := desc[:i]
				right := desc[i+1:]
				if strings.HasPrefix(strings.ToLower(right), strings.ToLower(left)) {
					cleaned = right
					break
				}
			}
		}
		if cleaned != tx.Description {
			db.DB.Model(&models.BankTransaction{}).Where("id = ?", tx.ID).Update("description", cleaned)
		}
	}

	// Clean up any previously seeded expenses/links, manual installment demo txs, or failed manual-entry fallbacks
	db.DB.Exec("DELETE FROM expense_bank_transactions")
	db.DB.Exec("DELETE FROM bank_transactions WHERE fit_id LIKE 'SEED-INSTALLMENT-%'")
	db.DB.Exec("DELETE FROM receipts WHERE expense_id IS NULL OR document_uri LIKE '%seed_receipt_%' OR expense_id IN (SELECT id FROM expenses WHERE description LIKE '%AI extraction unavailable%')")
	db.DB.Exec("DELETE FROM expenses WHERE notes LIKE '%[SEED]%' OR description LIKE '%AI extraction unavailable%'")

	mustDate := func(s string) time.Time {
		t, _ := time.Parse("2006-01-02", s)
		return t.UTC()
	}

	seedIdx := 1
	createSeededExpense := func(dateStr, vendor, desc string, amount, tax float64, tender string, catID *uint, reviewStatus, exclReason, exclNote string) models.Expense {
		exp := models.Expense{
			Timestamp:        mustDate(dateStr),
			Vendor:           vendor,
			Description:      desc,
			Amount:           amount,
			TaxAmount:        tax,
			CurrencyCode:     "USD",
			Tender:           tender,
			ChartAccountID:   catID,
			Notes:            "[SEED] Demo scenario record",
			IsManual:         false,
			AllocationStatus: "UNLINKED",
			ReviewStatus:     reviewStatus,
			ExclusionReason:  exclReason,
			ExclusionNote:    exclNote,
		}
		if err := db.DB.Create(&exp).Error; err != nil {
			log.Fatalf("❌ Failed to create seeded expense %s: %v", vendor, err)
		}
		attachReceipt(&exp, seedIdx)
		seedIdx++
		return exp
	}

	linkItems := func(expID, txID uint, status string, catID *uint) {
		link := models.ExpenseBankTransaction{
			ExpenseID:         expID,
			BankTransactionID: txID,
			Status:            status,
		}
		db.DB.Create(&link)
		if status == "confirmed" && catID != nil {
			db.DB.Model(&models.BankTransaction{}).Where("id = ?", txID).Update("category_account_id", *catID)
		}
	}

	// 1. Confirmed 1:1 Matches
	if tx := findTxByDateAndAmount("2026-07-21", -110.00); tx != nil {
		exp := createSeededExpense("2026-07-21", "Spectrum Business", "Monthly fiber internet service", 110.00, 0.00, "card", &utilities.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &utilities.ID)
	}
	if tx := findTxByDateAndAmount("2026-08-05", -36.88); tx != nil {
		exp := createSeededExpense("2026-08-05", "National Grid", "Electric utility service", 36.88, 0.00, "card", &utilities.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &utilities.ID)
	}
	if tx := findTxByDateAndAmount("2026-06-26", -13.87); tx != nil {
		exp := createSeededExpense("2026-06-26", "Dollar General #17768", "Folders, legal pads, and pens", 13.87, 1.03, "card", &supplies.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &supplies.ID)
	}
	if tx := findTxByDateAndAmount("2026-06-29", -15.10); tx != nil {
		exp := createSeededExpense("2026-06-29", "Exxon Mountain Mart #1", "Unleaded fuel for client site visit", 15.10, 0.00, "card", &travel.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &travel.ID)
	}

	// 2. Suggested Links (Score 55-65, awaiting user approval)
	if tx := findTxByDateAndAmount("2026-06-26", -80.81); tx != nil {
		exp := createSeededExpense("2026-06-24", "Bokie's Burgers & Catering", "Team lunch catering order", 80.81, 5.99, "card", &meals.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "suggested", nil)
	}
	if tx := findTxByDateAndAmount("2026-07-02", -38.18); tx != nil {
		exp := createSeededExpense("2026-06-30", "Hosler's Family Restaurant", "Client breakfast meeting", 38.18, 2.83, "card", &meals.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "suggested", nil)
	}

	// 3. 1-to-Many Split (1 Bank Transaction -$261.71 linked to 2 Expenses across 2 categories totaling $261.71)
	if tx := findTxByDateAndAmount("2026-07-24", -261.71); tx != nil {
		exp1 := createSeededExpense("2026-07-24", "Walmart Supercenter #3334", "LaserJet toner cartridge & copy paper (Sub-receipt 1)", 161.71, 11.98, "card", &supplies.ID, "APPROVED", "", "")
		exp2 := createSeededExpense("2026-07-24", "Walmart Supercenter #3334", "Office breakroom coffee & snacks (Sub-receipt 2)", 100.00, 7.41, "card", &meals.ID, "APPROVED", "", "")
		linkItems(exp1.ID, tx.ID, "confirmed", nil)
		linkItems(exp2.ID, tx.ID, "confirmed", nil)
		db.DB.Model(&models.BankTransaction{}).Where("id = ?", tx.ID).Update("category_account_id", nil)
	}

	// 4. Many-to-1 Splits:
	//    a) 2 Bank Transactions of -$109.36 on 2026-07-22 linked to 1 Combined Invoice of $218.72
	var ngridTxs []models.BankTransaction
	db.DB.Where("deleted_at IS NULL AND amount = ?", -109.36).Find(&ngridTxs)
	if len(ngridTxs) >= 2 {
		exp := createSeededExpense("2026-07-22", "National Grid", "Combined Gas & Electric Commercial Statement", 218.72, 0.00, "card", &utilities.ID, "APPROVED", "", "")
		linkItems(exp.ID, ngridTxs[0].ID, "confirmed", &utilities.ID)
		linkItems(exp.ID, ngridTxs[1].ID, "confirmed", &utilities.ID)
	}
	//    b) 3 Installment Bank Transactions of -$150.00 linked to 1 Apple Business Invoice of $450.00
	if capOneCard.ID > 0 {
		appleExp := createSeededExpense("2026-07-15", "Apple Store Business", "iPad Air Workstation (3 Monthly Installments of $150)", 450.00, 33.33, "card", &supplies.ID, "APPROVED", "", "")
		installmentDates := []string{"2026-07-15", "2026-08-01", "2026-08-15"}
		for idx, dStr := range installmentDates {
			instTx := models.BankTransaction{
				ChartAccountID:   &capOneCard.ID,
				CategoryAccountID: &supplies.ID,
				Date:             mustDate(dStr),
				Description:      fmt.Sprintf("APPLE STORE INSTALLMENT %d OF 3", idx+1),
				Amount:           -150.00,
				TransactionType:  "DEBIT",
				FITID:            fmt.Sprintf("SEED-INSTALLMENT-%d", idx+1),
				IsManual:         true,
				AllocationStatus: "BALANCED",
				ReviewStatus:     "APPROVED",
			}
			db.DB.Create(&instTx)
			linkItems(appleExp.ID, instTx.ID, "confirmed", &supplies.ID)
		}
	}

	// 5. Under-Allocated (PARTIALLY_ALLOCATED) Warnings:
	//    a) Transaction under-allocated: -$45.19 tx vs $35.19 receipt ($10 remaining on tx)
	if tx := findTxByDateAndAmount("2026-06-25", -45.19); tx != nil {
		exp := createSeededExpense("2026-06-25", "Stewart's Shop #331", "Fuel pump receipt (missing $10 car wash receipt)", 35.19, 0.00, "card", &travel.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &travel.ID)
	}
	//    b) Expense under-allocated: -$19.32 tx vs $29.32 receipt ($10 remaining on expense)
	if tx := findTxByDateAndAmount("2026-07-24", -19.32); tx != nil {
		exp := createSeededExpense("2026-07-24", "McDonalds 38918", "Client working lunch ($10 split paid on second card)", 29.32, 2.17, "card", &meals.ID, "APPROVED", "", "")
		linkItems(exp.ID, tx.ID, "confirmed", &meals.ID)
	}

	// 6. Over-Allocated (OVER_ALLOCATED) Warning: -$85.20 tx linked to 2 expenses totaling $95.20 ($10 over-allocated)
	if tx := findTxByDateAndAmount("2026-07-22", -85.20); tx != nil {
		exp1 := createSeededExpense("2026-07-22", "Walmart #3334", "Office supplies (receipt 1 of 2)", 55.20, 4.09, "card", &supplies.ID, "APPROVED", "", "")
		exp2 := createSeededExpense("2026-07-22", "Walmart #3334", "Printer ink & labels (duplicate/over-allocated receipt 2 of 2)", 40.00, 2.96, "card", &supplies.ID, "APPROVED", "", "")
		linkItems(exp1.ID, tx.ID, "confirmed", &supplies.ID)
		linkItems(exp2.ID, tx.ID, "confirmed", &supplies.ID)
	}

	// 7. Pure Cash Expenses (Auto-BALANCED without bank transactions)
	createSeededExpense("2026-07-10", "Potsdam Hardware & Supply", "Replacement keys and lock lubricant", 24.50, 1.81, "cash", &supplies.ID, "APPROVED", "", "")
	createSeededExpense("2026-08-02", "Village of Potsdam Parking", "Downtown client meeting parking", 6.00, 0.00, "cash", &travel.ID, "APPROVED", "", "")

	// 8. Unlinked Card Expense (Needs Attention - waiting for statement or manual link)
	createSeededExpense("2026-08-12", "Staples #0412", "Heavy-duty shredder and binder clips", 49.99, 3.70, "card", &supplies.ID, "APPROVED", "", "")

	// 9. Review Queue States:
	//    a) Excluded Item (Visible in Excluded Items tab)
	createSeededExpense("2026-07-14", "Netflix", "Personal home streaming subscription", 15.99, 1.18, "card", &software.ID, "IGNORED", "PERSONAL", "Accidental swipe on business card; personal expense")
	//    b) Warnings Ignored Item (Visible in Warnings Ignored tab)
	createSeededExpense("2026-07-29", "NYS Thruway Authority", "E-ZPass toll charge (receipt warning silenced)", 12.75, 0.00, "card", &travel.ID, "WARNINGS_IGNORED", "", "")
	//    c) Soft-Deleted Item (Visible in Deleted Items 30-day Trash tab)
	deletedExp := createSeededExpense("2026-07-19", "Duplicate Coffee Receipt", "Accidental duplicate scan moved to trash", 8.45, 0.62, "card", &meals.ID, "DELETED", "", "")
	twoDaysAgo := time.Now().Add(-48 * time.Hour)
	db.DB.Model(&deletedExp).Update("deleted_at", twoDaysAgo)

	// 10. Categorize key Revenue deposits and Balance Sheet transfers so P&L & Cash Flow are clean
	db.DB.Model(&models.BankTransaction{}).
		Where("amount > 0 AND description LIKE ?", "%CANTON - POTSDAM%").
		Update("category_account_id", salesRev.ID)
	db.DB.Model(&models.BankTransaction{}).
		Where("amount > 0 AND description LIKE ?", "%METAPAY%").
		Update("category_account_id", serviceRev.ID)

	if capOneCard.ID > 0 {
		db.DB.Model(&models.BankTransaction{}).
			Where("amount < 0 AND description ILIKE ?", "%CAPITAL ONE%").
			Update("category_account_id", capOneCard.ID)
	}
	if checking.ID > 0 {
		db.DB.Model(&models.BankTransaction{}).
			Where("amount > 0 AND description ILIKE ?", "%CAPITAL ONE MOBILE PYMT%").
			Update("category_account_id", checking.ID)
	}
	if savings.ID > 0 {
		db.DB.Model(&models.BankTransaction{}).
			Where("amount < 0 AND description ILIKE ?", "%Transfer to Share%").
			Update("category_account_id", savings.ID)
	}
	if bankLoan.ID > 0 {
		db.DB.Model(&models.BankTransaction{}).
			Where("amount < 0 AND description ILIKE ?", "%Transfer to Loan%").
			Update("category_account_id", bankLoan.ID)
	}
	if supplies.ID > 0 {
		db.DB.Model(&models.BankTransaction{}).
			Where("amount > 0 AND description ILIKE ?", "%WAL-MART%").
			Update("category_account_id", supplies.ID)
	}

	// Recompute all allocation statuses
	utils.UpdateAllocationStatuses()

	log.Println("✅ Seeding complete! All June–August 2026 reconciliation scenarios are ready.")
}
