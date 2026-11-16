package constants

import (
	"strings"
	"testing"
)

func TestNormalizeDropboxHostPath(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", "./document-data"},
		{"dot", ".", "./document-data"},
		{"./document-data", "./document-data", "./document-data"},
		{"document-data", "document-data", "./document-data"},
		{"already document-data", "/home/user/document-data", "/home/user/document-data"},
		{"parent path", "/home/user/Desktop", "/home/user/Desktop/document-data"},
		{"whitespace trimmed", "  /home/user/Desktop  ", "/home/user/Desktop/document-data"},
		{"traversal attack", "/home/user/../etc", "./document-data"},
		{"traversal in middle", "/home/user/foo/../../bar", "./document-data"},
		{"relative traversal", "../foo", "./document-data"},
		{"windows traversal", "..\\foo\\bar", "./document-data"},
		{"Users prefix", "Users/aj/Desktop", "/Users/aj/Desktop/document-data"},
		{"home prefix", "home/user/Desktop", "/home/user/Desktop/document-data"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeDropboxHostPath(tt.input)
			if got != tt.expected {
				t.Errorf("NormalizeDropboxHostPath(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestResolveHostToContainer(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty", "", "/app/documents"},
		{"dot", ".", "/app/documents"},
		{"./document-data", "./document-data", "/app/documents"},
		{"document-data", "document-data", "/app/documents"},
		{"already container path", "/app/documents/inbox", "/app/documents/inbox"},
		{"already host_fs path", "/host_fs/home/user", "/host_fs/home/user"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveHostToContainer(tt.input)
			if got != tt.expected {
				t.Errorf("ResolveHostToContainer(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestGetInboxPath(t *testing.T) {
	got := GetInboxPath()
	if !strings.HasSuffix(got, "inbox") && got != "/app/documents/inbox" {
		t.Errorf("GetInboxPath() = %q, expected path ending in 'inbox'", got)
	}
}

func TestGetProcessedPath(t *testing.T) {
	got := GetProcessedPath()
	if !strings.HasSuffix(got, "processed") && got != "/app/documents/processed" {
		t.Errorf("GetProcessedPath() = %q, expected path ending in 'processed'", got)
	}
}

func TestGetCurrentHostPath(t *testing.T) {
	got := GetCurrentHostPath()
	// Should not be empty after init
	if got == "" {
		t.Error("GetCurrentHostPath() returned empty string")
	}
}

func TestGetCurrentContainerDir(t *testing.T) {
	got := GetCurrentContainerDir()
	// Should not be empty after init
	if got == "" {
		t.Error("GetCurrentContainerDir() returned empty string")
	}
}

func TestRewriteStoredPathPrefix(t *testing.T) {
	if got, ok := RewriteStoredPathPrefix("/app/documents/processed/42.png", "/app/documents", "/host_fs/Users/aj/document-data"); !ok || got != "/host_fs/Users/aj/document-data/processed/42.png" {
		t.Fatalf("RewriteStoredPathPrefix() = (%q, %v), want rebased path", got, ok)
	}
	if got, ok := RewriteStoredPathPrefix("/other/dir/42.png", "/app/documents", "/new"); ok || got != "/other/dir/42.png" {
		t.Fatalf("RewriteStoredPathPrefix() unrelated = (%q, %v), want unchanged false", got, ok)
	}
}
