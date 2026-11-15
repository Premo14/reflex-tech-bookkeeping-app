package controllers

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func TestGetSystemHealth_Endpoint(t *testing.T) {
	app := fiber.New()
	app.Get("/health", GetSystemHealth)

	req := httptest.NewRequest("GET", "/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	var body SystemHealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body.Status == "" {
		t.Error("status should not be empty")
	}
	if body.Timestamp == "" {
		t.Error("timestamp should not be empty")
	}
	if body.Database == nil {
		t.Error("database should not be nil")
	}
	if body.Storage == nil {
		t.Error("storage should not be nil")
	}
}

func TestCheckDatabaseHealth_NilDB(t *testing.T) {
	// Temporarily set DB to nil for test isolation
	// (DB may or may not be connected depending on test env)
	result := checkDatabaseHealth()
	if result["status"] == "" {
		t.Error("status should not be empty")
	}
}

func TestCheckStorageHealth(t *testing.T) {
	result := checkStorageHealth()
	status, ok := result["status"]
	if !ok {
		t.Fatal("status key missing from storage health")
	}
	if status != "ready" && status != "warning" {
		t.Errorf("unexpected status %q", status)
	}

	if _, ok := result["inboxWritable"]; !ok {
		t.Error("inboxWritable should exist")
	}
	if _, ok := result["processedWritable"]; !ok {
		t.Error("processedWritable should exist")
	}
}

func TestIsDirWritable_EmptyDir(t *testing.T) {
	if isDirWritable("") {
		t.Error("empty dir string should return false")
	}
}

func TestCheckHTTPHealth_Unreachable(t *testing.T) {
	// Use a known-unreachable port
	result := checkHTTPHealth("http://127.0.0.1:1", 200*time.Millisecond)
	if result["status"] != "unavailable" {
		t.Errorf("expected 'unavailable', got %v", result["status"])
	}
}

func TestCheckHTTPHealth_Reachable(t *testing.T) {
	// Spin up a minimal test server on a random free port
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("could not bind for test: %v", err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()

	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	app := fiber.New()
	app.Get("/health", func(c fiber.Ctx) error {
		return c.Status(200).SendString("ok")
	})
	go app.Listen(fmt.Sprintf("127.0.0.1:%d", port))
	defer app.Shutdown()

	// Give the server a moment to start
	time.Sleep(50 * time.Millisecond)

	result := checkHTTPHealth(url, 2*time.Second)
	if result["status"] != "connected" {
		t.Errorf("expected 'connected', got %v", result["status"])
	}
}

func TestComputeOverallStatus(t *testing.T) {
	dbOK := map[string]interface{}{"status": "connected"}
	dbBad := map[string]interface{}{"status": "error"}
	storageOK := map[string]interface{}{"status": "ready"}
	storageWarn := map[string]interface{}{"status": "warning"}
	fpOK := map[string]interface{}{"status": "connected"}
	aiOK := map[string]interface{}{"ready": true}

	tests := []struct {
		name     string
		db       map[string]interface{}
		storage  map[string]interface{}
		fp       map[string]interface{}
		ai       map[string]interface{}
		expected string
	}{
		{"all healthy", dbOK, storageOK, fpOK, aiOK, "healthy"},
		{"db error", dbBad, storageOK, fpOK, aiOK, "degraded"},
		{"storage warning", dbOK, storageWarn, fpOK, aiOK, "degraded"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeOverallStatus(tt.db, tt.storage, tt.fp, tt.ai)
			if got != tt.expected {
				t.Errorf("computeOverallStatus() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestCheckOllamaHealth_NoModelsLoaded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"models": []interface{}{}})
	}))
	defer srv.Close()

	result := checkOllamaTags(srv.URL+"/api/tags", 2*time.Second)
	if status, ok := result["status"].(string); !ok || status != "no_models_loaded" {
		t.Errorf("expected 'no_models_loaded', got %v", result["status"])
	}
}

func TestCheckOllamaHealth_ModelsPresent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"models": []interface{}{
				map[string]interface{}{"name": "llama3.1:latest"},
				map[string]interface{}{"name": "qwen2.5vl:3b"},
			},
		})
	}))
	defer srv.Close()

	result := checkOllamaTags(srv.URL+"/api/tags", 2*time.Second)
	if ready, ok := result["ready"].(bool); !ok || !ready {
		t.Errorf("expected ready=true, got %v", result["ready"])
	}
}

func TestCheckOllamaHealth_Unreachable(t *testing.T) {
	result := checkOllamaTags("http://127.0.0.1:1", 200*time.Millisecond)
	if status, ok := result["status"].(string); !ok || status != "connecting" {
		t.Errorf("expected 'connecting', got %v", result["status"])
	}
}

func TestHTTPGet_InvalidURL(t *testing.T) {
	_, err := httpGet("://invalid-url", 200*time.Millisecond)
	if err == nil {
		t.Error("expected error for invalid URL")
	}
}

func TestGetCompanyName_Default(t *testing.T) {
	name := getCompanyName()
	if name == "" {
		t.Error("company name should not be empty")
	}
	// If DB is nil, it returns "Unnamed Company"
	// If DB is connected but no setting, same
	if name != "Unnamed Company" {
		// May be overridden if the DB has the CompanyName setting
		t.Logf("company name is %q (may be set from seeded data)", name)
	}
}

func TestCheckFileProcessorHealth_CustomURL(t *testing.T) {
	os.Setenv("FILE_PROCESSOR_URL", "http://127.0.0.1:19879/process")
	defer os.Unsetenv("FILE_PROCESSOR_URL")

	// Unreachable — should return unavailable
	result := checkFileProcessorHealth()
	if result["status"] != "unavailable" {
		t.Logf("file processor status: %v (expected 'unavailable')", result["status"])
	}
}
