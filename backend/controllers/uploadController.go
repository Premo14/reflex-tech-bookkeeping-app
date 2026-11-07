package controllers

import (
	"fmt"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

// UploadFile receives a file from the frontend and saves it to the inbox.
// Thanks to watcher.go, we just need to save it and return success.
func UploadFile(c fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No file uploaded"})
	}

	ext := filepath.Ext(file.Filename)

	if !constants.IsAllowedReceiptExt(ext) && !constants.IsAllowedBankStatementExt(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	safeFileName := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	savePath := filepath.Join(constants.GetInboxPath(), safeFileName)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save file"})
	}
	_ = os.Chmod(savePath, 0666)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}

// UploadReceiptToExpense allows manual attachment of a receipt file directly to an existing expense.
func UploadReceiptToExpense(c fiber.Ctx) error {
	expenseId := c.Params("id")
	if expenseId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing expense ID"})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No file uploaded"})
	}

	ext := filepath.Ext(file.Filename)
	if !constants.IsAllowedReceiptExt(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	safeFileName := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	savePath := filepath.Join(constants.GetProcessedPath(), safeFileName)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save file"})
	}
	_ = os.Chmod(savePath, 0666)

	// Create Receipt DB record
	var expense models.Expense
	if err := db.DB.First(&expense, expenseId).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Generate hash of the actual file contents to prevent duplicates
	hashStr, err := utils.HashFile(savePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash file"})
	}
	
	var documentURI = filepath.Join(constants.GetProcessedPath(), safeFileName)

	// Check if this file was already uploaded to ANY expense (global deduplication)
	var existingReceipt models.Receipt
	if err := db.DB.Preload("Expense").Where("file_hash = ?", hashStr).First(&existingReceipt).Error; err == nil {
		allowDuplicate := c.FormValue("allowDuplicate") == "true"
		if !allowDuplicate {
			// Duplicate found and bypass not requested
			os.Remove(savePath) // Cleanup the duplicate file
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":           "Duplicate receipt",
				"existingExpense": existingReceipt.Expense,
			})
		}
		// If allowDuplicate is true, use the existing file and delete the new temporary copy
		os.Remove(savePath)
		documentURI = existingReceipt.DocumentURI
	}

	receipt := models.Receipt{
		ExpenseID:   &expense.ID,
		DocumentURI: documentURI,
		FileExt:     ext,
		FileHash:    hashStr,
	}

	if err := db.DB.Create(&receipt).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create receipt record"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"receipt": receipt,
	})
}

// DeleteReceipt removes a receipt record and deletes the physical file from the processed folder
// only if no other receipts are referencing the same physical file.
func DeleteReceipt(c fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing receipt ID"})
	}

	var receipt models.Receipt
	if err := db.DB.First(&receipt, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Receipt not found"})
	}

	// Delete the DB record first
	if err := db.DB.Delete(&receipt).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete receipt record"})
	}

	// Check if any OTHER receipts are referencing the same physical file
	var count int64
	db.DB.Model(&models.Receipt{}).Where("document_uri = ?", receipt.DocumentURI).Count(&count)

	if count == 0 {
		// No other receipts reference this file, safe to delete
		if err := os.Remove(receipt.DocumentURI); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: failed to delete physical file %s: %v\n", receipt.DocumentURI, err)
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}
