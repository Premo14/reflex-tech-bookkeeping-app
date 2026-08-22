package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/aclindsa/ofxgo"
	"gorm.io/gorm/clause"
)

// ParseOfx reads an .ofx or .qfx file to extract the bank statement and transactions.
// it uses the bank's FITID to safely ignore duplicates so users can upload overlapping date ranges.
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
		startDate = ccStmtResp.BankTranList.DtStart.Time
		endDate = ccStmtResp.BankTranList.DtEnd.Time
		transactions = ccStmtResp.BankTranList.Transactions
	} else {
		log.Println("No bank or credit card statement found in OFX")
		return
	}

	// Create the BankStatement object
	bankStatement := models.BankStatement{
		DocumentURI: filePath,
		FileExt:     fileExt,
		AccountID:   accountID,
		BankID:      bankID,
		StartDate:   startDate,
		EndDate:     endDate,
	}

	// save statement to get its ID
	if err := db.DB.Create(&bankStatement).Error; err != nil {
		log.Println("Error creating BankStatement:", err)
		return
	}

	// rename ofx file to match new ID
	newFilePath := filepath.Join(filepath.Dir(filePath), fmt.Sprintf("%d%s", bankStatement.ID, filepath.Ext(filePath)))
	if err := os.Rename(filePath, newFilePath); err == nil {
		bankStatement.DocumentURI = newFilePath
		db.DB.Save(&bankStatement)
	}

	// Loop over the transactions
	var dbTransactions []models.BankTransaction
	for _, tx := range transactions {
		// Convert tx.TrnAmt (which is an ofxgo.Amount) to a float64
		val, _ := tx.TrnAmt.Float64()
		// Combine Name and Memo for a full description
		fullDesc := string(tx.Name) + " " + string(tx.Memo)
		dbTx := models.BankTransaction{
			BankStatementID: bankStatement.ID,
			Date:            tx.DtPosted.Time,
			Description:     fullDesc,
			Amount:          val,
			TransactionType: fmt.Sprintf("%v", tx.TrnType),
			FITID:           string(tx.FiTID),
		}
		dbTransactions = append(dbTransactions, dbTx)

		// ensure accounting period exists for this tx
		GetOrCreateAccountingPeriod(dbTx.Date)
	}

	if len(dbTransactions) > 0 {
		// bulk insert transactions.
		// onconflict ignores duplicates based on fit_id
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
	// trigger reconciliation to link any waiting expenses
	RunReconciliation()
}
