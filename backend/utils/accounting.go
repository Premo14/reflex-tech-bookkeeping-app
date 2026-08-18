package utils

import (
	"log"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"time"
)

// GetOrCreateAccountingPeriod checks if a period exists for the date,
// and if not, creates a new OPEN period.
func GetOrCreateAccountingPeriod(date time.Time) *models.AccountingPeriod {
	year := date.Year()
	month := int(date.Month())

	var period models.AccountingPeriod

	// Try to find the existing period
	err := db.DB.Where("year = ? AND month = ?", year, month).First(&period).Error
	if err == nil {
		return &period
	}

	// If it doesn't exist, create it autonomously
	period = models.AccountingPeriod{
		Year:   year,
		Month:  month,
		Status: "OPEN",
	}

	if err := db.DB.Create(&period).Error; err != nil {
		log.Printf("Error autonomously creating AccountingPeriod for %d/%d: %v\n", month, year, err)
		return nil
	}

	log.Printf("Autonomously opened new Accounting Period: %d/%d\n", month, year)
	return &period
}
