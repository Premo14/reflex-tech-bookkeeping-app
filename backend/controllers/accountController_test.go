package controllers

import (
	"strings"
	"testing"
)

func TestValidateAccountCode(t *testing.T) {
	tests := []struct {
		name        string
		code        string
		accountType string
		wantErr     bool
		errMsgPart  string
	}{
		// Valid ASSET codes
		{"Valid ASSET 1010", "1010", "ASSET", false, ""},
		{"Valid ASSET 1100", "1100", "ASSET", false, ""},
		{"Valid ASSET 1250", "1250", "ASSET", false, ""},
		{"Valid ASSET 1399", "1399", "ASSET", false, ""},
		{"Valid ASSET 1410", "1410", "ASSET", false, ""},
		{"Valid ASSET 1590", "1590", "ASSET", false, ""},

		// Valid LIABILITY codes
		{"Valid LIABILITY 2010", "2010", "LIABILITY", false, ""},
		{"Valid LIABILITY 2030", "2030", "LIABILITY", false, ""},
		{"Valid LIABILITY 2100", "2100", "LIABILITY", false, ""},
		{"Valid LIABILITY 2250", "2250", "LIABILITY", false, ""},
		{"Valid LIABILITY 2510", "2510", "LIABILITY", false, ""},

		// Valid EQUITY codes
		{"Valid EQUITY 3010", "3010", "EQUITY", false, ""},
		{"Valid EQUITY 3110", "3110", "EQUITY", false, ""},

		// Valid REVENUE codes
		{"Valid REVENUE 4010", "4010", "REVENUE", false, ""},
		{"Valid REVENUE 4110", "4110", "REVENUE", false, ""},
		{"Valid REVENUE 4210", "4210", "REVENUE", false, ""},

		// Valid EXPENSE codes
		{"Valid EXPENSE 5010", "5010", "EXPENSE", false, ""},
		{"Valid EXPENSE 5110", "5110", "EXPENSE", false, ""},
		{"Valid EXPENSE 5210", "5210", "EXPENSE", false, ""},
		{"Valid EXPENSE 5310", "5310", "EXPENSE", false, ""},
		{"Valid EXPENSE 5410", "5410", "EXPENSE", false, ""},
		{"Valid EXPENSE 5510", "5510", "EXPENSE", false, ""},
		{"Valid EXPENSE 5610", "5610", "EXPENSE", false, ""},
		{"Valid EXPENSE 5710", "5710", "EXPENSE", false, ""},
		{"Valid EXPENSE 5910", "5910", "EXPENSE", false, ""},

		// Non-numeric
		{"Non-numeric code", "10A0", "ASSET", true, "numbers only"},
		{"Alphabetical code", "abcd", "ASSET", true, "numbers only"},

		// Length checks
		{"Too short", "101", "ASSET", true, "exactly 4 digits"},
		{"Too long", "10100", "ASSET", true, "exactly 4 digits"},
		{"Empty string", "", "ASSET", true, "numbers only"},

		// Wrong type prefix (1st digit)
		{"Wrong 1st digit for ASSET", "2010", "ASSET", true, "must start with 1"},
		{"Wrong 1st digit for LIABILITY", "1010", "LIABILITY", true, "must start with 2"},
		{"Wrong 1st digit for EQUITY", "4010", "EQUITY", true, "must start with 3"},
		{"Wrong 1st digit for REVENUE", "5010", "REVENUE", true, "must start with 4"},
		{"Wrong 1st digit for EXPENSE", "1010", "EXPENSE", true, "must start with 5"},

		// Invalid 2nd digit / sub-category prefix
		{"Invalid ASSET prefix 16", "1600", "ASSET", true, "invalid sub-category prefix (16)"},
		{"Invalid ASSET prefix 19", "1999", "ASSET", true, "invalid sub-category prefix (19)"},
		{"Invalid LIABILITY prefix 23", "2300", "LIABILITY", true, "invalid sub-category prefix (23)"},
		{"Invalid LIABILITY prefix 24", "2400", "LIABILITY", true, "invalid sub-category prefix (24)"},
		{"Invalid EQUITY prefix 32", "3200", "EQUITY", true, "invalid sub-category prefix (32)"},
		{"Invalid REVENUE prefix 43", "4300", "REVENUE", true, "invalid sub-category prefix (43)"},
		{"Invalid EXPENSE prefix 58", "5800", "EXPENSE", true, "invalid sub-category prefix (58)"},

		// Unknown account type
		{"Unknown type", "1010", "UNKNOWN", true, "invalid account type"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateAccountCode(tt.code, tt.accountType)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateAccountCode(%q, %q) error = %v, wantErr = %v", tt.code, tt.accountType, err, tt.wantErr)
			}
			if tt.wantErr && tt.errMsgPart != "" {
				if !strings.Contains(err.Error(), tt.errMsgPart) {
					t.Errorf("ValidateAccountCode(%q, %q) error message = %q, expected to contain %q", tt.code, tt.accountType, err.Error(), tt.errMsgPart)
				}
			}
		})
	}
}
