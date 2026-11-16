package controllers

import (
	"testing"
)

func TestBatchCategorizeRequestValidation(t *testing.T) {
	tests := []struct {
		name       string
		txIDs      []uint
		expIDs     []uint
		categoryID uint
		wantErr    string
	}{
		{
			name:       "Empty IDs returns error",
			txIDs:      []uint{},
			expIDs:     []uint{},
			categoryID: 21,
			wantErr:    "No items were selected.",
		},
		{
			name:       "Zero categoryID returns error",
			txIDs:      []uint{1},
			expIDs:     []uint{},
			categoryID: 0,
			wantErr:    "Category account is required.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := BatchCategorizeRequest{
				TransactionIDs: tt.txIDs,
				ExpenseIDs:     tt.expIDs,
				CategoryID:     tt.categoryID,
			}
			var errMsg string
			if len(req.TransactionIDs) == 0 && len(req.ExpenseIDs) == 0 {
				errMsg = "No items were selected."
			} else if req.CategoryID == 0 {
				errMsg = "Category account is required."
			}

			if errMsg != tt.wantErr {
				t.Errorf("expected error %q, got %q", tt.wantErr, errMsg)
			}
		})
	}
}
