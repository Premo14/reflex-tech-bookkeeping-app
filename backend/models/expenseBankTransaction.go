package models

import "time"

/*
	expense_bank_transaction

a join table between expenses and bank transactions
*/

type ExpenseBankTransaction struct {
	// Composite primary key — one row per unique expense+transaction pair.
	// The gorm:"primaryKey" tag on both fields is what tells GORM to treat them
	// as a composite PK rather than separate auto-increment PKs.
	ExpenseID         uint `gorm:"primaryKey" json:"expenseID"`
	BankTransactionID uint `gorm:"primaryKey" json:"bankTransactionID"`

	// "suggested" = scoring system's best guess, awaiting user confirmation.
	// "confirmed" = user accepted the link, or auto-matched with high confidence.
	Status string `gorm:"not null" json:"status"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
