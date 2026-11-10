package models

import "time"

/*
BankRule defines an automated categorization and action rule for bank transactions.
Rules are evaluated in order of Priority ASC (lower numbers run first).
When a rule matches:
  - It assigns CategoryAccountID (if configured)
  - It can optionally rename/clean the merchant vendor string
  - It can auto-confirm (mark as approved) or auto-exclude (mark as ignored, e.g. personal expenses)
  - It records apply metrics (ApplyCount, LastAppliedAt)
*/
type BankRule struct {
	ID        uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string `gorm:"not null" json:"name"`
	Priority  int    `gorm:"default:0;index" json:"priority"`
	Active    bool   `gorm:"default:true" json:"active"`

	// Match logic: "AND" (all conditions must match) or "OR" (at least one matches)
	MatchLogic string `gorm:"default:'AND'" json:"matchLogic"`

	// JSON-serialized array of RuleCondition structs
	ConditionsJSON string `gorm:"type:text;not null" json:"conditions"`

	// Target category account (EXPENSE, REVENUE, ASSET, LIABILITY)
	CategoryAccountID *uint         `gorm:"index" json:"categoryAccountId"`
	CategoryAccount   *ChartAccount `gorm:"foreignKey:CategoryAccountID" json:"categoryAccount,omitempty"`

	// Optional cleaned vendor name to assign to the transaction
	RenamedVendor string `json:"renamedVendor"`

	// Action flags
	AutoConfirm     bool   `gorm:"default:false" json:"autoConfirm"` // Mark review status as APPROVED
	AutoExclude     bool   `gorm:"default:false" json:"autoExclude"` // Mark review status as IGNORED
	ExclusionReason string `json:"exclusionReason"`                  // PERSONAL, DUPLICATE, OTHER
	Notes           string `json:"notes"`                            // Append note/memo

	// Usage tracking
	ApplyCount    int        `gorm:"default:0" json:"applyCount"`
	LastAppliedAt *time.Time `json:"lastAppliedAt"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type RuleCondition struct {
	Field    string `json:"field"`    // "description", "amount", "transaction_type", "chart_account_id"
	Operator string `json:"operator"` // "contains", "not_contains", "equals", "starts_with", "ends_with", "regex", "greater_than", "less_than", "equals_amount"
	Value    string `json:"value"`
}
