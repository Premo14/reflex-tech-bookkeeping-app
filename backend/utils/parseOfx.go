package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/aclindsa/ofxgo"
	"gorm.io/gorm/clause"
)

// ParseOfx reads an .ofx file to extract the bank statement and transactions.
// it uses the bank's FITID to safely ignore duplicates so users can upload overlapping date ranges.
func ParseOfx(filePath string) {
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

	// OFX files can theoretically contain multiple statements, but usually just have one.
	// We check if there's at least one Bank response:
	if len(resp.Bank) == 0 {
		log.Println("No bank statement found in OFX")
		return
	}

	// Cast the generic response to a StatementResponse
	stmtResp, ok := resp.Bank[0].(*ofxgo.StatementResponse)
	if !ok {
		log.Println("Could not parse StatementResponse")
		return
	}

	// Create the BankStatement object
	bankStatement := models.BankStatement{
		DocumentURI: filePath,
		FileExt:     ".ofx",
		AccountID:   stmtResp.BankAcctFrom.AcctID.String(),
		BankID:      stmtResp.BankAcctFrom.BankID.String(),
		StartDate:   stmtResp.BankTranList.DtStart.Time,
		EndDate:     stmtResp.BankTranList.DtEnd.Time,
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
	for _, tx := range stmtResp.BankTranList.Transactions {
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
