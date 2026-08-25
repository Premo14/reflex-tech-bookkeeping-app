package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"
	"time"
)

func hashFile(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// processFile routes incoming files from the inbox.
// it checks extensions, hashes to prevent duplicates, handles HEIC conversion,
// and routes ofx files to the parser or images to the db.
func processFile(filePath string) error {
	fileExt := strings.ToLower(filepath.Ext(filePath))

	// Is it supported?
	if !constants.IsAllowedReceiptExt(fileExt) && !constants.IsAllowedBankStatementExt(fileExt) {
		// Delete it from the inbox and return an error.
		os.Remove(filePath)
		return fmt.Errorf("file extension %s not allowed", fileExt)
	}

	// Generate hash
	fileHash, err := hashFile(filePath)
	if err != nil {
		return err
	}

	// If it's a receipt, check if hash already exists
	if !constants.IsAllowedBankStatementExt(fileExt) {
		var existing models.Receipt
		if err := db.DB.Where("file_hash = ?", fileHash).First(&existing).Error; err == nil {
			// Found duplicate
			os.Remove(filePath)
			log.Printf("Duplicate file upload detected (hash: %s). Rejected.", fileHash)
			return nil
		}
	}

	// If it's a HEIC, we know the final extension will be .png
	finalExt := fileExt
	if fileExt == ".heic" {
		finalExt = ".png"
	}

	// If ext is ofx, then save as BankStatement
	if constants.IsAllowedBankStatementExt(fileExt) {
		tempPath := filepath.Join(constants.ProcessedPath, fmt.Sprintf("%d%s", time.Now().UnixNano(), finalExt))
		if err := os.Rename(filePath, tempPath); err != nil {
			return err
		}
		ParseOfx(tempPath)
	} else { // otherwise it is a receipt
		// Save to the Database first to get the auto-increment ID
		receipt := models.Receipt{
			DocumentURI: "",
			FileExt:     finalExt,
			FileHash:    fileHash,
		}
		// Save to Postgres
		if err := db.DB.Create(&receipt).Error; err != nil {
			return err
		}

		processedPath := filepath.Join(constants.ProcessedPath, fmt.Sprintf("%d%s", receipt.ID, finalExt))

		// Handle the File System operations
		if fileExt == ".heic" {
			// Convert the HEIC directly into the processed folder
			if err := ConvertHeicToPng(filePath, processedPath); err != nil {
				return err
			}
			// Conversion worked, delete original from inbox
			os.Remove(filePath)
		} else {
			// It's a PDF, PNG, JPG, etc. Just move it to the processed folder
			if err := os.Rename(filePath, processedPath); err != nil {
				return err
			}
		}

		receipt.DocumentURI = processedPath
		db.DB.Save(&receipt)

	}

	log.Println("Successfully processed and saved file")
	return nil
}
