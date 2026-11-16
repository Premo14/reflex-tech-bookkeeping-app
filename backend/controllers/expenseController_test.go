package controllers

import (
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestValidateExpenseCategory(t *testing.T) {
	tests := []struct {
		name    string
		acc     *models.ChartAccount
		wantErr bool
	}{
		{
			name:    "Nil category account is valid (optional field)",
			acc:     nil,
			wantErr: false,
		},
		{
			name: "Active EXPENSE account (Office Supplies) is valid",
			acc: &models.ChartAccount{
				Code:   "5050",
				Name:   "Office Supplies",
				Type:   "EXPENSE",
				Active: true,
			},
			wantErr: false,
		},
		{
			name: "Active EXPENSE account (Rent) is valid",
			acc: &models.ChartAccount{
				Code:   "5010",
				Name:   "Rent",
				Type:   "EXPENSE",
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
			name: "Active REVENUE account is rejected for expense category",
			acc: &models.ChartAccount{
				Code:   "4010",
				Name:   "Sales Revenue",
				Type:   "REVENUE",
				Active: true,
			},
			wantErr: true,
		},
		{
			name: "Active ASSET account is rejected for expense category",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Checking Account",
				Type:   "ASSET",
				Active: true,
			},
			wantErr: true,
		},
		{
			name: "Active LIABILITY account is rejected for expense category",
			acc: &models.ChartAccount{
				Code:   "2020",
				Name:   "Credit Card",
				Type:   "LIABILITY",
				Active: true,
			},
			wantErr: true,
		},
		{
			name: "Active EQUITY account is rejected for expense category",
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
			err := ValidateExpenseCategory(tc.acc)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateExpenseCategory() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
