package controllers

import (
	"time"

	"gorm.io/gorm"
)

// Shared SQL fragments describing which rows are "in the books".
// Rows with PENDING (awaiting closed-period review) or IGNORED (excluded) review status
// never contribute to totals, reports, or reconciliation. Legacy rows with an empty
// review status are treated as approved.
const (
	inBooksClause      = "(review_status IS NULL OR review_status = '' OR review_status = 'APPROVED' OR review_status = 'WARNINGS_IGNORED')"
	inBooksClauseBT    = "(bt.review_status IS NULL OR bt.review_status = '' OR bt.review_status = 'APPROVED' OR bt.review_status = 'WARNINGS_IGNORED')"
	inBooksClauseExpAS = "(e.review_status IS NULL OR e.review_status = '' OR e.review_status = 'APPROVED' OR e.review_status = 'WARNINGS_IGNORED')"
)

// Shared fragments used wherever "needs attention" is decided, so the Action Required list,
// the dashboard summary and the close preflight can never disagree.
//   - notCashClause: cash expenses never need a bank link (case-insensitive, NULL-safe).
//   - unbalancedClause: anything that is not BALANCED, including rows never evaluated (NULL).
const (
	notCashClause        = "LOWER(COALESCE(tender, '')) != 'cash'"
	unbalancedClause     = "(allocation_status IS NULL OR allocation_status != 'BALANCED')"
	needsAttentionClause = "(allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')"
)

// ApplyDateRange applies an inclusive calendar-day date range to a query.
// When endDate is in "YYYY-MM-DD" format, it creates a half-open interval `< nextDay`
// (e.g. `endDate = 2026-10-31` becomes `< 2026-11-01`), ensuring that all transactions
// timestamped during that calendar day (such as 12:00:00 UTC) are included.
func ApplyDateRange(query *gorm.DB, colName, startDate, endDate string) *gorm.DB {
	if startDate != "" {
		query = query.Where(colName+" >= ?", startDate)
	}
	if endDate != "" {
		if t, err := time.Parse("2006-01-02", endDate); err == nil {
			nextDay := t.AddDate(0, 0, 1).Format("2006-01-02")
			query = query.Where(colName+" < ?", nextDay)
		} else {
			query = query.Where(colName+" <= ?", endDate)
		}
	}
	return query
}
