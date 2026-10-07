package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"time"

	"github.com/aclindsa/ofxgo"
	"gorm.io/gorm/clause"
)

// ParseOfx reads an .ofx or .qfx file to extract the bank statement and transactions.
// It uses the bank's FITID to safely ignore duplicates so users can upload overlapping date ranges.
//
// COA account matching:
//   On import, we attempt to match the OFX AccountID+BankID to an existing ChartAccount
//   by looking at the Description field (where we store the raw OFX account ID on auto-create).
//   If no match is found, a new ASSET-type ChartAccount is auto-created.
//   The user can later reassign the type (e.g. to LIABILITY for a credit card account)
//   via the Account Manager in the UI.
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
	var startDate time.Time
	var endDate time.Time
	var transactions []ofxgo.Transaction

	if len(resp.Bank) > 0 {
		stmtResp, ok := resp.Bank[0].(*ofxgo.StatementResponse)
		if !ok {
			log.Println("Could not parse StatementResponse")
			return
		}
		accountID = stmtResp.BankAcctFrom.AcctID.String()
		bankID = stmtResp.BankAcctFrom.BankID.String()
		accountType = "ASSET" // Bank checking/savings accounts are assets
		startDate = stmtResp.BankTranList.DtStart.Time
		endDate = stmtResp.BankTranList.DtEnd.Time
		transactions = stmtResp.BankTranList.Transactions
	} else if len(resp.CreditCard) > 0 {
		ccStmtResp, ok := resp.CreditCard[0].(*ofxgo.CCStatementResponse)
		if !ok {
			log.Println("Could not parse CCStatementResponse")
			return
		}
		accountID = ccStmtResp.CCAcctFrom.AcctID.String()
		bankID = "" // Credit cards typically don't have a routing/bank ID in OFX
		accountType = "LIABILITY" // Credit cards are liabilities (money owed)
		startDate = ccStmtResp.BankTranList.DtStart.Time
		endDate = ccStmtResp.BankTranList.DtEnd.Time
		transactions = ccStmtResp.BankTranList.Transactions
	} else {
		log.Println("No bank or credit card statement found in OFX")
		return
	}

	// Resolve or auto-create a ChartAccount for this statement's bank account.
	// Bank accounts are ASSET type; credit card accounts are LIABILITY type.
	chartAccountID := resolveOrCreateChartAccount(accountID, bankID, accountType)

	// Create the BankStatement record
	bankStatement := models.BankStatement{
		DocumentURI:    filePath,
		FileExt:        fileExt,
		AccountID:      accountID,
		BankID:         bankID,
		StartDate:      startDate,
		EndDate:        endDate,
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
		dbTx.ReconciliationStatus = "UNMATCHED"

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
// or creates a new account of the specified type if none exists.
//
// Matching strategy:
//   The raw OFX accountID is stored in ChartAccount.Description on auto-creation.
//   We use that field to match future imports of the same account without requiring
//   the user to manually link every new statement.
//
// accountType should be "ASSET" for bank accounts and "LIABILITY" for credit cards.
// Users can update the type via the Account Manager in the UI if needed.
func resolveOrCreateChartAccount(accountID, bankID, accountType string) *uint {
	if accountID == "" {
		return nil
	}

	// Try to find an existing account whose Description contains the raw OFX account ID
	var existing models.ChartAccount
	if err := db.DB.Where("description = ?", accountID).First(&existing).Error; err == nil {
		return &existing.ID
	}

	// Determine a display-friendly account number suffix (last 4 digits)
	last4 := accountID
	if len(accountID) > 4 {
		last4 = accountID[len(accountID)-4:]
	}

	// Find the next available code in the appropriate range based on account type
	// ASSET accounts use 1xxx range; LIABILITY accounts use 2xxx range
	codePrefix := "1"
	accountLabel := "Bank Account"
	if accountType == "LIABILITY" {
		codePrefix = "2"
		accountLabel = "Credit Card"
	}

	code := nextAvailableCode(codePrefix)

	newAccount := models.ChartAccount{
		Code:        code,
		Name:        fmt.Sprintf("%s (...%s)", accountLabel, last4),
		Type:        accountType,
		Description: accountID, // store raw OFX ID for future statement matching
		Active:      true,
	}

	if err := db.DB.Create(&newAccount).Error; err != nil {
		log.Printf("Failed to auto-create ChartAccount for OFX account %s: %v\n", accountID, err)
		return nil
	}

	log.Printf("Auto-created ChartAccount '%s' (%s, type=%s) for OFX account ID: %s\n", newAccount.Name, newAccount.Code, newAccount.Type, accountID)
	return &newAccount.ID
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
