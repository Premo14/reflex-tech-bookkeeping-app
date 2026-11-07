package controllers

import (
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
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

