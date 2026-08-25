package models

import (
	"time"
)

// Expense represents the AI-extracted data for a transaction.
type Expense struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// AI Extracted fields
	Timestamp   time.Time `json:"timestamp"`
	Vendor      string    `json:"vendor"`
	Description string    `json:"description"`
	Amount      float64   `json:"amount"`
	Tender      string    `json:"tender"`
	Status      string    `gorm:"default:'OPEN'" json:"status"` // "OPEN" or "PENDING_CLOSED"

	// one expense can have multiple receipts (e.g. photo and pdf)
	Receipts []Receipt `json:"receipts"`

	BankTransactions []BankTransaction `gorm:"many2many:expense_bank_transactions;" json:"bankTransactions"`

	ReconciliationStatus string `json:"reconciliationStatus"`
	HasSuggestions       bool   `json:"hasSuggestions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Receipt represents a physical file on disk (image, pdf, etc).
type Receipt struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// pointer because new uploads don't have an expense yet
	ExpenseID *uint `gorm:"index" json:"expenseId"`

	// File metadata
	DocumentURI string `gorm:"not null" json:"documentUri"`
	FileExt     string `gorm:"not null" json:"fileExt"`
	FileHash    string `gorm:"unique" json:"fileHash"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
