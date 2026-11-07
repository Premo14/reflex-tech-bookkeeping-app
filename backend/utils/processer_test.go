package utils

import (
	"testing"
	"time"
)

func TestCleanAIJSON(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Plain JSON object",
			input:    `{"vendor": "Target", "amount": 25.50}`,
			expected: `{"vendor": "Target", "amount": 25.50}`,
		},
		{
			name:     "Markdown json fence",
			input:    "```json\n{\"vendor\": \"Target\", \"amount\": 25.50}\n```",
			expected: `{"vendor": "Target", "amount": 25.50}`,
		},
		{
			name:     "Surrounding explanation text",
			input:    "Here is the parsed receipt data:\n```\n{\"vendor\": \"Target\", \"amount\": 25.50}\n```\nHope that helps!",
			expected: `{"vendor": "Target", "amount": 25.50}`,
		},
		{
			name:     "No markdown fence but surrounding text",
			input:    "Receipt details: {\"vendor\": \"Target\", \"amount\": 25.50} (USD)",
			expected: `{"vendor": "Target", "amount": 25.50}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CleanAIJSON(tt.input)
			if got != tt.expected {
				t.Errorf("CleanAIJSON(%q) = %q, expected %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseExtractedAmount(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected float64
	}{
		{"Float64 positive", 45.67, 45.67},
		{"Float64 negative becomes positive", -45.67, 45.67},
		{"Integer", 100, 100.0},
		{"Int64", int64(250), 250.0},
		{"String with dollar sign", "$1,234.56", 1234.56},
		{"String with spaces", "  89.99 ", 89.99},
		{"Nil value", nil, 0.0},
		{"Invalid string", "unknown", 0.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseExtractedAmount(tt.input)
			if got != tt.expected {
				t.Errorf("ParseExtractedAmount(%v) = %f, expected %f", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseExtractedTimestamp(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string // formatted as YYYY-MM-DD
	}{
		{"RFC3339 format", "2026-10-15T14:30:00Z", "2026-10-15"},
		{"Standard ISO date", "2026-10-15", "2026-10-15"},
		{"US date MM/DD/YYYY", "10/15/2026", "2026-10-15"},
		{"Datetime space separated", "2026-10-15 09:00:00", "2026-10-15"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed := ParseExtractedTimestamp(tt.input)
			if parsed.Format("2006-01-02") != tt.expected {
				t.Errorf("ParseExtractedTimestamp(%q) = %s, expected %s", tt.input, parsed.Format("2006-01-02"), tt.expected)
			}
		})
	}

	// Empty string fallback to now
	now := time.Now().UTC()
	fallback := ParseExtractedTimestamp("")
	if fallback.Year() != now.Year() || fallback.Month() != now.Month() {
		t.Errorf("ParseExtractedTimestamp(\"\") fallback did not return current time: got %v", fallback)
	}
}

func TestParseExtractedChartAccountID(t *testing.T) {
	idVal := uint(42)

	tests := []struct {
		name     string
		input    interface{}
		expected *uint
	}{
		{"Float64 ID", 42.0, &idVal},
		{"Integer ID", 42, &idVal},
		{"String numeric ID", "42", &idVal},
		{"String 'null'", "null", nil},
		{"Nil", nil, nil},
		{"Zero ID", 0, nil},
		{"Negative ID", -5, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseExtractedChartAccountID(tt.input)
			if tt.expected == nil && got != nil {
				t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected nil", tt.input, *got)
			} else if tt.expected != nil && (got == nil || *got != *tt.expected) {
				t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected %v", tt.input, got, *tt.expected)
			}
		})
	}
}
