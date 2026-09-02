package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

	"github.com/gofiber/fiber/v3/client"
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

		err := sendReceiptToScript(processedPath, &receipt)
		if err != nil {
			log.Println("❌ Failed to send receipt to remote server:", err)
		} else {
			log.Println("✅ Successfully processed and sent receipt to remote server")
		}

	}

	return nil
}

/*
sends the file path of the saved receipt to a CI/CD pipeline
that sends the file to tesseract for image processing. once
tesseract sends data back, that data is sent to llama3.1:8b,
a text-based AI model that will send back structured JSON in
form of an Expense{} struct.
*/
func sendReceiptToScript(filePath string, receipt *models.Receipt) error {
	scriptUrl := "http://100.82.63.108:8081/process"

	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Acquire a new request from Fiber v3
	req := client.AcquireRequest()
	defer client.ReleaseRequest(req)

	// Create a form file field named "document"
	formFile := client.AcquireFile(func(f *client.File) {
		f.SetFieldName("document")              // form field name expected by the server
		f.SetName(filepath.Base(filePath))      // filename sent to server
		f.SetReader(file)                       // reading from the os.Open file
	})
	defer client.ReleaseFile(formFile)

	// Attach the file to the request
	req.AddFiles(formFile)

	// Send the POST request
	resp, err := req.Post(scriptUrl)
	if err != nil {
		return err
	}

	if resp.StatusCode() != 200 {
		return fmt.Errorf("AI script failed with status %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	// Read the response body and strip any markdown backticks that the LLM might have added
	rawBody := string(resp.Body())
	rawBody = strings.TrimPrefix(strings.TrimSpace(rawBody), "```json")
	rawBody = strings.TrimPrefix(strings.TrimSpace(rawBody), "```")
	rawBody = strings.TrimSuffix(strings.TrimSpace(rawBody), "```")
	rawBody = strings.TrimSpace(rawBody)

	// Unmarshal the JSON response into an intermediate struct
	var raw struct {
		Timestamp   string      `json:"timestamp"`
		Vendor      string      `json:"vendor"`
		Description string      `json:"description"`
		Amount      interface{} `json:"amount"`
		Tender      string      `json:"tender"`
	}
	err = json.Unmarshal([]byte(rawBody), &raw)
	if err != nil {
		return fmt.Errorf("failed to parse JSON from AI: %w", err)
	}

	// Clean the amount in case it came back as "$181.13" or "181.13"
	amountStr := fmt.Sprintf("%v", raw.Amount)
	amountStr = strings.TrimPrefix(amountStr, "$")
	amountStr = strings.ReplaceAll(amountStr, ",", "")
	
	var finalAmount float64
	fmt.Sscanf(amountStr, "%f", &finalAmount)

	parsedTime, _ := time.Parse(time.RFC3339, raw.Timestamp)

	newExpense := models.Expense{
		Timestamp:   parsedTime,
		Vendor:      raw.Vendor,
		Description: raw.Description,
		Amount:      finalAmount,
		Tender:      raw.Tender,
	}

	// Save the brand new Expense to your Postgres database
	if err := db.DB.Create(&newExpense).Error; err != nil {
		log.Println("❌ Failed to save expense to DB:", err)
		return err
	}

	// Ensure an accounting period exists for this expense's date
	GetOrCreateAccountingPeriod(newExpense.Timestamp)

	// Link the Receipt just uploaded to this new Expense
	receipt.ExpenseID = &newExpense.ID
	db.DB.Save(receipt)

	log.Printf("🧾 Successfully extracted & saved Expense: Vendor='%s', Amount=%.2f\n", newExpense.Vendor, newExpense.Amount)

	return nil
}
