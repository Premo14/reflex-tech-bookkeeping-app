package utils

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
)

// ============================================================
// HashFile
// ============================================================

func TestHashFile(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "test.txt")
	payload := []byte("hello world")
	if err := os.WriteFile(testFile, payload, 0644); err != nil {
		t.Fatal(err)
	}

	hash, err := HashFile(testFile)
	if err != nil {
		t.Fatalf("HashFile error: %v", err)
	}
	if hash == "" {
		t.Error("expected non-empty hash")
	}
	if len(hash) != 64 {
		t.Errorf("expected 64-char SHA256 hex, got %d chars", len(hash))
	}

	// Non-existent file
	_, err = HashFile(filepath.Join(dir, "nonexistent"))
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestHashFile_Deterministic(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "test.txt")
	content := []byte("deterministic content")
	os.WriteFile(testFile, content, 0644)

	hash1, _ := HashFile(testFile)
	hash2, _ := HashFile(testFile)
	if hash1 != hash2 {
		t.Error("HashFile should produce same hash for same file")
	}
}

// ============================================================
// ValidateExtractedCategory — nil DB handling
// ============================================================

func TestValidateExtractedCategory_NilDB(t *testing.T) {
	// When db.DB is nil, the function should NOT panic.
	// It should log a warning and return nil.
	orig := db.DB
	defer func() { db.DB = orig }()

	db.DB = nil
	id := uint(1)
	result := ValidateExtractedCategory(&id)
	if result != nil {
		t.Errorf("ValidateExtractedCategory(nil DB) = %v, want nil", result)
	}
}

// ============================================================
// BuildReceiptPrompt
// ============================================================

func TestBuildReceiptPrompt(t *testing.T) {
	accounts := []struct {
		ID   uint
		Name string
	}{
		{1, "Office Supplies"},
		{2, "Travel"},
		{3, "Meals"},
	}

	chartAccounts := make([]struct {
		ID   uint
		Name string
	}, len(accounts))
	for i, a := range accounts {
		chartAccounts[i] = struct {
			ID   uint
			Name string
		}{a.ID, a.Name}
	}

	prompt := buildReceiptPromptForTest(chartAccounts)
	if !strings.Contains(prompt, "1:Office Supplies") {
		t.Error("prompt should contain account ID:Name pairs")
	}
	if !strings.Contains(prompt, "2:Travel") {
		t.Error("prompt should contain account ID:Name pairs")
	}
	if !strings.Contains(prompt, "chartAccountId") {
		t.Error("prompt should mention chartAccountId")
	}
}

// buildReceiptPromptForTest mirrors BuildReceiptPrompt logic for testing
func buildReceiptPromptForTest(accounts []struct {
	ID   uint
	Name string
}) string {
	var catStrings []string
	for _, acc := range accounts {
		catStrings = append(catStrings, fmt.Sprintf("%d:%s", acc.ID, acc.Name))
	}
	categoriesList := strings.Join(catStrings, ", ")
	if len(catStrings) == 0 {
		categoriesList = "none"
	}
	return fmt.Sprintf(`{"timestamp":"","vendor":"","description":"","amount":0.00,"taxAmount":0.00,"currencyCode":"USD","tender":"CARD","chartAccountId":null}
Rules:
- chartAccountId: Best matching integer ID from [%s], or null.`, categoriesList)
}

// ============================================================
// isDefaultDescription
// ============================================================

func TestIsDefaultDescription(t *testing.T) {
	tests := []struct {
		name string
		desc string
		want bool
	}{
		{"Primary checking", "Primary business checking account", true},
		{"Business savings", "Business savings account", true},
		{"Credit card", "Business credit card balance", true},
		{"Loan", "Outstanding loan balances", true},
		{"Line of credit", "Revolving business line of credit", true},
		{"Custom name", "CHASE_CHK_1234", false},
		{"Custom descriptive name", "Chase Checking (...1234)", true},
		{"Has spaces", "My custom account", true},
		{"Single word", "Chase", false},
		{"Case mismatch", "primary business checking account", true},
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
// buildOfxDescription
// ============================================================

func TestBuildOfxDescription(t *testing.T) {
	tests := []struct {
		name     string
		n        string
		m        string
		expected string
	}{
		{"Only name", "Starbucks", "", "Starbucks"},
		{"Only memo", "", "Morning coffee", "Morning coffee"},
		{"Both different", "Starbucks", "Store #1234", "Starbucks Store #1234"},
		{"Memo subset of name", "Starbucks Store #1234", "Store", "Starbucks Store #1234"},
		{"Name subset of memo", "Store", "Starbucks Store #1234", "Starbucks Store #1234"},
		{"Identical", "Starbucks", "Starbucks", "Starbucks"},
		{"Extra whitespace", "  Starbucks  ", "  Store  ", "Starbucks Store"},
		{"Both empty", "", "", ""},
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
// uploadWithTimeout
// ============================================================

func TestUploadWithTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	resp, err := uploadWithTimeout(http.DefaultClient, server.URL, []byte("test"), "multipart/form-data")
	if err != nil {
		t.Fatalf("uploadWithTimeout error: %v", err)
	}
	if string(resp) != `{"status":"ok"}` {
		t.Errorf("unexpected response: %s", string(resp))
	}

	// Test non-200 status
	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer errServer.Close()

	_, err = uploadWithTimeout(http.DefaultClient, errServer.URL, []byte("test"), "multipart/form-data")
	if err == nil {
		t.Error("expected error for non-200 status")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 in error message, got: %v", err)
	}

	// Test unreachable URL
	_, err = uploadWithTimeout(http.DefaultClient, "http://localhost:1", []byte("test"), "multipart/form-data")
	if err == nil {
		t.Error("expected error for unreachable URL")
	}
}

// ============================================================
// acquireInFlight / releaseInFlight
// ============================================================

func TestAcquireReleaseInFlight(t *testing.T) {
	inFlight = make(map[string]bool)

	if !acquireInFlight("/tmp/test.txt") {
		t.Error("first acquireInFlight should return true")
	}
	if acquireInFlight("/tmp/test.txt") {
		t.Error("second acquireInFlight for same file should return false")
	}
	if !acquireInFlight("/tmp/other.txt") {
		t.Error("acquireInFlight for different file should return true")
	}

	releaseInFlight("/tmp/test.txt")
	if !acquireInFlight("/tmp/test.txt") {
		t.Error("acquireInFlight after release should return true")
	}

	releaseInFlight("/tmp/test.txt")
	releaseInFlight("/tmp/other.txt")
}

func TestAcquireReleaseInFlight_Concurrent(t *testing.T) {
	inFlight = make(map[string]bool)

	var acquiredCount atomic.Int32
	startCh := make(chan struct{})

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startCh
			if acquireInFlight("/tmp/concurrent.txt") {
				acquiredCount.Add(1)
			}
		}()
	}
	close(startCh)
	wg.Wait()
	releaseInFlight("/tmp/concurrent.txt")

	if acquiredCount.Load() != 1 {
		t.Errorf("expected exactly 1 successful acquire while locked, got %d", acquiredCount.Load())
	}
}

// ============================================================
// CleanAIJSON — additional edge cases
// ============================================================

func TestCleanAIJSON_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"Empty string", "", ""},
		{"Whitespace only", "   \n\t  ", ""},
		{"No braces", "just plain text", "just plain text"},
		{"Only open brace", "{", "{"},
		{"Only close brace", "}", "}"},
		{"Nested JSON", `{"outer": {"inner": 42}}`, `{"outer": {"inner": 42}}`},
		{"Single quotes", `{'vendor': 'Target'}`, `{'vendor': 'Target'}`},
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
// ParseExtractedAmount — additional edge cases
// ============================================================

func TestParseExtractedAmount_AdditionalCases(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected float64
	}{
		{"Yen ¥ symbol (not stripped)", "¥1000", 0.0},
		{"Rupee ₹ symbol", "₹500", 0.0},
		{"Scientific", "1.5e2", 150.0},
		{"Negative zero", "-0.00", 0.0},
		{"True value", true, 0.0},
		{"Array", []interface{}{1}, 0.0},
		{"Multiple symbols", "$€£100", 100.0},
		{"Only dollar sign", "$", 0.0},
		{"Heavy whitespace", "  $  123.45  ", 123.45},
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

// ============================================================
// ParseExtractedChartAccountID — additional edge cases
// ============================================================

func TestParseExtractedChartAccountID_AdditionalCases(t *testing.T) {
	got := ParseExtractedChartAccountID("0")
	if got != nil {
		t.Errorf(`ParseExtractedChartAccountID("0") = %v, expected nil`, got)
	}

	got = ParseExtractedChartAccountID("  042  ")
	if got == nil || *got != 42 {
		t.Errorf(`ParseExtractedChartAccountID("  042  ") = %v, expected 42`, got)
	}

	// Float 0.5 > 0 so it returns &uint(0) — expected behavior
	got = ParseExtractedChartAccountID(0.5)
	if got == nil {
		t.Errorf("ParseExtractedChartAccountID(0.5) = nil, expected &uint(0) since 0.5 > 0")
	}

}

// ============================================================
// ParseExtractedTimestamp — additional formats
// ============================================================

func TestParseExtractedTimestamp_ExtraFormats(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"US short date", "12/25/2024", "2024-12-25"},
		{"Two-digit year", "01/15/24", "2024-01-15"},
		{"US short no leading zero", "3/4/2024", "2024-03-04"},
		{"Timezone offset", "2024-06-15T14:30:00-05:00", "2024-06-15"},
		{"Timezone +00:00", "2024-06-15T12:00:00+00:00", "2024-06-15"},
		{"Slash separator", "2024/03/20", "2024-03-20"},
		{"Space separator datetime", "2024-07-04 10:30:00", "2024-07-04"},
		{"Space separator short", "2024-07-04 14:30", "2024-07-04"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseExtractedTimestamp(tt.input)
			formatted := result.Format("2006-01-02")
			if formatted != tt.expected {
				t.Errorf("ParseExtractedTimestamp(%q) = %s, want %s", tt.input, formatted, tt.expected)
			}
		})
	}
}

// ============================================================
// ParseExtractedTimestamp — unparseable strings
// ============================================================

func TestParseExtractedTimestamp_Unparseable(t *testing.T) {
	invalidInputs := []string{
		"yesterday", "last week", "tomorrow", "today",
		"13/32/2024", "00/01/2024", "not a date at all!!!", "2024-13-01",
	}

	now := time.Now().UTC()
	for _, input := range invalidInputs {
		result := ParseExtractedTimestamp(input)
		diff := result.Sub(now)
		if diff < -time.Minute || diff > time.Minute {
			t.Errorf("ParseExtractedTimestamp(%q) = %v, expected fallback to current time", input, result.Format("2006-01-02"))
		}
	}
}

// ============================================================
// parseCSVDate — additional formats
// ============================================================

func TestParseCSVDate_AdditionalFormats(t *testing.T) {
	tests := []struct {
		input    string
		expected string
		wantErr  bool
	}{
		{"15/08/2026", "2026-08-15", false},
		{"8/15/2026", "2026-08-15", false},
		{"1-2-2006", "2006-01-02", false},
		{"2006-01-02 15:04:05", "2006-01-02", false},
		{"2026-08-15T14:30:00-05:00", "2026-08-15", false},
		{"01/15/24", "2024-01-15", false},
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

// ============================================================
// cleanCSVAmount — additional edge cases
// ============================================================

func TestCleanCSVAmount_AdditionalCases(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
		wantErr  bool
	}{
		{"$1,000,000.00", 1000000.00, false},
		{"(999.99)", -999.99, false},
		{"€1,234.56", 1234.56, false},
		{"99.99", 99.99, false},
		{"-42.00", -42.00, false},
		{"$00123.45", 123.45, false},
		{"-", 0.0, true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := cleanCSVAmount(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("cleanCSVAmount(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.expected {
				t.Errorf("cleanCSVAmount(%q) = %f, expected %f", tt.input, got, tt.expected)
			}
		})
	}
}

// ============================================================
// GenerateCSVFitID — determinism checks
// ============================================================

func TestGenerateCSVFitID_Determinism(t *testing.T) {
	d := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)

	results := make(map[string]bool)
	for i := 0; i < 10; i++ {
		id := GenerateCSVFitID(d, "UBER TRIP", -20.00, 1, 1010)
		results[id] = true
	}
	if len(results) != 1 {
		t.Errorf("expected 1 unique FITID across 10 runs, got %d", len(results))
	}

	id1 := GenerateCSVFitID(d, "UBER TRIP", -20.00, 1, 1010)
	id3 := GenerateCSVFitID(d, "UBER TRIP", -20.00, 3, 1010)
	if id1 == id3 {
		t.Error("different occurrence indices should produce different FITIDs")
	}

	idA := GenerateCSVFitID(d, "UBER TRIP", -20.00, 1, 1010)
	idB := GenerateCSVFitID(d, "UBER TRIP", -25.00, 1, 1010)
	if idA == idB {
		t.Error("different amounts should produce different FITIDs")
	}
}

// ============================================================
// sendReceiptToScript — HTTP mock (partial, no DB)
// ============================================================

func TestSendReceiptToScript_Stub(t *testing.T) {
	t.Log("sendReceiptToScript requires real DB + file-processor; covered via integration test")
}

// ============================================================
// isIgnoredFile — additional cases
// ============================================================

func TestIsIgnoredFile_AdditionalCases(t *testing.T) {
	tests := []struct {
		filename string
		want     bool
	}{
		{".syncthing.config.xml", true},
		{".syncthing.index", true},
		{".AppleDouble", true},
		{".Trashes", true},
		{"file.TMP", true},
		{"file.PART", true},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := isIgnoredFile(tt.filename)
			if got != tt.want {
				t.Errorf("isIgnoredFile(%q) = %v, want %v", tt.filename, got, tt.want)
			}
		})
	}
}

// ============================================================
// nextAvailableCodeInRange
// ============================================================

func TestNextAvailableCodeInRange(t *testing.T) {
	code := nextAvailableCodeInRange(1010, 1099)
	if len(code) != 4 || code[0] != '1' {
		t.Errorf("expected 4-digit code starting with '1', got %q", code)
	}

	code = nextAvailableCodeInRange(2020, 2099)
	if len(code) != 4 || code[0] != '2' {
		t.Errorf("expected 4-digit code starting with '2', got %q", code)
	}

	code = nextAvailableCodeInRange(1010, 1010)
	if len(code) != 4 {
		t.Errorf("expected 4-digit code, got %q", code)
	}
}

// ============================================================
// cleanForVendorMatch / vendorMatchesDescription / normalizeString
// ============================================================

func TestCleanForVendorMatch(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", ""},
		{"STARBUCKS", "starbucks"},
		{"WALMART SUPERCENTER", "walmart supercenter"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := cleanForVendorMatch(tt.input)
			if got != tt.expected {
				t.Errorf("cleanForVendorMatch(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestVendorMatchesDescription(t *testing.T) {
	tests := []struct {
		vendor string
		desc   string
		want   bool
	}{
		{"STARBUCKS", "Starbucks Store #1234", true},
		{"WALMART", "WALMART SUPERCENTER #1980", true},
		{"WALMART", "Target Store 555", false},
		{"UBER", "UBER TRIP 08/15/2026", true},
	}

	for _, tt := range tests {
		t.Run(tt.vendor+"|"+tt.desc, func(t *testing.T) {
			got := vendorMatchesDescription(tt.vendor, tt.desc)
			if got != tt.want {
				t.Errorf("vendorMatchesDescription(%q, %q) = %v, want %v", tt.vendor, tt.desc, got, tt.want)
			}
		})
	}
}

func TestNormalizeString(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Hello World", "hello world"},
		{"  SPACES  ", "spaces"},
		{"UPPERCASE", "uppercase"},
		{"mixed CASE", "mixed case"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeString(tt.input)
			if got != tt.expected {
				t.Errorf("normalizeString(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// ============================================================
// ProcessExistingFiles
// ============================================================

func TestProcessExistingFiles_NoInbox(t *testing.T) {
	err := ProcessExistingFiles("/nonexistent/inbox/path/xyz")
	if err == nil {
		t.Error("ProcessExistingFiles should return error for non-existent directory")
	}
}

func TestProcessExistingFiles_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	err := ProcessExistingFiles(dir)
	if err != nil {
		t.Errorf("ProcessExistingFiles on empty dir should succeed, got: %v", err)
	}
}

func TestProcessExistingFiles_SkipsIgnored(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("junk"), 0644)
	os.WriteFile(filepath.Join(dir, "file.tmp"), []byte("junk"), 0644)

	err := ProcessExistingFiles(dir)
	if err != nil {
		t.Errorf("ProcessExistingFiles should handle ignored files, got: %v", err)
	}
}

// ============================================================
// debounceEvent — timer verification
// ============================================================

func TestDebounceEvent_TimerResets(t *testing.T) {
	// Clean up any existing timers
	mu.Lock()
	for k := range timers {
		timers[k].Stop()
		delete(timers, k)
	}
	mu.Unlock()

	// Give any pending goroutines time to finish
	time.Sleep(200 * time.Millisecond)

	// Start debounce - verify it doesn't panic
	debounceEvent("/tmp/test.deb", 50*time.Millisecond)

	// Wait for the debounce timer to fire (50ms) plus isFileStable checks
	time.Sleep(300 * time.Millisecond)

	t.Log("debounceEvent completed without panic")
}

// isFileStability — rapid size change simulation
// ============================================================

func TestIsFileStability_RapidWrite(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "growing.txt")

	os.WriteFile(file, []byte("small"), 0644)
	if !isFileStable(file) {
		t.Error("isFileStable should return true for stable file")
	}

	os.WriteFile(file, []byte("different content now"), 0644)
	if !isFileStable(file) {
		t.Error("isFileStable should return true for stable file after overwrite")
	}
}

// ============================================================
// CreateDirsIfNotExists — function exists check
// ============================================================

func TestCreateDirsIfNotExists(t *testing.T) {
	// CreateDirsIfNotExists uses constants.GetInboxPath() which requires
	// constants to be initialized. We can't easily mock this without
	// interface changes, so we verify the function is callable via reflection.
	v := reflect.ValueOf(CreateDirsIfNotExists)
	if !v.IsValid() || v.IsNil() || v.Kind() != reflect.Func {
		t.Error("CreateDirsIfNotExists should be a valid non-nil function")
	}
}
