package utils

import (
	"log"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"time"
)

/*
GetOrCreateAccountingPeriod automatically ensures an AccountingPeriod exists for a given date.
It extracts the Month and Year, queries the database, and if it doesn't exist, it creates it
with an initial status of "OPEN".
*/
func GetOrCreateAccountingPeriod(date time.Time) *models.AccountingPeriod {
	year := date.Year()
	month := int(date.Month())

	var period models.AccountingPeriod
	
	// Try to find the existing period
	err := db.DB.Where("year = ? AND month = ?", year, month).First(&period).Error
	if err == nil {
		return &period // Found it!
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
