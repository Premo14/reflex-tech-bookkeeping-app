package utils

import (
	"testing"
)

// ── NormalizeTender ──────────────────────────────────────────────────────

func TestNormalizeTender(t *testing.T) {
	tests := []struct {
		input  string
		output string
	}{
		// Standard cards → "card"
		{"visa", "card"},
		{"mastercard", "card"},
		{"amex", "card"},
		{"american express", "card"},
		{"discover", "card"},
		{"debit", "card"},
		{"credit", "card"},
		{"credit card", "card"},
		{"debit card", "card"},
		// Cash variants → "cash"
		{"cash", "cash"},
		{"cash / paper", "cash"},
		{"cash/paper", "cash"},
		{"currency", "cash"},
		{"paper", "cash"},
		// Check → "check"
		{"check", "check"},
		{"cheque", "check"},
		// Transfer → "transfer"
		{"transfer", "transfer"},
		{"wire", "transfer"},
		{"ach", "transfer"},
		// Specific → self
		{"paypal", "paypal"},
		{"venmo", "venmo"},
		{"zelle", "zelle"},
		{"other", "other"},
		// Empty → "card" (default)
		{"", "card"},
		// Whitespace → trimmed
		{"  VISA  ", "card"},
		{"  cash  ", "cash"},
		// Unknown → preserved
		{"gift card", "gift card"},
		{"crypto", "crypto"},
		// Case insensitive
		{"VISA", "card"},
		{"CASH", "cash"},
		{"Check", "check"},
		{"PayPal", "paypal"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := NormalizeTender(tt.input)
			if got != tt.output {
				t.Errorf("NormalizeTender(%q) = %q, want %q", tt.input, got, tt.output)
			}
		})
	}
}

// ── IsCashTender ──────────────────────────────────────────────────────────

func TestIsCashTender_Variants(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"cash", true},
		{"cash / paper", true},
		{"CASH", true},
		{"  cash  ", true},
		{"currency", true},
		{"visa", false},
		{"credit", false},
		{"check", false},
		{"", false}, // empty → NormalizeTender returns "card", not "cash"
		{"venmo", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := IsCashTender(tt.input)
			if got != tt.want {
				t.Errorf("IsCashTender(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// ── IsDateInClosedPeriod (no DB → test helper logic via stub) ────────────
// IsDateInClosedPeriod requires a DB connection. It's tested via controller
// integration tests in SettingsModal/Period close preflight tests.
