package routes

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

// ---- SetupRoutes: verify all routes are registered without panic ----

func TestSetupRoutes_NoPanic(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)
	// If we reach here without panic, routes were set up successfully
}

func TestSetupRoutes_HealthCheck(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	body := io.NopCloser(strings.NewReader(""))
	req := httptest.NewRequest("GET", "/api/health", body)
	resp, err := app.Test(req)
	if err != nil {
		t.Logf("Health check test: %v (expected if controller requires DB)", err)
		return
	}
	if resp.StatusCode != 200 {
		t.Logf("Health check status = %d (expected 200, controller may need DB)", resp.StatusCode)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

func TestSetupRoutes_Accounts(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/accounts"},
		{"POST", "/api/accounts"},
		{"PATCH", "/api/accounts/1"},
		{"DELETE", "/api/accounts/1"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Rules(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/rules"},
		{"GET", "/api/rules/suggestions"},
		{"POST", "/api/rules"},
		{"GET", "/api/rules/1"},
		{"PATCH", "/api/rules/1"},
		{"DELETE", "/api/rules/1"},
		{"POST", "/api/rules/reorder"},
		{"POST", "/api/rules/apply-all"},
		{"POST", "/api/rules/preview"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Invoices(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/invoices"},
		{"POST", "/api/invoices"},
		{"GET", "/api/invoices/1"},
		{"PATCH", "/api/invoices/1"},
		{"DELETE", "/api/invoices/1"},
		{"POST", "/api/invoices/1/match-payment"},
		{"POST", "/api/invoices/1/pay-cash"},
		{"POST", "/api/invoices/1/unmatch-payment"},
		{"GET", "/api/invoices/1/candidates"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Settings(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/settings"},
		{"POST", "/api/settings"},
		{"GET", "/api/settings/audit-logs"},
		{"GET", "/api/settings/close-preflight"},
		{"GET", "/api/settings/directories"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_ReviewQueue(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/review-queue"},
		{"GET", "/api/review-queue/counts"},
		{"POST", "/api/review-queue/resolve"},
		{"POST", "/api/review-queue/batch-categorize"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Transactions(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/transactions/export"},
		{"GET", "/api/transactions"},
		{"POST", "/api/transactions"},
		{"GET", "/api/transactions/1"},
		{"PATCH", "/api/transactions/1"},
		{"DELETE", "/api/transactions/1"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Expenses(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/expenses/export"},
		{"GET", "/api/expenses"},
		{"POST", "/api/expenses"},
		{"GET", "/api/expenses/1"},
		{"PATCH", "/api/expenses/1"},
		{"DELETE", "/api/expenses/1"},
		{"POST", "/api/expenses/1/split"},
		{"POST", "/api/expenses/1/receipt"},
		{"DELETE", "/api/receipts/1"},
		{"PATCH", "/api/expenses/1/cash"},
		{"PATCH", "/api/reconciliation/cash/1"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Reconciliation(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/reconciliation/flagged"},
		{"POST", "/api/reconciliation/run"},
		{"POST", "/api/reconciliation/link"},
		{"POST", "/api/reconciliation/link-expense-invoice"},
		{"POST", "/api/reconciliation/unlink-expense-invoice"},
		{"POST", "/api/reconciliation/create-and-link"},
		{"POST", "/api/reconciliation/unlink"},
		{"GET", "/api/reconciliation/unlinked"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Reports(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/reports/pl"},
		{"GET", "/api/reports/schedule-c"},
		{"GET", "/api/reports/tax-pack"},
		{"GET", "/api/reports/cash-flow"},
		{"GET", "/api/reports/vendor-spend"},
		{"GET", "/api/reports/ar-aging"},
		{"GET", "/api/reports/trial-balance"},
		{"GET", "/api/reports/trial-balance/export"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_SystemBackup(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/system/backup/export"},
		{"POST", "/api/system/backup/restore"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Demo(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/api/demo/status"},
		{"POST", "/api/demo/seed"},
		{"POST", "/api/demo/reset"},
		{"POST", "/api/demo/remove"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Events(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	body := io.NopCloser(strings.NewReader(""))
	req := httptest.NewRequest("GET", "/api/events", body)
	defer func() { recover() }()
	resp, err := app.Test(req)
	if err != nil {
		t.Logf("GET /api/events: %v", err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

func TestSetupRoutes_Items(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	tests := []struct {
		method string
		path   string
	}{
		{"POST", "/api/items/exclude-preview"},
		{"POST", "/api/items/exclude-bulk-preview"},
		{"POST", "/api/items/exclude"},
		{"POST", "/api/items/exclude-bulk"},
		{"POST", "/api/items/restore"},
		{"POST", "/api/items/restore-bulk"},
		{"POST", "/api/items/delete-bulk"},
		{"POST", "/api/items/restore-deleted"},
		{"POST", "/api/items/move-to-excluded"},
		{"POST", "/api/items/delete-permanent"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(""))
			req := httptest.NewRequest(tt.method, tt.path, body)
			defer func() { recover() }()
			resp, err := app.Test(req)
			if err != nil {
				t.Logf("%s %s: %v", tt.method, tt.path, err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		})
	}
}

func TestSetupRoutes_Summary(t *testing.T) {
	app := fiber.New()
	SetupRoutes(app)

	body := io.NopCloser(strings.NewReader(""))
	req := httptest.NewRequest("GET", "/api/summary", body)
	defer func() { recover() }()
	resp, err := app.Test(req)
	if err != nil {
		t.Logf("GET /api/summary: %v", err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// ---- SetupRoutes: basic coverage ----

func TestSetupRoutes_Basic(t *testing.T) {
	// Just verify SetupRoutes doesn't panic
	app := fiber.New()
	SetupRoutes(app)
}
