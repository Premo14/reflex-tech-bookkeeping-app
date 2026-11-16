package utils

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
)

// ============================================================
// HEIC conversion — converter.go
// ============================================================

func TestConvertHeicToPng_FunctionExists(t *testing.T) {
	// Converter requires a real HEIC file and libde265; verify the function exists
	// and has the correct signature by checking it is not nil via reflection.
	v := reflect.ValueOf(ConvertHeicToPng)
	if !v.IsValid() || v.IsNil() || v.Kind() != reflect.Func {
		t.Error("ConvertHeicToPng should be a valid non-nil function")
	}
}

func TestConvertHeicToPng_NoSuchFile(t *testing.T) {
	err := ConvertHeicToPng("/nonexistent/path/photo.heic", "/tmp/out.png")
	if err == nil {
		t.Error("expected error for non-existent HEIC file")
	}
}

// ============================================================
// CleanAIJSON — additional regex edge cases
// ============================================================

func TestCleanAIJSON_Additional(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"JSON with markdown", "```json\n{\"a\":1}\n```", `{"a":1}`},
		// Multiple braces prose: original returns outermost {..}
		{"Multiple braces prose", "text {a:1} more {b:2} end", `{a:1} more {b:2}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CleanAIJSON(tt.input)
			if got != tt.expected {
				t.Errorf("CleanAIJSON(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// ============================================================
// BuildReceiptPrompt — unit tests
// ============================================================

func TestBuildReceiptPrompt_AccountsEdgeCases(t *testing.T) {
	accounts := []models.ChartAccount{
		{ID: 1, Name: "Office Supplies"},
		{ID: 2, Name: "Travel"},
		{ID: 3, Name: "Meals"},
	}

	prompt := BuildReceiptPrompt(accounts)
	if prompt == "" {
		t.Error("BuildReceiptPrompt returned empty string")
	}
	if !strings.Contains(prompt, "1:Office Supplies") {
		t.Error("prompt should contain account 1:Office Supplies")
	}
	if !strings.Contains(prompt, "3:Meals") {
		t.Error("prompt should contain account 3:Meals")
	}
	if !strings.Contains(prompt, "chartAccountId") {
		t.Error("prompt should mention chartAccountId")
	}

	// Empty accounts
	emptyPrompt := BuildReceiptPrompt(nil)
	if !strings.Contains(emptyPrompt, "none") {
		t.Error("empty accounts should result in 'none' in prompt")
	}
}

// ============================================================
// ParseExtractedChartAccountID — float rounding tests
// ============================================================

func TestParseExtractedChartAccountID_FloatRounding(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected *uint
	}{
		{"Float 42.0", 42.0, ptrUint(42)},
		{"Float 42.4 rounds down", 42.4, ptrUint(42)},
		{"Float 42.5 rounds up", 42.5, ptrUint(43)},
		{"Float 42.9 rounds up", 42.9, ptrUint(43)},
		{"Float32 42.0", float32(42.0), ptrUint(42)},
		{"Negative float", -1.0, nil},
		{"Zero float", 0.0, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseExtractedChartAccountID(tt.input)
			if tt.expected == nil {
				if got != nil {
					t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected nil", tt.input, *got)
				}
			} else {
				if got == nil || *got != *tt.expected {
					t.Errorf("ParseExtractedChartAccountID(%v) = %v, expected %v", tt.input, got, *tt.expected)
				}
			}
		})
	}
}

func ptrUint(u uint) *uint { return &u }

// ============================================================
// ParseExtractedAmount — float32 type support
// ============================================================

func TestParseExtractedAmount_Float32Support(t *testing.T) {
	got := ParseExtractedAmount(float32(42.5))
	if got != 42.5 {
		t.Errorf("ParseExtractedAmount(float32(42.5)) = %f, expected 42.5", got)
	}
}

// ============================================================
// FetchActiveExpenseAccounts — nil DB guard
// ============================================================

func TestFetchActiveExpenseAccounts_NilDB(t *testing.T) {
	orig := db.DB
	defer func() { db.DB = orig }()

	db.DB = nil
	accounts, err := FetchActiveExpenseAccounts()
	if err == nil {
		t.Error("expected error when DB is nil")
	}
	if accounts != nil {
		t.Error("expected nil accounts when DB is nil")
	}
}

// ============================================================
// Constants validation — extension checks
// ============================================================

func TestConstantsExtensionValidation(t *testing.T) {
	// Verify receipt extensions
	if constants.IsAllowedReceiptExt(".txt") {
		t.Error(".txt should not be a valid receipt extension")
	}
	if !constants.IsAllowedReceiptExt(".png") {
		t.Error(".png should be a valid receipt extension")
	}
	if !constants.IsAllowedReceiptExt(".heic") {
		t.Error(".heic should be a valid receipt extension")
	}
	if !constants.IsAllowedReceiptExt(".pdf") {
		t.Error(".pdf should be a valid receipt extension")
	}
	// Bare extension (no dot) should be rejected
	if constants.IsAllowedReceiptExt("png") {
		t.Error("bare 'png' should not be a valid receipt extension")
	}

	// Verify bank statement extensions
	if !constants.IsAllowedBankStatementExt(".ofx") {
		t.Error(".ofx should be a valid bank statement extension")
	}
	if !constants.IsAllowedBankStatementExt(".qfx") {
		t.Error(".qfx should be a valid bank statement extension")
	}
	if !constants.IsAllowedBankStatementExt(".qbo") {
		t.Error(".qbo should be a valid bank statement extension")
	}
	if constants.IsAllowedBankStatementExt(".heic") {
		t.Error(".heic should not be a bank statement extension")
	}
}

// ============================================================
// ValidateExtractedCategory — nil pointer
// ============================================================

func TestValidateExtractedCategory_NilPointer(t *testing.T) {
	result := ValidateExtractedCategory(nil)
	if result != nil {
		t.Error("ValidateExtractedCategory(nil) should return nil")
	}
}

// ============================================================
// resolveOrCreateChartAccount — nil DB guard
// ============================================================

func TestResolveOrCreateChartAccount_NilDB(t *testing.T) {
	orig := db.DB
	defer func() { db.DB = orig }()

	db.DB = nil
	result := resolveOrCreateChartAccount("12345678", "9876", "ASSET", "Test Bank", "CHECKING")
	if result != nil {
		t.Error("expected nil when DB is nil")
	}
}

func TestResolveOrCreateChartAccount_EmptyAccountID(t *testing.T) {
	orig := db.DB
	defer func() { db.DB = orig }()

	result := resolveOrCreateChartAccount("", "9876", "ASSET", "Test Bank", "CHECKING")
	if result != nil {
		t.Error("expected nil for empty accountID")
	}
}

// ============================================================
// isDefaultDescription — boundary tests
// ============================================================

func TestIsDefaultDescription_BoundaryCases(t *testing.T) {
	tests := []struct {
		name string
		desc string
		want bool
	}{
		{"Empty string", "", false},
		{"Single word no space", "Chase", false},
		{"Single word with trailing space", "Chase ", true},
		{"Two words with space", "My Account", true},
		{"Template with spaces", "Primary business checking account", true},
		{"Custom with numbers", "Chase 1234", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isDefaultDescription(tt.desc)
			if got != tt.want {
				t.Errorf("isDefaultDescription(%q) = %v, want %v", tt.desc, got, tt.want)
			}
		})
	}
}

// ============================================================
// nextAvailableCode — basic test
// ============================================================

func TestNextAvailableCode_Basic(t *testing.T) {
	code := nextAvailableCode("1")
	// Code should start with '1' and be at least 4 chars
	// (fallback may produce longer codes when all slots are taken)
	if code == "" || code[0] != '1' {
		t.Errorf("expected code starting with '1', got %q", code)
	}
	if len(code) < 4 {
		t.Errorf("expected at least 4-char code, got %q (len=%d)", code, len(code))
	}
}

// ============================================================
// ProcessExistingFiles — symlink handling
// ============================================================

func TestProcessExistingFiles_SymlinkDir(t *testing.T) {
	dir := t.TempDir()
	targetDir := filepath.Join(dir, "real")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatal(err)
	}
	symlinkDir := filepath.Join(dir, "link")
	if err := os.Symlink(targetDir, symlinkDir); err != nil {
		t.Fatal(err)
	}

	// Should not panic even with symlink
	_ = ProcessExistingFiles(symlinkDir)
}

// ============================================================
// ProcessExistingFiles — symlink handling
// ============================================================

func TestBuildOfxDescription_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		n        string
		m        string
		expected string
	}{
		{"Name with trailing space", "Starbucks ", "Morning coffee", "Starbucks Morning coffee"},
		{"Single char name", "A", "Memo B", "A Memo B"},
		{"Unicode name", "Starbucks ☕", "Morning coffee", "Starbucks ☕ Morning coffee"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildOfxDescription(tt.n, tt.m)
			if got != tt.expected {
				t.Errorf("buildOfxDescription(%q, %q) = %q, want %q", tt.n, tt.m, got, tt.expected)
			}
		})
	}
}

// ============================================================
// GenerateCSVFitID — integer-cent determinism
// ============================================================

func TestGenerateCSVFitID_IntCentDeterminism(t *testing.T) {
	d := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)

	// Verify that amounts that look close in float64 produce the same FITID
	// because we now use integer cents.
	id1 := GenerateCSVFitID(d, "UBER TRIP", -20.00, 1, 1010)
	id2 := GenerateCSVFitID(d, "UBER TRIP", -20.0000001, 1, 1010)
	if id1 != id2 {
		t.Errorf("FITIDs should match for amounts within cent precision: %s vs %s", id1, id2)
	}

	// Different amounts at cent boundary should differ
	idA := GenerateCSVFitID(d, "UBER TRIP", -20.00, 1, 1010)
	idB := GenerateCSVFitID(d, "UBER TRIP", -20.01, 1, 1010)
	if idA == idB {
		t.Error("different cent amounts should produce different FITIDs")
	}
}

// ============================================================
// HashFile — error handling
// ============================================================

func TestHashFile_NoPermissions(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "noperm.txt")
	os.WriteFile(testFile, []byte("test"), 0000)
	defer os.Chmod(testFile, 0644) // Restore for cleanup

	_, err := HashFile(testFile)
	if err == nil {
		t.Error("expected error for file without read permissions")
	}
}
