package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"

	"github.com/google/uuid"
)

/*
processFile acts as the routing and sanitization layer for newly uploaded files.
When the Watcher detects a new file in the inbox, this function takes over to:
1. Validate the file extension against our allowed whitelist.
2. Rename the file to a secure UUID to prevent path-traversal attacks and collisions.
3. If it's a HEIC file (from an iPhone), convert it to PNG so browsers can display it.
4. Route the file: OFX files go to the bank parser, image/pdf files get saved as Receipts in the DB.
*/
func processFile(filePath string) error {
	fileExt := strings.ToLower(filepath.Ext(filePath))

	// Is it supported?
	if !constants.IsAllowedReceiptExt(fileExt) && !constants.IsAllowedBankStatementExt(fileExt) {
		// Delete it from the inbox and return an error.
		os.Remove(filePath)
		return fmt.Errorf("file extension %s not allowed", fileExt)
	}

	// Generate UUID & Build Processed Path
	fileID := uuid.New().String()

	// If it's a HEIC, we know the final extension will be .png
	finalExt := fileExt
	if fileExt == ".heic" {
		finalExt = ".png"
	}

	processedDir := constants.ProcessedPath
	processedPath := filepath.Join(processedDir, fileID+finalExt)

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

	// If ext is ofx, then save as BankStatement
	if fileExt == ".ofx" {
		ParseOfx(processedPath, fileID) // ParseOfx() saves to the database
	} else { // otherwise it is a receipt
		// Save to the Database
		receipt := models.Receipt{
			ID:          fileID,
			DocumentURI: processedPath,
			FileExt:     finalExt,
		}
		// Save to Postgres
		if err := db.DB.Create(&receipt).Error; err != nil {
			return err
		}
	}

	log.Println("Successfully processed and saved receipt:", fileID)
	return nil
}
