package constants

import "testing"

func TestIsAllowedReceiptExt(t *testing.T) {
	tests := []struct {
		name   string
		ext    string
		expect bool
	}{
		{"png with dot", ".png", true},
		{"jpg with dot", ".jpg", true},
		{"jpeg with dot", ".jpeg", true},
		{"heic with dot", ".heic", true},
		{"pdf with dot", ".pdf", true},
		{"PNG uppercase", ".PNG", true},
		{"JPEG uppercase", ".JPEG", true},
		{"pdf lowercase", ".pdf", true},
		{"no dot - png", "png", false},
		{"no dot - jpg", "jpg", false},
		{"no dot - pdf", "pdf", false},
		{"empty string", "", false},
		{"just dot", ".", false},
		{"whitespace trimmed", "  .png  ", true},
		{"gif not allowed", ".gif", false},
		{"tiff not allowed", ".tiff", false},
		{"doc not allowed", ".doc", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsAllowedReceiptExt(tt.ext)
			if got != tt.expect {
				t.Errorf("IsAllowedReceiptExt(%q) = %v, want %v", tt.ext, got, tt.expect)
			}
		})
	}
}

func TestIsAllowedBankStatementExt(t *testing.T) {
	tests := []struct {
		name   string
		ext    string
		expect bool
	}{
		{"ofx with dot", ".ofx", true},
		{"qfx with dot", ".qfx", true},
		{"qbo with dot", ".qbo", true},
		{"OFX uppercase", ".OFX", true},
		{"QFX uppercase", ".QFX", true},
		{"no dot - ofx", "ofx", false},
		{"no dot - qfx", "qfx", false},
		{"empty string", "", false},
		{"just dot", ".", false},
		{"whitespace trimmed", "  .ofx  ", true},
		{"csv not allowed", ".csv", false},
		{"xlsx not allowed", ".xlsx", false},
		{"pdf not allowed", ".pdf", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsAllowedBankStatementExt(tt.ext)
			if got != tt.expect {
				t.Errorf("IsAllowedBankStatementExt(%q) = %v, want %v", tt.ext, got, tt.expect)
			}
		})
	}
}
