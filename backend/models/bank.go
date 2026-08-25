package models

import (
	"time"
)

// BankStatement represents the raw OFX file and its metadata
type BankStatement struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	DocumentURI string `gorm:"not null" json:"documentUri"` // Path to the OFX file in processed/
	FileExt     string `gorm:"not null" json:"fileExt"`     // ".ofx" or ".qfx"

	// Metadata about the statement itself
	AccountID string    `json:"accountId"`
	BankID    string    `json:"bankId"`
	StartDate time.Time `json:"startDate"`
	EndDate   time.Time `json:"endDate"`
	// A statement contains many transactions
	Transactions []BankTransaction `gorm:"foreignKey:BankStatementID" json:"transactions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// BankTransaction represents each transaction line of the bank statement
type BankTransaction struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`
	// Nullable so manually created transactions don't need to belong to an imported statement.
	BankStatementID *uint `gorm:"index" json:"bankStatementId"`

	// The actual transaction data
	Date            time.Time `gorm:"not null;index" json:"date"`
	Description     string    `json:"description"`
	Amount          float64   `json:"amount"`
	TransactionType string    `json:"transactionType"` // e.g. "DEBIT" or "DEP"

	// bank's unique id for the tx
	// make it unique to avoid duplicate imports
	FITID string `gorm:"unique;not null" json:"fitId"`

	Expenses []Expense `gorm:"many2many:expense_bank_transactions;" json:"expenses"`

	ReconciliationStatus string `json:"reconciliationStatus"`
	HasSuggestions       bool   `json:"hasSuggestions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
