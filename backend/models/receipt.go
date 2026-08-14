package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Expense represents the AI-extracted data for a transaction.
type Expense struct {
	// GORM will use this as the primary key
	ID string `gorm:"primaryKey;type:uuid"`

	// AI Extracted fields
	Timestamp   time.Time
	Vendor      string
	Description string
	Amount      float64
	Tender      string

	// A single Expense can have multiple Receipts (e.g. a photo and a PDF).
	// GORM automatically uses the ExpenseID field in the Receipt struct as the foreign key.
	Receipts []Receipt

	// Standard timestamps (good practice to have)
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Receipt represents a physical file on disk (image, pdf, etc).
type Receipt struct {
	ID string `gorm:"primaryKey;type:uuid"`

	// Foreign key linking back to the Expense.
	// It's a pointer (*string) because when a file is first uploaded,
	// it won't have an Expense associated with it yet until the AI runs.
	ExpenseID *string `gorm:"type:uuid;index"`

	// File metadata
	DocumentURI string `gorm:"not null"` // e.g. "/app/documents/processed/a3f2...png"
	FileExt     string `gorm:"not null"` // e.g. ".png"

	CreatedAt time.Time
	UpdatedAt time.Time
}

// BeforeCreate is a GORM hook that runs automatically before an Expense is saved
// It is required that GORM hooks return an error
func (e *Expense) BeforeCreate(tx *gorm.DB) (err error) {
	e.ID = uuid.New().String()
	return nil
}

// BeforeCreate is a GORM hook that runs automatically before a Receipt is saved
// It is required that GORM hooks return an error
func (r *Receipt) BeforeCreate(tx *gorm.DB) (err error) {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}
