package utils

import (
	"math"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestToCents(t *testing.T) {
	tests := []struct {
		name     string
		amount   float64
		expected int64
	}{
		{"Exact integer", 100.0, 10000},
		{"Two decimals", 60.45, 6045},
		{"Floating point rounding 0.1 + 0.2", 0.1 + 0.2, 30},
		{"Negative amount", -50.25, -5025},
		{"Zero", 0.0, 0},
		{"Sub-cent round up", 10.006, 1001},
		{"Sub-cent round down", 10.004, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toCents(tt.amount)
			if got != tt.expected {
				t.Errorf("toCents(%f) = %d, expected %d", tt.amount, got, tt.expected)
			}
		})
	}
}

func TestIsCashTender(t *testing.T) {
	tests := []struct {
		tender   string
		expected bool
	}{
		{"CASH", true},
		{"cash", true},
		{"Cash", true},
		{"CASH / PAPER", true},
		{"cash / paper", true},
		{"CARD", false},
		{"credit card", false},
		{"CHECK", false},
		{"ACH", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.tender, func(t *testing.T) {
			got := IsCashTender(tt.tender)
			if got != tt.expected {
				t.Errorf("IsCashTender(%q) = %v, expected %v", tt.tender, got, tt.expected)
			}
		})
	}
}

func TestCalculateExpenseSum(t *testing.T) {
	expenses := []models.Expense{
		{Amount: 60.50},
		{Amount: 39.50},
		{Amount: 100.00},
	}

	sum := calculateExpenseSum(expenses)
	if math.Abs(sum-200.00) > 0.0001 {
		t.Errorf("calculateExpenseSum() = %f, expected 200.00", sum)
	}

	emptySum := calculateExpenseSum([]models.Expense{})
	if emptySum != 0 {
		t.Errorf("calculateExpenseSum([]) = %f, expected 0", emptySum)
	}
}

func TestDaysDifference(t *testing.T) {
	d1 := time.Date(2026, 10, 1, 14, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 10, 5, 9, 30, 0, 0, time.UTC)

	diff := daysDifference(d1, d2)
	if diff != 4 {
		t.Errorf("daysDifference() = %d, expected 4", diff)
	}

	sameDayDiff := daysDifference(d1, d1)
	if sameDayDiff != 0 {
		t.Errorf("daysDifference() same day = %d, expected 0", sameDayDiff)
	}
}

func TestNormalizeStringWithApostrophes(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"McDonald's", "mcdonalds"},
		{"Wendy’s", "wendys"},
		{"Trader Joe's #123", "trader joes 123"},
		{"Lowe's Home Improvement", "lowes home improvement"},
		{"WAL*MART", "wal mart"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeString(tt.input)
			if got != tt.expected {
				t.Errorf("normalizeString(%q) = %q, expected %q", tt.input, got, tt.expected)
			}
		})
	}

	// Vendor description match test
	if !vendorMatchesDescription("MCDONALDS 01460092243", "McDonald's") {
		t.Errorf("expected MCDONALDS to match McDonald's")
	}
	if !vendorMatchesDescription("WENDYS RESTAURANT #44", "Wendy's") {
		t.Errorf("expected WENDYS to match Wendy's")
	}
}
