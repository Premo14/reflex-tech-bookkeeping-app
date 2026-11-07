package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"
	"time"

	"github.com/aclindsa/ofxgo"
	"gorm.io/gorm/clause"
)

// ParseOfx reads an .ofx or .qfx file to extract the bank statement and transactions.
// It uses the bank's FITID to safely ignore duplicates so users can upload overlapping date ranges.
//
// COA account matching & Smart Adoption:
//   On import, we attempt to match the OFX AccountID to an existing ChartAccount.
//   If an unassigned default account of the matching type exists (e.g. 1010 Checking, 2020 Credit Card),
//   the system adopts it, binding the institution name and account ID without creating duplicate accounts.
//   If all default accounts are already in use, a new sequential account is auto-created.
//
// Period assignment:
//   Transactions are NOT auto-assigned to any accounting period. They are stored freely
//   and appear in any user-created period whose date range covers their date.
func ParseOfx(filePath string) {
	fileExt := filepath.Ext(filePath)

	f, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("can't open file: %v\n", err)
		return
	}
	defer f.Close()

	resp, err := ofxgo.ParseResponse(f)
	if err != nil {
		fmt.Printf("can't parse response: %v\n", err)
		return
	}

	var accountID string
	var bankID string
	var accountType string
	var subType string
	var startDate time.Time
	var endDate time.Time
	var endingBalance *float64
	var balanceAsOf *time.Time
	var transactions []ofxgo.Transaction

	// Extract financial institution name (e.g. "Chase", "Wells Fargo", "Capital One")
	institution := strings.TrimSpace(string(resp.Signon.Org))

	if len(resp.Bank) > 0 {
		stmtResp, ok := resp.Bank[0].(*ofxgo.StatementResponse)
		if !ok {
			log.Println("Could not parse StatementResponse")
			return
		}
		accountID = strings.TrimSpace(stmtResp.BankAcctFrom.AcctID.String())
		bankID = strings.TrimSpace(stmtResp.BankAcctFrom.BankID.String())
		subType = strings.ToUpper(strings.TrimSpace(stmtResp.BankAcctFrom.AcctType.String()))
		if subType == "CREDITLINE" {
			accountType = "LIABILITY"
		} else {
			accountType = "ASSET" // CHECKING, SAVINGS, MONEYMRKT are assets
		}
		startDate = stmtResp.BankTranList.DtStart.Time
		endDate = stmtResp.BankTranList.DtEnd.Time
		bal, _ := stmtResp.BalAmt.Float64()
		endingBalance = &bal
		if !stmtResp.DtAsOf.Time.IsZero() {
			t := stmtResp.DtAsOf.Time
			balanceAsOf = &t
		}
		transactions = stmtResp.BankTranList.Transactions
	} else if len(resp.CreditCard) > 0 {
		ccStmtResp, ok := resp.CreditCard[0].(*ofxgo.CCStatementResponse)
		if !ok {
			log.Println("Could not parse CCStatementResponse")
			return
		}
		accountID = strings.TrimSpace(ccStmtResp.CCAcctFrom.AcctID.String())
		bankID = "" // Credit cards typically don't have a routing/bank ID in OFX
		subType = "CREDIT_CARD"
		accountType = "LIABILITY" // Credit cards are liabilities (money owed)
		startDate = ccStmtResp.BankTranList.DtStart.Time
		endDate = ccStmtResp.BankTranList.DtEnd.Time
		bal, _ := ccStmtResp.BalAmt.Float64()
		endingBalance = &bal
		if !ccStmtResp.DtAsOf.Time.IsZero() {
			t := ccStmtResp.DtAsOf.Time
			balanceAsOf = &t
		}
		transactions = ccStmtResp.BankTranList.Transactions
	} else {
		log.Println("No bank or credit card statement found in OFX")
		return
	}

	// Resolve or adopt a ChartAccount for this statement's bank account.
	chartAccountID := resolveOrCreateChartAccount(accountID, bankID, accountType, institution, subType)

	// Create the BankStatement record
	bankStatement := models.BankStatement{
		DocumentURI:    filePath,
		FileExt:        fileExt,
		AccountID:      accountID,
		BankID:         bankID,
		StartDate:      startDate,
		EndDate:        endDate,
		EndingBalance:  endingBalance,
		BalanceAsOf:    balanceAsOf,
		ChartAccountID: chartAccountID,
	}

	// Save the statement to get its auto-increment ID
	if err := db.DB.Create(&bankStatement).Error; err != nil {
		log.Println("Error creating BankStatement:", err)
		return
	}

	// Rename the OFX file to match the new statement ID for consistent storage naming
	newFilePath := filepath.Join(filepath.Dir(filePath), fmt.Sprintf("%d%s", bankStatement.ID, filepath.Ext(filePath)))
	if err := os.Rename(filePath, newFilePath); err == nil {
		bankStatement.DocumentURI = newFilePath
		db.DB.Save(&bankStatement)
	}

	// Build and bulk-insert the transactions
	var dbTransactions []models.BankTransaction
	for _, tx := range transactions {
		// Convert tx.TrnAmt (which is an ofxgo.Amount) to a float64
		val, _ := tx.TrnAmt.Float64()
		// Combine Name and Memo for a full description
		fullDesc := string(tx.Name) + " " + string(tx.Memo)
		statementID := bankStatement.ID

		dbTx := models.BankTransaction{
			BankStatementID: &statementID,
			ChartAccountID:  chartAccountID, // denormalized from the statement
			Date:            tx.DtPosted.Time,
			Description:     fullDesc,
			Amount:          val,
			TransactionType: fmt.Sprintf("%v", tx.TrnType),
			FITID:           string(tx.FiTID),
		}

		if IsDateInClosedPeriod(dbTx.Date) {
			dbTx.ReviewStatus = "PENDING"
		} else {
			dbTx.ReviewStatus = "APPROVED"
		}
		dbTx.AllocationStatus = "UNLINKED"

		dbTransactions = append(dbTransactions, dbTx)
	}

	if len(dbTransactions) > 0 {
		// Bulk insert transactions.
		// OnConflict ignores duplicates based on fit_id — safe for overlapping statement ranges.
		err = db.DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "fit_id"}},
			DoNothing: true,
		}).Create(&dbTransactions).Error

		if err != nil {
			log.Println("Error bulk inserting transactions:", err)
		} else {
			log.Printf("Successfully imported %d transactions from OFX\n", len(dbTransactions))
		}
	}

	// Trigger reconciliation to link any waiting expenses to the newly imported transactions
	RunReconciliation()
}

// resolveOrCreateChartAccount finds a ChartAccount matching the given OFX account credentials,
// adopts an unassigned default placeholder account if available, or creates a new account.
//
// Matching & Adoption strategy:
//  1. Direct match: Check if an existing ChartAccount has OfxAccountID matching accountID,
//     or if an existing BankStatement has account_id matching accountID, or legacy description match.
//  2. Smart Adoption: If no match is found, check if an unadopted default placeholder account
//     of the matching type exists with 0 associated bank statements. If so, adopt it by updating
//     its Name (incorporating institution if available) and setting OfxAccountID to accountID.
//  3. Fallback: If all default accounts of that category are already adopted (e.g. user uploads a
//     second checking account or second credit card), find the next available code and auto-create.
func resolveOrCreateChartAccount(accountID, bankID, accountType, institution, subType string) *uint {
	if accountID == "" {
		return nil
	}

	// 1. Direct match: Try to find an existing account matching the raw OFX account ID
	// a) By background OfxAccountID
	var existing models.ChartAccount
	if err := db.DB.Where("ofx_account_id = ?", accountID).First(&existing).Error; err == nil {
		return &existing.ID
	}

	// b) By prior BankStatement linked to this accountID
	var existingStmt models.BankStatement
	if err := db.DB.Where("account_id = ? AND chart_account_id IS NOT NULL", accountID).First(&existingStmt).Error; err == nil && existingStmt.ChartAccountID != nil {
		db.DB.Model(&models.ChartAccount{}).Where("id = ? AND (ofx_account_id IS NULL OR ofx_account_id = '')", *existingStmt.ChartAccountID).Update("ofx_account_id", accountID)
		return existingStmt.ChartAccountID
	}

	// c) Legacy fallback: Description matches accountID
	if err := db.DB.Where("description = ?", accountID).First(&existing).Error; err == nil {
		db.DB.Model(&existing).Update("ofx_account_id", accountID)
		return &existing.ID
	}

	// Determine a display-friendly account number suffix (last 4 digits)
	last4 := accountID
	if len(accountID) > 4 {
		last4 = accountID[len(accountID)-4:]
	}

	// Determine account label and default candidate code for Smart Adoption
	accountLabel := "Bank Account"
	defaultCandidateCode := ""
	codePrefix := "1"

	switch accountType {
	case "ASSET":
		codePrefix = "1"
		if subType == "SAVINGS" || subType == "MONEYMRKT" {
			accountLabel = "Savings Account"
			defaultCandidateCode = "1020"
		} else {
			accountLabel = "Checking Account"
			defaultCandidateCode = "1010"
		}
	case "LIABILITY":
		codePrefix = "2"
		if subType == "CREDITLINE" {
			accountLabel = "Line of Credit"
			defaultCandidateCode = "2030"
		} else if subType == "LOAN" {
			accountLabel = "Bank Loan"
			defaultCandidateCode = "2510"
		} else {
			accountLabel = "Credit Card"
			defaultCandidateCode = "2020"
		}
	}

	displayName := fmt.Sprintf("%s (...%s)", accountLabel, last4)
	if institution != "" {
		displayName = fmt.Sprintf("%s %s (...%s)", institution, accountLabel, last4)
	}

	// 2. Smart Adoption: Check if the default placeholder account exists and is 100% pristine (unadopted)
	if defaultCandidateCode != "" {
		var candidate models.ChartAccount
		if err := db.DB.Where("code = ? AND is_default = ?", defaultCandidateCode, true).First(&candidate).Error; err == nil {
			var statementCount int64
			db.DB.Model(&models.BankStatement{}).Where("chart_account_id = ?", candidate.ID).Count(&statementCount)
			var txCount int64
			db.DB.Model(&models.BankTransaction{}).Where("chart_account_id = ? OR category_account_id = ?", candidate.ID, candidate.ID).Count(&txCount)
			var expCount int64
			db.DB.Model(&models.Expense{}).Where("chart_account_id = ?", candidate.ID).Count(&expCount)

			// An account is unadopted ONLY if it is completely pristine:
			// 0 statements, 0 transactions, 0 expenses, and its description is still a default template phrase
			if statementCount == 0 && txCount == 0 && expCount == 0 && (candidate.Description == "" || isDefaultDescription(candidate.Description)) {
				candidate.Name = displayName
				candidate.OfxAccountID = &accountID
				candidate.Description = fmt.Sprintf("OFX ID: %s", accountID)
				if err := db.DB.Save(&candidate).Error; err == nil {
					log.Printf("Smart Adoption: Claimed pristine default account %s '%s' for OFX account %s (institution: %s)\n",
						candidate.Code, candidate.Name, accountID, institution)
					events.Broadcast("ACCOUNTS_UPDATED", nil)
					return &candidate.ID
				}
			} else {
				log.Printf("Smart Adoption: Candidate default account %s '%s' has existing records (stmts=%d, txs=%d, exps=%d). Preserving it and allocating new account.\n",
					candidate.Code, candidate.Name, statementCount, txCount, expCount)
			}
		}
	}

	// 3. Fallback: Create a new account with the next sequential code in standard range
	var code string
	if accountType == "ASSET" {
		code = nextAvailableCodeInRange(1010, 1099)
	} else if accountType == "LIABILITY" {
		code = nextAvailableCodeInRange(2020, 2099)
	} else {
		code = nextAvailableCode(codePrefix)
	}

	newAccount := models.ChartAccount{
		Code:         code,
		Name:         displayName,
		Type:         accountType,
		OfxAccountID: &accountID, // store raw OFX ID in background for future statement matching
		Description:  fmt.Sprintf("OFX ID: %s", accountID),
		Active:       true,
		IsDefault:    false,
	}

	if err := db.DB.Create(&newAccount).Error; err != nil {
		log.Printf("Failed to auto-create ChartAccount for OFX account %s: %v\n", accountID, err)
		return nil
	}

	log.Printf("Auto-created ChartAccount '%s' (%s, type=%s) for OFX account ID: %s\n", newAccount.Name, newAccount.Code, newAccount.Type, accountID)
	events.Broadcast("ACCOUNTS_UPDATED", nil)
	return &newAccount.ID
}

// isDefaultDescription checks whether an account description is an initial template description
func isDefaultDescription(desc string) bool {
	defaults := []string{
		"Primary business checking account",
		"Business savings account",
		"Business credit card balance",
		"Outstanding loan balances",
		"Revolving business line of credit",
	}
	for _, d := range defaults {
		if strings.EqualFold(desc, d) {
			return true
		}
	}
	// If the description contains spaces, it's a descriptive phrase rather than a raw account ID
	return strings.Contains(desc, " ")
}

// nextAvailableCode finds the next unused 4-digit code starting with the given prefix.
// e.g. prefix "1" will try 1010, 1020, 1030, ... until a gap is found.
func nextAvailableCode(prefix string) string {
	for i := 10; i <= 990; i += 10 {
		candidate := fmt.Sprintf("%s%03d", prefix, i)
		var count int64
		db.DB.Model(&models.ChartAccount{}).Where("code = ?", candidate).Count(&count)
		if count == 0 {
			return candidate
		}
	}
	// Fallback: use a timestamp-based code if all slots are taken
	return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano()%9999)
}

// nextAvailableCodeInRange finds the next unused 4-digit code between minCode and maxCode inclusive.
func nextAvailableCodeInRange(minCode, maxCode int) string {
	for i := minCode; i <= maxCode; i += 5 {
		candidate := fmt.Sprintf("%04d", i)
		var count int64
		db.DB.Model(&models.ChartAccount{}).Where("code = ?", candidate).Count(&count)
		if count == 0 {
			return candidate
		}
	}
	// Fallback: try any single integer gap
	for i := minCode; i <= maxCode; i++ {
		candidate := fmt.Sprintf("%04d", i)
		var count int64
		db.DB.Model(&models.ChartAccount{}).Where("code = ?", candidate).Count(&count)
		if count == 0 {
			return candidate
		}
	}
	return fmt.Sprintf("%04d", minCode)
}
