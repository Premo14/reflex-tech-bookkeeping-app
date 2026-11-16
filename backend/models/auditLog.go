package models

import "time"

type PeriodAuditLog struct {
	ID           uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Action       string    `json:"action"`       // "LOCKED", "UNLOCKED", "ROLLED_BACK"
	PreviousDate string    `json:"previousDate"` // ISO date string or empty
	NewDate      string    `json:"newDate"`      // ISO date string or empty
	Reason       string    `json:"reason"`       // "Manual Update", "Review Queue Resolution"
	CreatedAt    time.Time `json:"createdAt"`
}
