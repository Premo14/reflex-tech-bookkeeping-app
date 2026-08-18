package main

import (
	"fmt"
	"log"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
)

func parseDate(d string) time.Time {
	t, _ := time.Parse("2006-01-02", d)
	return t
}

func main() {
	db.Connect()

	log.Println("Wiping database tables...")
	if err := db.DB.Exec("TRUNCATE TABLE accounting_periods, expenses, receipts, bank_statements, bank_transactions CASCADE;").Error; err != nil {
		log.Fatalf("Failed to truncate tables: %v", err)
	}

	log.Println("Seeding mock expenses and receipts...")

	type mockData struct {
		Date   string
		Vendor string
		Amount float64
		Tender string
	}

	expenses := []mockData{
		// ---- JULY EXACT MATCHES ----
		{"2026-07-21", "CAPITAL ONE", 1040.84, "ach"},
		{"2026-07-21", "PEACOCKTV.COM", 10.99, "visa"},
		{"2026-07-21", "SPECTRUM", 110.00, "ach"},
		{"2026-07-22", "VENMO *Joseph Ianaconi", 15.00, "visa"},
		{"2026-07-22", "NGRID36WEB", 109.36, "ach"},
		{"2026-07-25", "VENMO *Courtney Dumas", 65.00, "visa"},
		{"2026-07-27", "SPECTRUM", 10.00, "ach"},
		{"2026-07-28", "CAPITAL ONE", 16.50, "ach"},

		// ---- AUGUST EXACT MATCHES ----
		{"2026-08-03", "METAPAY*Carol Phil Edw", 475.00, "visa"},
		{"2026-08-04", "FNB OF SCOTIA", 553.91, "ach"},
		{"2026-08-05", "NGRID36WEB", 36.88, "ach"},
		{"2026-08-07", "ARFCU CK WEBXFR", 218.10, "ach"},
		{"2026-08-07", "Nyx*A.W", 2.60, "visa"},
		{"2026-08-08", "PIT STOP DIN", 62.50, "visa"},
		{"2026-08-14", "DOLLAR GENERAL", 9.45, "visa"},
		{"2026-08-14", "CAPITAL ONE", 1029.50, "ach"},
		{"2026-08-14", "Nyx*A.W", 1.85, "visa"},

		// ---- SOFT LINKS (Partial Matches - Amount slightly off) ----
		{"2026-07-25", "METAPAY*Shannon Genawa", 25.00, "visa"}, // Tx is 20.00
		{"2026-08-08", "Kindle Unltd", 10.00, "visa"},             // Tx is 11.99
		{"2026-08-14", "MCDONALDS", 4.00, "visa"},                 // Tx is 3.88

		// ---- ORPHANED (No matching transactions in OFX) ----
		{"2026-07-15", "LOWES", 25.00, "visa"},
		{"2026-07-28", "HOME DEPOT", 45.00, "visa"},
		{"2026-08-02", "STAPLES", 12.99, "visa"},
		{"2026-08-10", "USPS", 8.50, "visa"},
		{"2026-08-11", "AMAZON", 50.00, "visa"},

		// ---- CASH EXPENSES ----
		{"2026-08-12", "FARMERS MARKET", 15.00, "cash"},
		{"2026-08-15", "TIPS", 5.00, "cash"},
	}

	for _, e := range expenses {
		expense := models.Expense{
			Timestamp:   parseDate(e.Date),
			Vendor:      e.Vendor,
			Description: e.Vendor + " Purchase",
			Amount:      e.Amount,
			Tender:      e.Tender,
		}

		if err := db.DB.Create(&expense).Error; err != nil {
			log.Printf("Failed to create expense %v: %v", expense.Vendor, err)
		}

		// Create a mock receipt for the expense
		receipt := models.Receipt{
			ExpenseID:   &expense.ID,
			DocumentURI: fmt.Sprintf("/documents/processed/mock_%d.png", expense.ID),
			FileExt:     ".png",
			FileHash:    fmt.Sprintf("mock-hash-%d", expense.ID), // unique hash for mock
		}

		if err := db.DB.Create(&receipt).Error; err != nil {
			log.Printf("Failed to create receipt for %v: %v", expense.Vendor, err)
		}
	}

	log.Println("Seed completed successfully!")
}
