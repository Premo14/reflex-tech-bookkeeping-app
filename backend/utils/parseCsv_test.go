package utils

import (
	"math"
	"testing"
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
