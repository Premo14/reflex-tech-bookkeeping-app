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
				t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestCleanAIJSON_MalformedAndMarkdown(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		contains string // verify this string appears in the result
	}{
		{
			name:     "Prose with embedded JSON",
			input:    "I couldn't find any useful data. But just in case: {\"vendor\":\"Test\",\"amount\":5.00}",
			contains: `{"vendor":"Test","amount":5.00}`,
		},
		{
			name:     "Multiple JSON objects - returns outermost",
			input:    "Result: {\"a\":1} and also {\"b\":2}",
			contains: `{"a":1} and also {"b":2}`,
		},
		{
			name:     "Empty result after cleaning",
			input:    "This is just prose, no JSON at all",
			contains: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CleanAIJSON(tt.input)
			if tt.contains != "" {
				if got != tt.contains {
					t.Errorf("CleanAIJSON(%q) = %q, expected %q", tt.input, got, tt.contains)
				}
			} else if got != "" && got != "This is just prose, no JSON at all" {
				t.Errorf("CleanAIJSON(%q) = %q, expected empty or unchanged", tt.input, got)
			}
		})
	}
}

func TestParseExtractedAmount_StringFormatted(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected float64
	}{
		{"String $1,234.56", "$1,234.56", 1234.56},
		{"String $0.99", "$0.99", 0.99},
		{"String €50.00 (euro stripped)", "€50.00", 50.0},
		{"String without symbol", "1234.56", 1234.56},
		{"String with comma no dollar", "1,234.56", 1234.56},
		{"String with spaces and dollar", "  $25.00  ", 25.00},
		{"String negative with dollar", "-$50.00", 50.0},
		{"String with USD suffix", "$10.00 USD", 10.00},
		{"String with USD prefix", "USD 10.00", 10.00},
		{"String with CAD prefix", "CAD 45.67", 45.67},
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

func TestParseExtractedTimestamp_EmptyAndMissing(t *testing.T) {
	// Empty string should fall back to current time
	fallback := ParseExtractedTimestamp("")
	now := time.Now().UTC()
	if fallback.Year() != now.Year() || fallback.Month() != now.Month() || fallback.Day() != now.Day() {
		t.Errorf("ParseExtractedTimestamp(\"\") fallback = %v, expected current time %v", fallback, now)
	}

	// Whitespace-only should also fall back
	fallbackWS := ParseExtractedTimestamp("   ")
	if fallbackWS.Year() != now.Year() || fallbackWS.Month() != now.Month() || fallbackWS.Day() != now.Day() {
		t.Errorf("ParseExtractedTimestamp(\"   \") fallback = %v, expected current time %v", fallbackWS, now)
	}

	// Unparseable string falls back too
	fallbackBad := ParseExtractedTimestamp("not-a-date")
	if fallbackBad.Year() != now.Year() {
		t.Errorf("ParseExtractedTimestamp(\"not-a-date\") fallback = %v, expected current time %v", fallbackBad, now)
	}

	// Strict parser distinguishes valid month-name / US dash dates from unparseable values
	for _, tc := range []struct {
		raw      string
		wantOK   bool
		wantDate string
	}{
		{"Jan 2, 2006", true, "2006-01-02"},
		{"January 2, 2006", true, "2006-01-02"},
		{"02-Jan-2006", true, "2006-01-02"},
		{"01-02-2026", true, "2026-01-02"},
		{"N/A", false, ""},
	} {
		parsed, ok := ParseExtractedTimestampStrict(tc.raw)
		if ok != tc.wantOK {
			t.Errorf("ParseExtractedTimestampStrict(%q) ok=%v, want %v", tc.raw, ok, tc.wantOK)
		}
		if tc.wantOK && parsed.Format("2006-01-02") != tc.wantDate {
			t.Errorf("ParseExtractedTimestampStrict(%q) = %s, want %s", tc.raw, parsed.Format("2006-01-02"), tc.wantDate)
		}
	}
}

func TestParseExtractedChartAccountID_HallucinatedValues(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		// Note: float values like 999999.0 and 7.5 are accepted and converted to uint
		// (truncated). Only truly invalid values return nil.
		shouldReturnNil bool
	}{
		{"Very large number", 999999.0, false},
		{"Negative ID", -1, true},
		{"Zero", 0, true},
		{"Empty string", "", true},
		{"Non-numeric string", "abc", true},
		{"Float with decimal", 7.5, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseExtractedChartAccountID(tt.input)
			if tt.shouldReturnNil {
				if got != nil {
					t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected nil", tt.input, *got)
				}
			} else {
				if got == nil {
					t.Errorf("ParseExtractedChartAccountID(%v) = nil, expected valid pointer", tt.input)
				}
			}
		})
	}
}

func TestParseExtractedChartAccountID_InvalidTypeString(t *testing.T) {
	// String that looks like a price - Sscanf parses the integer part (25)
	// This is expected behavior: %d reads up to the first non-digit
	got := ParseExtractedChartAccountID("25.99")
	expected := uint(25)
	if got == nil || *got != expected {
		t.Errorf("ParseExtractedChartAccountID(\"25.99\") = %v, expected %v (parses integer part)", got, expected)
	}

	// String with leading zeros
	got = ParseExtractedChartAccountID("007")
	expected = uint(7)
	if got == nil || *got != expected {
		t.Errorf("ParseExtractedChartAccountID(\"007\") = %v, expected %v", got, expected)
	}
}
