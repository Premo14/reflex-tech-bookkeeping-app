package utils

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"time"
)

// IsDateInClosedPeriod checks whether the given date is on or before the BooksClosedDate setting.
func IsDateInClosedPeriod(date time.Time) bool {
	var setting models.AppSetting
	if err := db.DB.Where("key = ?", "BooksClosedDate").First(&setting).Error; err != nil {
		return false // Setting doesn't exist, so nothing is closed
	}

	if setting.Value == "" {
		return false
	}

	// Parse the date (assuming "2006-01-02" format)
	closedDate, err := time.Parse("2006-01-02", setting.Value)
	if err != nil {
		return false
	}

	// If the date is on or before the closedDate, it's in a closed period
	// We zero out the time on the given date to ensure safe comparison
	compareDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	return !compareDate.After(closedDate)
}
