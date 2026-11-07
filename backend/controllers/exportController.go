package controllers

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
)

// ExportTransactionsCSV streams all bank transactions for the filtered range as CSV.
func ExportTransactionsCSV(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")

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

	var txs []models.BankTransaction
	if err := query.Order("date DESC").Preload("ChartAccount").Preload("Category").Find(&txs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch transactions"})
	}

	buf := new(bytes.Buffer)
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
			if tx.Amount > 0 {
				allocStatus = "BALANCED"
			} else {
				allocStatus = "UNLINKED"
			}
		}

		_ = writer.Write([]string{
			dateStr,
			tx.Description,
			fmt.Sprintf("%.2f", tx.Amount),
			tx.TransactionType,
			bankCode,
			bankName,
			catCode,
			catName,
			allocStatus,
			tx.ReviewStatus,
			tx.Notes,
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

	query := db.DB.Model(&models.Expense{}).Where(inBooksClause)
	query = ApplyDateRange(query, "timestamp", startDate, endDate)

	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
			query = query.Where("chart_account_id IN ?", accountIDs)
		} else {
			query = query.Where("chart_account_id = ?", accountId)
		}
	}

	var exps []models.Expense
	if err := query.Order("timestamp DESC").Preload("ChartAccount").Find(&exps).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch expenses"})
	}

	buf := new(bytes.Buffer)
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
			exp.Vendor,
			exp.Description,
			fmt.Sprintf("%.2f", exp.Amount),
			fmt.Sprintf("%.2f", exp.TaxAmount),
			exp.Tender,
			catCode,
			catName,
			allocStatus,
			exp.ReviewStatus,
			exp.Notes,
		})
	}
	writer.Flush()

	filename := fmt.Sprintf("expenses-%s.csv", time.Now().Format("2006-01-02"))
	c.Set("Content-Type", "text/csv; charset=utf-8")
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	return c.Send(buf.Bytes())
}
