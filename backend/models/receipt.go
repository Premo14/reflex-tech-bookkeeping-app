package models

import (
	"time"
)

// Expense represents the AI-extracted data for a purchase/receipt.
// An expense is created by the file processor after it analyses a receipt image or PDF.
// It can also be created manually via the API.
type Expense struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// AI-extracted (or manually entered) fields
	IsManual    bool      `gorm:"default:false" json:"isManual"`
	Timestamp   time.Time `json:"timestamp"`
	Vendor      string    `json:"vendor"`
	Description string    `json:"description"`
	Amount      float64   `json:"amount"`
	Tender      string    `json:"tender"` // "card", "cash", "check", "other"

	// The Chart of Accounts entry this expense is categorized under.
	// Typically an EXPENSE-type account (e.g. "5010 Rent", "5040 Advertising").
	// Set by the user after AI extraction, or can be auto-suggested in the future.
	// Nullable so expenses without an assigned account remain valid.
	ChartAccountID *uint        `json:"chartAccountId"`
	ChartAccount   ChartAccount `gorm:"foreignKey:ChartAccountID" json:"chartAccount"`

	// One expense can have multiple receipts (e.g. a photo and a PDF of the same purchase)
	Receipts []Receipt `json:"receipts"`

	BankTransactions []BankTransaction `gorm:"many2many:expense_bank_transactions;" json:"bankTransactions"`

	ReconciliationStatus string `json:"reconciliationStatus"`
	ReviewStatus         string `json:"reviewStatus"` // PENDING, APPROVED, IGNORED
	ExclusionReason      string `json:"exclusionReason"` // DUPLICATE, PERSONAL, ERROR, OTHER (set when excluded)
	ExclusionNote        string `json:"exclusionNote"`
	HasSuggestions       bool   `json:"hasSuggestions"`
	Notes                string `json:"notes"` // Free-text memo/annotation field

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Receipt represents a physical file on disk (image, pdf, etc).
type Receipt struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	// Pointer because new uploads don't have an expense yet — the file processor
	// creates the Receipt record first, then links it to the Expense after AI extraction.
	ExpenseID *uint `gorm:"index" json:"expenseId"`

	// File metadata
	DocumentURI string `gorm:"not null" json:"documentUri"`
	FileExt     string `gorm:"not null" json:"fileExt"`
	FileHash    string `gorm:"unique" json:"fileHash"` // SHA256, prevents duplicate uploads

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
