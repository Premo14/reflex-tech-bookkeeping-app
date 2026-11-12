package models_test

import (
	"encoding/json"
	"reflex-tech-bookkeeping-app-api/models"
	"testing"
)

func TestMoney_Arithmetic(t *testing.T) {
	m1 := models.NewMoney(12.50)
	m2 := models.NewMoney(2.50)

	// Add
	sum := m1.Add(m2)
	if sum.Dollars() != 15.00 {
		t.Fatalf("Add: expected 15.00, got %.2f", sum.Dollars())
	}

	// Sub
	diff := m1.Sub(m2)
	if diff.Dollars() != 10.00 {
		t.Fatalf("Sub: expected 10.00, got %.2f", diff.Dollars())
	}

	// MulByInt
	mul := m2.MulByInt(3)
	if mul.Dollars() != 7.50 {
		t.Fatalf("MulByInt: expected 7.50, got %.2f", mul.Dollars())
	}

	// MulByInt with 0
	mulZero := m2.MulByInt(0)
	if mulZero.Dollars() != 0.00 {
		t.Fatalf("MulByInt(0): expected 0.00, got %.2f", mulZero.Dollars())
	}

	// Abs and Neg
	neg := m2.Neg()
	if neg.Dollars() != -2.50 {
		t.Fatalf("Neg: expected -2.50, got %.2f", neg.Dollars())
	}
	if !neg.IsNegative() {
		t.Fatalf("IsNegative: expected true for -2.50")
	}
	abs := neg.Abs()
	if abs.Dollars() != 2.50 {
		t.Fatalf("Abs: expected 2.50, got %.2f", abs.Dollars())
	}
	if !abs.IsPositive() {
		t.Fatalf("IsPositive: expected true for 2.50")
	}

	// GreaterThan / LessThan
	if !m1.GreaterThan(m2) {
		t.Fatalf("GreaterThan: expected 12.50 > 2.50")
	}
	if !m2.LessThan(m1) {
		t.Fatalf("LessThan: expected 2.50 < 12.50")
	}
}

func TestMoney_JSON(t *testing.T) {
	// Marshal
	m := models.NewMoney(4876.10)
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("MarshalJSON error: %v", err)
	}
	if string(b) != "4876.10" {
		t.Fatalf("MarshalJSON expected '4876.10', got %s", string(b))
	}

	// Unmarshal number
	var unmarshaled models.Money
	if err := json.Unmarshal([]byte("4876.10"), &unmarshaled); err != nil {
		t.Fatalf("UnmarshalJSON number error: %v", err)
	}
	if unmarshaled.Dollars() != 4876.10 {
		t.Fatalf("UnmarshalJSON expected 4876.10, got %.2f", unmarshaled.Dollars())
	}

	// Unmarshal quoted string
	var fromString models.Money
	if err := json.Unmarshal([]byte(`"123.45"`), &fromString); err != nil {
		t.Fatalf("UnmarshalJSON string error: %v", err)
	}
	if fromString.Dollars() != 123.45 {
		t.Fatalf("UnmarshalJSON expected 123.45, got %.2f", fromString.Dollars())
	}
}
