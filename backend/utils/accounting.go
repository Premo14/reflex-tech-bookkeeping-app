package utils

// accounting.go previously contained GetOrCreateAccountingPeriod, which auto-created
// a monthly accounting period whenever a file was imported. This function has been
// removed as part of the flexible statement periods redesign.
//
// Periods are now user-defined date ranges created manually via the API.
// Transactions and expenses are imported freely without auto-period assignment —
// they are always visible in the "All Periods" view and appear in any period
// whose date range covers their date.
//
// See: controllers/accountingController.go for period CRUD endpoints.
