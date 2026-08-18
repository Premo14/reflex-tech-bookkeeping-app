package models

import (
	"time"
)

// BankStatement represents the raw OFX file and its metadata
type BankStatement struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	DocumentURI string `gorm:"not null" json:"documentUri"` // Path to the OFX file in processed/
	FileExt     string `gorm:"not null" json:"fileExt"`     // ".ofx"

	// Metadata about the statement itself
	AccountID string    `json:"accountId"` // e.g. "50106954S:05"
	BankID    string    `json:"bankId"`    // e.g. "221376539"
	StartDate time.Time `json:"startDate"`
	EndDate   time.Time `json:"endDate"`
	// A statement contains many transactions
	Transactions []BankTransaction `gorm:"foreignKey:BankStatementID" json:"transactions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// BankTransaction represents each transaction line of the bank statement
type BankTransaction struct {
	ID              uint `gorm:"primaryKey;autoIncrement" json:"id"`
	BankStatementID uint `gorm:"index;not null" json:"bankStatementId"`

	// The actual transaction data
	Date            time.Time `gorm:"not null;index" json:"date"`
	Description     string    `json:"description"`
	Amount          float64   `json:"amount"`
	TransactionType string    `json:"transactionType"` // e.g. "DEBIT" or "DEP"

	// bank's unique id for the tx
	// make it unique to avoid duplicate imports
	FITID string `gorm:"unique;not null" json:"fitId"`

	Expenses             []Expense `gorm:"foreignKey:BankTransactionID" json:"expenses"`
	ReconciliationStatus string    `json:"reconciliationStatus"`
	SuggestedExpenseID   *uint     `json:"suggestedExpenseId"`
	SuggestedExpense     *Expense  `gorm:"foreignKey:SuggestedExpenseID;constraint:-" json:"suggestedExpense"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
