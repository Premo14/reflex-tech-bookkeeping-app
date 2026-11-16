package controllers

import (
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestValidateAccountForRole(t *testing.T) {
	tests := []struct {
		name         string
		acc          *models.ChartAccount
		allowedTypes []string
		wantErr      bool
	}{
		{
			name:         "Nil account is permitted (optional field)",
			acc:          nil,
			allowedTypes: []string{"ASSET", "LIABILITY"},
			wantErr:      false,
		},
		{
			name: "Active ASSET matches ASSET/LIABILITY",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Checking",
				Type:   "ASSET",
				Active: true,
			},
			allowedTypes: []string{"ASSET", "LIABILITY"},
			wantErr:      false,
		},
		{
			name: "Active LIABILITY matches ASSET/LIABILITY",
			acc: &models.ChartAccount{
				Code:   "2020",
				Name:   "Credit Card",
				Type:   "LIABILITY",
				Active: true,
			},
			allowedTypes: []string{"ASSET", "LIABILITY"},
			wantErr:      false,
		},
		{
			name: "Inactive account is always rejected",
			acc: &models.ChartAccount{
				Code:   "1010",
				Name:   "Old Checking",
				Type:   "ASSET",
				Active: false,
			},
			allowedTypes: []string{"ASSET", "LIABILITY"},
			wantErr:      true,
		},
		{
			name: "Mismatched type (EXPENSE when ASSET/LIABILITY allowed) is rejected",
			acc: &models.ChartAccount{
				Code:   "5010",
				Name:   "Office Supplies",
				Type:   "EXPENSE",
				Active: true,
			},
			allowedTypes: []string{"ASSET", "LIABILITY"},
			wantErr:      true,
		},
		{
			name: "Active EXPENSE matches EXPENSE/REVENUE",
			acc: &models.ChartAccount{
				Code:   "5110",
				Name:   "Legal Fees",
				Type:   "EXPENSE",
				Active: true,
			},
			allowedTypes: []string{"EXPENSE", "REVENUE"},
			wantErr:      false,
		},
		{
			name: "Active REVENUE matches EXPENSE/REVENUE",
			acc: &models.ChartAccount{
				Code:   "4010",
				Name:   "Product Sales",
				Type:   "REVENUE",
				Active: true,
			},
			allowedTypes: []string{"EXPENSE", "REVENUE"},
			wantErr:      false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateAccountForRole(tc.acc, tc.allowedTypes...)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateAccountForRole() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestValidateCreateAndLinkRoles(t *testing.T) {
	activeChecking := &models.ChartAccount{
		Code:   "1010",
		Name:   "Checking Account",
		Type:   "ASSET",
		Active: true,
	}
	inactiveChecking := &models.ChartAccount{
		Code:   "1010",
		Name:   "Checking Account",
		Type:   "ASSET",
		Active: false,
	}
	activeCreditCard := &models.ChartAccount{
		Code:   "2020",
		Name:   "Credit Card",
		Type:   "LIABILITY",
		Active: true,
	}
	activeExpense := &models.ChartAccount{
		Code:   "5110",
		Name:   "Professional Services",
		Type:   "EXPENSE",
		Active: true,
	}
	inactiveExpense := &models.ChartAccount{
		Code:   "5110",
		Name:   "Professional Services",
		Type:   "EXPENSE",
		Active: false,
	}

	tests := []struct {
		name     string
		itemType string
		bankAcc  *models.ChartAccount
		catAcc   *models.ChartAccount
		wantErr  bool
	}{
		{
			name:     "Receipt type: valid ASSET bank account with no category succeeds",
			itemType: "receipt",
			bankAcc:  activeChecking,
			catAcc:   nil,
			wantErr:  false,
		},
		{
			name:     "Receipt type: valid LIABILITY credit card with EXPENSE category succeeds",
			itemType: "receipt",
			bankAcc:  activeCreditCard,
			catAcc:   activeExpense,
			wantErr:  false,
		},
		{
			name:     "Receipt type: missing bank account fails",
			itemType: "receipt",
			bankAcc:  nil,
			catAcc:   activeExpense,
			wantErr:  true,
		},
		{
			name:     "Receipt type: inactive bank account fails",
			itemType: "receipt",
			bankAcc:  inactiveChecking,
			catAcc:   activeExpense,
			wantErr:  true,
		},
		{
			name:     "Receipt type: inactive category account fails",
			itemType: "receipt",
			bankAcc:  activeChecking,
			catAcc:   inactiveExpense,
			wantErr:  true,
		},
		{
			name:     "Receipt type: bank account cannot be EXPENSE",
			itemType: "receipt",
			bankAcc:  activeExpense,
			catAcc:   activeExpense,
			wantErr:  true,
		},
		{
			name:     "Transaction type: active EXPENSE category succeeds",
			itemType: "transaction",
			bankAcc:  nil,
			catAcc:   activeExpense,
			wantErr:  false,
		},
		{
			name:     "Transaction type: inactive category fails",
			itemType: "transaction",
			bankAcc:  nil,
			catAcc:   inactiveExpense,
			wantErr:  true,
		},
		{
			name:     "Transaction type: ASSET account cannot be expense category",
			itemType: "transaction",
			bankAcc:  nil,
			catAcc:   activeChecking,
			wantErr:  true,
		},
		{
			name:     "Unknown item type fails",
			itemType: "invoice",
			bankAcc:  activeChecking,
			catAcc:   activeExpense,
			wantErr:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateCreateAndLinkRoles(tc.itemType, tc.bankAcc, tc.catAcc)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateCreateAndLinkRoles() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
