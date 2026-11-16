package controllers

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
)

// magicBytes defines expected magic byte prefixes for non-container binary formats.
var magicBytes = map[string][][]byte{
	".png":  {{0x89, 0x50, 0x4E, 0x47}},
	".jpg":  {{0xFF, 0xD8, 0xFF}},
	".jpeg": {{0xFF, 0xD8, 0xFF}},
	".pdf":  {{0x25, 0x50, 0x44, 0x46}},
}

// validHEICBrands are ISO-BMFF major brands seen on real Apple/Android HEIC/HEIF captures.
var validHEICBrands = map[string]bool{
	"heic": true,
	"heix": true,
	"hevc": true,
	"hevx": true,
	"mif1": true,
	"msf1": true,
	"isom": true,
}

// validateMIME checks the first 24 bytes of a file against expected magic headers
// without loading large uploads into memory.
func validateMIME(path string, ext string) error {
	var sig [][]byte
	if ext != ".heic" {
		var ok bool
		sig, ok = magicBytes[ext]
		if !ok {
			return fmt.Errorf("unsupported file type")
		}
	}

	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("cannot read file for MIME validation")
	}
	defer f.Close()

	var buf [24]byte
	n, readErr := io.ReadFull(f, buf[:])
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return fmt.Errorf("cannot read file for MIME validation")
	}
	header := buf[:n]

	if ext == ".heic" {
		// ISO Base Media File Format: bytes 4..7 == "ftyp" and bytes 8..11 == major brand.
		if len(header) < 12 {
			return fmt.Errorf("file too small to validate MIME type")
		}
		if bytes.Equal(header[4:8], []byte("ftyp")) && validHEICBrands[string(header[8:12])] {
			return nil
		}
		return fmt.Errorf("file does not match expected format for %s", ext)
	}

	if len(header) < len(sig[0]) {
		return fmt.Errorf("file too small to validate MIME type")
	}
	for _, s := range sig {
		if len(header) >= len(s) && bytes.HasPrefix(header, s) {
			return nil
		}
	}
	return fmt.Errorf("file does not match expected format for %s", ext)
}

// UploadFile receives a file from the frontend and saves it to the inbox.
// Thanks to watcher.go, we just need to save it and return success.
// Enforces 20MB max upload size (matches file-processor limit) and validates MIME via magic bytes.
func UploadFile(c fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No file uploaded"})
	}

	// Enforce max upload size to prevent DoS (20 MB = 20*1024*1024)
	const maxUploadSize int64 = 20 * 1024 * 1024
	if file.Size > maxUploadSize {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "File too large. Maximum upload size is 20 MB.",
		})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))

	if !constants.IsAllowedReceiptExt(ext) && !constants.IsAllowedBankStatementExt(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	safeFileName := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	savePath := filepath.Join(constants.GetInboxPath(), safeFileName)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save file"})
	}
	// Validate the saved file's magic bytes to reject disguised files (skip text bank statement formats)
	if ext != ".ofx" && ext != ".qfx" && ext != ".qbo" {
		if err := validateMIME(savePath, ext); err != nil {
			os.Remove(savePath)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "File content does not match extension"})
		}
	}
	_ = os.Chmod(savePath, 0644)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}

// UploadReceiptToExpense allows manual attachment of a receipt file directly to an existing expense.
// Enforces 20MB max upload size and closed-period preflight on the target expense.
func UploadReceiptToExpense(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	expenseId := c.Params("id")
	if expenseId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing expense ID"})
	}

	// Verify target expense exists and is not in a closed period before accepting file upload
	var expense models.Expense
	if err := db.DB.First(&expense, expenseId).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot attach a receipt to an expense in a closed accounting period.",
		})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No file uploaded"})
	}

	// Enforce max upload size to prevent DoS (20 MB = 20*1024*1024)
	const maxUploadSize int64 = 20 * 1024 * 1024
	if file.Size > maxUploadSize {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "File too large. Maximum upload size is 20 MB.",
		})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !constants.IsAllowedReceiptExt(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	nano := time.Now().UnixNano()
	safeFileName := fmt.Sprintf("%d%s", nano, ext)
	savePath := filepath.Join(constants.GetProcessedPath(), safeFileName)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save file"})
	}
	// Validate magic bytes for image/PDF formats (text formats like OFX/QFX are skipped)
	if ext != ".ofx" && ext != ".qfx" && ext != ".qbo" {
		if err := validateMIME(savePath, ext); err != nil {
			os.Remove(savePath)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "File content does not match extension"})
		}
	}
	_ = os.Chmod(savePath, 0644)

	finalExt := ext
	if ext == ".heic" {
		finalExt = ".png"
		pngFileName := fmt.Sprintf("%d.png", nano)
		pngPath := filepath.Join(constants.GetProcessedPath(), pngFileName)
		// Validate HEIC magic bytes before attempting conversion to avoid wasting I/O on corrupt files
		if err := validateMIME(savePath, ".heic"); err != nil {
			os.Remove(savePath)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "File does not appear to be a valid HEIC image"})
		}
		if err := utils.ConvertHeicToPng(savePath, pngPath); err != nil {
			os.Remove(savePath)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to convert HEIC receipt to PNG"})
		}
		os.Remove(savePath)
		_ = os.Chmod(pngPath, 0644)
		safeFileName = pngFileName
		savePath = pngPath
	}

	// Generate hash of the actual file contents to prevent duplicates
	hashStr, err := utils.HashFile(savePath)
	if err != nil {
		os.Remove(savePath)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash file"})
	}
	
	var documentURI = filepath.Join(constants.GetProcessedPath(), safeFileName)

	// Check if this file was already uploaded to ANY active expense (global deduplication)
	var existingReceipt models.Receipt
	if err := db.DB.Preload("Expense").
		Joins("JOIN expenses ON expenses.id = receipts.expense_id").
		Where("receipts.file_hash = ? AND COALESCE(expenses.review_status, '') != 'DELETED'", hashStr).
		First(&existingReceipt).Error; err == nil {
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
		FileExt:     finalExt,
		FileHash:    hashStr,
	}

	if err := db.DB.Create(&receipt).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create receipt record"})
	}

	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)
	events.Broadcast("ACCOUNTS_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"receipt": receipt,
	})
}

// DeleteReceipt removes a receipt record and deletes the physical file from the processed folder
// only if no other receipts are referencing the same physical file.
func DeleteReceipt(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	id := c.Params("id")
	if id == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing receipt ID"})
	}

	var receipt models.Receipt
	if err := db.DB.First(&receipt, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Receipt not found"})
	}

	if receipt.ExpenseID != nil {
		var exp models.Expense
		if err := db.DB.First(&exp, *receipt.ExpenseID).Error; err == nil {
			if utils.IsDateInClosedPeriod(exp.Timestamp) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Cannot delete a receipt attached to an expense in a closed accounting period.",
				})
			}
		}
	}

	// Delete the DB record first
	if err := db.DB.Delete(&receipt).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete receipt record"})
	}

	// Check if any OTHER receipts are referencing the same physical file
	var count int64
	db.DB.Model(&models.Receipt{}).Where("document_uri = ?", receipt.DocumentURI).Count(&count)

	if count == 0 {
		// No other receipts reference this file, safe to delete.
		// Guard against path traversal: verify DocumentURI is within the processed directory.
		cleaned := filepath.Clean(receipt.DocumentURI)
		processedDir := constants.GetProcessedPath()
		if processedDir != "" {
			if cleaned != processedDir && !strings.HasPrefix(cleaned, processedDir+string(filepath.Separator)) {
				fmt.Printf("Warning: refusing to delete file outside processed dir: %s\n", receipt.DocumentURI)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Receipt file path is invalid"})
			}
		}
		if err := os.Remove(receipt.DocumentURI); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: failed to delete physical file %s: %v\n", receipt.DocumentURI, err)
		}
	}

	events.Broadcast("EXPENSES_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}
