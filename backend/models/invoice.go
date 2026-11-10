package models

import (
	"time"
)

// Invoice represents a lightweight client invoice for solopreneurs and freelancers.
type Invoice struct {
	ID                uint             `gorm:"primaryKey;autoIncrement" json:"id"`
	InvoiceNumber     string           `gorm:"size:50;not null;uniqueIndex" json:"invoiceNumber"`
	ClientName        string           `gorm:"size:255;not null" json:"clientName"`
	ClientEmail       string           `gorm:"size:255" json:"clientEmail"`
	ClientAddress     string           `gorm:"type:text" json:"clientAddress"`
	IssueDate         time.Time        `gorm:"not null" json:"issueDate"`
	DueDate           time.Time        `gorm:"not null" json:"dueDate"`
	Items             string           `gorm:"type:text" json:"items"` // JSON encoded line items [{description, quantity, unitPrice, amount}]
	Subtotal          float64          `gorm:"type:decimal(12,2);not null;default:0" json:"subtotal"`
	TaxRate           float64          `gorm:"type:decimal(5,2);default:0" json:"taxRate"`
	TaxAmount         float64          `gorm:"type:decimal(12,2);default:0" json:"taxAmount"`
	TotalAmount       float64          `gorm:"type:decimal(12,2);not null;default:0" json:"totalAmount"`
	AmountPaid        float64          `gorm:"type:decimal(12,2);not null;default:0" json:"amountPaid"`
	BalanceDue        float64          `gorm:"type:decimal(12,2);not null;default:0" json:"balanceDue"`
	Notes             string           `gorm:"type:text" json:"notes"`
	PaymentTerms      string           `gorm:"size:100;default:'Net 30'" json:"paymentTerms"`
	Status            string           `gorm:"size:30;not null;default:'DRAFT'" json:"status"` // DRAFT, SENT, PARTIALLY_PAID, PAID, OVERDUE, VOID
	PaidDate          *time.Time       `json:"paidDate"`
	BankTransactionID *uint            `gorm:"index" json:"bankTransactionId"`
	BankTransaction   *BankTransaction `gorm:"foreignKey:BankTransactionID" json:"bankTransaction"`
	CategoryAccountID *uint            `gorm:"index" json:"categoryAccountId"`
	CategoryAccount   *ChartAccount    `gorm:"foreignKey:CategoryAccountID" json:"categoryAccount"`
	CreatedAt         time.Time        `json:"createdAt"`
	UpdatedAt         time.Time        `json:"updatedAt"`
}

type InvoiceLineItem struct {
	Description string  `json:"description"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unitPrice"`
	Amount      float64 `json:"amount"`
}
