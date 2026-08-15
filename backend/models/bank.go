package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BankStatement represents the raw OFX file and its metadata
type BankStatement struct {
	ID string `gorm:"primaryKey;type:uuid"`

	DocumentURI string `gorm:"not null"` // Path to the OFX file in processed/
	FileExt     string `gorm:"not null"` // ".ofx"

	// Metadata about the statement itself
	AccountID string // e.g. "50106954S:05"
	BankID    string // e.g. "221376539"
	StartDate time.Time
	EndDate   time.Time
	// A statement contains many transactions
	Transactions []BankTransaction `gorm:"foreignKey:BankStatementID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

// BankTransaction represents each transaction line of the bank statement
type BankTransaction struct {
	ID              string `gorm:"primaryKey;type:uuid"`
	BankStatementID string `gorm:"type:uuid;index;not null"`

	// The actual transaction data
	Date            time.Time `gorm:"not null"`
	Description     string
	Amount          float64
	TransactionType string // e.g. "DEBIT" or "DEP"

	// CRITICAL: The bank's unique ID for this transaction.
	// We make it UNIQUE so we can't accidentally import it twice.
	FITID string `gorm:"unique;not null"`

	// Link this to an AI-extracted "Expense" (from a receipt)
	// It's a pointer because it won't be matched immediately.
	ExpenseID *string `gorm:"type:uuid;index"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

// BeforeCreate is a GORM hook that runs automatically before a BankStatement is saved
// It is required that GORM hooks return an error
func (bs *BankStatement) BeforeCreate(tx *gorm.DB) error {
	if bs.ID == "" {
		bs.ID = uuid.New().String()
	}

	return nil
}

func (bt *BankTransaction) BeforeCreate(tx *gorm.DB) error {
	if bt.ID == "" {
		bt.ID = uuid.New().String()
	}

	return nil
}
