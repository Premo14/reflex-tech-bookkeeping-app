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

func processFile(filePath string) error {
	fileExt := strings.ToLower(filepath.Ext(filePath))

	// 1. Is it supported?
	if !constants.IsAllowedReceiptExt(fileExt) && !constants.IsAllowedBankStatementExt(fileExt) {
		// Delete it from the inbox and return an error.
		os.Remove(filePath)
		return fmt.Errorf("file extension %s not allowed", fileExt)
	}

	// 2. Generate UUID & Build Processed Path
	fileID := uuid.New().String()

	// If it's a HEIC, we know the final extension will be .png
	finalExt := fileExt
	if fileExt == ".heic" {
		finalExt = ".png"
	}

	processedDir := constants.ProcessedPath
	processedPath := filepath.Join(processedDir, fileID+finalExt)

	// 3. Handle the File System operations
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

	// 4. Save to the Database
	receipt := models.Receipt{
		ID:          fileID,
		DocumentURI: processedPath,
		FileExt:     finalExt,
	}

	// Save to Postgres
	if err := db.DB.Create(&receipt).Error; err != nil {
		return err
	}

	log.Println("Successfully processed and saved receipt:", fileID)
	return nil
}
