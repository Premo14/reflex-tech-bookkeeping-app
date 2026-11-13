package controllers

import (
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestBuildVendorSpendData_ThresholdsAndGrouping(t *testing.T) {
	now := time.Now()

	items := []VendorSpendRawItem{
		// Vendor 1: $599.99 (just under 1099-NEC threshold)
		{
			Vendor:       "Acme Contractor",
			Description:  "Dev services",
			Amount:       models.Money{Cents: 59999},
			Timestamp:    now,
			CategoryCode: "5040",
			CategoryName: "Contract Labor",
		},
		// Vendor 2: $600.00 (exactly at 1099-NEC threshold)
		{
			Vendor:       "Beta Freelance",
			Description:  "Graphic design",
			Amount:       models.Money{Cents: 60000},
			Timestamp:    now,
			CategoryCode: "5040",
			CategoryName: "Contract Labor",
		},
		// Vendor 3: Multiple entries with varying case and description fallback
		{
			Vendor:       "Gamma Consulting",
			Description:  "Advisory pass 1",
			Amount:       models.Money{Cents: 40000},
			Timestamp:    now.Add(-24 * time.Hour),
			CategoryCode: "5050",
			CategoryName: "Professional Fees",
		},
		{
			Vendor:       "gamma consulting ", // case insensitive + whitespace
			Description:  "Advisory pass 2",
			Amount:       models.Money{Cents: 30000},
			Timestamp:    now,
			CategoryCode: "5050",
			CategoryName: "Professional Fees",
		},
		// Vendor 4: Empty vendor, fallback to description
		{
			Vendor:       "",
			Description:  "AWS Cloud Hosting",
			Amount:       models.Money{Cents: 15000},
			Timestamp:    now,
			CategoryCode: "5010",
			CategoryName: "Software & SaaS",
		},
		// Vendor 5: Debit with negative amount (must use absolute value)
		{
			Vendor:       "Office Depot",
			Description:  "Supplies purchase",
			Amount:       models.Money{Cents: -12550}, // -$125.50
			Timestamp:    now,
			CategoryCode: "5020",
			CategoryName: "Office Supplies",
		},
	}

	report := BuildVendorSpendData(VendorSpendBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-12-31",
		Items:     items,
	})

	// Total spend: 599.99 + 600.00 + 400.00 + 300.00 + 150.00 + 125.50 = 2175.49
	if report.TotalSpend.Cents != 217549 {
		t.Errorf("Expected TotalSpend 217549 cents, got %d", report.TotalSpend.Cents)
	}
	if report.TotalVendors != 5 {
		t.Errorf("Expected 5 total vendors, got %d", report.TotalVendors)
	}

	// Vendor spend ranking:
	// 1. Gamma Consulting: 400 + 300 = 700.00 (70000 cents) -> Requires1099 = true
	// 2. Beta Freelance: 600.00 (60000 cents) -> Requires1099 = true
	// 3. Acme Contractor: 599.99 (59999 cents) -> Requires1099 = false
	// 4. AWS Cloud Hosting: 150.00 (15000 cents) -> Requires1099 = false
	// 5. Office Depot: 125.50 (12550 cents) -> Requires1099 = false
	if len(report.Vendors) != 5 {
		t.Fatalf("Expected 5 vendors in list, got %d", len(report.Vendors))
	}

	if report.Vendors[0].VendorName != "Gamma Consulting" || report.Vendors[0].TotalSpend.Cents != 70000 || !report.Vendors[0].Requires1099 {
		t.Errorf("Vendor 0 mismatch: %+v", report.Vendors[0])
	}
	if report.Vendors[0].TransactionCount != 2 || report.Vendors[0].AverageSpend.Cents != 35000 {
		t.Errorf("Vendor 0 count/avg mismatch: count=%d avg=%d", report.Vendors[0].TransactionCount, report.Vendors[0].AverageSpend.Cents)
	}

	if report.Vendors[1].VendorName != "Beta Freelance" || report.Vendors[1].TotalSpend.Cents != 60000 || !report.Vendors[1].Requires1099 {
		t.Errorf("Vendor 1 mismatch: %+v", report.Vendors[1])
	}

	if report.Vendors[2].VendorName != "Acme Contractor" || report.Vendors[2].TotalSpend.Cents != 59999 || report.Vendors[2].Requires1099 {
		t.Errorf("Vendor 2 mismatch: %+v", report.Vendors[2])
	}

	if report.Vendors[3].VendorName != "AWS Cloud Hosting" || report.Vendors[3].TotalSpend.Cents != 15000 || report.Vendors[3].Requires1099 {
		t.Errorf("Vendor 3 mismatch: %+v", report.Vendors[3])
	}

	if report.Vendors[4].VendorName != "Office Depot" || report.Vendors[4].TotalSpend.Cents != 12550 || report.Vendors[4].Requires1099 {
		t.Errorf("Vendor 4 mismatch: %+v", report.Vendors[4])
	}

	// 1099 metrics:
	// Contractors >= 600: Gamma Consulting ($700) + Beta Freelance ($600) = 2
	if report.ContractorsOver600 != 2 {
		t.Errorf("Expected ContractorsOver600=2, got %d", report.ContractorsOver600)
	}
	// Total 1099 spend: 70000 + 60000 = 130000 cents ($1300.00)
	if report.Total1099Spend.Cents != 130000 {
		t.Errorf("Expected Total1099Spend=130000 cents, got %d", report.Total1099Spend.Cents)
	}

	// All 5 vendors constitute 100% of top 5 spend
	if report.Top5Percent != 100.0 {
		t.Errorf("Expected Top5Percent=100.0, got %f", report.Top5Percent)
	}
}

func TestBuildVendorSpendData_EmptyAndZero(t *testing.T) {
	report := BuildVendorSpendData(VendorSpendBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-12-31",
		Items:     nil,
	})

	if report.TotalSpend.Cents != 0 {
		t.Errorf("Expected TotalSpend=0, got %d", report.TotalSpend.Cents)
	}
	if report.TotalVendors != 0 {
		t.Errorf("Expected TotalVendors=0, got %d", report.TotalVendors)
	}
	if report.Top5Percent != 0.0 {
		t.Errorf("Expected Top5Percent=0.0, got %f", report.Top5Percent)
	}
	if len(report.Vendors) != 0 {
		t.Errorf("Expected empty Vendors list, got %d", len(report.Vendors))
	}
	if report.ContractorsOver600 != 0 {
		t.Errorf("Expected ContractorsOver600=0, got %d", report.ContractorsOver600)
	}
	if report.Total1099Spend.Cents != 0 {
		t.Errorf("Expected Total1099Spend=0, got %d", report.Total1099Spend.Cents)
	}
}
