package controllers

import (
	"reflex-tech-bookkeeping-app-api/models"
	"testing"
)

func TestScheduleCIncomeTreatmentRequiresExactLineNumber(t *testing.T) {
	tests := []struct {
		line string
		want string
	}{
		{line: "Line 1", want: "gross_receipts"},
		{line: "Line 2", want: "returns_and_allowances"},
		{line: "Line 4", want: "cost_of_goods_sold"},
		{line: "Line 6", want: "other_income"},
	}

	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			got, ok := scheduleCIncomeTreatmentForLine(tt.line)
			if !ok || got != tt.want {
				t.Fatalf("scheduleCIncomeTreatmentForLine(%q) = (%q, %t), want (%q, true)", tt.line, got, ok, tt.want)
			}
		})
	}
}

func TestScheduleCIncomeTreatmentDoesNotMatchLineNumberSubstrings(t *testing.T) {
	for _, line := range []string{"Line 21", "Line 26", "Line 27a"} {
		t.Run(line, func(t *testing.T) {
			if got, ok := scheduleCIncomeTreatmentForLine(line); ok {
				t.Fatalf("scheduleCIncomeTreatmentForLine(%q) = (%q, true), want unsupported line", line, got)
			}
		})
	}
}

func TestResolveScheduleCLineFallback(t *testing.T) {
	tests := []struct {
		name     string
		account  models.ChartAccount
		wantLine string
		wantPct  float64
	}{
		{
			name:     "Explicit Schedule C Line takes precedence",
			account:  models.ChartAccount{Name: "General Stuff", ScheduleCLine: "Line 18 - Office expense"},
			wantLine: "Line 18",
			wantPct:  100.0,
		},
		{
			name:     "Vehicle / mileage fallback to Line 9",
			account:  models.ChartAccount{Code: "5510", Name: "Business Auto Mileage & Gas", Type: "EXPENSE"},
			wantLine: "Line 9",
			wantPct:  100.0,
		},
		{
			name:     "Repairs fallback to Line 21",
			account:  models.ChartAccount{Code: "5040", Name: "Equipment Maintenance & Repair", Type: "EXPENSE"},
			wantLine: "Line 21",
			wantPct:  100.0,
		},
		{
			name:     "Supplies fallback to Line 22",
			account:  models.ChartAccount{Code: "5060", Name: "Packaging Supplies", Type: "EXPENSE"},
			wantLine: "Line 22",
			wantPct:  100.0,
		},
		{
			name:     "Contract labor fallback to Line 11",
			account:  models.ChartAccount{Code: "5120", Name: "Freelance Developers & Contractors", Type: "EXPENSE"},
			wantLine: "Line 11",
			wantPct:  100.0,
		},
		{
			name:     "Meals 50% limit",
			account:  models.ChartAccount{Code: "5090", Name: "Client Lunch Meals", Type: "EXPENSE"},
			wantLine: "Line 24b",
			wantPct:  50.0,
		},
		{
			name:     "Home office fallback to Line 30",
			account:  models.ChartAccount{Code: "5070", Name: "Home Office Workspace", Type: "EXPENSE"},
			wantLine: "Line 30",
			wantPct:  100.0,
		},
		{
			name:     "Revenue interest fallback to Line 6",
			account:  models.ChartAccount{Code: "4210", Name: "Interest Income", Type: "REVENUE"},
			wantLine: "Line 6",
			wantPct:  100.0,
		},
		{
			name:     "Revenue returns and allowances fallback to Line 2",
			account:  models.ChartAccount{Code: "4090", Name: "Customer Refunds & Returns", Type: "REVENUE"},
			wantLine: "Line 2",
			wantPct:  100.0,
		},
		{
			name:     "Cost of goods sold fallback to Line 4",
			account:  models.ChartAccount{Code: "5000", Name: "Direct Materials & COGS", Type: "EXPENSE"},
			wantLine: "Line 4",
			wantPct:  100.0,
		},
		{
			name:     "Equipment rental & lease fallback to Line 20a",
			account:  models.ChartAccount{Code: "5015", Name: "Machinery Rental", Type: "EXPENSE"},
			wantLine: "Line 20a",
			wantPct:  100.0,
		},
		{
			name:     "Employee benefits fallback to Line 14",
			account:  models.ChartAccount{Code: "5025", Name: "Staff Health Insurance & Benefits", Type: "EXPENSE"},
			wantLine: "Line 14",
			wantPct:  100.0,
		},
		{
			name:     "Taxes & licenses fallback to Line 23",
			account:  models.ChartAccount{Code: "5610", Name: "State Business Registration & Permits", Type: "EXPENSE"},
			wantLine: "Line 23",
			wantPct:  100.0,
		},
		{
			name:     "Interest expense fallback to Line 16b",
			account:  models.ChartAccount{Code: "5710", Name: "Credit Card & Loan Interest", Type: "EXPENSE"},
			wantLine: "Line 16b",
			wantPct:  100.0,
		},
		{
			name:     "Depreciation & section 179 fallback to Line 13",
			account:  models.ChartAccount{Code: "5720", Name: "Equipment Depreciation Writeoff", Type: "EXPENSE"},
			wantLine: "Line 13",
			wantPct:  100.0,
		},
		{
			name:     "Merchant and processing fees fallback to Line 10",
			account:  models.ChartAccount{Code: "5810", Name: "Credit Card Processing Fees", Type: "EXPENSE"},
			wantLine: "Line 10",
			wantPct:  100.0,
		},
		{
			name:     "Software & subscriptions fallback to Line 27a",
			account:  models.ChartAccount{Code: "5210", Name: "Cloud SaaS Subscriptions", Type: "EXPENSE"},
			wantLine: "Line 27a",
			wantPct:  100.0,
		},
		{
			name:     "Bank fees fallback to Line 27a",
			account:  models.ChartAccount{Code: "5910", Name: "Wire & Monthly Maintenance Fees", Type: "EXPENSE"},
			wantLine: "Line 27a",
			wantPct:  100.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotLine, _, gotPct := resolveScheduleCLine(tt.account)
			if gotLine != tt.wantLine || gotPct != tt.wantPct {
				t.Fatalf("resolveScheduleCLine(%+v) = (%q, %v), want (%q, %v)", tt.account, gotLine, gotPct, tt.wantLine, tt.wantPct)
			}
		})
	}
}
