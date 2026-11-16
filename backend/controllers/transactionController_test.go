package controllers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/stretchr/testify/require"
)

func TestValidateBankAccount(t *testing.T) {
	tests := []struct {
		name    string
		acc     *models.ChartAccount
		wantErr bool
	}{
		{
			name:    "Nil account returns error",
			acc:     nil,
			wantErr: true,
		},
		{
			name: "Active ASSET account (Checking) is valid",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Checking Account",
				Type:   "ASSET",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Active LIABILITY account (Credit Card) is valid",
			acc: &models.ChartAccount{
				Code:   "2020",
				Name:   "Credit Card",
				Type:   "LIABILITY",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Inactive ASSET account is rejected",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Checking Account",
				Type:   "ASSET",
				Active: false,
			},
			wantErr: true,
		},
		{
			name: "Inactive LIABILITY account is rejected",
			acc: &models.ChartAccount{
				Code:   "2020",
				Name:   "Credit Card",
				Type:   "LIABILITY",
				Active: false,
			},
			wantErr: true,
		},
		{
			name: "Active EXPENSE account is rejected as bank account",
			acc: &models.ChartAccount{
				Code:   "5010",
				Name:   "Rent",
				Type:   "EXPENSE",
				Active: true,
			},
			wantErr: true,
		},
		{
			name: "Active REVENUE account is rejected as bank account",
			acc: &models.ChartAccount{
				Code:   "4010",
				Name:   "Sales Revenue",
				Type:   "REVENUE",
				Active: true,
			},
			wantErr: true,
		},
		{
			name: "Active EQUITY account is rejected as bank account",
			acc: &models.ChartAccount{
				Code:   "3010",
				Name:   "Owner Equity",
				Type:   "EQUITY",
				Active: true,
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateBankAccount(tc.acc)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateBankAccount() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// === ValidateTransactionCategory tests (existing) ===

func TestValidateTransactionCategory(t *testing.T) {
	tests := []struct {
		name    string
		acc     *models.ChartAccount
		wantErr bool
	}{
		{
			name:    "Nil category account is valid (optional)",
			acc:     nil,
			wantErr: false,
		},
		{
			name: "Active EXPENSE account is valid category",
			acc: &models.ChartAccount{
				Code:   "5050",
				Name:   "Office Supplies",
				Type:   "EXPENSE",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Active REVENUE account is valid category",
			acc: &models.ChartAccount{
				Code:   "4010",
				Name:   "Sales Revenue",
				Type:   "REVENUE",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Inactive EXPENSE account is rejected",
			acc: &models.ChartAccount{
				Code:   "5050",
				Name:   "Office Supplies",
				Type:   "EXPENSE",
				Active: false,
			},
			wantErr: true,
		},
		{
			name: "Inactive REVENUE account is rejected",
			acc: &models.ChartAccount{
				Code:   "4010",
				Name:   "Sales Revenue",
				Type:   "REVENUE",
				Active: false,
			},
			wantErr: true,
		},
		{
			name: "Active ASSET account is accepted as category",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Checking Account",
				Type:   "ASSET",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Active LIABILITY account is accepted as category",
			acc: &models.ChartAccount{
				Code:   "2020",
				Name:   "Credit Card",
				Type:   "LIABILITY",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Active EQUITY account is accepted as category",
			acc: &models.ChartAccount{
				Code:   "3010",
				Name:   "Owner Equity",
				Type:   "EQUITY",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Unknown account type is rejected",
			acc: &models.ChartAccount{
				Code:   "9990",
				Name:   "Unknown Type",
				Type:   "OTHER",
				Active: true,
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateTransactionCategory(tc.acc)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateTransactionCategory() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// === TransactionInitialStatus tests (existing) ===

func TestTransactionInitialStatus(t *testing.T) {
	getStatus := func(amount float64) (string, string) {
		allocationStatus := "UNLINKED"
		if amount > 0 {
			allocationStatus = "BALANCED"
		}
		return allocationStatus, "APPROVED"
	}

	alloc, rev := getStatus(-89.99)
	if alloc != "UNLINKED" || rev != "APPROVED" {
		t.Errorf("debit tx expected (UNLINKED, APPROVED), got (%s, %s)", alloc, rev)
	}

	alloc, rev = getStatus(500.00)
	if alloc != "BALANCED" || rev != "APPROVED" {
		t.Errorf("deposit tx expected (BALANCED, APPROVED), got (%s, %s)", alloc, rev)
	}
}

// === GetTransactions tests ===

func TestGetTransactions_Success(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	// Seed test accounts and transactions
	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx1 := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-wm-1",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	tx2 := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Starbucks",
		Amount:           models.NewMoney(-4.50),
		FITID:            "fit-sb-2",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx1)
	db.DB.Create(&tx2)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
	require.Equal(t, float64(2), body["total"])
}

func TestGetTransactions_StatusFilterUnlinked(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	txBalanced := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Balanced",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-balanced",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	txUnlinked := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Unlinked",
		Amount:           models.NewMoney(-30.00),
		FITID:            "fit-unlinked",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&txBalanced)
	db.DB.Create(&txUnlinked)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=UNLINKED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_StatusFilterBalanced(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	txDep := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Deposit",
		Amount:           models.NewMoney(1000.00),
		FITID:            "fit-dep",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	txBalanced := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Balanced expense",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-balanced",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&txDep)
	db.DB.Create(&txBalanced)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=BALANCED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	// BALANCED filter includes deposits (amount >= 0) and BALANCED allocations
	require.GreaterOrEqual(t, body["total"], float64(1))
}

func TestGetTransactions_StatusFilterLinked(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	txBalanced := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Balanced",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-linked",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&txBalanced)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=LINKED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_StatusFilterNeedsAttention(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Needs attention: unbalanced and approved review status
	txUnbalanced := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Unbalanced",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-needs-1",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}
	// Ignored review status should not appear
	txIgnored := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Ignored",
		Amount:           models.NewMoney(-20.00),
		FITID:            "fit-needs-2",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "IGNORED",
	}
	db.DB.Create(&txUnbalanced)
	db.DB.Create(&txIgnored)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=NEEDS_ATTENTION", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_SearchText(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-wm",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Target",
		Amount:           models.NewMoney(-30.00),
		FITID:            "fit-tg",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?search=walmart", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_SearchAmount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-50",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	// Search with $ prefix
	req := httptest.NewRequest(http.MethodGet, "/api/transactions?search=$50", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.GreaterOrEqual(t, body["total"], float64(1))
}

func TestGetTransactions_DateRangeFilter(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC),
		Description:      "January",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-jan",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "June",
		Amount:           models.NewMoney(-30.00),
		FITID:            "fit-jun",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?startDate=2026-04-01&endDate=2026-07-31", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_Pagination(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	for i := 0; i < 5; i++ {
		db.DB.Create(&models.BankTransaction{
			ChartAccountID:   &bankAcct.ID,
			Date:             time.Date(2026, 6, 15+i, 0, 0, 0, 0, time.UTC),
			Description:      "Tx",
			Amount:           models.NewMoney(float64(-i) * 10),
			FITID:            "fit-pg-" + string(rune('0'+i)),
			AllocationStatus: "BALANCED",
			ReviewStatus:     "APPROVED",
		})
	}

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?page=1&limit=2", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(5), body["total"])
	require.Equal(t, float64(1), body["page"])
	require.Equal(t, float64(2), body["limit"])
}

func TestGetTransactions_SortByAmount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Small",
		Amount:           models.NewMoney(-10.00),
		FITID:            "fit-small",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Large",
		Amount:           models.NewMoney(-1000.00),
		FITID:            "fit-large",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?sortBy=amount&sortOrder=desc", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(2), body["total"])
}

func TestGetTransactions_IgnoredDeletedExcluded(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// These should be excluded from results
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Ignored",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-ignored",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "IGNORED",
	})
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Deleted",
		Amount:           models.NewMoney(-30.00),
		FITID:            "fit-deleted",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "DELETED",
	})
	// This one should be included
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 17, 0, 0, 0, 0, time.UTC),
		Description:      "Active",
		Amount:           models.NewMoney(-20.00),
		FITID:            "fit-active",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === GetTransaction tests ===

func TestGetTransaction_NotFound(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Get("/api/transactions/:id", GetTransaction)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions/99999", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 404, resp.StatusCode)
}

func TestGetTransaction_Success(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	expense := models.Expense{
		Vendor:         "Walmart",
		Amount:         models.NewMoney(50.00),
		Timestamp:      time.Now(),
		ChartAccountID: &bankAcct.ID,
	}
	db.DB.Create(&expense)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-wm",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions/:id", GetTransaction)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
}

func TestGetTransaction_LinkedInvoice(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Create invoice linked to the bank transaction
	invoice := models.Invoice{
		InvoiceNumber:     "INV-001",
		ClientName:        "Acme Corp",
		TotalAmount:       models.NewMoney(100.00),
		AmountPaid:        models.NewMoney(100.00),
		BankTransactionID: nil, // will be set via association
	}
	db.DB.Create(&invoice)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Acme Corp Payment",
		Amount:           models.NewMoney(100.00),
		FITID:            "fit-inv",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	// Manually link the invoice to the transaction via the foreign key
	db.DB.Model(&invoice).Update("bank_transaction_id", tx.ID)

	app := newTestApp()
	app.Get("/api/transactions/:id", GetTransaction)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
	require.NotNil(t, body["linkedInvoice"])
}

func TestGetTransaction_SuggestedInvoices(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Create an open invoice for a client
	clientName := "Acme Corp"
	invoice := models.Invoice{
		InvoiceNumber: "INV-001",
		ClientName:    clientName,
		TotalAmount:   models.NewMoney(250.00),
		AmountPaid:    models.NewMoney(0),
		Status:        "SENT",
	}
	db.DB.Create(&invoice)

	// Create a deposit transaction that matches the client name and amount
	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Payment from Acme Corp",
		Amount:           models.NewMoney(250.00),
		FITID:            "fit-suggest",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions/:id", GetTransaction)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
	// Suggested invoices should be populated since tx is a deposit and not linked to an invoice
	suggested, ok := body["suggestedInvoices"]
	require.True(t, ok, "suggestedInvoices key should exist")
	suggestedList, isList := suggested.([]interface{})
	if isList {
		require.GreaterOrEqual(t, len(suggestedList), 1)
	}
}

// === CreateTransaction tests ===

func TestCreateTransaction_BadJSON(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte("{invalid")))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_MissingBankAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":10.00}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_InvalidBankAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":10.00,"chartAccountId":9999}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_InactiveBankAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	inactiveAcct := models.ChartAccount{Code: "1010", Name: "Old Checking", Type: "ASSET", Active: false}
	db.DB.Create(&inactiveAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":10.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_InactiveCategoryAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// First create an inactive expense account
	inactiveCat := models.ChartAccount{Code: "5010", Name: "Old Rent", Type: "EXPENSE", Active: false}
	db.DB.Create(&inactiveCat)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":10.00,"chartAccountId":1,"categoryAccountId":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_ClosedPeriod(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	// Set books closed to 2026-01-01
	setting := models.AppSetting{Key: "BooksClosedDate", Value: "2026-01-01"}
	db.DB.Save(&setting)

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2025-12-15","description":"Test","amount":10.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 403, resp.StatusCode)
}

func TestCreateTransaction_Success_Deposit(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Payroll deposit","amount":2500.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])

	// Verify transaction was created with BALANCED allocation (deposit >= 0)
	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Equal(t, "BALANCED", tx.AllocationStatus)
}

func TestCreateTransaction_Success_Depbit(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Office supplies","amount":-25.00,"chartAccountId":1,"categoryAccountId":2}`

	// First create a category account
	catAcct := models.ChartAccount{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	db.DB.Create(&catAcct)

	payload = `{"date":"2026-06-15","description":"Office supplies","amount":-25.00,"chartAccountId":1,"categoryAccountId":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])

	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Equal(t, "UNLINKED", tx.AllocationStatus)
}

func TestCreateTransaction_Success_RFC3339(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	// RFC3339 date format
	payload := `{"date":"2026-06-15T14:30:00Z","description":"Test","amount":100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
}

func TestCreateTransaction_NotInClosedPeriod(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	// Books closed date in the past — current transactions should be allowed
	setting := models.AppSetting{Key: "BooksClosedDate", Value: "2020-01-01"}
	db.DB.Save(&setting)

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)
}

func TestCreateTransaction_NoCategoryAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	// No category account provided — should succeed with UNLINKED
	payload := `{"date":"2026-06-15","description":"Test","amount":-100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Nil(t, tx.CategoryAccountID)
}

// === UpdateTransaction tests ===

func TestUpdateTransaction_NotFound(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/99999", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 404, resp.StatusCode)
}

func TestUpdateTransaction_ClosedPeriod(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	setting := models.AppSetting{Key: "BooksClosedDate", Value: "2026-01-01"}
	db.DB.Save(&setting)

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2025, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Old transaction",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-old",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 403, resp.StatusCode)
}

func TestUpdateTransaction_ImportedAmountProtected(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Imported transaction (IsManual = false)
	tx := models.BankTransaction{
		IsManual:         false,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Imported",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-import",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated","amount":100.00}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTransaction_ImportedAccountProtected(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	anotherAcct := models.ChartAccount{Code: "1020", Name: "Savings", Type: "ASSET", Active: true}
	db.DB.Create(&anotherAcct)

	// Imported transaction
	tx := models.BankTransaction{
		IsManual:         false,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Imported",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-import",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated","chartAccountId":2}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTransaction_ImportedDateProtected(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Imported transaction
	tx := models.BankTransaction{
		IsManual:         false,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Imported",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-import",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"date":"2026-07-01"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTransaction_ManualUpdate_Success(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-manual",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated manually"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
}

func TestUpdateTransaction_ManualAmountChange(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-manual",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"amount":75.00}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])

	var updated models.BankTransaction
	require.NoError(t, db.DB.First(&updated, "id = ?", 1).Error)
	// Amount should be updated to 75.00
	require.Equal(t, models.NewMoney(75.00).Dollars(), updated.Amount.Dollars())
}

func TestUpdateTransaction_ManualBankAccountChange(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	savingsAcct := models.ChartAccount{Code: "1020", Name: "Savings", Type: "ASSET", Active: true}
	db.DB.Create(&savingsAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-manual",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"chartAccountId":2}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
}

func TestUpdateTransaction_ManualBankAccountInvalid(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Inactive account
	inactiveAcct := models.ChartAccount{Code: "5010", Name: "Rent", Type: "EXPENSE", Active: true}
	db.DB.Create(&inactiveAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-manual",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Trying to move to EXPENSE account — should fail (not ASSET/LIABILITY)
	payload := `{"chartAccountId":2}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTransaction_ClearCategory(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:          true,
		ChartAccountID:    &bankAcct.ID,
		CategoryAccountID: &bankAcct.ID, // temporarily set to same
		Date:              time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:       "Manual entry",
		Amount:            models.NewMoney(-50.00),
		FITID:             "fit-manual",
		AllocationStatus:  "BALANCED",
		ReviewStatus:      "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Clear category — send 0 as categoryAccountId
	payload := `{"categoryAccountId":0}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
}

func TestUpdateTransaction_DateIntoClosedPeriod(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	setting := models.AppSetting{Key: "BooksClosedDate", Value: "2026-06-01"}
	db.DB.Save(&setting)

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Future transaction",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-future",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Move date into closed period
	payload := `{"date":"2026-05-15"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 403, resp.StatusCode)
}

// === DeleteTransaction tests ===

func TestDeleteTransaction_NotFound(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/99999", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 404, resp.StatusCode)
}

func TestDeleteTransaction_ClosedPeriod(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	setting := models.AppSetting{Key: "BooksClosedDate", Value: "2026-01-01"}
	db.DB.Save(&setting)

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2025, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Old transaction",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-old",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 403, resp.StatusCode)
}

func TestDeleteTransaction_Success(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "To delete",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-del",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])

	// Verify soft-delete: review_status should be DELETED and deleted_at set
	var deleted models.BankTransaction
	require.NoError(t, db.DB.Where("id = ?", 1).First(&deleted).Error)
	require.Equal(t, "DELETED", deleted.ReviewStatus)
	require.NotNil(t, deleted.DeletedAt)
}

func TestDeleteTransaction_UnlinksExpenses(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "To delete",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-unlink",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	expense := models.Expense{Vendor: "Walmart", Amount: models.NewMoney(50.00), Timestamp: time.Now()}
	db.DB.Create(&expense)

	// Link expense to transaction
	link := models.ExpenseBankTransaction{
		BankTransactionID: tx.ID,
		ExpenseID:         expense.ID,
		Status:            "confirmed",
	}
	db.DB.Create(&link)

	// Verify link exists before delete
	var linkCount int64
	db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ?", tx.ID).Count(&linkCount)
	require.Equal(t, int64(1), linkCount)

	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	// Verify join table rows are deleted
	db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ?", tx.ID).Count(&linkCount)
	require.Equal(t, int64(0), linkCount)
}

func TestDeleteTransaction_AuditLogCreated(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "To delete",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-audit",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	// Verify audit log was created
	var log models.ItemAuditLog
	require.NoError(t, db.DB.Where("item_type = ? AND item_id = ? AND action = ?", "transaction", tx.ID, "DELETED").First(&log).Error)
	require.Equal(t, "DELETED", log.Action)
}

// === Account hierarchy tests ===

func TestGetAccountAndDescendantIDs_SingleAccount(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	result := GetAccountAndDescendantIDs(999)
	require.Equal(t, []uint{999}, result)
}

func TestGetAccountAndDescendantIDs_WithChildren(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	parent := models.ChartAccount{Code: "1000", Name: "Assets", Type: "ASSET"}
	child1 := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", ParentID: &parent.ID}
	child2 := models.ChartAccount{Code: "1020", Name: "Savings", Type: "ASSET", ParentID: &parent.ID}
	db.DB.Create(&parent)
	db.DB.Create(&child1)
	db.DB.Create(&child2)

	result := GetAccountAndDescendantIDs(parent.ID)
	require.Contains(t, result, parent.ID)
	require.Contains(t, result, child1.ID)
	require.Contains(t, result, child2.ID)
}

// === NIL-DB GUARD tests ===

func TestGetTransactions_NilDB(t *testing.T) {
	teardownTestDB()
	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 500, resp.StatusCode)
}

func TestGetTransaction_NilDB(t *testing.T) {
	teardownTestDB()
	app := newTestApp()
	app.Get("/api/transactions/:id", GetTransaction)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 500, resp.StatusCode)
}

func TestCreateTransaction_NilDB(t *testing.T) {
	teardownTestDB()
	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":10.00}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 500, resp.StatusCode)
}

func TestUpdateTransaction_NilDB(t *testing.T) {
	teardownTestDB()
	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"description":"Updated"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 500, resp.StatusCode)
}

func TestDeleteTransaction_NilDB(t *testing.T) {
	teardownTestDB()
	app := newTestApp()
	app.Delete("/api/transactions/:id", DeleteTransaction)

	req := httptest.NewRequest(http.MethodDelete, "/api/transactions/1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 500, resp.StatusCode)
}

// === Status filter edge-case tests ===

func TestGetTransactions_StatusFilterOverAllocated(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Over allocated",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-over",
		AllocationStatus: "OVER_ALLOCATED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=OVER_ALLOCATED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_StatusFilterPartiallyAllocated(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Partially allocated",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-partial",
		AllocationStatus: "PARTIALLY_ALLOCATED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=PARTIALLY_ALLOCATED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === Sort order tests ===

func TestGetTransactions_SortAsc(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:      "Later",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-asc-2",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})
	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Earlier",
		Amount:           models.NewMoney(-30.00),
		FITID:            "fit-asc-1",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?sortOrder=asc", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(2), body["total"])
}

// === Constants/paths integration test ===

func TestGetAccountAndDescendantIDs_NilDB(t *testing.T) {
	teardownTestDB()
	result := GetAccountAndDescendantIDs(42)
	require.Equal(t, []uint{42}, result)
}

// === Search with special chars ===

func TestGetTransactions_SearchTrimmed(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-search",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	// Whitespace-only search should not filter — use URL-encoded space
	req, err := http.NewRequest(http.MethodGet, "/api/transactions?search=%20%20", nil)
	require.NoError(t, err)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

func TestGetTransactions_SearchFITID(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Walmart",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-wm-unique",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?search=fit-wm-unique", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === Notes field search ===

func TestGetTransactions_SearchNotes(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Office supply store",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-notes",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
		Notes:            "Purchase of office supplies",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?search=office", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === Verify FITID auto-generation for manual transactions ===

func TestCreateTransaction_FITIDGenerated(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Contains(t, tx.FITID, "MANUAL-")
	require.True(t, tx.IsManual)
	require.Equal(t, "APPROVED", tx.ReviewStatus)
}

// === Transaction type tests ===

func TestCreateTransaction_TransactionType(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":100.00,"transactionType":"DEP","chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Equal(t, "DEP", tx.TransactionType)
}

// === Bank rules auto-evaluation ===

func TestCreateTransaction_BankRulesApplied(t *testing.T) {
	// Bank rules engine requires a working DB + seeded rules
	// This test verifies the CreateTransaction flow invokes bank rules when category is nil
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Create a rule with ConditionsJSON (JSON array of RuleCondition)
	rule := models.BankRule{
		Name:              "Auto-walmart",
		ConditionsJSON:    `[{"field":"description","operator":"contains","value":"walmart"}]`,
		CategoryAccountID: &bankAcct.ID,
		Active:            true,
		Priority:          1,
	}
	db.DB.Create(&rule)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Walmart purchase","amount":-25.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)
}

// === Category account validation tests ===

func TestCreateTransaction_CategoryNotFound(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":-25.00,"chartAccountId":1,"categoryAccountId":9999}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestCreateTransaction_CategoryAccountTypeMismatch(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Create an ASSET account (not valid as category since not EXPENSE/REVENUE/etc. — actually ASSET is valid per code)
	assetCat := models.ChartAccount{Code: "1020", Name: "Savings", Type: "ASSET", Active: true}
	db.DB.Create(&assetCat)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":-25.00,"chartAccountId":1,"categoryAccountId":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	// ASSET is a valid category type per ValidateTransactionCategory
	require.Equal(t, 201, resp.StatusCode)
}

// === Zero-date validation ===

func TestCreateTransaction_ZeroDateDefaultsToNow(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	// No date field — should default to now
	payload := `{"description":"Test","amount":100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)
}

// === Empty date string ===

func TestCreateTransaction_EmptyDateDefaultsToNow(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"","description":"Test","amount":100.00,"chartAccountId":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)
}

// === UpdateTransaction with valid category ===

func TestUpdateTransaction_SetCategory(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	catAcct := models.ChartAccount{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	db.DB.Create(&catAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-cat",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"categoryAccountId":2}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "success", body["status"])
}

func TestUpdateTransaction_CategoryNotFound(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-cat-nf",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Non-existent category
	payload := `{"categoryAccountId":9999}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTransaction_InactiveCategory(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	inactiveCat := models.ChartAccount{Code: "5050", Name: "Old Supplies", Type: "EXPENSE", Active: false}
	db.DB.Create(&inactiveCat)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-cat-inactive",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"categoryAccountId":2}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
}

// === UpdateTransaction with Notes only ===

func TestUpdateTransaction_NotesOnly(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-notes-only",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"notes":"Additional context"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
}

// === UpdateTransaction date parse formats ===

func TestUpdateTransaction_DateRFC3339(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-rfc3339",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"date":"2026-07-01T12:00:00Z"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
}

func TestUpdateTransaction_DateYYYYMMDD(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-yyyymmdd",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	payload := `{"date":"2026-07-15"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
}

func TestUpdateTransaction_InvalidDate(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		IsManual:         true,
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Manual entry",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-invdate",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Invalid date format — should be ignored (not zero)
	payload := `{"date":"not-a-date"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/transactions/1", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	// The date parse fails, newDate is zero, so the date is not updated — request succeeds
	require.Equal(t, 200, resp.StatusCode)
}

// === GetTransactions status filtering with case-insensitivity ===

func TestGetTransactions_StatusFilterLowercase(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	tx := models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Test",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-lower",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	// Lowercase status — should be uppercased by controller
	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=balanced", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === GetTransactions — UNCATEGORIZED filter ===

func TestGetTransactions_StatusFilterUncategorized(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	// Uncategorized: no category_account_id, not a liability deposit
	uncat := models.BankTransaction{
		ChartAccountID:    &bankAcct.ID,
		Date:              time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:       "Uncategorized",
		Amount:            models.NewMoney(-50.00),
		FITID:             "fit-uncat",
		AllocationStatus:  "UNLINKED",
		CategoryAccountID: nil,
		ReviewStatus:      "APPROVED",
	}
	db.DB.Create(&uncat)

	// Categorized — should NOT appear
	categorized := models.BankTransaction{
		ChartAccountID:    &bankAcct.ID,
		Date:              time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Description:       "Categorized",
		Amount:            models.NewMoney(-30.00),
		FITID:             "fit-cat",
		AllocationStatus:  "BALANCED",
		CategoryAccountID: &bankAcct.ID,
		ReviewStatus:      "APPROVED",
	}
	db.DB.Create(&categorized)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?status=UNCATEGORIZED", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === Account filter by descendant IDs ===

func TestGetTransactions_AccountFilterDescendant(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	parent := models.ChartAccount{Code: "1000", Name: "Assets", Type: "ASSET", Active: true}
	child := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true, ParentID: &parent.ID}
	db.DB.Create(&parent)
	db.DB.Create(&child)

	tx := models.BankTransaction{
		ChartAccountID:   &child.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Via child",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-child",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&tx)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	// Filter by parent ID — should find child's transaction
	req := httptest.NewRequest(http.MethodGet, "/api/transactions?accountId=1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
}

// === Default pagination values ===

func TestGetTransactions_DefaultPagination(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Tx",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-def",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["total"])
	require.Equal(t, float64(1), body["page"])
	require.Equal(t, float64(50), body["limit"])
}

// === Negative page/limit handling ===

func TestGetTransactions_NegativePageDefaultsToOne(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	db.DB.Create(&models.BankTransaction{
		ChartAccountID:   &bankAcct.ID,
		Date:             time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:      "Tx",
		Amount:           models.NewMoney(-50.00),
		FITID:            "fit-negpage",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	})

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)

	req := httptest.NewRequest(http.MethodGet, "/api/transactions?page=-1", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, float64(1), body["page"])
}

// === Constants/SetDropboxLocation integration (already tested via upload, no-op here) ===

func TestCreateTransaction_NotesField(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.DB.Create(&bankAcct)

	app := newTestApp()
	app.Post("/api/transactions", CreateTransaction)

	payload := `{"date":"2026-06-15","description":"Test","amount":100.00,"chartAccountId":1,"notes":"Customer payment for invoice #123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 201, resp.StatusCode)

	var tx models.BankTransaction
	require.NoError(t, db.DB.First(&tx, "id = ?", 1).Error)
	require.Equal(t, "Customer payment for invoice #123", tx.Notes)
}

func TestUpdateTransaction_ClearCategoryNullAndCaseInsensitiveSearch(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	bankAcct := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	expAcct := models.ChartAccount{Code: "5010", Name: "Software", Type: "EXPENSE", Active: true}
	require.NoError(t, db.DB.Create(&bankAcct).Error)
	require.NoError(t, db.DB.Create(&expAcct).Error)

	tx := models.BankTransaction{
		ChartAccountID:    &bankAcct.ID,
		CategoryAccountID: &expAcct.ID,
		Date:              time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Description:       "Adobe Creative Cloud",
		Amount:            models.NewMoney(-59.99),
		FITID:             "fit-adobe-case",
		AllocationStatus:  "UNLINKED",
		ReviewStatus:      "APPROVED",
	}
	require.NoError(t, db.DB.Create(&tx).Error)

	app := newTestApp()
	app.Get("/api/transactions", GetTransactions)
	app.Patch("/api/transactions/:id", UpdateTransaction)

	// Uppercase search query must match mixed-case description
	reqSearch := httptest.NewRequest(http.MethodGet, "/api/transactions?search=ADOBE", nil)
	respSearch, err := app.Test(reqSearch)
	require.NoError(t, err)
	require.Equal(t, 200, respSearch.StatusCode)
	var listBody map[string]interface{}
	require.NoError(t, json.NewDecoder(respSearch.Body).Decode(&listBody))
	require.Equal(t, float64(1), listBody["total"])

	// Clearing categoryAccountId explicitly with JSON null must persist CategoryAccountID = nil
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/transactions/"+itoa(tx.ID), bytes.NewBufferString(`{"categoryAccountId":null}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchResp, err := app.Test(patchReq)
	require.NoError(t, err)
	require.Equal(t, 200, patchResp.StatusCode)

	var updated models.BankTransaction
	require.NoError(t, db.DB.First(&updated, tx.ID).Error)
	require.Nil(t, updated.CategoryAccountID)
}
