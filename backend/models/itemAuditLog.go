package models

import "time"

// ItemAuditLog records exclusions and restorations of individual bank transactions / expenses.
// Items excluded together as one link group share a GroupID.
type ItemAuditLog struct {
	ID       uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	ItemType string `gorm:"index" json:"itemType"` // "transaction" or "expense"
	ItemID   uint   `gorm:"index" json:"itemId"`
	Action   string `json:"action"` // EXCLUDED, RESTORED
	Reason   string `json:"reason"`
	Note     string `json:"note"`
	GroupID  string `json:"groupId"`

	CreatedAt time.Time `json:"createdAt"`
}
