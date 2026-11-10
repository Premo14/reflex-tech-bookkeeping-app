package controllers

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// sanitizeCSVCell neutralizes CSV formula injection attacks by prefixing
// any cell starting with '=', '+', '-', '@', '\t', or '\r' with a single quote.
func sanitizeCSVCell(v string) string {
	if len(v) == 0 {
		return v
	}
	trimmed := strings.TrimSpace(v)
	if len(trimmed) > 0 {
		first := trimmed[0]
		if first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r' {
			return "'" + v
		}
	}
	if v[0] == '\t' || v[0] == '\r' {
		return "'" + v
	}
	return v
}

// ExportTransactionsCSV streams all bank transactions for the filtered range as CSV.
func ExportTransactionsCSV(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")
	search := strings.TrimSpace(c.Query("search"))

	query := db.DB.Model(&models.BankTransaction{}).Where(inBooksClause)
	query = ApplyDateRange(query, "date", startDate, endDate)

	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
			query = query.Where("chart_account_id IN ? OR category_account_id IN ?", accountIDs, accountIDs)
		} else {
			query = query.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId)
		}
	}

	if search != "" {
		if val, err := strconv.ParseFloat(strings.TrimPrefix(search, "$"), 64); err == nil {
			query = query.Where("description ILIKE ? OR ABS(amount) = ?", "%"+search+"%", math.Abs(val))
		} else {
			query = query.Where("description ILIKE ?", "%"+search+"%")
		}
	}

	var txs []models.BankTransaction
	if err := query.Order("date DESC").Preload("ChartAccount").Preload("Category").Find(&txs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch transactions"})
	}

	buf := new(bytes.Buffer)
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(buf)

	// CSV Header
	_ = writer.Write([]string{
		"Date",
		"Description",
		"Amount",
		"Type",
		"Bank Account Code",
		"Bank Account Name",
		"Category Code",
		"Category Name",
		"Allocation Status",
		"Review Status",
		"Notes",
	})

	for _, tx := range txs {
		dateStr := tx.Date.Format("2006-01-02")
		bankCode := ""
		bankName := ""
		if tx.ChartAccount != nil {
			bankCode = tx.ChartAccount.Code
			bankName = tx.ChartAccount.Name
		}
		catCode := ""
		catName := ""
		if tx.Category != nil {
			catCode = tx.Category.Code
			catName = tx.Category.Name
		}
		allocStatus := tx.AllocationStatus
		if allocStatus == "" {
			if tx.Amount >= 0 {
				allocStatus = "BALANCED"
			} else {
				allocStatus = "UNLINKED"
			}
		}

		_ = writer.Write([]string{
			dateStr,
			sanitizeCSVCell(tx.Description),
			fmt.Sprintf("%.2f", tx.Amount),
			sanitizeCSVCell(tx.TransactionType),
			sanitizeCSVCell(bankCode),
			sanitizeCSVCell(bankName),
			sanitizeCSVCell(catCode),
			sanitizeCSVCell(catName),
			sanitizeCSVCell(allocStatus),
			sanitizeCSVCell(tx.ReviewStatus),
			sanitizeCSVCell(tx.Notes),
		})
	}
	writer.Flush()

	filename := fmt.Sprintf("bank-transactions-%s.csv", time.Now().Format("2006-01-02"))
	c.Set("Content-Type", "text/csv; charset=utf-8")
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	return c.Send(buf.Bytes())
}

// ExportExpensesCSV streams all expenses for the filtered range as CSV.
func ExportExpensesCSV(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")
	search := strings.TrimSpace(c.Query("search"))

	query := db.DB.Model(&models.Expense{}).Where(inBooksClause)
	query = ApplyDateRange(query, "timestamp", startDate, endDate)

	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
			query = query.Where(
				"chart_account_id IN ? OR id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE ebt.status = 'confirmed' AND bt.chart_account_id IN ?)",
				accountIDs, accountIDs,
			)
		} else {
			query = query.Where("chart_account_id = ?", accountId)
		}
	}

	if search != "" {
		if val, err := strconv.ParseFloat(strings.TrimPrefix(search, "$"), 64); err == nil {
			query = query.Where("vendor ILIKE ? OR description ILIKE ? OR amount = ?", "%"+search+"%", "%"+search+"%", math.Abs(val))
		} else {
			query = query.Where("vendor ILIKE ? OR description ILIKE ?", "%"+search+"%", "%"+search+"%")
		}
	}

	var exps []models.Expense
	if err := query.Order("timestamp DESC").Preload("ChartAccount").Find(&exps).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch expenses"})
	}

	buf := new(bytes.Buffer)
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(buf)

	// CSV Header
	_ = writer.Write([]string{
		"Date",
		"Vendor",
		"Description",
		"Amount",
		"Tax Amount",
		"Tender",
		"Category Code",
		"Category Name",
		"Allocation Status",
		"Review Status",
		"Notes",
	})

	for _, exp := range exps {
		dateStr := exp.Timestamp.Format("2006-01-02")
		catCode := ""
		catName := ""
		if exp.ChartAccount != nil {
			catCode = exp.ChartAccount.Code
			catName = exp.ChartAccount.Name
		}
		allocStatus := exp.AllocationStatus
		if allocStatus == "" {
			if exp.Tender == "cash" || exp.Tender == "CASH" {
				allocStatus = "BALANCED"
			} else {
				allocStatus = "UNLINKED"
			}
		}

		_ = writer.Write([]string{
			dateStr,
			sanitizeCSVCell(exp.Vendor),
			sanitizeCSVCell(exp.Description),
			fmt.Sprintf("%.2f", exp.Amount),
			fmt.Sprintf("%.2f", exp.TaxAmount),
			sanitizeCSVCell(exp.Tender),
			sanitizeCSVCell(catCode),
			sanitizeCSVCell(catName),
			sanitizeCSVCell(allocStatus),
			sanitizeCSVCell(exp.ReviewStatus),
			sanitizeCSVCell(exp.Notes),
		})
	}
	writer.Flush()

	filename := fmt.Sprintf("expenses-%s.csv", time.Now().Format("2006-01-02"))
	c.Set("Content-Type", "text/csv; charset=utf-8")
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	return c.Send(buf.Bytes())
}

var safeFileNameRegex = regexp.MustCompile(`[^a-zA-Z0-9_\-\.]`)

func sanitizePathSegment(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "\\", "_")
	s = safeFileNameRegex.ReplaceAllString(s, "")
	if s == "" {
		return "uncategorized"
	}
	return s
}

// ExportTaxPackZip bundles the Schedule C tax summary, full transaction register,
// and all underlying receipt files organized by tax line into a single ZIP archive.
func ExportTaxPackZip(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	yearStr := c.Query("year")

	var year int
	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			year = y
		}
	}
	if year == 0 {
		year = time.Now().Year()
	}
	if startDate == "" && endDate == "" {
		startDate = fmt.Sprintf("%d-01-01", year)
		endDate = fmt.Sprintf("%d-12-31", year)
	}

	report, err := BuildScheduleCData(startDate, endDate, year)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to compile tax pack data: " + err.Error(),
		})
	}

	zipBuf := new(bytes.Buffer)
	zw := zip.NewWriter(zipBuf)

	// --- 1. Schedule_C_Tax_Summary.csv ---
	summaryBuf := new(bytes.Buffer)
	summaryBuf.WriteString("\xEF\xBB\xBF") // UTF-8 BOM
	sw := csv.NewWriter(summaryBuf)

	_ = sw.Write([]string{"IRS FORM 1040 SCHEDULE C - TAX SUMMARY"})
	_ = sw.Write([]string{fmt.Sprintf("Tax Year: %d | Period: %s to %s", report.Year, report.StartDate, report.EndDate)})
	_ = sw.Write([]string{fmt.Sprintf("Generated: %s", time.Now().Format("2006-01-02 15:04:05"))})
	_ = sw.Write([]string{})

	// Part I: Income
	_ = sw.Write([]string{"PART I: INCOME", "LINE NUMBER", "AMOUNT"})
	_ = sw.Write([]string{"Gross receipts or sales", "Line 1", fmt.Sprintf("%.2f", report.GrossReceipts)})
	_ = sw.Write([]string{"Returns and allowances", "Line 2", fmt.Sprintf("%.2f", report.ReturnsAndAllowances)})
	_ = sw.Write([]string{"Net receipts (Line 1 - Line 2)", "Line 3", fmt.Sprintf("%.2f", report.NetReceipts)})
	_ = sw.Write([]string{"Cost of goods sold", "Line 4", fmt.Sprintf("%.2f", report.CostOfGoodsSold)})
	_ = sw.Write([]string{"Gross profit (Line 3 - Line 4)", "Line 5", fmt.Sprintf("%.2f", report.GrossProfit)})
	_ = sw.Write([]string{"Other income (interest, credits, etc.)", "Line 6", fmt.Sprintf("%.2f", report.OtherIncome)})
	_ = sw.Write([]string{"Gross income (Line 5 + Line 6)", "Line 7", fmt.Sprintf("%.2f", report.GrossIncome)})
	_ = sw.Write([]string{})

	// Part II: Expenses
	_ = sw.Write([]string{"PART II: EXPENSES", "LINE NUMBER", "GROSS AMOUNT", "DEDUCTIBLE %", "ALLOWABLE DEDUCTION"})
	for _, l := range report.ExpenseLines {
		_ = sw.Write([]string{
			l.LineName,
			l.LineNumber,
			fmt.Sprintf("%.2f", l.GrossAmount),
			fmt.Sprintf("%.0f%%", l.DeductiblePercent),
			fmt.Sprintf("%.2f", l.DeductibleAmount),
		})
	}
	_ = sw.Write([]string{})
	_ = sw.Write([]string{"TOTAL EXPENSES", "Line 28", fmt.Sprintf("%.2f", report.TotalExpensesGross), "", fmt.Sprintf("%.2f", report.TotalExpensesDeductible)})
	_ = sw.Write([]string{"Nondeductible 50% Meals (IRS Limit)", "Line 24b Adj", fmt.Sprintf("%.2f", report.NondeductibleMeals), "", "0.00"})
	_ = sw.Write([]string{"NET PROFIT OR (LOSS)", "Line 31", "", "", fmt.Sprintf("%.2f", report.NetProfitOrLoss)})

	if report.UncategorizedExpenseAmount > 0 || report.UncategorizedIncomeAmount > 0 {
		_ = sw.Write([]string{})
		_ = sw.Write([]string{"CAUTION / SUSPENSE ITEMS REQUIRING ATTENTION BEFORE TAX FILING"})
		if report.UncategorizedExpenseAmount > 0 {
			_ = sw.Write([]string{"Uncategorized Expenses", "Suspense 9999", fmt.Sprintf("%.2f", report.UncategorizedExpenseAmount)})
		}
		if report.UncategorizedIncomeAmount > 0 {
			_ = sw.Write([]string{"Uncategorized Deposits / Income", "Suspense 9998", fmt.Sprintf("%.2f", report.UncategorizedIncomeAmount)})
		}
	}
	sw.Flush()

	fSummary, err := zw.Create(fmt.Sprintf("Schedule_C_Tax_Summary_%d.csv", report.Year))
	if err == nil {
		_, _ = fSummary.Write(summaryBuf.Bytes())
	}

	// --- 2. All_Transactions_Detailed.csv ---
	txBuf := new(bytes.Buffer)
	txBuf.WriteString("\xEF\xBB\xBF")
	tw := csv.NewWriter(txBuf)

	_ = tw.Write([]string{
		"Date",
		"Record Type",
		"Description / Vendor",
		"Amount ($)",
		"Tax Amount ($)",
		"Account Code",
		"Account Name",
		"Schedule C Line",
		"Status",
		"Reference / Notes",
	})

	// Bank transactions
	var txs []models.BankTransaction
	txQ := db.DB.Model(&models.BankTransaction{}).Where(inBooksClause).Preload("ChartAccount").Preload("Category")
	txQ = ApplyDateRange(txQ, "date", startDate, endDate)
	_ = txQ.Order("date ASC").Find(&txs).Error

	for _, t := range txs {
		catCode := ""
		catName := ""
		schedLine := ""
		if t.Category != nil {
			catCode = t.Category.Code
			catName = t.Category.Name
			schedLine = t.Category.ScheduleCLine
			if schedLine == "" {
				lNum, lName, _ := resolveScheduleCLine(*t.Category)
				schedLine = lNum + " - " + lName
			}
		}
		_ = tw.Write([]string{
			t.Date.Format("2006-01-02"),
			"BANK_TRANSACTION",
			sanitizeCSVCell(t.Description),
			fmt.Sprintf("%.2f", t.Amount),
			"0.00",
			sanitizeCSVCell(catCode),
			sanitizeCSVCell(catName),
			sanitizeCSVCell(schedLine),
			sanitizeCSVCell(t.AllocationStatus),
			sanitizeCSVCell(t.Notes),
		})
	}

	// Expenses
	var exps []models.Expense
	expQ := db.DB.Model(&models.Expense{}).Where(inBooksClause).Preload("ChartAccount").Preload("Receipts")
	expQ = ApplyDateRange(expQ, "timestamp", startDate, endDate)
	_ = expQ.Order("timestamp ASC").Find(&exps).Error

	receiptCount := 0
	for _, e := range exps {
		catCode := ""
		catName := ""
		schedLine := ""
		if e.ChartAccount != nil {
			catCode = e.ChartAccount.Code
			catName = e.ChartAccount.Name
			schedLine = e.ChartAccount.ScheduleCLine
			if schedLine == "" {
				lNum, lName, _ := resolveScheduleCLine(*e.ChartAccount)
				schedLine = lNum + " - " + lName
			}
		}
		_ = tw.Write([]string{
			e.Timestamp.Format("2006-01-02"),
			"EXPENSE_RECEIPT",
			sanitizeCSVCell(e.Vendor + " - " + e.Description),
			fmt.Sprintf("%.2f", e.Amount),
			fmt.Sprintf("%.2f", e.TaxAmount),
			sanitizeCSVCell(catCode),
			sanitizeCSVCell(catName),
			sanitizeCSVCell(schedLine),
			sanitizeCSVCell(e.AllocationStatus),
			sanitizeCSVCell(e.Notes),
		})
	}
	tw.Flush()

	fTxs, err := zw.Create(fmt.Sprintf("All_Transactions_%d.csv", report.Year))
	if err == nil {
		_, _ = fTxs.Write(txBuf.Bytes())
	}

	// --- 3. Organized Receipts Directory ---
	manifestBuf := new(bytes.Buffer)
	manifestBuf.WriteString(fmt.Sprintf("REFLEX TECH BOOKKEEPING — TAX PACK RECEIPTS MANIFEST (%d)\n", report.Year))
	manifestBuf.WriteString(fmt.Sprintf("Period: %s to %s\n\n", report.StartDate, report.EndDate))
	manifestBuf.WriteString("This folder contains all audit-ready receipt images and PDF documents organized by IRS Schedule C tax category.\n\n")

	for _, e := range exps {
		if len(e.Receipts) == 0 {
			continue
		}
		folderName := "Uncategorized"
		if e.ChartAccount != nil {
			lNum, lName, _ := resolveScheduleCLine(*e.ChartAccount)
			folderName = sanitizePathSegment(fmt.Sprintf("%s_%s", lNum, lName))
		}

		cleanVendor := sanitizePathSegment(e.Vendor)
		if cleanVendor == "" {
			cleanVendor = "Expense"
		}

		for idx, r := range e.Receipts {
			filePath := r.DocumentURI
			if filePath == "" {
				continue
			}

			// Read receipt file
			fileData, readErr := os.ReadFile(filePath)
			if readErr != nil {
				// Note missing physical file in manifest
				manifestBuf.WriteString(fmt.Sprintf("[MISSING] Expense ID %d (%s $%.2f) - %s (not found on disk)\n", e.ID, e.Vendor, e.Amount, filePath))
				continue
			}

			ext := filepath.Ext(filePath)
			if ext == "" {
				ext = r.FileExt
			}
			if ext == "" {
				ext = ".png"
			}

			var zipEntryName string
			if len(e.Receipts) == 1 {
				zipEntryName = fmt.Sprintf("Receipts/%s/REC_%d_%s_$%.2f%s", folderName, e.ID, cleanVendor, e.Amount, ext)
			} else {
				zipEntryName = fmt.Sprintf("Receipts/%s/REC_%d_pt%d_%s_$%.2f%s", folderName, e.ID, idx+1, cleanVendor, e.Amount, ext)
			}

			fReceipt, createErr := zw.Create(zipEntryName)
			if createErr == nil {
				_, _ = io.Copy(fReceipt, bytes.NewReader(fileData))
				receiptCount++
				manifestBuf.WriteString(fmt.Sprintf("[INCLUDED] %s -> %s\n", zipEntryName, filePath))
			}
		}
	}

	manifestBuf.WriteString(fmt.Sprintf("\nTotal Receipts Archived: %d\n", receiptCount))
	fManifest, err := zw.Create("Receipts/README_MANIFEST.txt")
	if err == nil {
		_, _ = fManifest.Write(manifestBuf.Bytes())
	}

	_ = zw.Close()

	zipFilename := fmt.Sprintf("Tax_Pack_%d.zip", report.Year)
	c.Set("Content-Type", "application/zip")
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipFilename))
	return c.Send(zipBuf.Bytes())
}
