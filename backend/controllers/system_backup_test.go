package controllers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestExportSystemBackupJSON(t *testing.T) {
	app := fiber.New()
	app.Get("/api/system/backup", ExportSystemBackupJSON)

	req := httptest.NewRequest("GET", "/api/system/backup", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to execute test request: %v", err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "application/json; charset=utf-8" {
		t.Errorf("Expected Content-Type application/json; charset=utf-8, got %s", contentType)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response JSON: %v", err)
	}

	if result["company"] != "Reflex Technologies LLC (Utica, NY)" {
		t.Errorf("Expected company 'Reflex Technologies LLC (Utica, NY)', got %v", result["company"])
	}

	if result["version"] == nil {
		t.Errorf("Expected backup version to be set")
	}

	if result["data"] == nil {
		t.Errorf("Expected backup data map to be present")
	}

	if result["counts"] == nil {
		t.Errorf("Expected backup counts map to be present")
	}
}
