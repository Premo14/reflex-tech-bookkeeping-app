package utils

import (
	"math"
	"testing"
	"time"
)

func TestParseCSVDate(t *testing.T) {
	tests := []struct {
		input    string
		expected string
		wantErr  bool
	}{
		{"2026-08-15", "2026-08-15", false},
		{"08/15/2026", "2026-08-15", false},
		{"8/15/2026", "2026-08-15", false},
		{"08-15-2026", "2026-08-15", false},
		{"2026/08/15", "2026-08-15", false},
		{"2026-08-15T14:30:00Z", "2026-08-15", false},
		{"invalid-date", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseCSVDate(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseCSVDate(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if !tt.wantErr {
				formatted := got.Format("2006-01-02")
				if formatted != tt.expected {
					t.Errorf("parseCSVDate(%q) = %s, expected %s", tt.input, formatted, tt.expected)
				}
			}
		})
	}
}



func TestCleanCSVAmount(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
		wantErr  bool
	}{
		{"$1,234.56", 1234.56, false},
		{"-$50.25", -50.25, false},
		{"($75.00)", -75.00, false},
		{"100", 100.0, false},
		{"", 0, false},
		{"(12.34)", -12.34, false},
		{"  $ 99.99  ", 99.99, false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := cleanCSVAmount(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("cleanCSVAmount(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if !tt.wantErr {
				if math.Abs(got-tt.expected) > 0.001 {
					t.Errorf("cleanCSVAmount(%q) = %f, expected %f", tt.input, got, tt.expected)
				}
			}
		})
	}
}

func TestGenerateDeterministicFITID(t *testing.T) {
	d1 := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)

	// 1. Invariance across multiple runs
	id1 := GenerateCSVFitID(d1, "GITHUB INC", -20.00, 1, 1010)
	id2 := GenerateCSVFitID(d2, "github inc ", -20.00, 1, 1010)
	if id1 != id2 {
		t.Errorf("Expected identical FITID regardless of casing/trailing space, got %s vs %s", id1, id2)
	}

	// 2. Same-day occurrence disambiguation
	idFirstOccurrence := GenerateCSVFitID(d1, "UBER TRIP", -15.50, 1, 1010)
	idSecondOccurrence := GenerateCSVFitID(d1, "UBER TRIP", -15.50, 2, 1010)
	if idFirstOccurrence == idSecondOccurrence {
		t.Errorf("Expected distinct FITIDs for multiple occurrences on same day, got %s", idFirstOccurrence)
	}

	// 3. Account-scoping disambiguation
	idChecking := GenerateCSVFitID(d1, "AMAZON.COM", -49.99, 1, 1)  // Account 1 (Checking)
	idCreditCard := GenerateCSVFitID(d1, "AMAZON.COM", -49.99, 1, 8) // Account 8 (Credit Card)
	if idChecking == idCreditCard {
		t.Errorf("Expected distinct FITIDs across different accounts, got %s", idChecking)
	}

	// 4. Proper prefix format
	if len(id1) < 10 || id1[:4] != "CSV-" {
		t.Errorf("Expected FITID to have 'CSV-' prefix, got %s", id1)
	}
}


