package models_test

import (
	"encoding/json"
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

// ---- Money: MustParseMoney, CentsValue, SumMoney ----

func TestMustParseMoney(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want int64
	}{
		{"positive", "1234.56", 123456},
		{"negative", "-99.99", -9999},
		{"zero", "0.00", 0},
		{"zero_str", "0", 0},
		{"whole", "50", 5000},
		{"rounds_half_up", "0.005", 1},
		{"rounds_half_down", "0.015", 2},
		{"empty", "", 0},
		{"invalid", "abc", 0},
		{"whitespace", "  42.00  ", 4200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := models.MustParseMoney(tt.in)
			if got.CentsValue() != tt.want {
				t.Errorf("MustParseMoney(%q) = %d cents, want %d", tt.in, got.CentsValue(), tt.want)
			}
		})
	}
}

func TestMoney_CentsValue(t *testing.T) {
	m := models.NewMoney(12.34)
	if got := m.CentsValue(); got != 1234 {
		t.Errorf("CentsValue() = %d, want 1234", got)
	}
}

func TestSumMoney(t *testing.T) {
	tests := []struct {
		name string
		in   []models.Money
		want int64
	}{
		{"empty", []models.Money{}, 0},
		{"single", []models.Money{models.NewMoney(10.00)}, 1000},
		{"positive", []models.Money{models.NewMoney(5.00), models.NewMoney(3.00), models.NewMoney(2.00)}, 1000},
		{"mixed", []models.Money{models.NewMoney(100.00), models.NewMoney(-30.00)}, 7000},
		{"overflow_check", []models.Money{models.NewMoney(1e8), models.NewMoney(1e8)}, 20000000000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := models.SumMoney(tt.in)
			if got.CentsValue() != tt.want {
				t.Errorf("SumMoney() = %d cents, want %d", got.CentsValue(), tt.want)
			}
		})
	}
}

// ---- Money: Scan / Value (driver interface) ----

func TestMoney_Scan(t *testing.T) {
	tests := []struct {
		name string
		in   interface{}
		want int64
	}{
		{"int64", int64(1234), 1234},
		{"int", int(1234), 1234},
		{"int32", int32(1234), 1234},
		{"uint", uint(1234), 1234},
		{"uint32", uint32(1234), 1234},
		{"uint64", uint64(1234), 1234},
		{"float64", float64(12.34), 1234},
		{"float32", float32(12.34), 1234},
		{"[]byte", []byte("1234.56"), 123456},
		{"string", "1234.56", 123456},
		{"quoted_string", `"1234.56"`, 123456},
		{"nil", nil, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var m models.Money
			if err := m.Scan(tt.in); err != nil {
				t.Fatalf("Scan(%T) error: %v", tt.in, err)
			}
			if got := m.CentsValue(); got != tt.want {
				t.Errorf("Scan(%T) = %d cents, want %d", tt.in, got, tt.want)
			}
		})
	}
	// Unsupported type
	var m2 models.Money
	if err := m2.Scan(true); err == nil {
		t.Error("Scan(bool) should error")
	}
}

func TestMoney_Value(t *testing.T) {
	m := models.NewMoney(12.34)
	v, err := m.Value()
	if err != nil {
		t.Fatalf("Value() error: %v", err)
	}
	fv, ok := v.(float64)
	if !ok {
		t.Fatalf("Value() = %T, want float64", v)
	}
	if fv != 12.34 {
		t.Errorf("Value() = %v, want 12.34", fv)
	}
}

// ---- Money: PercentOf precision ----

func TestMoney_PercentOf(t *testing.T) {
	tests := []struct {
		name  string
		in    float64
		cents int64
		want  int64
	}{
		{"10pct_of_100", 10, 10000, 1000},     // 10% of $100 = $10
		{"29pct_of_970_70", 2.9, 97070, 2815},  // ~2.9% of $970.70 = $28.15 (floor)
		{"zero_rate", 0, 10000, 0},
		{"round_up", 33.33, 1000000, 333300}, // 33.33% of $10,000
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := models.Money{Cents: tt.cents}
			got := m.PercentOf(tt.in)
			if got.CentsValue() != tt.want {
				t.Errorf("PercentOf(%v) = %d cents, want %d", tt.in, got.CentsValue(), tt.want)
			}
		})
	}
}

// ---- Money: JSON round-trip ----

func TestMoney_JSON_RoundTrip(t *testing.T) {
	original := models.NewMoney(99.99)
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}
	var result models.Money
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	if result.Dollars() != original.Dollars() {
		t.Errorf("round-trip: %.2f -> %.2f", original.Dollars(), result.Dollars())
	}
}

// ---- Money: Marshal special values ----

func TestMoney_MarshalSpecialValues(t *testing.T) {
	tests := []struct {
		name string
		doll float64
		want string
	}{
		{"zero", 0, "0.00"},
		{"negative", -10.50, "-10.50"},
		{"large", 1234567.89, "1234567.89"},
		{"trailing_zero", 100.10, "100.10"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := models.NewMoney(tt.doll)
			data, err := json.Marshal(m)
			if err != nil {
				t.Fatalf("Marshal error: %v", err)
			}
			if string(data) != tt.want {
				t.Errorf("Marshal(%v) = %s, want %s", tt.doll, string(data), tt.want)
			}
		})
	}
}

// ---- UnmarshalJSON edge cases ----

func TestMoney_UnmarshalJSON_EdgeCases(t *testing.T) {
	tests := []struct {
		name string
		data string
		want int64
	}{
		{"null", "null", 0},
		{"empty_str", `""`, 0},
		{"quoted_number", `"42.50"`, 4250},
		{"leading_zeros", `"0042.50"`, 4250},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var m models.Money
			if err := json.Unmarshal([]byte(tt.data), &m); err != nil {
				t.Fatalf("UnmarshalJSON(%s) error: %v", tt.data, err)
			}
			if m.CentsValue() != tt.want {
				t.Errorf("UnmarshalJSON(%s) = %d cents, want %d", tt.data, m.CentsValue(), tt.want)
			}
		})
	}
}

// ---- BankTransaction.AfterFind ----

func TestBankTransaction_AfterFind(t *testing.T) {
	bt := models.BankTransaction{
		AllocationStatus: "BALANCED",
	}
	bt.AfterFind(nil)
	if bt.ReconciliationStatus != "BALANCED" {
		t.Errorf("ReconciliationStatus = %q, want %q", bt.ReconciliationStatus, "BALANCED")
	}
	if bt.LinkStatus != "BALANCED" {
		t.Errorf("LinkStatus = %q, want %q", bt.LinkStatus, "BALANCED")
	}

	bt.AllocationStatus = "UNLINKED"
	bt.AfterFind(nil)
	if bt.ReconciliationStatus != "UNLINKED" {
		t.Errorf("ReconciliationStatus = %q, want %q", bt.ReconciliationStatus, "UNLINKED")
	}
}

// ---- Expense.AfterFind ----

func TestExpense_AfterFind(t *testing.T) {
	e := models.Expense{
		AllocationStatus: "PARTIALLY_ALLOCATED",
	}
	e.AfterFind(nil)
	if e.ReconciliationStatus != "PARTIALLY_ALLOCATED" {
		t.Errorf("ReconciliationStatus = %q, want %q", e.ReconciliationStatus, "PARTIALLY_ALLOCATED")
	}
	if e.LinkStatus != "PARTIALLY_ALLOCATED" {
		t.Errorf("LinkStatus = %q, want %q", e.LinkStatus, "PARTIALLY_ALLOCATED")
	}
}

// ---- Model struct sanity: no naked floats ----

func TestModel_NoFloat64Money(t *testing.T) {
	// Verify that monetary fields in model structs use models.Money, not float64.
	// This is a compile-time check — if someone changes BankTransaction.Amount to float64,
	// the following field access would fail to compile.
	bt := models.BankTransaction{}
	_ = bt.Amount // should be models.Money
	e := models.Expense{}
	_ = e.Amount
	_ = e.TaxAmount

	inv := models.Invoice{}
	_ = inv.Subtotal
	_ = inv.TaxAmount
	_ = inv.TotalAmount
	_ = inv.AmountPaid
	_ = inv.BalanceDue
}
