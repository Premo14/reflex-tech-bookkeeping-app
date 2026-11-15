package utils

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"
	"time"
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
// and routes bank statements to the parser or images to the DB.
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

	// If ext is bank statement, save to processed and route to parser (.ofx/.qfx/.qbo)
	if constants.IsAllowedBankStatementExt(fileExt) {
		tempPath := filepath.Join(constants.GetProcessedPath(), fmt.Sprintf("%d%s", time.Now().UnixNano(), finalExt))
		if err := constants.SafeMove(filePath, tempPath); err != nil {
			return err
		}
		_ = os.Chmod(tempPath, 0644) // Restrict permissions (owner rw, world readable only)
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
			// It's a PDF, PNG, JPG, etc. Move it to the processed folder
			if err := constants.SafeMove(filePath, processedPath); err != nil {
				db.DB.Delete(&receipt)
				return err
			}
		}
		_ = os.Chmod(processedPath, 0644) // Restrict permissions (owner rw, world readable only)

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
				Amount:           models.NewMoney(0),
				TaxAmount:        models.NewMoney(0),
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
	if db.DB == nil {
		return nil, fmt.Errorf("database connection is nil")
	}
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
		clean = strings.ReplaceAll(clean, "$", "")
		clean = strings.ReplaceAll(clean, "€", "")
		clean = strings.ReplaceAll(clean, "£", "")
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
// Float values are rounded (not truncated) to nearest integer before conversion, preventing
// e.g. 42.99 from silently becoming uint(42). Values with a fractional component > 0.5 are
// rounded up; values with < 0.5 are rounded down — consistent with JSON number expectations.
func ParseExtractedChartAccountID(val interface{}) *uint {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case float64:
		rounded := int64(math.Round(v))
		if rounded > 0 {
			u := uint(rounded)
			return &u
		}
	case float32:
		rounded := int64(math.Round(float64(v)))
		if rounded > 0 {
			u := uint(rounded)
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
	// Guard against nil DB — if DB is unavailable, log and return nil (graceful degradation)
	if db.DB == nil {
		log.Printf("⚠️ ValidateExtractedCategory: DB is nil, cannot validate account ID %d. Setting to uncategorized.\n", *accountID)
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

	var bodyBuf bytes.Buffer
	var respBody []byte
	var err error
	maxRetries := 2

	// Fetch active EXPENSE categories once to build dynamic prompt
	var dynamicPrompt string
	if accounts, fetchErr := FetchActiveExpenseAccounts(); fetchErr == nil {
		dynamicPrompt = BuildReceiptPrompt(accounts)
	}

	// Use a custom HTTP client with 10-minute read timeout exceeding
	// file-processor's 5-minute ReadTimeout. This prevents slow CPU inference
	// from dropping the connection prematurely and spawning duplicate fallback expenses.
	httpClient := &http.Client{
		Timeout: 10 * time.Minute,
	}

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			log.Printf("⏳ Retrying AI receipt processing (attempt %d/%d) after error: %v", attempt, maxRetries, err)
			time.Sleep(3 * time.Second)
		}

		file, openErr := os.Open(filePath)
		if openErr != nil {
			return openErr
		}

		bodyBuf.Reset()
		w := multipart.NewWriter(&bodyBuf)

		promptField, _ := w.CreateFormField("prompt")
		if dynamicPrompt != "" {
			promptField.Write([]byte(dynamicPrompt))
		}

		fileField, _ := w.CreateFormFile("document", filepath.Base(filePath))
		if _, err = io.Copy(fileField, file); err != nil {
			file.Close()
			w.Close()
			err = fmt.Errorf("failed to read file for upload: %w", err)
			continue
		}
		w.Close()
		file.Close()

		respBody, err = uploadWithTimeout(httpClient, scriptUrl, bodyBuf.Bytes(), w.FormDataContentType())
		if err == nil && len(respBody) > 0 {
			break
		}
		if err == nil {
			err = fmt.Errorf("AI script returned empty response")
		}
	}

	if err != nil {
		return err
	}

	// Clean AI response body isolating JSON object
	rawBody := CleanAIJSON(string(respBody))

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

	// Flag expenses with missing dates or zero amounts so they aren't silently booked.
	// When amount is 0 or the timestamp was not found (empty string in AI response),
	// append a warning to the description and set ReviewStatus = PENDING.
	warningFlags := []string{}
	if finalAmount == 0 {
		warningFlags = append(warningFlags, "[MISSING AMOUNT - AI could not read receipt total]")
	}
	if raw.Timestamp == "" {
		warningFlags = append(warningFlags, "[MISSING DATE - AI could not read receipt date]")
	}

	reviewStatus := "APPROVED"
	if IsDateInClosedPeriod(parsedTime) {
		log.Printf("Extracted date (%s) falls within a closed period. Flagging for review.\n", parsedTime)
		reviewStatus = "PENDING"
	}
	if len(warningFlags) > 0 {
		reviewStatus = "PENDING"
	}

	extractedAccountID := ParseExtractedChartAccountID(raw.ChartAccountID)
	validatedAccountID := ValidateExtractedCategory(extractedAccountID)

	currCode := strings.ToUpper(strings.TrimSpace(raw.CurrencyCode))
	if currCode == "" {
		currCode = "USD"
	}

	normTender := NormalizeTender(raw.Tender)
	initialAllocation := "UNLINKED"
	if IsCashTender(normTender) {
		initialAllocation = "BALANCED"
	}

	desc := strings.TrimSpace(raw.Description)
	if len(warningFlags) > 0 {
		desc = desc + " " + strings.Join(warningFlags, "; ")
	}

	newExpense := models.Expense{
		Timestamp:        parsedTime,
		Vendor:           strings.TrimSpace(raw.Vendor),
		Description:      desc,
		Amount:           models.NewMoney(finalAmount),
		TaxAmount:        models.NewMoney(taxAmount),
		CurrencyCode:     currCode,
		Tender:           normTender,
		ChartAccountID:   validatedAccountID,
		IsManual:         false,
		AllocationStatus: initialAllocation,
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
		newExpense.ID, newExpense.Vendor, newExpense.Amount.Dollars(), newExpense.ChartAccountID)

	go RunReconciliation()

	return nil
}

// uploadWithTimeout sends a multipart POST request with the given timeout,
// returning the response body as bytes or an error.
func uploadWithTimeout(client *http.Client, url string, body []byte, contentType string) ([]byte, error) {
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AI script failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return bodyBytes, nil
}
