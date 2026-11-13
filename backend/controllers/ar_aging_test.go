package controllers

import (
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

// arTestAsOf is the fixed reference date for all A/R aging tests.
var arTestAsOf = time.Date(2026, 11, 12, 14, 30, 0, 0, time.UTC)

// arInv builds a test invoice whose due date is offsetDays days relative to
// arTestAsOf (negative = past due).
func arInv(id uint, num, client string, offsetDays int, total, paid float64, status string) models.Invoice {
	return models.Invoice{
		ID:            id,
		InvoiceNumber: num,
		ClientName:    client,
		IssueDate:     arTestAsOf.AddDate(0, 0, -60),
		DueDate:       arTestAsOf.AddDate(0, 0, offsetDays),
		TotalAmount:   models.NewMoney(total),
		AmountPaid:    models.NewMoney(paid),
		BalanceDue:    models.NewMoney(total - paid),
		Status:        status,
	}
}

func bucketIndex(t *testing.T, r ARAgingReportData, name string) int {
	t.Helper()
	for i, b := range r.Buckets {
		if b.BucketName == name {
			return i
		}
	}
	t.Fatalf("bucket %q not found in report", name)
	return -1
}

// TestBuildARAgingBucketWindowing verifies the exact bucket boundary days:
// 0/Current, 1, 30, 31, 60, 61, 90, 91.
func TestBuildARAgingBucketWindowing(t *testing.T) {
	cases := []struct {
		offset int
		bucket string
	}{
		{0, "Current (Not Due)"},
		{1, "1 - 30 Days Overdue"},
		{30, "1 - 30 Days Overdue"},
		{31, "31 - 60 Days Overdue"},
		{60, "31 - 60 Days Overdue"},
		{61, "61 - 90 Days Overdue"},
		{90, "61 - 90 Days Overdue"},
		{91, "90+ Days Overdue"},
	}

	for _, c := range cases {
		report := BuildARAgingData(
			[]models.Invoice{arInv(1, "INV-1", "Client A", -c.offset, 100, 0, "OVERDUE")},
			arTestAsOf,
			models.NewMoney(100),
			90,
		)
		idx := bucketIndex(t, report, c.bucket)
		if report.Buckets[idx].Count != 1 {
			t.Errorf("offset %d: expected invoice in bucket %q, got counts: %+v", c.offset, c.bucket, report.Buckets)
		}
	}
}

// TestBuildARAgingTimeOfDayIgnored pins the calendar-day rule: a due date of
// 23:59 with an as-of time of 00:30 the next morning is exactly 1 day past due
// (the old elapsed-hours Floor math reported 0).
func TestBuildARAgingTimeOfDayIgnored(t *testing.T) {
	inv := models.Invoice{
		ID:            2,
		InvoiceNumber: "INV-2",
		ClientName:    "Client B",
		IssueDate:     time.Date(2026, 10, 10, 23, 59, 0, 0, time.UTC),
		DueDate:       time.Date(2026, 11, 11, 23, 59, 0, 0, time.UTC),
		TotalAmount:   models.NewMoney(250),
		AmountPaid:    models.NewMoney(0),
		BalanceDue:    models.NewMoney(250),
		Status:        "OVERDUE",
	}
	asOf := time.Date(2026, 11, 12, 0, 30, 0, 0, time.UTC)

	report := BuildARAgingData([]models.Invoice{inv}, asOf, models.NewMoney(250), 90)

	if report.Buckets[bucketIndex(t, report, "1 - 30 Days Overdue")].Count != 1 {
		t.Fatalf("expected invoice 1 day past due, got buckets: %+v", report.Buckets)
	}
	if report.Buckets[bucketIndex(t, report, "Current (Not Due)")].Count != 0 {
		t.Fatalf("expected zero current invoices, got %+v", report.Buckets)
	}
}

// TestBuildARAgingDueDateOnAsOfIsCurrent: an invoice due exactly on the as-of
// date (any time of day) is still within terms -> Current.
func TestBuildARAgingDueDateOnAsOfIsCurrent(t *testing.T) {
	inv := models.Invoice{
		ID:            3,
		InvoiceNumber: "INV-3",
		ClientName:    "Client C",
		IssueDate:     time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC),
		DueDate:       time.Date(2026, 11, 12, 9, 15, 0, 0, time.UTC),
		TotalAmount:   models.NewMoney(100),
		AmountPaid:    models.NewMoney(0),
		BalanceDue:    models.NewMoney(100),
		Status:        "SENT",
	}

	report := BuildARAgingData([]models.Invoice{inv}, arTestAsOf, models.NewMoney(100), 90)

	if report.Buckets[bucketIndex(t, report, "Current (Not Due)")].Count != 1 {
		t.Fatalf("invoice due on as-of date must be Current, got %+v", report.Buckets)
	}
	if report.TotalOverdue.Cents != 0 {
		t.Fatalf("expected $0 overdue, got %v", report.TotalOverdue)
	}
}

// TestBuildARAgingDSOAndDelinquency verifies DSO = Receivables/CreditSales x
// window and DelinquencyRate = Overdue/Receivables x 100, including the
// zero-credit-sales guard.
func TestBuildARAgingDSOAndDelinquency(t *testing.T) {
	invoices := []models.Invoice{
		arInv(1, "INV-1", "Client A", -40, 2500, 0, "OVERDUE"),   // $2,500 overdue
		arInv(2, "INV-2", "Client A", 10, 2000, 0, "SENT"),       // $2,000 current
		arInv(3, "INV-3", "Client B", -5, 1500, 500, "PARTIALLY_PAID"), // $1,000 overdue
	}

	report := BuildARAgingData(invoices, arTestAsOf, models.NewMoney(4500), 90)

	if report.TotalReceivables.Cents != 550000 {
		t.Errorf("expected total receivables $5,500, got %v", report.TotalReceivables)
	}
	if report.TotalOverdue.Cents != 350000 {
		t.Errorf("expected total overdue $3,500, got %v", report.TotalOverdue)
	}
	if report.TotalCurrent.Cents != 200000 {
		t.Errorf("expected total current $2,000, got %v", report.TotalCurrent)
	}
	// DSO = 5500 / 4500 * 90 = 110.0 days
	if report.DSODays != 110.0 {
		t.Errorf("expected DSO 110.0 days, got %v", report.DSODays)
	}
	// Delinquency = 3500 / 5500 * 100 = 63.6%
	if report.DelinquencyRate != 63.6 {
		t.Errorf("expected delinquency 63.6%%, got %v", report.DelinquencyRate)
	}

	// Zero credit sales -> DSO must be 0 (no divide-by-zero).
	zero := BuildARAgingData(invoices, arTestAsOf, models.NewMoney(0), 90)
	if zero.DSODays != 0 {
		t.Errorf("expected DSO 0 with no credit sales, got %v", zero.DSODays)
	}

	// No receivables -> delinquency 0.
	empty := BuildARAgingData(nil, arTestAsOf, models.NewMoney(1000), 90)
	if empty.DelinquencyRate != 0 || empty.TotalReceivables.Cents != 0 {
		t.Errorf("expected empty report with zero metrics, got %+v", empty)
	}
}

// TestBuildARAgingOldestDueDateIsMinAcrossAllInvoices pins that the client's
// oldest due date is the minimum across ALL open invoices (current included)
// and is independent of input slice order.
func TestBuildARAgingOldestDueDateIsMinAcrossAllInvoices(t *testing.T) {
	// Deliberately unsorted: future-due invoice first.
	invoices := []models.Invoice{
		arInv(2, "INV-2", "Client X", 12, 100, 0, "SENT"), // due +12 days (current)
		arInv(1, "INV-1", "Client X", -3, 200, 0, "OVERDUE"), // due -3 days
	}

	report := BuildARAgingData(invoices, arTestAsOf, models.NewMoney(300), 90)

	if len(report.Clients) != 1 {
		t.Fatalf("expected 1 client, got %+v", report.Clients)
	}
	want := arTestAsOf.AddDate(0, 0, -3).Format("2006-01-02")
	if report.Clients[0].OldestDueDate != want {
		t.Errorf("expected oldest due date %s, got %s", want, report.Clients[0].OldestDueDate)
	}
	if report.Clients[0].InvoiceCount != 2 {
		t.Errorf("expected 2 invoices for client, got %d", report.Clients[0].InvoiceCount)
	}
	if report.Clients[0].OverdueAmount.Cents != 20000 {
		t.Errorf("expected $200 overdue, got %v", report.Clients[0].OverdueAmount)
	}
	if report.Clients[0].CurrentAmount.Cents != 10000 {
		t.Errorf("expected $100 current, got %v", report.Clients[0].CurrentAmount)
	}
}

// TestBuildARAgingIntegerCentPrecision verifies receivable totals are exact in
// integer cents (no float drift): $0.10 + $0.20 == $0.30 exactly.
func TestBuildARAgingIntegerCentPrecision(t *testing.T) {
	invoices := []models.Invoice{
		arInv(1, "INV-1", "Tiny Co", -1, 0.10, 0, "OVERDUE"),
		arInv(2, "INV-2", "Tiny Co", -2, 0.20, 0, "OVERDUE"),
	}
	report := BuildARAgingData(invoices, arTestAsOf, models.NewMoney(0.30), 90)
	if report.TotalReceivables.Cents != 30 {
		t.Fatalf("expected exactly 30 cents, got %d", report.TotalReceivables.Cents)
	}
	if report.Buckets[bucketIndex(t, report, "1 - 30 Days Overdue")].TotalAmount.Cents != 30 {
		t.Fatalf("expected bucket total of 30 cents, got %v", report.Buckets)
	}
}

// TestARReceivableFallback pins the uncollected-balance derivation:
// prefer stored BalanceDue, fall back to Total-Paid, then Total.
func TestARReceivableFallback(t *testing.T) {
	// Stored balance present -> used as-is.
	if got := arReceivableFor(models.Invoice{
		TotalAmount: models.NewMoney(1000), AmountPaid: models.NewMoney(400), BalanceDue: models.NewMoney(500),
	}); got.Cents != 50000 {
		t.Errorf("expected stored balance 50000c, got %v", got)
	}
	// Stale zero balance with partial payment -> Total - Paid.
	if got := arReceivableFor(models.Invoice{
		TotalAmount: models.NewMoney(1000), AmountPaid: models.NewMoney(300), BalanceDue: models.NewMoney(0),
	}); got.Cents != 70000 {
		t.Errorf("expected fallback 70000c, got %v", got)
	}
	// Stale zero balance, nothing paid -> full Total.
	if got := arReceivableFor(models.Invoice{
		TotalAmount: models.NewMoney(1000), AmountPaid: models.NewMoney(0), BalanceDue: models.NewMoney(0),
	}); got.Cents != 100000 {
		t.Errorf("expected fallback 100000c, got %v", got)
	}
}

// TestInvoiceWritePathMoneyArithmetic pins PROPOSAL 2026-11-12-01:
// Integer-cent arithmetic on invoice write paths prevents float drift.
func TestInvoiceWritePathMoneyArithmetic(t *testing.T) {
	// 1. Repeated partial payments: 3 payments of $0.10 on a $0.30 invoice
	inv := models.Invoice{
		TotalAmount: models.NewMoney(0.30),
		AmountPaid:  models.NewMoney(0),
		BalanceDue:  models.NewMoney(0.30),
		Status:      "SENT",
	}

	payment := models.NewMoney(0.10)
	for i := 1; i <= 3; i++ {
		inv.AmountPaid = inv.AmountPaid.Add(payment)
		inv.BalanceDue = inv.TotalAmount.Sub(inv.AmountPaid)
	}

	if inv.BalanceDue.Cents != 0 {
		t.Errorf("Expected BalanceDue to be exactly 0 cents after 3x$0.10 payments, got %d cents", inv.BalanceDue.Cents)
	}
	if inv.AmountPaid.Cents != 30 {
		t.Errorf("Expected AmountPaid to be exactly 30 cents, got %d cents", inv.AmountPaid.Cents)
	}

	// 2. Tax rate calculation via PercentOf
	subtotal := models.NewMoney(100.00) // 10000 cents
	taxRate := 8.25                     // 8.25%
	tax := subtotal.PercentOf(taxRate)
	if tax.Cents != 825 {
		t.Errorf("Expected tax of 825 cents ($8.25), got %d cents", tax.Cents)
	}
	total := subtotal.Add(tax)
	if total.Cents != 10825 {
		t.Errorf("Expected total of 10825 cents ($108.25), got %d cents", total.Cents)
	}
}
