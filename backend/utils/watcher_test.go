package utils

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsIgnoredFile(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     bool
	}{
		// Syncthing files — should be ignored
		{"Syncthing temp", ".syncthing.abc123", true},
		{"Syncthing metadata", ".syncthing.config.bak", true},
		{"Syncthing short prefix", ".stmp", true},
		{"Syncthing file", ".stfolder", true},

		// macOS dotfiles — should be ignored
		{"Dotfile", ".DS_Store", true},
		{"Dotfile hidden", ".hidden", true},
		{"Dotfile gitignore", ".gitignore", true},

		// Partial transfer extensions — should be ignored
		{"Temp file", "download.tmp", true},
		{"Partial transfer", "file.part", true},
		{"Chrome download", "file.crdownload", true},
		{"Partial extension", "file.partial", true},
		{"Download extension", "file.download", true},

		// OS junk files — should be ignored
		{"Windows thumbs", "Thumbs.db", true},
		{"Windows desktop", "desktop.ini", true},
		{"Mac DS_Store", "DS_Store", true},

		// Valid files — should NOT be ignored
		{"PNG receipt", "receipt_2024.png", false},
		{"JPG receipt", "photo.jpg", false},
		{"JPEG receipt", "scan.jpeg", false},
		{"HEIC receipt", "photo.heic", false},
		{"PDF receipt", "invoice.pdf", false},
		{"OFX statement", "bank.ofx", false},
		{"QFX statement", "statement.qfx", false},
		{"QBO statement", "data.qbo", false},
		{"Plain name", "myfile.pdf", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isIgnoredFile(tt.filename)
			if got != tt.want {
				t.Errorf("isIgnoredFile(%q) = %v, want %v", tt.filename, got, tt.want)
			}
		})
	}
}

func TestIsFileStable(t *testing.T) {
	dir := t.TempDir()

	// Test: non-existent file
	if isFileStable(filepath.Join(dir, "nonexistent")) {
		t.Error("isFileStable should return false for non-existent file")
	}

	// Test: zero-size file
	zeroFile := filepath.Join(dir, "zero.txt")
	os.WriteFile(zeroFile, nil, 0666)
	if isFileStable(zeroFile) {
		t.Error("isFileStable should return false for zero-size file")
	}

	// Test: stable file
	stableFile := filepath.Join(dir, "stable.txt")
	os.WriteFile(stableFile, []byte("hello world"), 0666)
	if !isFileStable(stableFile) {
		t.Error("isFileStable should return true for stable file")
	}

	// Test: rapidly growing file (write, then check)
	growingFile := filepath.Join(dir, "growing.txt")
	os.WriteFile(growingFile, []byte("small"), 0666)
	// Write more data after the first check would see
	os.WriteFile(growingFile, []byte("this is a much longer content now"), 0666)
	// Should be stable now since we're not actively writing during the check
	if !isFileStable(growingFile) {
		t.Error("isFileStable should return true for stable file after final write")
	}
}
