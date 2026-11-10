package models

import "time"

/*
ChartAccount represents a single entry in the Chart of Accounts.

The COA uses a standard five-type structure:
  - ASSET     (1000–1999): Things the business owns — bank accounts, cash, receivables
  - LIABILITY (2000–2999): Things the business owes — payables, loans, credit cards
  - EQUITY    (3000–3999): Owner's stake — capital, retained earnings
  - REVENUE   (4000–4999): Money brought in — sales, service fees, interest
  - EXPENSE   (5000–5999): Costs to run the business — rent, payroll, utilities

Accounts can be nested via ParentID for grouping (e.g. a parent "5000 Operating Expenses"
with children "5010 Rent", "5020 Payroll"). Leaf accounts are where transactions are posted.

This is intentionally a single-entry COA. Each BankTransaction and Expense links to
one ChartAccount. Full double-entry journal entries (debit + credit pairs) can be layered
on top in a future phase without structural changes to this model.
*/
type ChartAccount struct {
	ID   uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	Code string `gorm:"unique;not null" json:"code"` // e.g. "1010" — unique, user-editable

	Name string `gorm:"not null" json:"name"` // e.g. "Checking Account"

	// Type must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
	Type string `gorm:"not null" json:"type"`

	// Optional parent for sub-account grouping.
	// nil = top-level account. Set = child of another ChartAccount.
	ParentID *uint        `json:"parentId"`
	Parent   *ChartAccount `gorm:"foreignKey:ParentID" json:"-"`

	Description  string  `json:"description"` // free-text notes
	OfxAccountID *string `gorm:"column:ofx_account_id;index" json:"ofxAccountId,omitempty"` // background OFX account number for statement matching

	// Tax line mapping for Schedule C (Form 1040) / T2125
	// e.g. "Line 8 - Advertising", "Line 18 - Office expense", "Line 24b - Deductible meals (50%)"
	ScheduleCLine string `gorm:"column:schedule_c_line;default:''" json:"scheduleCLine"`

	// Soft-disable: inactive accounts can no longer receive new transactions
	// but their history is preserved.
	Active bool `gorm:"default:true" json:"active"`

	// System/default accounts cannot be deleted, and their Type cannot be changed.
	IsDefault bool `gorm:"default:false" json:"isDefault"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
