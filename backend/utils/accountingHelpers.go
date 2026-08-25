package utils

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
)

// IsMonthClosed checks if the accounting period for the given year/month is CLOSED
func IsMonthClosed(year int, month int) bool {
	var period models.AccountingPeriod
	err := db.DB.Where("year = ? AND month = ?", year, month).First(&period).Error
	if err != nil {
		return false // if doesn't exist, it's open
	}
	return period.Status == "CLOSED"
}
