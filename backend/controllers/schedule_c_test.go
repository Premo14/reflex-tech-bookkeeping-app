package controllers

import "testing"

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
