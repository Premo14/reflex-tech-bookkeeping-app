package models

import (
	"time"

	"gorm.io/gorm"
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

	// Authoritative statement ending balance and timestamp extracted from OFX LedgerBal
	EndingBalance *float64   `json:"endingBalance"`
	BalanceAsOf   *time.Time `json:"balanceAsOf"`

	// The Chart of Accounts entry this statement belongs to.
	// Set during OFX import by matching AccountID+BankID to an existing ChartAccount,
	// or auto-creating a new one (ASSET type) if no match is found.
	// Nullable so legacy statements without a linked account remain valid.
	ChartAccountID *uint         `json:"chartAccountId"`
	ChartAccount   *ChartAccount `gorm:"foreignKey:ChartAccountID" json:"chartAccount"`

	// A statement contains many transactions
	Transactions []BankTransaction `gorm:"foreignKey:BankStatementID" json:"transactions"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// BankTransaction represents each individual transaction line from a bank statement.
type BankTransaction struct {
	ID uint `gorm:"primaryKey;autoIncrement" json:"id"`

	IsManual bool `gorm:"default:false" json:"isManual"`

	// Nullable so manually created transactions don't need to belong to an imported statement.
	BankStatementID *uint `gorm:"index" json:"bankStatementId"`

	// The BANK/CREDIT-CARD account this transaction moved through (ASSET or LIABILITY).
	// Denormalized from the parent BankStatement's ChartAccountID for fast per-account
	// filtering without a JOIN to bank_statements. Set during OFX import alongside the statement.
	// Nullable for backward compatibility and manual transactions without an assigned account.
	ChartAccountID *uint         `json:"chartAccountId"`
	ChartAccount   *ChartAccount `gorm:"foreignKey:ChartAccountID" json:"chartAccount"`

	// The CATEGORY this transaction is booked under (EXPENSE or REVENUE account).
	// Kept separate from ChartAccountID because a bank transaction has two sides:
	// where the money moved (above) and what it was for (this). Linked expenses must
	// agree with this category, except on split transactions (several linked expenses).
	CategoryAccountID *uint         `gorm:"index" json:"categoryAccountId"`
	Category          *ChartAccount `gorm:"foreignKey:CategoryAccountID" json:"category"`

	// The actual transaction data
	Date            time.Time `gorm:"not null;index" json:"date"`
	Description     string    `json:"description"`
	Amount          float64   `json:"amount"`
	TransactionType string    `json:"transactionType"` // e.g. "DEBIT" or "DEP"

	// Bank's unique ID for the transaction.
	// Unique constraint prevents duplicate imports when statement date ranges overlap.
	FITID string `gorm:"unique;not null" json:"fitId"`

	Expenses []Expense `gorm:"many2many:expense_bank_transactions;" json:"expenses"`

	AllocationStatus     string `gorm:"column:allocation_status" json:"allocationStatus"`
	ReconciliationStatus string `gorm:"-" json:"reconciliationStatus,omitempty"`
	LinkStatus           string `gorm:"-" json:"linkStatus,omitempty"`
	ReviewStatus         string     `json:"reviewStatus"` // PENDING, APPROVED, IGNORED, WARNINGS_IGNORED, DELETED
	ExclusionReason      string     `json:"exclusionReason"` // DUPLICATE, PERSONAL, OTHER, CLOSED_PERIOD (set when excluded)
	ExclusionNote        string     `json:"exclusionNote"`
	HasSuggestions       bool       `json:"hasSuggestions"`
	Notes                string     `json:"notes"` // Free-text memo/annotation field
	DeletedAt            *time.Time `gorm:"column:deleted_at;index" json:"deletedAt,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (b *BankTransaction) AfterFind(tx *gorm.DB) (err error) {
	b.ReconciliationStatus = b.AllocationStatus
	b.LinkStatus = b.AllocationStatus
	return
}
