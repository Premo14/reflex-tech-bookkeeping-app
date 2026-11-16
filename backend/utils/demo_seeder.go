package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/gorm"
)

const (
	demoMarker            = "[DEMO]"
	legacySeedMarker      = "[SEED]"
	demoTxFitIDPrefix     = "DEMO-TX-"
	demoCashInvPrefix     = "CASH-INV-DEMO-"
	demoStmtURIPrefix     = "demo://statement/"
	demoInvoiceNumPrefix  = "INV-DEMO-"
	demoReceiptFilePrefix = "demo_receipt_"
)

// DemoDatasetCounts reports how many demo records are currently stored.
type DemoDatasetCounts struct {
	Statements   int64 `json:"statements"`
	Transactions int64 `json:"transactions"`
	Expenses     int64 `json:"expenses"`
	Receipts     int64 `json:"receipts"`
	Invoices     int64 `json:"invoices"`
}

// DemoDatasetStatus describes whether demo data is currently loaded.
type DemoDatasetStatus struct {
	Active bool              `json:"active"`
	Counts DemoDatasetCounts `json:"counts"`
}

// GetDemoDatasetStatus counts active demo records in the database.
func GetDemoDatasetStatus() (DemoDatasetStatus, error) {
	status := DemoDatasetStatus{}
	if db.DB == nil {
		return status, nil
	}

	db.DB.Unscoped().Model(&models.BankStatement{}).
		Where("document_uri LIKE ?", demoStmtURIPrefix+"%").
		Count(&status.Counts.Statements)
	db.DB.Unscoped().Model(&models.BankTransaction{}).
		Where("fit_id LIKE ? OR fit_id LIKE ? OR fit_id LIKE ?", demoTxFitIDPrefix+"%", "SEED-INSTALLMENT-%", demoCashInvPrefix+"%").
		Count(&status.Counts.Transactions)
	db.DB.Unscoped().Model(&models.Expense{}).
		Where("notes LIKE ? OR notes LIKE ?", "%"+demoMarker+"%", "%"+legacySeedMarker+"%").
		Count(&status.Counts.Expenses)
	db.DB.Model(&models.Receipt{}).
		Where("document_uri LIKE ? OR document_uri LIKE ?", "%"+demoReceiptFilePrefix+"%", "%seed_receipt_%").
		Count(&status.Counts.Receipts)
	db.DB.Model(&models.Invoice{}).
		Where("invoice_number LIKE ? OR notes LIKE ?", demoInvoiceNumPrefix+"%", "%"+demoMarker+"%").
		Count(&status.Counts.Invoices)

	status.Active = status.Counts.Statements > 0 ||
		status.Counts.Transactions > 0 ||
		status.Counts.Expenses > 0 ||
		status.Counts.Receipts > 0 ||
		status.Counts.Invoices > 0

	return status, nil
}

// RemoveDemoDataset deletes all demo statements, transactions, expenses, receipts, links,
// invoices, audit entries, and synthetic receipt PNGs without disturbing user-imported data.
func RemoveDemoDataset() (DemoDatasetStatus, error) {
	if db.DB == nil {
		return DemoDatasetStatus{}, fmt.Errorf("database not initialized")
	}

	// Collect demo expense IDs, transaction IDs, invoice IDs, and synthetic image paths before deletion.
	var demoExpIDs []uint
	db.DB.Unscoped().Model(&models.Expense{}).
		Where("notes LIKE ? OR notes LIKE ?", "%"+demoMarker+"%", "%"+legacySeedMarker+"%").
		Pluck("id", &demoExpIDs)

	var demoTxIDs []uint
	db.DB.Unscoped().Model(&models.BankTransaction{}).
		Where("fit_id LIKE ? OR fit_id LIKE ? OR fit_id LIKE ? OR notes LIKE ?", demoTxFitIDPrefix+"%", "SEED-INSTALLMENT-%", demoCashInvPrefix+"%", "%"+demoMarker+"%").
		Pluck("id", &demoTxIDs)

	var demoInvIDs []uint
	db.DB.Model(&models.Invoice{}).
		Where("invoice_number LIKE ? OR notes LIKE ?", demoInvoiceNumPrefix+"%", "%"+demoMarker+"%").
		Pluck("id", &demoInvIDs)

	var demoReceiptURIs []string
	qRec := db.DB.Model(&models.Receipt{}).Where("document_uri LIKE ? OR document_uri LIKE ?", "%"+demoReceiptFilePrefix+"%", "%seed_receipt_%")
	if len(demoExpIDs) > 0 {
		qRec = qRec.Or("expense_id IN ?", demoExpIDs)
	}
	qRec.Pluck("document_uri", &demoReceiptURIs)

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Unlink any non-demo expenses pointing at demo invoices first
		if len(demoInvIDs) > 0 {
			if err := tx.Unscoped().Model(&models.Expense{}).Where("invoice_id IN ?", demoInvIDs).Update("invoice_id", nil).Error; err != nil {
				return err
			}
			// Also unlink demo transactions referenced by non-demo invoices just in case
			if len(demoTxIDs) > 0 {
				if err := tx.Model(&models.Invoice{}).Where("bank_transaction_id IN ?", demoTxIDs).Update("bank_transaction_id", nil).Error; err != nil {
					return err
				}
			}
		}

		// 2. Delete join links referencing demo expenses or demo transactions
		if len(demoExpIDs) > 0 && len(demoTxIDs) > 0 {
			if err := tx.Where("expense_id IN ? OR bank_transaction_id IN ?", demoExpIDs, demoTxIDs).Delete(&models.ExpenseBankTransaction{}).Error; err != nil {
				return err
			}
		} else if len(demoExpIDs) > 0 {
			if err := tx.Where("expense_id IN ?", demoExpIDs).Delete(&models.ExpenseBankTransaction{}).Error; err != nil {
				return err
			}
		} else if len(demoTxIDs) > 0 {
			if err := tx.Where("bank_transaction_id IN ?", demoTxIDs).Delete(&models.ExpenseBankTransaction{}).Error; err != nil {
				return err
			}
		}

		// 3. Delete demo receipts
		delRec := tx.Where("document_uri LIKE ? OR document_uri LIKE ?", "%"+demoReceiptFilePrefix+"%", "%seed_receipt_%")
		if len(demoExpIDs) > 0 {
			delRec = delRec.Or("expense_id IN ?", demoExpIDs)
		}
		if err := delRec.Delete(&models.Receipt{}).Error; err != nil {
			return err
		}

		// 4. Hard-delete demo expenses
		if len(demoExpIDs) > 0 {
			if err := tx.Unscoped().Where("id IN ?", demoExpIDs).Delete(&models.Expense{}).Error; err != nil {
				return err
			}
		}

		// 5. Delete demo invoices
		if len(demoInvIDs) > 0 {
			if err := tx.Where("id IN ?", demoInvIDs).Delete(&models.Invoice{}).Error; err != nil {
				return err
			}
		}

		// 6. Hard-delete demo bank transactions
		if len(demoTxIDs) > 0 {
			if err := tx.Unscoped().Where("id IN ?", demoTxIDs).Delete(&models.BankTransaction{}).Error; err != nil {
				return err
			}
		}

		// 7. Delete demo bank statements
		if err := tx.Where("document_uri LIKE ?", demoStmtURIPrefix+"%").Delete(&models.BankStatement{}).Error; err != nil {
			return err
		}

		// 8. Delete demo audit logs
		if err := tx.Where("note LIKE ? OR note LIKE ?", "%"+demoMarker+"%", "%"+legacySeedMarker+"%").Delete(&models.ItemAuditLog{}).Error; err != nil {
			return err
		}
		if err := tx.Where("reason LIKE ?", "%"+demoMarker+"%").Delete(&models.PeriodAuditLog{}).Error; err != nil {
			return err
		}

		// 9. Restore BooksClosedDate only if the demo seeder itself applied it
		var appliedSetting models.AppSetting
		if err := tx.Where("key = ?", "DemoClosedDateApplied").First(&appliedSetting).Error; err == nil && appliedSetting.Value == "true" {
			tx.Where("key = ?", "BooksClosedDate").Delete(&models.AppSetting{})
			tx.Where("key = ?", "DemoClosedDateApplied").Delete(&models.AppSetting{})
		}
		tx.Where("key = ?", "DemoDataActive").Delete(&models.AppSetting{})

		return nil
	})
	if err != nil {
		return DemoDatasetStatus{}, err
	}

	// Remove synthetic PNG receipt files from disk when no remaining DB record points to them
	for _, uri := range demoReceiptURIs {
		if uri == "" {
			continue
		}
		var refCount int64
		db.DB.Model(&models.Receipt{}).Where("document_uri = ?", uri).Count(&refCount)
		if refCount == 0 {
			_ = os.Remove(uri)
		}
	}

	// Recompute allocation statuses on any remaining real user records
	UpdateAllocationStatuses()

	return GetDemoDatasetStatus()
}

// ResetDemoDataset clears any existing demo dataset and re-seeds the comprehensive demo scenario cleanly.
func ResetDemoDataset() (DemoDatasetStatus, error) {
	if _, err := RemoveDemoDataset(); err != nil {
		return DemoDatasetStatus{}, err
	}
	return SeedDemoDataset()
}

// SeedDemoDataset populates a comprehensive multi-month bookkeeping dataset covering
// statements, checking/credit/savings/cash transactions, splits, installments, 1099-NEC vendors,
// all Schedule C tax lines, Review Queue items, Client Invoices, and realistic receipt PNGs.
func SeedDemoDataset() (DemoDatasetStatus, error) {
	if db.DB == nil {
		return DemoDatasetStatus{}, fmt.Errorf("database not initialized")
	}

	// Idempotent reset if any demo records already exist
	if _, err := RemoveDemoDataset(); err != nil {
		return DemoDatasetStatus{}, fmt.Errorf("cleanup prior demo data: %w", err)
	}

	// Sync storage directory with app_settings
	var dropboxSetting models.AppSetting
	if err := db.DB.Where("key = ?", "DocumentDropboxPath").First(&dropboxSetting).Error; err == nil && dropboxSetting.Value != "" {
		_, _ = constants.SetDropboxLocation(dropboxSetting.Value)
	}
	_ = CreateDirsIfNotExists()

	// Guarantee standard Chart of Accounts & Bank Rules exist on fresh DB
	db.SeedChartOfAccounts()
	db.SeedDefaultBankRules()

	// Lookup Chart of Accounts by code
	acct := func(code string) *uint {
		var a models.ChartAccount
		if err := db.DB.Where("code = ?", code).First(&a).Error; err == nil && a.ID > 0 {
			id := a.ID
			return &id
		}
		return nil
	}

	checkingID := acct("1010")
	savingsID := acct("1020")
	cashOnHandID := acct("1030")
	equipmentID := acct("1300")
	creditCardID := acct("2020")
	bankLoanID := acct("2510")
	ownersCapitalID := acct("3010")
	ownersDrawID := acct("3110")

	salesRevID := acct("4010")
	returnsRevID := acct("4090")
	serviceRevID := acct("4110")
	interestRevID := acct("4210")

	cogsID := acct("5000")
	rentID := acct("5010")
	equipRentalID := acct("5015")
	payrollID := acct("5020")
	benefitsID := acct("5025")
	utilitiesID := acct("5030")
	repairsID := acct("5040")
	officeSuppliesID := acct("5050")
	suppliesMatID := acct("5060")
	homeOfficeID := acct("5070")
	insuranceID := acct("5080")
	mealsID := acct("5090")
	profServicesID := acct("5110")
	contractLaborID := acct("5120")
	softwareID := acct("5210")
	advertisingID := acct("5310")
	travelID := acct("5410")
	vehicleID := acct("5510")
	taxesLicensesID := acct("5610")
	interestExpID := acct("5710")
	depreciationID := acct("5720")
	merchantFeesID := acct("5810")
	bankFeesID := acct("5910")

	// Account code labels for PNG receipt rendering
	codeLabels := make(map[uint]string)
	var allAccounts []models.ChartAccount
	db.DB.Find(&allAccounts)
	for _, a := range allAccounts {
		codeLabels[a.ID] = fmt.Sprintf("%s %s", a.Code, a.Name)
	}

	mustDate := func(s string) time.Time {
		t, _ := time.Parse("2006-01-02", s)
		return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC)
	}

	// Set Q1 BooksClosedDate ("2026-03-31") only if the user hasn't set a custom closing date yet
	var existingClosedSetting models.AppSetting
	errClosed := db.DB.Where("key = ?", "BooksClosedDate").First(&existingClosedSetting).Error
	if errClosed != nil || strings.TrimSpace(existingClosedSetting.Value) == "" {
		db.DB.Where("key = ?", "BooksClosedDate").Assign(models.AppSetting{Value: "2026-03-31"}).FirstOrCreate(&models.AppSetting{Key: "BooksClosedDate"})
		db.DB.Where("key = ?", "DemoClosedDateApplied").Assign(models.AppSetting{Value: "true"}).FirstOrCreate(&models.AppSetting{Key: "DemoClosedDateApplied"})
		db.DB.Create(&models.PeriodAuditLog{
			Action:       "LOCKED",
			PreviousDate: "",
			NewDate:      "2026-03-31",
			Reason:       demoMarker + " Q1 2026 Books Closed",
		})
	}
	db.DB.Where("key = ?", "DemoDataActive").Assign(models.AppSetting{Value: "true"}).FirstOrCreate(&models.AppSetting{Key: "DemoDataActive"})

	// 1. Seed Monthly Bank Statements (Jan–Nov 2026 for Checking + Credit Card + Savings)
	type stmtSeed struct {
		uri        string
		ext        string
		accountNum string
		bankID     string
		start      string
		end        string
		endingBal  float64
		acctID     *uint
	}
	stmtDefs := []stmtSeed{
		{"demo://statement/checking-2026-q1.ofx", ".ofx", "50106954S:05", "021000021", "2026-01-01", "2026-03-31", 18420.50, checkingID},
		{"demo://statement/checking-2026-q2.ofx", ".ofx", "50106954S:05", "021000021", "2026-04-01", "2026-06-30", 21685.15, checkingID},
		{"demo://statement/checking-2026-q3.ofx", ".ofx", "50106954S:05", "021000021", "2026-07-01", "2026-09-30", 24910.40, checkingID},
		{"demo://statement/checking-2026-q4.ofx", ".ofx", "50106954S:05", "021000021", "2026-10-01", "2026-11-12", 26840.75, checkingID},
		{"demo://statement/card-2026-q1.qfx", ".qfx", "5137", "", "2026-01-01", "2026-03-31", -842.19, creditCardID},
		{"demo://statement/card-2026-q2.qfx", ".qfx", "5137", "", "2026-04-01", "2026-06-30", -1290.44, creditCardID},
		{"demo://statement/card-2026-q3.qfx", ".qfx", "5137", "", "2026-07-01", "2026-09-30", -1645.80, creditCardID},
		{"demo://statement/card-2026-q4.qfx", ".qfx", "5137", "", "2026-10-01", "2026-11-12", -714.62, creditCardID},
		{"demo://statement/savings-2026-ytd.ofx", ".ofx", "50106954S:99", "021000021", "2026-01-01", "2026-11-12", 14582.40, savingsID},
	}

	checkingStmtByMonth := map[string]*uint{}
	cardStmtByMonth := map[string]*uint{}
	var savingsStmtID *uint

	for _, sd := range stmtDefs {
		eb := models.NewMoney(sd.endingBal)
		balDate := mustDate(sd.end)
		stmt := models.BankStatement{
			DocumentURI:    sd.uri,
			FileExt:        sd.ext,
			AccountID:      sd.accountNum,
			BankID:         sd.bankID,
			StartDate:      mustDate(sd.start),
			EndDate:        balDate,
			EndingBalance:  &eb,
			BalanceAsOf:    &balDate,
			ChartAccountID: sd.acctID,
		}
		if err := db.DB.Create(&stmt).Error; err != nil {
			return DemoDatasetStatus{}, err
		}
		id := stmt.ID
		if strings.Contains(sd.uri, "checking-2026-q1") {
			for _, m := range []string{"01", "02", "03"} {
				checkingStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "checking-2026-q2") {
			for _, m := range []string{"04", "05", "06"} {
				checkingStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "checking-2026-q3") {
			for _, m := range []string{"07", "08", "09"} {
				checkingStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "checking-2026-q4") {
			for _, m := range []string{"10", "11"} {
				checkingStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "card-2026-q1") {
			for _, m := range []string{"01", "02", "03"} {
				cardStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "card-2026-q2") {
			for _, m := range []string{"04", "05", "06"} {
				cardStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "card-2026-q3") {
			for _, m := range []string{"07", "08", "09"} {
				cardStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "card-2026-q4") {
			for _, m := range []string{"10", "11"} {
				cardStmtByMonth[m] = &id
			}
		} else if strings.Contains(sd.uri, "savings") {
			savingsStmtID = &id
		}
	}

	txCounter := 0
	createTx := func(acctID *uint, catID *uint, dateStr, desc string, amount float64, txType, reviewStatus, exclReason, exclNote string, hasSugg bool, extraNote string) models.BankTransaction {
		txCounter++
		month := "01"
		if parts := strings.Split(dateStr, "-"); len(parts) >= 2 {
			month = parts[1]
		}
		var stmtID *uint
		if acctID != nil && checkingID != nil && *acctID == *checkingID {
			stmtID = checkingStmtByMonth[month]
		} else if acctID != nil && creditCardID != nil && *acctID == *creditCardID {
			stmtID = cardStmtByMonth[month]
		} else if acctID != nil && savingsID != nil && *acctID == *savingsID {
			stmtID = savingsStmtID
		}

		alloc := "UNLINKED"
		if amount >= 0 {
			alloc = "BALANCED"
		}
		note := demoMarker
		if extraNote != "" {
			note = demoMarker + " " + extraNote
		}
		tx := models.BankTransaction{
			BankStatementID:   stmtID,
			ChartAccountID:    acctID,
			CategoryAccountID: catID,
			Date:              mustDate(dateStr),
			Description:       desc,
			Amount:            models.NewMoney(amount),
			TransactionType:   txType,
			FITID:             fmt.Sprintf("%s%04d-%s", demoTxFitIDPrefix, txCounter, strings.ReplaceAll(dateStr, "-", "")),
			AllocationStatus:  alloc,
			ReviewStatus:      reviewStatus,
			ExclusionReason:   exclReason,
			ExclusionNote:     exclNote,
			HasSuggestions:    hasSugg,
			Notes:             note,
		}
		db.DB.Create(&tx)
		return tx
	}

	attachDemoReceipt := func(exp *models.Expense, withReceipt bool) {
		if !withReceipt {
			return
		}
		rec := models.Receipt{
			ExpenseID:   &exp.ID,
			DocumentURI: "",
			FileExt:     ".png",
			FileHash:    fmt.Sprintf("demo-pending-%d-%d", exp.ID, time.Now().UnixNano()),
		}
		if err := db.DB.Create(&rec).Error; err != nil {
			return
		}
		sub := exp.Amount.Dollars() - exp.TaxAmount.Dollars()
		if sub < 0 {
			sub = exp.Amount.Dollars()
		}
		catLabel := ""
		if exp.ChartAccountID != nil {
			catLabel = codeLabels[*exp.ChartAccountID]
		}
		path, hash, err := CreateDemoReceiptPNG(DemoReceiptSpec{
			ReceiptID:    rec.ID,
			Vendor:       exp.Vendor,
			Date:         exp.Timestamp.Format("2006-01-02"),
			Description:  exp.Description,
			Subtotal:     fmt.Sprintf("$%.2f", sub),
			Tax:          fmt.Sprintf("$%.2f", exp.TaxAmount.Dollars()),
			Total:        fmt.Sprintf("$%.2f", exp.Amount.Dollars()),
			Tender:       exp.Tender,
			AccountLabel: catLabel,
		})
		if err != nil {
			log.Printf("⚠️ Failed creating demo receipt PNG: %v", err)
			return
		}
		rec.DocumentURI = path
		rec.FileHash = hash
		db.DB.Save(&rec)
	}

	createExp := func(dateStr, vendor, desc string, amount, tax float64, tender string, catID *uint, reviewStatus, exclReason, exclNote string, withReceipt bool, invoiceID *uint) models.Expense {
		alloc := "UNLINKED"
		if IsCashTender(NormalizeTender(tender)) {
			alloc = "BALANCED"
		}
		exp := models.Expense{
			Timestamp:        mustDate(dateStr),
			Vendor:           vendor,
			Description:      desc,
			Amount:           models.NewMoney(amount),
			TaxAmount:        models.NewMoney(tax),
			CurrencyCode:     "USD",
			Tender:           NormalizeTender(tender),
			ChartAccountID:   catID,
			InvoiceID:        invoiceID,
			Notes:            demoMarker + " Demo scenario record",
			IsManual:         !withReceipt,
			AllocationStatus: alloc,
			ReviewStatus:     reviewStatus,
			ExclusionReason:  exclReason,
			ExclusionNote:    exclNote,
		}
		db.DB.Create(&exp)
		attachDemoReceipt(&exp, withReceipt)
		return exp
	}

	linkTxExp := func(expID, txID uint, status string) {
		db.DB.Create(&models.ExpenseBankTransaction{
			ExpenseID:         expID,
			BankTransactionID: txID,
			Status:            status,
		})
	}

	// =========================================================================
	// SECTION A: Q1 2026 (CLOSED PERIOD <= 2026-03-31) — CLEAN BALANCED HISTORY
	// =========================================================================
	// Opening capital & checking inflows
	createTx(checkingID, ownersCapitalID, "2026-01-01", "OWNER CAPITAL CONTRIBUTION INITIAL DEPOSIT", 15000.00, "DEP", "APPROVED", "", "", false, "Opening equity contribution")

	q1Pairs := []struct {
		date, txDesc, vendor, expDesc string
		amt, tax                      float64
		acctID, catID                 *uint
	}{
		{"2026-01-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "January studio office rent", 1650.00, 0, checkingID, rentID},
		{"2026-01-12", "SPECTRUM BUSINESS FIBER #0921", "Spectrum Business", "Business fiber internet (Jan)", 110.00, 0, checkingID, utilitiesID},
		{"2026-01-15", "GUSTO PAYROLL #8821", "Gusto Payroll", "Semi-monthly staff payroll", 2400.00, 0, checkingID, payrollID},
		{"2026-01-18", "HISCOX COMMERCIAL INSURANCE", "Hiscox Insurance", "General liability policy (Jan)", 195.00, 0, checkingID, insuranceID},
		{"2026-01-22", "ADOBE *CREATIVE CLOUD", "Adobe Creative Cloud", "Monthly design suite license", 59.99, 0, creditCardID, softwareID},
		{"2026-02-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "February studio office rent", 1650.00, 0, checkingID, rentID},
		{"2026-02-11", "NATIONAL GRID ELECTRIC #4410", "National Grid", "Commercial electric service (Feb)", 142.30, 0, checkingID, utilitiesID},
		{"2026-02-15", "GUSTO PAYROLL #8904", "Gusto Payroll", "Semi-monthly staff payroll", 2400.00, 0, checkingID, payrollID},
		{"2026-02-18", "HISCOX COMMERCIAL INSURANCE", "Hiscox Insurance", "General liability policy (Feb)", 195.00, 0, checkingID, insuranceID},
		{"2026-02-24", "UTICA CPA ADVISORY GROUP", "Utica CPA Advisory", "Q1 bookkeeping & tax prep retainer", 450.00, 0, checkingID, profServicesID},
		{"2026-03-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "March studio office rent", 1650.00, 0, checkingID, rentID},
		{"2026-03-10", "GOOGLE *WORKSPACE UTICA", "Google Workspace", "Business email & drive seats", 24.00, 0, creditCardID, softwareID},
		{"2026-03-14", "SPECTRUM BUSINESS FIBER #0921", "Spectrum Business", "Business fiber internet (Mar)", 110.00, 0, checkingID, utilitiesID},
		{"2026-03-15", "GUSTO PAYROLL #9012", "Gusto Payroll", "Semi-monthly staff payroll", 2400.00, 0, checkingID, payrollID},
		{"2026-03-18", "AETNA SMALL BUSINESS BENEFITS", "Aetna Group Health", "Q1 employee health benefits", 560.00, 0, checkingID, benefitsID},
		{"2026-03-22", "GITHUB TEAM SUBSCRIPTION", "GitHub", "Source control team plan", 19.00, 0, creditCardID, softwareID},
	}
	for _, p := range q1Pairs {
		tx := createTx(p.acctID, p.catID, p.date, p.txDesc, -p.amt, "DEBIT", "APPROVED", "", "", false, "")
		exp := createExp(p.date, p.vendor, p.expDesc, p.amt, p.tax, "card", p.catID, "APPROVED", "", "", true, nil)
		linkTxExp(exp.ID, tx.ID, "confirmed")
	}

	// Q1 Revenue, Refund & Transfers
	createTx(checkingID, serviceRevID, "2026-01-20", "ACH CREDIT RETAINER NORTHCO MANUFACTURING", 4250.00, "DEP", "APPROVED", "", "", false, "")
	createTx(checkingID, salesRevID, "2026-02-09", "SHOPIFY PAYOUT ONLINE STORE #204", 1920.00, "DEP", "APPROVED", "", "", false, "")
	createTx(checkingID, serviceRevID, "2026-02-26", "WIRE DEPOSIT HARBOR VIEW CLINIC", 3800.00, "DEP", "APPROVED", "", "", false, "")
	createTx(checkingID, returnsRevID, "2026-04-18", "CUSTOMER REFUND INV #204 RETURN", -185.00, "DEBIT", "APPROVED", "", "", false, "Customer return allowance (Schedule C Line 2)")
	createTx(checkingID, serviceRevID, "2026-03-25", "ACH CREDIT RETAINER NORTHCO MANUFACTURING", 4600.00, "DEP", "APPROVED", "", "", false, "")
	createTx(savingsID, interestRevID, "2026-03-31", "QUARTERLY INTEREST PAID SAVINGS", 48.20, "DEP", "APPROVED", "", "", false, "")

	// =========================================================================
	// SECTION B: Q2–Q4 2026 (OPEN PERIOD >= 2026-04-01) — ALL CORE WORKFLOWS
	// =========================================================================
	// B1. Revenue Inflows & Transfers (Apr–Nov 2026)
	revDeposits := []struct {
		date, desc string
		amt        float64
		acct, cat  *uint
	}{
		{"2026-04-15", "CANTON - POTSDAM POS SETTLEMENT #410", 2850.00, checkingID, salesRevID},
		{"2026-05-06", "ACH CREDIT NORTHERN TIER ARCHITECTS", 3900.00, checkingID, serviceRevID},
		{"2026-05-22", "SHOPIFY PAYOUT ONLINE STORE #319", 2140.00, checkingID, salesRevID},
		{"2026-06-12", "ACH CREDIT FINGER LAKES LOGISTICS", 4400.00, checkingID, serviceRevID},
		{"2026-06-30", "INTEREST CREDIT SAVINGS #9034", 54.15, savingsID, interestRevID},
		{"2026-07-18", "STRIPE TRANSFER WEB DESIGN MILESTONE", 3150.00, checkingID, serviceRevID},
		{"2026-08-13", "METAPAY*SHANNON GENAWA CONSULTING", 950.00, checkingID, serviceRevID},
		{"2026-09-18", "SHOPIFY PAYOUT FALL CATALOG #412", 2680.00, checkingID, salesRevID},
		{"2026-10-08", "CANTON - POTSDAM POS SETTLEMENT #812", 3120.00, checkingID, salesRevID},
		{"2026-11-04", "ACH CREDIT ONEIDA HEALTH PARTNERS", 4850.00, checkingID, serviceRevID},
		{"2026-11-10", "METAPAY*CLIENT DEPOSIT Q4 ENGAGEMENT", 1290.00, checkingID, serviceRevID},
	}
	for _, r := range revDeposits {
		createTx(r.acct, r.cat, r.date, r.desc, r.amt, "DEP", "APPROVED", "", "", false, "")
	}

	// Transfers & Balance Sheet Transactions (Asset/Liability/Equity debits auto-balance)
	transfers := []struct {
		date, desc string
		amt        float64
		acct, cat  *uint
		txType     string
		note       string
	}{
		{"2026-05-15", "TRANSFER TO TAX RESERVE SAVINGS #9034", -1000.00, checkingID, savingsID, "DEBIT", "Internal savings transfer"},
		{"2026-05-15", "TRANSFER FROM CHECKING #4821", 1000.00, savingsID, checkingID, "DEP", "Internal savings transfer"},
		{"2026-07-20", "CAPITAL ONE MOBILE PYMT CREDIT CARD", -1500.00, checkingID, creditCardID, "DEBIT", "Card balance payoff"},
		{"2026-07-20", "ONLINE PAYMENT THANK YOU", 1500.00, creditCardID, checkingID, "DEP", "Card payment received"},
		{"2026-08-28", "B&H PHOTO VIDEO WORKSTATION LAPTOP", -1899.00, creditCardID, equipmentID, "DEBIT", "Capital Equipment CapEx"},
		{"2026-09-15", "OWNER DISTRIBUTION CHECK #1042", -1200.00, checkingID, ownersDrawID, "DEBIT", "Owner's draw"},
		{"2026-10-15", "BANK LOAN PRINCIPAL AUTOPAY #2510", -425.00, checkingID, bankLoanID, "DEBIT", "Loan principal reduction"},
		{"2026-11-05", "OWNER DISTRIBUTION TRANSFER", -950.00, checkingID, ownersDrawID, "DEBIT", "November owner draw"},
	}
	for _, tr := range transfers {
		t := createTx(tr.acct, tr.cat, tr.date, tr.desc, tr.amt, tr.txType, "APPROVED", "", "", false, tr.note)
		db.DB.Model(&t).Update("allocation_status", "BALANCED")
	}

	// B2. Confirmed 1:1 Matched Purchases across ALL remaining Schedule C lines + 1099-NEC Contractors
	confirmedPairs := []struct {
		date, txDesc, vendor, expDesc string
		amt, tax                      float64
		acctID, catID                 *uint
	}{
		{"2026-04-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "April office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-04-14", "COSTCO WHOLESALE BULK MATERIALS", "Costco Business Center", "Direct merchandise packaging inventory", 389.40, 28.84, creditCardID, cogsID},
		{"2026-04-21", "SUNBELT RENTALS CAMERA RIG", "Sunbelt Rentals", "Video lighting & tripod rental (3 days)", 275.00, 20.37, creditCardID, equipRentalID},
		{"2026-05-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "May office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-05-12", "GOOGLE *ADS CAMPAIGN #4421", "Google Ads", "Spring local search ad campaign", 320.00, 0, creditCardID, advertisingID},
		{"2026-05-19", "NY DEPT OF STATE CORPS FILING FEE", "NY Dept of State", "Biennial business license & filing fee", 125.00, 0, checkingID, taxesLicensesID},
		{"2026-06-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "June office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-06-18", "ZELLE *ALEX RIVERA DESIGN LLC", "Alex Rivera Design LLC", "Contractor UI design sprint 1", 950.00, 0, checkingID, contractLaborID},
		{"2026-06-26", "DOLLAR GENERAL #17768", "Dollar General #17768", "Folders, legal pads, and pens", 13.87, 1.03, creditCardID, officeSuppliesID},
		{"2026-06-29", "EXXON MOUNTAIN MART #1", "Exxon Mountain Mart #1", "Unleaded fuel for client site visit", 48.75, 0, creditCardID, vehicleID},
		{"2026-07-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "July office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-07-11", "DELTA AIR LINES TICKET #0062", "Delta Air Lines", "Round-trip airfare client summit NYC", 412.60, 0, creditCardID, travelID},
		{"2026-07-12", "MARRIOTT HOTEL UTICA DOWNTOWN", "Marriott Hotels", "2-night lodging client workshop", 289.00, 32.10, creditCardID, travelID},
		{"2026-07-21", "SPECTRUM BUSINESS FIBER #0921", "Spectrum Business", "Monthly fiber internet service", 110.00, 0, checkingID, utilitiesID},
		{"2026-08-05", "NATIONAL GRID ELECTRIC #4410", "National Grid", "Electric utility service", 136.88, 0, checkingID, utilitiesID},
		{"2026-08-08", "CHECK #1084 NORTHSTAR ELECTRICAL", "Northstar Electrical Services", "Office wiring & panel upgrade contractor", 780.00, 0, checkingID, contractLaborID},
		{"2026-08-19", "ONONDAGA COMPUTER REPAIR LLC", "Onondaga IT Repair", "Server UPS battery & workstation repair", 215.00, 15.93, creditCardID, repairsID},
		{"2026-09-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "September office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-09-14", "ACH PAY ALEX RIVERA DESIGN LLC", "Alex Rivera Design LLC", "Contractor brand refresh sprint 2", 1150.00, 0, checkingID, contractLaborID},
		{"2026-09-20", "ULINE SHIPPING SUPPLIES #991", "Uline Shipping Supply", "Corrugated mailers & packing tape", 168.45, 12.48, creditCardID, suppliesMatID},
		{"2026-09-25", "THE HOME DEPOT #1248 HOME OFFICE", "The Home Depot", "Home office desk lighting & shelving", 189.00, 14.00, creditCardID, homeOfficeID},
		{"2026-10-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "October office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-10-10", "VENMO *JORDAN KIM COPYWRITING", "Jordan Kim Copywriting", "Website copywriting (under $600 1099)", 425.00, 0, checkingID, contractLaborID},
		{"2026-10-15", "CAPITAL ONE LOAN INTEREST CHARGE", "Capital One Auto/Term", "Term loan interest installment", 46.80, 0, checkingID, interestExpID},
		{"2026-10-18", "SECTION 179 ASSET DEPRECIATION ENTRY", "Dell Small Business", "Diagnostic monitor Section 179 writeoff", 650.00, 48.15, creditCardID, depreciationID},
		{"2026-10-22", "STRIPE MERCHANT PROCESSING FEES", "Stripe", "October card processing commissions", 142.80, 0, checkingID, merchantFeesID},
		{"2026-10-31", "SEACOMM MONTHLY ACCOUNT SERVICE FEE", "SEACOMM Federal CU", "Monthly commercial checking service fee", 15.00, 0, checkingID, bankFeesID},
		{"2026-11-02", "FACEBK *ADS MANAGER CAMPAIGN", "Meta Ads", "November social retargeting ads", 195.00, 0, creditCardID, advertisingID},
		{"2026-11-05", "ACH DEBIT MOHAWK MILL RENTALS STUDIO RENT", "Mohawk Mill Rentals", "November office & studio rent", 1650.00, 0, checkingID, rentID},
		{"2026-11-06", "NAPA AUTO PARTS #0812", "NAPA Auto Parts", "Company van wiper blades & oil filter", 86.40, 6.40, creditCardID, vehicleID},
		{"2026-11-08", "SPECTRUM BUSINESS FIBER #0921", "Spectrum Business", "November fiber internet service", 110.00, 0, checkingID, utilitiesID},
		{"2026-11-09", "ADOBE *CREATIVE CLOUD", "Adobe Creative Cloud", "November Creative Cloud team license", 59.99, 0, creditCardID, softwareID},
	}
	for _, p := range confirmedPairs {
		tx := createTx(p.acctID, p.catID, p.date, p.txDesc, -p.amt, "DEBIT", "APPROVED", "", "", false, "")
		exp := createExp(p.date, p.vendor, p.expDesc, p.amt, p.tax, "card", p.catID, "APPROVED", "", "", true, nil)
		linkTxExp(exp.ID, tx.ID, "confirmed")
	}

	// B3. High-Confidence Suggested Links (awaiting user click to confirm!)
	suggestedPairs := []struct {
		txDate, expDate, txDesc, vendor, expDesc string
		amt, tax                                 float64
		catID                                    *uint
	}{
		{"2026-08-14", "2026-08-12", "BOKIES BURGERS CATERING UTICA NY", "Bokie's Burgers & Catering", "Team lunch catering order", 84.60, 6.27, mealsID},
		{"2026-09-09", "2026-09-08", "THE HOME DEPOT #1248 NEW HARTFORD", "Home Depot #1248", "Heavy duty extension cords & surge strip", 142.38, 10.55, suppliesMatID},
		{"2026-10-04", "2026-10-02", "HOSLERS FAMILY RESTAURANT #1", "Hosler's Family Restaurant", "Client breakfast strategy meeting", 38.18, 2.83, mealsID},
	}
	for _, s := range suggestedPairs {
		tx := createTx(creditCardID, s.catID, s.txDate, s.txDesc, -s.amt, "DEBIT", "APPROVED", "", "", true, "Suggested match waiting")
		exp := createExp(s.expDate, s.vendor, s.expDesc, s.amt, s.tax, "card", s.catID, "APPROVED", "", "", true, nil)
		linkTxExp(exp.ID, tx.ID, "suggested")
	}

	// B4. 1-to-Many Split Transaction ($264.80 bank charge -> 2 split receipts totaling $264.80)
	splitTx := createTx(creditCardID, nil, "2026-08-24", "WAL-MART SUPERCENTER #3334 UTICA NY", -264.80, "DEBIT", "APPROVED", "", "", false, "Split across 2 categories")
	splitExp1 := createExp("2026-08-24", "Walmart Supercenter #3334", "LaserJet toner & copy paper (Split 1 of 2)", 164.80, 12.21, "card", officeSuppliesID, "APPROVED", "", "", true, nil)
	splitExp2 := createExp("2026-08-24", "Walmart Supercenter #3334", "Client meeting coffee & snacks (Split 2 of 2)", 100.00, 7.41, "card", mealsID, "APPROVED", "", "", true, nil)
	linkTxExp(splitExp1.ID, splitTx.ID, "confirmed")
	linkTxExp(splitExp2.ID, splitTx.ID, "confirmed")

	// B5. Many-to-1 Installments (3 x -$150.00 card installments linked to 1 $450.00 receipt)
	appleExp := createExp("2026-07-15", "Apple Store Business", "iPad Air Workstation (3 Monthly Installments)", 450.00, 33.33, "card", officeSuppliesID, "APPROVED", "", "", true, nil)
	for idx, dStr := range []string{"2026-07-15", "2026-08-01", "2026-08-15"} {
		instTx := createTx(creditCardID, officeSuppliesID, dStr, fmt.Sprintf("APPLE STORE INSTALLMENT %d OF 3", idx+1), -150.00, "DEBIT", "APPROVED", "", "", false, "Installment plan")
		linkTxExp(appleExp.ID, instTx.ID, "confirmed")
	}

	// B6. Allocation Warning Scenarios (Under-Allocated & Over-Allocated)
	underTx := createTx(creditCardID, vehicleID, "2026-09-16", "STEWART'S SHOP #331 POTSDAM NY", -68.50, "DEBIT", "APPROVED", "", "", false, "Under-allocated tx demo")
	underExpA := createExp("2026-09-16", "Stewart's Shop #331", "Fuel pump receipt (missing $15 car wash slip)", 53.50, 0, "card", vehicleID, "APPROVED", "", "", true, nil)
	linkTxExp(underExpA.ID, underTx.ID, "confirmed")

	underExpB := createExp("2026-10-14", "McDonald's #38918", "Working lunch ($10 split paid on second card)", 34.80, 2.58, "card", mealsID, "APPROVED", "", "", true, nil)
	partialTx := createTx(creditCardID, mealsID, "2026-10-14", "MCDONALD'S F38918 NEW HARTFORD", -24.80, "DEBIT", "APPROVED", "", "", false, "Partial card payment demo")
	linkTxExp(underExpB.ID, partialTx.ID, "confirmed")

	overTx := createTx(creditCardID, officeSuppliesID, "2026-10-21", "WAL-MART #3334 NEW HARTFORD NY", -95.00, "DEBIT", "APPROVED", "", "", false, "Over-allocated duplicate demo")
	overExp1 := createExp("2026-10-21", "Walmart #3334", "Desk organizers & surge protectors (1 of 2)", 55.00, 4.07, "card", officeSuppliesID, "APPROVED", "", "", true, nil)
	overExp2 := createExp("2026-10-21", "Walmart #3334", "Duplicate ink receipt causing $10 over-allocation", 50.00, 3.70, "card", officeSuppliesID, "APPROVED", "", "", true, nil)
	linkTxExp(overExp1.ID, overTx.ID, "confirmed")
	linkTxExp(overExp2.ID, overTx.ID, "confirmed")

	// B7. Unlinked Raw Bank Transactions (ideal for testing Rules & Manual Linking)
	createTx(creditCardID, nil, "2026-11-07", "STARBUCKS STORE 04421 UTICA NY", -8.95, "DEBIT", "APPROVED", "", "", false, "Uncategorized raw bank feed (test Apply Rules)")
	createTx(creditCardID, nil, "2026-11-08", "AMZN MKTP US*7X9K2 AMZN.COM/BILL", -64.20, "DEBIT", "APPROVED", "", "", false, "Uncategorized Amazon purchase")
	createTx(creditCardID, mealsID, "2026-11-09", "MCDONALD'S F38918 UTICA NY", -14.85, "DEBIT", "APPROVED", "", "", false, "Unlinked card debit")
	createTx(checkingID, vehicleID, "2026-11-11", "UBER *TRIP HELP.UBER.COM", -32.40, "DEBIT", "APPROVED", "", "", false, "Airport client ride")

	// B8. Cash Receipts (auto-BALANCED) & Unlinked Card Receipt
	createExp("2026-07-10", "Potsdam Hardware & Supply", "Replacement keys and lock lubricant", 24.50, 1.81, "cash", suppliesMatID, "APPROVED", "", "", true, nil)
	createExp("2026-09-28", "Village of Potsdam Parking", "Downtown municipal client meeting parking", 8.00, 0, "cash", vehicleID, "APPROVED", "", "", true, nil)
	createExp("2026-11-03", "FedEx Office #2140", "Overnight printed proposal packet (Cash)", 18.75, 1.39, "cash", suppliesMatID, "APPROVED", "", "", true, nil)
	createExp("2026-11-10", "Staples #0412", "Heavy-duty paper shredder & file tabs", 54.99, 4.07, "card", officeSuppliesID, "APPROVED", "", "", true, nil)

	// =========================================================================
	// SECTION C: ALL 4 REVIEW QUEUE STATES (+ ITEM AUDIT LOGS)
	// =========================================================================
	// 1. Action Required (PENDING) — Backdated items in closed Q1 period + unreviewed items
	createExp("2026-03-28", "Staples Backdated Scan", "Late uploaded binder receipt in closed Q1", 34.50, 2.56, "card", officeSuppliesID, "PENDING", "CLOSED_PERIOD", "Uploaded receipt dated inside closed Q1 period", true, nil)
	createTx(checkingID, bankFeesID, "2026-03-29", "WIRE TRANSFER RETURN FEE", -25.00, "DEBIT", "PENDING", "CLOSED_PERIOD", "Closed-period bank charge awaiting confirmation", false, "")

	// 2. Excluded Items (IGNORED) + Audit Logs
	exclExp := createExp("2026-07-14", "Netflix", "Personal home streaming subscription", 15.99, 1.18, "card", softwareID, "IGNORED", "PERSONAL", "Accidental swipe on business card; excluded as personal", true, nil)
	exclTx := createTx(creditCardID, softwareID, "2026-07-14", "NETFLIX.COM PERSONAL CHARGE", -15.99, "DEBIT", "IGNORED", "PERSONAL", "Matched excluded personal charge", false, "")
	linkTxExp(exclExp.ID, exclTx.ID, "confirmed")
	db.DB.Create(&models.ItemAuditLog{
		ItemType: "expense",
		ItemID:   exclExp.ID,
		Action:   "EXCLUDED",
		Reason:   "PERSONAL",
		Note:     demoMarker + " Excluded personal streaming charge from business P&L",
		GroupID:  "demo-group-personal-1",
	})
	db.DB.Create(&models.ItemAuditLog{
		ItemType: "transaction",
		ItemID:   exclTx.ID,
		Action:   "EXCLUDED",
		Reason:   "PERSONAL",
		Note:     demoMarker + " Excluded personal streaming charge from business P&L",
		GroupID:  "demo-group-personal-1",
	})

	// 3. Warnings Ignored (WARNINGS_IGNORED)
	createExp("2026-08-29", "NYS Thruway Authority", "E-ZPass toll replenish (warning silenced)", 25.00, 0, "card", vehicleID, "WARNINGS_IGNORED", "", "", true, nil)

	// 4. Soft-Deleted 30-Day Trash (DELETED)
	deletedExp := createExp("2026-10-19", "Duplicate Coffee Receipt", "Accidental duplicate scan moved to trash", 8.45, 0.62, "card", mealsID, "DELETED", "", "", true, nil)
	twoDaysAgo := time.Now().UTC().Add(-48 * time.Hour)
	db.DB.Model(&deletedExp).Update("deleted_at", twoDaysAgo)

	// =========================================================================
	// SECTION D: COMPREHENSIVE CLIENT INVOICES (ALL STATUSES & A/R AGING BUCKETS)
	// =========================================================================
	makeItems := func(items []models.InvoiceLineItem) (string, models.Money) {
		var subCents int64
		for i := range items {
			c := models.NewMoney(items[i].UnitPrice).Cents * int64(items[i].Quantity)
			// Handle fractional quantity cleanly via float round once into integer cents
			if float64(int64(items[i].Quantity)) != items[i].Quantity {
				c = models.NewMoney(items[i].Quantity * items[i].UnitPrice).Cents
			}
			items[i].Amount = models.Money{Cents: c}
			subCents += c
		}
		b, _ := json.Marshal(items)
		return string(b), models.Money{Cents: subCents}
	}

	nowDay := time.Now().UTC()
	daysAgo := func(d int) time.Time {
		t := nowDay.AddDate(0, 0, -d)
		return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC)
	}
	daysFromNow := func(d int) time.Time {
		t := nowDay.AddDate(0, 0, d)
		return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC)
	}

	// 1. PAID via Bank Deposit
	depPaid1 := createTx(checkingID, serviceRevID, "2026-09-22", "ACH DEPOSIT SHANNON GENAWA DESIGN RETAINER", 3250.00, "DEP", "APPROVED", "", "", false, "Matched INV-DEMO-001")
	items1, sub1 := makeItems([]models.InvoiceLineItem{
		{Description: "Custom UI/UX Architecture & Prototyping", Quantity: 25, UnitPrice: 130.00},
	})
	paidDate1 := mustDate("2026-09-22")
	inv1 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "001",
		ClientName:        "Shannon Genawa",
		ClientEmail:       "shannon@genawastudio.example",
		ClientAddress:     "123 Genesee St, Utica, NY 13501",
		IssueDate:         mustDate("2026-09-01"),
		DueDate:           mustDate("2026-10-01"),
		Items:             items1,
		Subtotal:          sub1,
		TaxRate:           0,
		TaxAmount:         models.NewMoney(0),
		TotalAmount:       sub1,
		AmountPaid:        sub1,
		BalanceDue:        models.NewMoney(0),
		Notes:             demoMarker + " Settled in full via ACH checking deposit.",
		PaymentTerms:      "Net 30",
		Status:            "PAID",
		PaidDate:          &paidDate1,
		BankTransactionID: &depPaid1.ID,
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv1)

	// 2. PAID in Cash (Manual balanced 1030 Cash on Hand DEP transaction matching CASH-INV- convention)
	cashPaidDate := mustDate("2026-10-12")
	items2, sub2 := makeItems([]models.InvoiceLineItem{
		{Description: "On-Site POS Hardware Troubleshooting (4 hrs)", Quantity: 4, UnitPrice: 162.50},
	})
	inv2 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "002",
		ClientName:        "Mohawk Coffee Roasters",
		ClientEmail:       "accounts@mohawkcoffee.example",
		ClientAddress:     "448 Varick St, Utica, NY 13502",
		IssueDate:         mustDate("2026-10-08"),
		DueDate:           mustDate("2026-10-23"),
		Items:             items2,
		Subtotal:          sub2,
		TotalAmount:       sub2,
		AmountPaid:        sub2,
		BalanceDue:        models.NewMoney(0),
		Notes:             demoMarker + " Settled in cash at counter pickup.",
		PaymentTerms:      "Net 15",
		Status:            "PAID",
		PaidDate:          &cashPaidDate,
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv2)
	cashTx := models.BankTransaction{
		ChartAccountID:    cashOnHandID,
		CategoryAccountID: serviceRevID,
		Date:              cashPaidDate,
		Description:       fmt.Sprintf("Cash Payment: Invoice %s (Mohawk Coffee Roasters)", inv2.InvoiceNumber),
		Amount:            sub2,
		TransactionType:   "DEP",
		FITID:             fmt.Sprintf("%s%d-%d", demoCashInvPrefix, inv2.ID, time.Now().UnixNano()),
		IsManual:          true,
		AllocationStatus:  "BALANCED",
		ReviewStatus:      "APPROVED",
		Notes:             demoMarker + " Paid in cash",
	}
	db.DB.Create(&cashTx)
	db.DB.Model(&inv2).Update("bank_transaction_id", cashTx.ID)

	// 3. SENT (Current, with UNMATCHED exact Checking deposit ready for 1-click Match!)
	createTx(checkingID, serviceRevID, daysAgo(2).Format("2006-01-02"), "ACH DEPOSIT MOHAWK VALLEY DENTAL CLINIC", 1450.00, "DEP", "APPROVED", "", "", false, "Unmatched deposit matching INV-DEMO-003")
	items3, sub3 := makeItems([]models.InvoiceLineItem{
		{Description: "Network Security Audit & Firewall Upgrade", Quantity: 1, UnitPrice: 1450.00},
	})
	inv3 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "003",
		ClientName:        "Mohawk Valley Dental",
		ClientEmail:       "billing@mvdental.example",
		ClientAddress:     "2100 Bleecker St, New Hartford, NY 13413",
		IssueDate:         daysAgo(5),
		DueDate:           daysFromNow(25),
		Items:             items3,
		Subtotal:          sub3,
		TotalAmount:       sub3,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub3,
		Notes:             demoMarker + " Ready to auto-reconcile or 1-click match against $1,450 checking deposit!",
		PaymentTerms:      "Net 30",
		Status:            "SENT",
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv3)

	// 4. PARTIALLY_PAID (50% deposit matched + 50% second deposit awaiting match)
	depPart1 := createTx(checkingID, serviceRevID, daysAgo(14).Format("2006-01-02"), "WIRE DEPOSIT 1 SYRACUSE LOGISTICS CO", 1200.00, "DEP", "APPROVED", "", "", false, "50% upfront retainer")
	createTx(checkingID, serviceRevID, daysAgo(1).Format("2006-01-02"), "WIRE DEPOSIT 2 SYRACUSE LOGISTICS CO", 1200.00, "DEP", "APPROVED", "", "", false, "Final $1,200 installment waiting to match")
	items4, sub4 := makeItems([]models.InvoiceLineItem{
		{Description: "Warehouse Inventory Dashboard Implementation", Quantity: 20, UnitPrice: 120.00},
	})
	inv4 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "004",
		ClientName:        "Syracuse Logistics Co.",
		ClientEmail:       "ap@syracuselogistics.example",
		ClientAddress:     "780 Spencer St, Syracuse, NY 13204",
		IssueDate:         daysAgo(20),
		DueDate:           daysFromNow(10),
		Items:             items4,
		Subtotal:          sub4,
		TotalAmount:       sub4,
		AmountPaid:        models.NewMoney(1200.00),
		BalanceDue:        models.NewMoney(1200.00),
		Notes:             demoMarker + " 50% deposit received; final $1,200 wire arrived in Checking!",
		PaymentTerms:      "Net 30",
		Status:            "PARTIALLY_PAID",
		BankTransactionID: &depPart1.ID,
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv4)

	// 5. OVERDUE (1–30 Days Bucket)
	items5, sub5 := makeItems([]models.InvoiceLineItem{
		{Description: "E-Commerce Checkout Performance Optimization", Quantity: 1, UnitPrice: 980.00},
	})
	inv5 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "005",
		ClientName:        "Apex Retail Group",
		ClientEmail:       "finance@apexretail.example",
		ClientAddress:     "905 Seneca Turnpike, Clinton, NY 13323",
		IssueDate:         daysAgo(48),
		DueDate:           daysAgo(18),
		Items:             items5,
		Subtotal:          sub5,
		TotalAmount:       sub5,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub5,
		Notes:             demoMarker + " Follow-up reminder sent.",
		PaymentTerms:      "Net 30",
		Status:            "OVERDUE",
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv5)

	// 6. OVERDUE (31–60 Days Bucket) + Linked Billable Expense!
	items6, sub6 := makeItems([]models.InvoiceLineItem{
		{Description: "Shop Floor Barcode Integration & Server Setup", Quantity: 1, UnitPrice: 1850.00},
		{Description: "Industrial Scanner Hardware Pass-through", Quantity: 1, UnitPrice: 300.00},
	})
	inv6 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "006",
		ClientName:        "Utica Precision Machining",
		ClientEmail:       "billing@uticaprecision.example",
		ClientAddress:     "1400 Broad St, Utica, NY 13501",
		IssueDate:         daysAgo(72),
		DueDate:           daysAgo(42),
		Items:             items6,
		Subtotal:          sub6,
		TotalAmount:       sub6,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub6,
		Notes:             demoMarker + " Includes linked billable hardware expense.",
		PaymentTerms:      "Net 30",
		Status:            "OVERDUE",
		CategoryAccountID: salesRevID,
	}
	db.DB.Create(&inv6)

	// Attach a linked billable expense directly to INV-DEMO-006
	billableTx := createTx(creditCardID, cogsID, daysAgo(55).Format("2006-01-02"), "CDW *BARCODE SCANNER HARDWARE", -284.50, "DEBIT", "APPROVED", "", "", false, "Billable hardware for Utica Precision")
	billableExp := createExp(daysAgo(55).Format("2006-01-02"), "CDW Direct", "Zebra handheld barcode scanner for INV-DEMO-006", 284.50, 21.07, "card", cogsID, "APPROVED", "", "", true, &inv6.ID)
	linkTxExp(billableExp.ID, billableTx.ID, "confirmed")

	// 7. OVERDUE (61–90+ Days Bucket)
	items7, sub7 := makeItems([]models.InvoiceLineItem{
		{Description: "Commercial Office Network Cabling Phase II", Quantity: 1, UnitPrice: 3400.00},
	})
	inv7 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "007",
		ClientName:        "Empire State Properties",
		ClientEmail:       "ap@empireproperties.example",
		ClientAddress:     "258 Genesee St, Utica, NY 13502",
		IssueDate:         daysAgo(128),
		DueDate:           daysAgo(98),
		Items:             items7,
		Subtotal:          sub7,
		TotalAmount:       sub7,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub7,
		Notes:             demoMarker + " Senior A/R aging follow-up required.",
		PaymentTerms:      "Net 30",
		Status:            "OVERDUE",
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv7)

	// 8. SENT (Upcoming Due Date)
	items8, sub8 := makeItems([]models.InvoiceLineItem{
		{Description: "Monthly Cloud Hosting & Managed Support (Nov)", Quantity: 1, UnitPrice: 850.00},
	})
	inv8 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "008",
		ClientName:        "Rome Civic Center",
		ClientEmail:       "finance@romecivic.example",
		ClientAddress:     "198 N Washington St, Rome, NY 13440",
		IssueDate:         daysAgo(3),
		DueDate:           daysFromNow(27),
		Items:             items8,
		Subtotal:          sub8,
		TotalAmount:       sub8,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub8,
		Notes:             demoMarker + " Monthly retainer invoice.",
		PaymentTerms:      "Net 30",
		Status:            "SENT",
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv8)

	// 9. DRAFT Invoice
	items9, sub9 := makeItems([]models.InvoiceLineItem{
		{Description: "2027 Annual Cybersecurity & Backup Retainer", Quantity: 1, UnitPrice: 1600.00},
	})
	inv9 := models.Invoice{
		InvoiceNumber:     demoInvoiceNumPrefix + "009",
		ClientName:        "Oneida Tech Partners",
		ClientEmail:       "ops@oneidatech.example",
		ClientAddress:     "301 Turner St, Utica, NY 13501",
		IssueDate:         nowDay,
		DueDate:           daysFromNow(30),
		Items:             items9,
		Subtotal:          sub9,
		TotalAmount:       sub9,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        sub9,
		Notes:             demoMarker + " Draft proposal awaiting client sign-off.",
		PaymentTerms:      "Net 30",
		Status:            "DRAFT",
		CategoryAccountID: serviceRevID,
	}
	db.DB.Create(&inv9)

	// Final recompute of all allocation statuses
	UpdateAllocationStatuses()

	log.Println("✅ Rich Jan–Nov 2026 demo dataset seeded successfully!")
	return GetDemoDatasetStatus()
}
