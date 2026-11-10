package utils

import (
	"crypto/sha256"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/gorm/clause"
)

// Supported date layout formats for CSV statement exports
var csvDateFormats = []string{
	"2006-01-02",
	"01/02/2006",
	"1/2/2006",
	"01-02-2006",
	"1-2-2006",
	"2006/01/02",
	"02/01/2006", // DD/MM/YYYY fallback
	time.RFC3339,
	"2006-01-02 15:04:05",
	"01/02/06",
}

func parseCSVDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	// Try ISO prefix if date has time attached (e.g. "2026-08-12T00:00:00")
	if len(s) > 10 && (s[10] == 'T' || s[10] == ' ') {
		prefix := s[:10]
		if t, err := time.Parse("2006-01-02", prefix); err == nil {
			return t, nil
		}
	}

	for _, format := range csvDateFormats {
		if t, err := time.Parse(format, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse date %q", s)
}

func cleanCSVAmount(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}

	// Handle accounting negative parentheses: "(123.45)" -> "-123.45"
	isNegative := false
	if strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		isNegative = true
		s = strings.Trim(s, "()")
	}

	// Remove currency symbols, commas, and whitespace
	re := regexp.MustCompile(`[^\d.-]`)
	cleaned := re.ReplaceAllString(s, "")

	val, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, err
	}

	if isNegative && val > 0 {
		val = -val
	}
	return math.Round(val*100) / 100, nil
}

// ParseCsvStatement imports bank transactions from standard bank CSV exports.
func ParseCsvStatement(filePath string) {
	f, err := os.Open(filePath)
	if err != nil {
		log.Printf("⚠️ CSV Import: cannot open file %s: %v", filePath, err)
		return
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1 // Allow variable column counts
	reader.TrimLeadingSpace = true

	rows, err := reader.ReadAll()
	if err != nil && err != io.EOF {
		log.Printf("⚠️ CSV Import: failed to read CSV rows: %v", err)
		return
	}

	if len(rows) < 2 {
		log.Printf("⚠️ CSV Import: file has fewer than 2 rows (no data)")
		return
	}

	// Identify column indexes from the header row
	headerIdx := -1
	dateCol := -1
	descCol := -1
	amtCol := -1
	debitCol := -1
	creditCol := -1
	idCol := -1

	// Scan first few rows to locate the header row
	for rIdx := 0; rIdx < int(math.Min(5, float64(len(rows)))); rIdx++ {
		row := rows[rIdx]
		dCol, descC, aCol, debC, credC, iCol := -1, -1, -1, -1, -1, -1

		for cIdx, cell := range row {
			headerName := strings.ToLower(strings.TrimSpace(cell))
			switch {
			case strings.Contains(headerName, "date") && dCol == -1:
				dCol = cIdx
			case (strings.Contains(headerName, "description") || strings.Contains(headerName, "payee") ||
				strings.Contains(headerName, "merchant") || strings.Contains(headerName, "memo") ||
				strings.Contains(headerName, "narrative") || strings.Contains(headerName, "name") ||
				headerName == "details") && descC == -1:
				descC = cIdx
			case (headerName == "amount" || strings.Contains(headerName, "total") || strings.Contains(headerName, "net")) && aCol == -1:
				aCol = cIdx
			case (strings.Contains(headerName, "debit") || strings.Contains(headerName, "withdrawal") || strings.Contains(headerName, "spent")) && debC == -1:
				debC = cIdx
			case (strings.Contains(headerName, "credit") || strings.Contains(headerName, "deposit") || strings.Contains(headerName, "received")) && credC == -1:
				credC = cIdx
			case (strings.Contains(headerName, "id") || strings.Contains(headerName, "fitid") || strings.Contains(headerName, "ref") || strings.Contains(headerName, "check")) && iCol == -1:
				iCol = cIdx
			}
		}

		// A valid header must have at least Date, Description, and either Amount or Debit/Credit
		if dCol != -1 && (descC != -1 || aCol != -1) && (aCol != -1 || (debC != -1 || credC != -1)) {
			headerIdx = rIdx
			dateCol = dCol
			descCol = descC
			amtCol = aCol
			debitCol = debC
			creditCol = credC
			idCol = iCol
			break
		}
	}

	if headerIdx == -1 {
		log.Printf("⚠️ CSV Import: could not detect required bank statement headers (Date, Description, Amount) in %s", filePath)
		return
	}

	// Default description column if missing
	if descCol == -1 {
		descCol = 1
	}

	// Prepare account mapping
	baseName := filepath.Base(filePath)
	accountID := "CSV-" + strings.TrimSuffix(baseName, filepath.Ext(baseName))
	chartAccountID := resolveOrCreateChartAccount(accountID, "", "ASSET", "Bank (CSV)", "CHECKING")

	var parsedTransactions []models.BankTransaction
	var minDate, maxDate time.Time
	sameDayOccurrences := make(map[string]int)

	for rIdx := headerIdx + 1; rIdx < len(rows); rIdx++ {
		row := rows[rIdx]
		if len(row) <= dateCol {
			continue
		}

		dateStr := strings.TrimSpace(row[dateCol])
		if dateStr == "" {
			continue
		}

		txDate, err := parseCSVDate(dateStr)
		if err != nil {
			continue // Skip non-date rows
		}

		desc := "Transaction"
		if descCol < len(row) && strings.TrimSpace(row[descCol]) != "" {
			desc = strings.TrimSpace(row[descCol])
		}

		var amount float64
		if amtCol != -1 && amtCol < len(row) && strings.TrimSpace(row[amtCol]) != "" {
			amt, err := cleanCSVAmount(row[amtCol])
			if err != nil {
				continue
			}
			amount = amt
		} else {
			// Split debit/credit columns
			var debAmt, credAmt float64
			if debitCol != -1 && debitCol < len(row) {
				debAmt, _ = cleanCSVAmount(row[debitCol])
			}
			if creditCol != -1 && creditCol < len(row) {
				credAmt, _ = cleanCSVAmount(row[creditCol])
			}

			if debAmt != 0 {
				amount = -math.Abs(debAmt) // Debits are negative
			} else if credAmt != 0 {
				amount = math.Abs(credAmt) // Credits are positive
			}
		}

		// Skip zero-value or empty rows
		if amount == 0 {
			continue
		}

		// FITID generation: use column value or deterministic SHA256 invariant to row position
		fitID := ""
		if idCol != -1 && idCol < len(row) {
			fitID = strings.TrimSpace(row[idCol])
		}
		if fitID == "" {
			dupKey := fmt.Sprintf("%s|%s|%.2f", txDate.Format("2006-01-02"), desc, amount)
			sameDayOccurrences[dupKey]++
			occurrenceIndex := sameDayOccurrences[dupKey]
			h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s", dupKey, occurrenceIndex, accountID)))
			fitID = fmt.Sprintf("CSV-%x", h[:8])
		}

		txType := "DEBIT"
		if amount > 0 {
			txType = "DEP"
		}

		if minDate.IsZero() || txDate.Before(minDate) {
			minDate = txDate
		}
		if maxDate.IsZero() || txDate.After(maxDate) {
			maxDate = txDate
		}

		parsedTransactions = append(parsedTransactions, models.BankTransaction{
			Date:            txDate,
			Description:     desc,
			Amount:          amount,
			TransactionType: txType,
			FITID:           fitID,
			ChartAccountID:  chartAccountID,
		})
	}

	if len(parsedTransactions) == 0 {
		log.Printf("⚠️ CSV Import: no valid transactions extracted from %s", filePath)
		return
	}

	// Create BankStatement header record
	bankStatement := models.BankStatement{
		DocumentURI:    filePath,
		FileExt:        ".csv",
		AccountID:      accountID,
		StartDate:      minDate,
		EndDate:        maxDate,
		ChartAccountID: chartAccountID,
	}

	if err := db.DB.Create(&bankStatement).Error; err != nil {
		log.Printf("⚠️ CSV Import: failed to create BankStatement record: %v", err)
		return
	}

	// Link transactions to statement and apply automated bank rules
	for i := range parsedTransactions {
		parsedTransactions[i].BankStatementID = &bankStatement.ID
		if IsDateInClosedPeriod(parsedTransactions[i].Date) {
			parsedTransactions[i].ReviewStatus = "PENDING"
		} else {
			parsedTransactions[i].ReviewStatus = "APPROVED"
		}
		parsedTransactions[i].AllocationStatus = "UNLINKED"

		// Automatically evaluate active bank rules (auto-categorization, clean renaming, notes)
		ApplyBankRulesToTransaction(&parsedTransactions[i], db.DB)
	}

	// Insert ignoring duplicates via FITID unique constraint
	res := db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "fit_id"}},
		DoNothing: true,
	}).Create(&parsedTransactions)

	if res.Error != nil {
		log.Printf("⚠️ CSV Import: error saving transactions: %v", res.Error)
		return
	}

	log.Printf("✅ CSV Import: successfully processed %d transactions from %s", len(parsedTransactions), baseName)

	// Trigger real-time live events and auto-reconciliation
	events.Broadcast("TRANSACTION_CREATED", nil)
	RunReconciliation()
}
