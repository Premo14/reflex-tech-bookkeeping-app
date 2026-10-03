package models

import (
	"time"
)

// BankStatement represents the raw OFX file and its metadata.
// Each statement is linked to a ChartAccount (typically an ASSET or LIABILITY type)
// so that all imported transactions are automatically categorized by account.
type BankStatement struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	DocumentURI string `gorm:"not null" json:"documentUri"` // Path to the OFX file in processed/
	FileExt     string `gorm:"not null" json:"fileExt"`     // ".ofx" or ".qfx"

	// Metadata extracted from the OFX header
	AccountID string    `json:"accountId"` // Raw account number string from OFX
	BankID    string    `json:"bankId"`    // Routing/institution ID (empty for credit cards)
	StartDate time.Time `json:"startDate"`
	EndDate   time.Time `json:"endDate"`

	// The Chart of Accounts entry this statement belongs to.
	// Set during OFX import by matching AccountID+BankID to an existing ChartAccount,
	// or auto-creating a new one (ASSET type) if no match is found.
	// Nullable so legacy statements without a linked account remain valid.
	ChartAccountID *uint        `json:"chartAccountId"`
	ChartAccount   ChartAccount `gorm:"foreignKey:ChartAccountID" json:"chartAccount"`

	// A statement contains many transactions
	Transactions []BankTransaction `gorm:"foreignKey:BankStatementID" json:"transactions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// BankTransaction represents each individual transaction line from a bank statement.
type BankTransaction struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// Nullable so manually created transactions don't need to belong to an imported statement.
	BankStatementID *uint `gorm:"index" json:"bankStatementId"`

	// Denormalized from the parent BankStatement's ChartAccountID for fast per-account
	// filtering without a JOIN to bank_statements. Set during OFX import alongside the statement.
	// Nullable for backward compatibility and manual transactions without an assigned account.
	ChartAccountID *uint        `json:"chartAccountId"`
	ChartAccount   ChartAccount `gorm:"foreignKey:ChartAccountID" json:"chartAccount"`

	// The actual transaction data
	Date            time.Time `gorm:"not null;index" json:"date"`
	Description     string    `json:"description"`
	Amount          float64   `json:"amount"`
	TransactionType string    `json:"transactionType"` // e.g. "DEBIT" or "DEP"

	// Bank's unique ID for the transaction.
	// Unique constraint prevents duplicate imports when statement date ranges overlap.
	FITID string `gorm:"unique;not null" json:"fitId"`

	Expenses []Expense `gorm:"many2many:expense_bank_transactions;" json:"expenses"`

	ReconciliationStatus string `json:"reconciliationStatus"`
	HasSuggestions       bool   `json:"hasSuggestions"`
	Notes                string `json:"notes"` // Free-text memo/annotation field

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
