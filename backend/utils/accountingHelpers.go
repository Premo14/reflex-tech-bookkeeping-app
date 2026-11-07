package utils

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"
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
	// We zero out the time in UTC to ensure safe, timezone-neutral calendar comparison
	compareDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	return !compareDate.After(closedDate)
}

// NormalizeTender canonicalizes a payment method to trimmed lower-case so that comparisons
// (e.g. against "cash") behave the same no matter which UI or import path wrote the value.
// It also maps common card aliases and brands (visa, mastercard, amex, debit, credit) to "card".
func NormalizeTender(tender string) string {
	t := strings.ToLower(strings.TrimSpace(tender))
	switch t {
	case "visa", "mastercard", "amex", "american express", "discover", "debit", "credit", "credit card", "debit card":
		return "card"
	case "cash", "cash / paper", "cash/paper", "currency", "paper":
		return "cash"
	case "check", "cheque":
		return "check"
	case "transfer", "wire", "ach":
		return "transfer"
	case "paypal":
		return "paypal"
	case "venmo":
		return "venmo"
	case "zelle":
		return "zelle"
	case "other":
		return "other"
	case "":
		return "card"
	default:
		return t
	}
}

// IsCashTender reports whether the payment method is cash (case-insensitive).
func IsCashTender(tender string) bool {
	return NormalizeTender(tender) == "cash"
}
