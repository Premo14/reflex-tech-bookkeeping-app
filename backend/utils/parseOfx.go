package utils

import (
	"fmt"
	"log"
	"os"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/aclindsa/ofxgo"
	"gorm.io/gorm/clause"
)

/*
ParseOfx reads an Open Financial Exchange (.ofx) file and extracts the Bank Statement and its Transactions.
Because users might download overlapping date ranges from their bank (e.g. July 1-15, then July 10-20),
this function is designed to be completely idempotent. It uses the bank's unique FITID to safely
ignore duplicate transactions, allowing the user to upload as many statements as they want without breaking the math.
*/
func ParseOfx(filePath, bankStatementID string) {
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
		ID:          bankStatementID, // This is the fileID passed from processFile
		DocumentURI: filePath,
		FileExt:     ".ofx",
		AccountID:   stmtResp.BankAcctFrom.AcctID.String(),
		BankID:      stmtResp.BankAcctFrom.BankID.String(),
		StartDate:   stmtResp.BankTranList.DtStart.Time,
		EndDate:     stmtResp.BankTranList.DtEnd.Time,
	}

	// Save the statement to the database so we get its UUID and have a record of the upload
	if err := db.DB.Create(&bankStatement).Error; err != nil {
		log.Println("Error creating BankStatement:", err)
		return
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
	}

	if len(dbTransactions) > 0 {
		// Bulk Insert the transactions into Postgres for speed.
		// The `clause.OnConflict` is the magic here. GORM maps the struct field `FITID` to the column `fit_id`.
		// If Postgres sees a transaction with a `fit_id` it already has, it silently skips it (DoNothing: true).
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
	// Now that the database has fresh bank transactions, trigger the reconciliation engine
	// to see if any waiting Expenses (receipts) can finally be linked
	RunReconciliation()
}
