package models

import (
	"database/sql/driver"
	"fmt"
	"math"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// Money stores a monetary value as integer cents internally to avoid
// IEEE 754 float64 precision errors.  It reads/writes decimal(12,2)
// columns in PostgreSQL and serialises to JSON with exactly 2 decimal
// places (e.g. 4876.10, never 4876.1).
type Money struct {
	Cents int64 `gorm:"column:-" json:"-"` // internal storage in cents
}

// NewMoney creates a Money from dollars (float64), rounding to the
// nearest cent.  This is the entry point when converting from OFX
// data or user input.
func NewMoney(dollars float64) Money {
	cents := int64(math.Round(dollars * 100))
	return Money{Cents: cents}
}

// Dollars returns the value as a float64 dollars.  Use only for
// display or external API output — never for internal arithmetic.
func (m Money) Dollars() float64 {
	return float64(m.Cents) / 100
}

// Add returns the sum of two Money values.
func (m Money) Add(other Money) Money {
	return Money{Cents: m.Cents + other.Cents}
}

// Sub returns the difference.
func (m Money) Sub(other Money) Money {
	return Money{Cents: m.Cents - other.Cents}
}

// MulByInt multiplies the Money amount by an integer factor.
func (m Money) MulByInt(n int) Money {
	return Money{Cents: m.Cents * int64(n)}
}

// Abs returns the absolute value of Money.
func (m Money) Abs() Money {
	if m.Cents < 0 {
		return Money{Cents: -m.Cents}
	}
	return m
}

// Neg returns the negated Money value.
func (m Money) Neg() Money {
	return Money{Cents: -m.Cents}
}

// IsPositive returns true if the money value is strictly greater than zero.
func (m Money) IsPositive() bool {
	return m.Cents > 0
}

// IsNegative returns true if the money value is strictly less than zero.
func (m Money) IsNegative() bool {
	return m.Cents < 0
}

// GreaterThan returns true if m is greater than other.
func (m Money) GreaterThan(other Money) bool {
	return m.Cents > other.Cents
}

// LessThan returns true if m is less than other.
func (m Money) LessThan(other Money) bool {
	return m.Cents < other.Cents
}

// PercentOf returns floor(m * pct / 100).
func (m Money) PercentOf(pct float64) Money {
	fraction := float64(m.Cents) * pct / 100.0
	return Money{Cents: int64(math.Round(fraction))}
}

// IsZero returns true when the value is zero (or within one cent).
func (m Money) IsZero() bool {
	return m.Cents == 0
}

// Scan implements sql.Scanner so GORM can read decimal columns.
func (m *Money) Scan(value interface{}) error {
	if value == nil {
		m.Cents = 0
		return nil
	}
	switch v := value.(type) {
	case int64:
		m.Cents = v
	case int:
		m.Cents = int64(v)
	case int32:
		m.Cents = int64(v)
	case uint:
		m.Cents = int64(v)
	case uint32:
		m.Cents = int64(v)
	case uint64:
		m.Cents = int64(v)
	case float64:
		// PostgreSQL decimal(12,2) may come as float64 via Go pq
		m.Cents = int64(math.Round(v * 100))
	case float32:
		m.Cents = int64(math.Round(float64(v) * 100))
	case []byte:
		s := strings.Trim(strings.TrimSpace(string(v)), "\"")
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return fmt.Errorf("Money.Scan: invalid decimal %q: %w", s, err)
		}
		m.Cents = int64(math.Round(f * 100))
	case string:
		s := strings.Trim(strings.TrimSpace(v), "\"")
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return fmt.Errorf("Money.Scan: invalid decimal %q: %w", s, err)
		}
		m.Cents = int64(math.Round(f * 100))
	default:
		return fmt.Errorf("Money.Scan: unsupported type %T", value)
	}
	return nil
}

// Value implements driver.Valuer so GORM can write decimal columns.
func (m Money) Value() (driver.Value, error) {
	return float64(m.Cents) / 100, nil
}

// GormDBDataType selects decimal(12,2) on PostgreSQL and real on SQLite so whole-dollar
// floats written by Value() are not coerced to integer storage class by SQLite NUMERIC affinity.
func (Money) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	switch db.Dialector.Name() {
	case "sqlite":
		return "real"
	default:
		return "decimal(12,2)"
	}
}

// MarshalJSON produces a JSON number with exactly 2 decimal places.
// Example: 4876.10 (not 4876.1 or 4876).
func (m Money) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("%.2f", m.Dollars())), nil
}

// UnmarshalJSON parses a JSON number or numeric string into Money.
func (m *Money) UnmarshalJSON(data []byte) error {
	s := strings.Trim(strings.TrimSpace(string(data)), "\"")
	// Handle null
	if s == "null" || s == "" {
		m.Cents = 0
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return fmt.Errorf("Money.UnmarshalJSON: %w", err)
	}
	m.Cents = int64(math.Round(f * 100))
	return nil
}

// MustParseMoney parses a dollar string like "1234.56" and returns Money.
func MustParseMoney(s string) Money {
	s = strings.TrimSpace(s)
	if s == "" {
		return Money{}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return Money{}
	}
	return Money{Cents: int64(math.Round(f * 100))}
}

// Cents returns the raw cents value (useful for database operations).
func (m Money) CentsValue() int64 {
	return m.Cents
}

// SumMoney adds a slice of Money values and returns the total.
func SumMoney(moneys []Money) Money {
	var total int64
	for _, m := range moneys {
		total += m.Cents
	}
	return Money{Cents: total}
}
