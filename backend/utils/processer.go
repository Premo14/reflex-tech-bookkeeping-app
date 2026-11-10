package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3/client"
)

// HashFile exports the hash function
func HashFile(filePath string) (string, error) {
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
		log.Printf("⚠️ File '%s' with extension '%s' is not supported. Retaining in inbox without processing.", filepath.Base(filePath), fileExt)
		return fmt.Errorf("file extension %s not allowed", fileExt)
	}

	// Generate hash
	fileHash, err := HashFile(filePath)
	if err != nil {
		return err
	}

	// If it's a receipt, check if hash already exists on an active (non-deleted) expense
	if !constants.IsAllowedBankStatementExt(fileExt) {
		var existing models.Receipt
		if err := db.DB.Joins("JOIN expenses ON expenses.id = receipts.expense_id").
			Where("receipts.file_hash = ? AND COALESCE(expenses.review_status, '') != 'DELETED'", fileHash).
			First(&existing).Error; err == nil {
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

	// If ext is bank statement, save to processed and route to parser (.csv or .ofx/.qfx/.qbo)
	if constants.IsAllowedBankStatementExt(fileExt) {
		tempPath := filepath.Join(constants.GetProcessedPath(), fmt.Sprintf("%d%s", time.Now().UnixNano(), finalExt))
		if err := os.Rename(filePath, tempPath); err != nil {
			return err
		}
		_ = os.Chmod(tempPath, 0666)
		if fileExt == ".csv" {
			ParseCsvStatement(tempPath)
		} else {
			ParseOfx(tempPath)
		}
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

		processedPath := filepath.Join(constants.GetProcessedPath(), fmt.Sprintf("%d%s", receipt.ID, finalExt))

		// Handle the File System operations
		if fileExt == ".heic" {
			// Convert the HEIC directly into the processed folder
			if err := ConvertHeicToPng(filePath, processedPath); err != nil {
				db.DB.Delete(&receipt)
				return err
			}
			// Conversion worked, delete original from inbox
			os.Remove(filePath)
		} else {
			// It's a PDF, PNG, JPG, etc. Just move it to the processed folder
			if err := os.Rename(filePath, processedPath); err != nil {
				db.DB.Delete(&receipt)
				return err
			}
		}
		_ = os.Chmod(processedPath, 0666)

		receipt.DocumentURI = processedPath
		db.DB.Save(&receipt)

		err := sendReceiptToScript(processedPath, &receipt)
		if err != nil {
			reviewStatus := "APPROVED"
			if IsDateInClosedPeriod(time.Now().UTC()) {
				reviewStatus = "PENDING"
			}
			log.Printf("⚠️ sendReceiptToScript failed (%v). Creating fallback expense with ReviewStatus=%s for manual review.\n", err, reviewStatus)
			fallbackExpense := models.Expense{
				Timestamp:        time.Now().UTC(),
				Vendor:           fmt.Sprintf("Receipt %d", receipt.ID),
				Description:      "Receipt uploaded; AI extraction unavailable. Please enter details manually.",
				Amount:           0.00,
				TaxAmount:        0.00,
				CurrencyCode:     "USD",
				Tender:           "card",
				ChartAccountID:   nil,
				IsManual:         false,
				AllocationStatus: "UNLINKED",
				ReviewStatus:     reviewStatus,
			}
			if createErr := db.DB.Create(&fallbackExpense).Error; createErr == nil {
				receipt.ExpenseID = &fallbackExpense.ID
				db.DB.Save(&receipt)
			}
		} else {
			log.Println("Successfully processed and sent receipt to remote server")
		}

	}

	return nil
}

// FetchActiveExpenseAccounts returns all active EXPENSE accounts sorted by code ascending.
func FetchActiveExpenseAccounts() ([]models.ChartAccount, error) {
	var accounts []models.ChartAccount
	if err := db.DB.Where("type = ? AND active = true", "EXPENSE").Order("code ASC").Find(&accounts).Error; err != nil {
		return nil, err
	}
	return accounts, nil
}

// BuildReceiptPrompt generates a dynamic LLM prompt with strict JSON schema rules
// and active Chart of Accounts expense categories.
func BuildReceiptPrompt(accounts []models.ChartAccount) string {
	var catStrings []string
	for _, acc := range accounts {
		catStrings = append(catStrings, fmt.Sprintf("%d:%s", acc.ID, acc.Name))
	}

	categoriesList := strings.Join(catStrings, ", ")
	if len(catStrings) == 0 {
		categoriesList = "none"
	}

	return fmt.Sprintf(`Extract receipt details and return ONLY a single compact JSON object (no markdown, no explanation):
{"timestamp":"YYYY-MM-DDTHH:MM:SSZ","vendor":"","description":"","amount":0.00,"taxAmount":0.00,"currencyCode":"USD","tender":"CARD","chartAccountId":null}
Rules:
- timestamp: Receipt date in RFC3339 (use T00:00:00Z if no time, "" if no date).
- vendor: Merchant name only.
- description: Short 3-6 word summary.
- amount: Total paid (positive number).
- taxAmount: Tax paid (0 if none).
- tender: CARD, CASH, CHECK, TRANSFER, PAYPAL, VENMO, ZELLE, or OTHER.
- chartAccountId: Best matching integer ID from [%s], or null.`, categoriesList)
}

// CleanAIJSON removes markdown fences and extra commentary, isolating the outer JSON object.
func CleanAIJSON(raw string) string {
	s := strings.TrimSpace(raw)
	// Strip markdown fences if present
	if strings.Contains(s, "```") {
		if idx := strings.Index(s, "```"); idx != -1 {
			remainder := s[idx+3:]
			if newline := strings.Index(remainder, "\n"); newline != -1 {
				remainder = remainder[newline+1:]
			}
			if endIdx := strings.Index(remainder, "```"); endIdx != -1 {
				s = strings.TrimSpace(remainder[:endIdx])
			} else {
				s = strings.TrimSpace(remainder)
			}
		}
	}

	// Isolate JSON object between outermost '{' and '}'
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start != -1 && end != -1 && end > start {
		s = s[start : end+1]
	}

	return strings.TrimSpace(s)
}

// ParseExtractedAmount converts any numeric or string amount value into a positive float64.
func ParseExtractedAmount(val interface{}) float64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return math.Abs(v)
	case float32:
		return math.Abs(float64(v))
	case int:
		return math.Abs(float64(v))
	case int64:
		return math.Abs(float64(v))
	case string:
		clean := strings.TrimSpace(v)
		clean = strings.TrimPrefix(clean, "$")
		clean = strings.ReplaceAll(clean, ",", "")
		var f float64
		if _, err := fmt.Sscanf(clean, "%f", &f); err == nil {
			return math.Abs(f)
		}
	}
	return 0
}

// ParseExtractedTimestamp attempts multiple standard date and datetime formats.
// If unparseable or empty, it returns the current time in UTC to avoid period closing bugs with 0001-01-01.
func ParseExtractedTimestamp(raw string) time.Time {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Now().UTC()
	}

	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02T15:04Z",
		"2006-01-02T15:04",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"01/02/2006 15:04:05",
		"01/02/2006",
		"1/2/2006",
		"01/02/06 15:04:05",
		"01/02/06",
		"1/2/06",
		"2006/01/02",
	}

	for _, layout := range formats {
		if t, err := time.Parse(layout, trimmed); err == nil {
			return t.UTC()
		}
	}

	log.Printf("⚠️ Could not parse extracted timestamp '%s', defaulting to current time UTC\n", raw)
	return time.Now().UTC()
}

// ParseExtractedChartAccountID parses chartAccountId from float64, int, or string representations.
func ParseExtractedChartAccountID(val interface{}) *uint {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case float64:
		if v > 0 {
			u := uint(v)
			return &u
		}
	case int:
		if v > 0 {
			u := uint(v)
			return &u
		}
	case int64:
		if v > 0 {
			u := uint(v)
			return &u
		}
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" || strings.EqualFold(trimmed, "null") {
			return nil
		}
		var u uint
		if _, err := fmt.Sscanf(trimmed, "%d", &u); err == nil && u > 0 {
			return &u
		}
	}
	return nil
}

// ValidateExtractedCategory verifies that the extracted chartAccountId exists, is active,
// and is an EXPENSE type account. If invalid or hallucinated, it logs a warning and returns nil.
func ValidateExtractedCategory(accountID *uint) *uint {
	if accountID == nil {
		return nil
	}
	var account models.ChartAccount
	if err := db.DB.First(&account, *accountID).Error; err != nil {
		log.Printf("⚠️ AI auto-categorization suggested account ID %d, but account does not exist. Setting to uncategorized.\n", *accountID)
		return nil
	}
	if !account.Active {
		log.Printf("⚠️ AI auto-categorization suggested account ID %d ('%s'), but account is deactivated/archived. Setting to uncategorized.\n", *accountID, account.Name)
		return nil
	}
	if account.Type != "EXPENSE" {
		log.Printf("⚠️ AI auto-categorization suggested account ID %d ('%s') with type %s (expected EXPENSE). Setting to uncategorized.\n", *accountID, account.Name, account.Type)
		return nil
	}
	return accountID
}

/*
sends the file path of the saved receipt to a CI/CD pipeline
*/
func sendReceiptToScript(filePath string, receipt *models.Receipt) error {
	scriptUrl := os.Getenv("FILE_PROCESSOR_URL")
	if scriptUrl == "" {
		scriptUrl = "http://file-processor:8081/process"
	}

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
		f.SetFieldName("document")         // form field name expected by the server
		f.SetName(filepath.Base(filePath)) // filename sent to server
		f.SetReader(file)                  // reading from the os.Open file
	})
	defer client.ReleaseFile(formFile)

	// Fetch only active EXPENSE categories to build a hardened dynamic prompt
	if accounts, err := FetchActiveExpenseAccounts(); err == nil {
		dynamicPrompt := BuildReceiptPrompt(accounts)
		req.SetFormData("prompt", dynamicPrompt)
	}

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

	// Clean AI response body isolating JSON object
	rawBody := CleanAIJSON(string(resp.Body()))

	// Unmarshal the JSON response into an intermediate struct
	var raw struct {
		Timestamp      string      `json:"timestamp"`
		Vendor         string      `json:"vendor"`
		Description    string      `json:"description"`
		Amount         interface{} `json:"amount"`
		TaxAmount      interface{} `json:"taxAmount"`
		CurrencyCode   string      `json:"currencyCode"`
		Tender         string      `json:"tender"`
		ChartAccountID interface{} `json:"chartAccountId"`
	}
	err = json.Unmarshal([]byte(rawBody), &raw)
	if err != nil {
		return fmt.Errorf("failed to parse JSON from AI: %w (raw response: %s)", err, rawBody)
	}

	finalAmount := ParseExtractedAmount(raw.Amount)
	taxAmount := ParseExtractedAmount(raw.TaxAmount)
	parsedTime := ParseExtractedTimestamp(raw.Timestamp)

	reviewStatus := "APPROVED"
	if IsDateInClosedPeriod(parsedTime) {
		log.Printf("Extracted date (%s) falls within a closed period. Flagging for review.\n", parsedTime)
		reviewStatus = "PENDING"
	}

	extractedAccountID := ParseExtractedChartAccountID(raw.ChartAccountID)
	validatedAccountID := ValidateExtractedCategory(extractedAccountID)

	currCode := strings.ToUpper(strings.TrimSpace(raw.CurrencyCode))
	if currCode == "" {
		currCode = "USD"
	}

	newExpense := models.Expense{
		Timestamp:        parsedTime,
		Vendor:           strings.TrimSpace(raw.Vendor),
		Description:      strings.TrimSpace(raw.Description),
		Amount:           finalAmount,
		TaxAmount:        taxAmount,
		CurrencyCode:     currCode,
		Tender:           NormalizeTender(raw.Tender),
		ChartAccountID:   validatedAccountID,
		IsManual:         false,
		AllocationStatus: "UNLINKED",
		ReviewStatus:     reviewStatus,
	}

	// Save the brand new Expense to your Postgres database
	if err := db.DB.Create(&newExpense).Error; err != nil {
		log.Println("Failed to save expense to DB:", err)
		return err
	}

	// Link the Receipt just uploaded to this new Expense
	receipt.ExpenseID = &newExpense.ID
	db.DB.Save(receipt)

	log.Printf(" Successfully extracted & saved Expense: ID=%d Vendor='%s', Amount=%.2f, CategoryID=%v\n",
		newExpense.ID, newExpense.Vendor, newExpense.Amount, newExpense.ChartAccountID)

	go RunReconciliation()

	return nil
}
