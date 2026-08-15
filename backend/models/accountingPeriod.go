package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

/*
	Represents a single month in the books.

If a month is 'closed', it is not editable.
Reports cannot be generated if a month is still open or in review.
*/
type AccountingPeriod struct {
	ID     string `gorm:"primaryKey;type:uuid"`
	Year   int    // 2026
	Month  int    // 8
	Status string // "OPEN", "REVIEW", "CLOSED"

	CreatedAt time.Time
	UpdatedAt time.Time
}

// BeforeCreate is a GORM hook that runs automatically before a BankStatement is saved
// It is required that GORM hooks return an error
func (ap *AccountingPeriod) BeforeCreate(tx *gorm.DB) error {
	if ap.ID == "" {
		ap.ID = uuid.New().String()
	}
	return nil
}
