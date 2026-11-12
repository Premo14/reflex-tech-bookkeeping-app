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
			account:  models.ChartAccount{Code: "5810", Name: "Home Office Workspace", Type: "EXPENSE"},
			wantLine: "Line 30",
			wantPct:  100.0,
		},
		{
			name:     "Revenue interest fallback to Line 6",
			account:  models.ChartAccount{Code: "4210", Name: "Interest Income", Type: "REVENUE"},
			wantLine: "Line 6",
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
