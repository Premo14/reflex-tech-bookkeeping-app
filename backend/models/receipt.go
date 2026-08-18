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

	// one expense can have multiple receipts (e.g. photo and pdf)
	Receipts []Receipt `json:"receipts"`

	// A receipt can only be linked to one bank transaction
	BankTransactionID      *uint            `json:"bankTransactionId"`
	SuggestedTransactionID *uint            `json:"suggestedTransactionId"`
	SuggestedTransaction   *BankTransaction `gorm:"foreignKey:SuggestedTransactionID" json:"suggestedTransaction"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Receipt represents a physical file on disk (image, pdf, etc).
type Receipt struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// pointer because new uploads don't have an expense yet
	ExpenseID *uint `gorm:"index" json:"expenseId"`

	// File metadata
	DocumentURI string `gorm:"not null" json:"documentUri"` // e.g. "/app/documents/processed/a3f2...png"
	FileExt     string `gorm:"not null" json:"fileExt"`     // e.g. ".png"
	FileHash    string `gorm:"unique" json:"fileHash"`      // SHA-256 hash to prevent duplicates

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
