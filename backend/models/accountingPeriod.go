package models

import (
	"time"
)

/*
	Represents a single month in the books.

If a month is 'closed', it is not editable.
Reports cannot be generated if a month is still open or in review.
*/
type AccountingPeriod struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Year      int       `json:"year"`
	Month     int       `json:"month"`
	Status    string    `json:"status"` // "OPEN", "REVIEW", "CLOSED"
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
