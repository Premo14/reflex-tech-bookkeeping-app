package controllers

// Shared SQL fragments describing which rows are "in the books".
// Rows with PENDING (awaiting closed-period review) or IGNORED (excluded) review status
// never contribute to totals, reports, or reconciliation. Legacy rows with an empty
// review status are treated as approved.
const (
	inBooksClause      = "(review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')"
	inBooksClauseBT    = "(bt.review_status IS NULL OR bt.review_status = '' OR bt.review_status = 'APPROVED')"
	inBooksClauseExpAS = "(e.review_status IS NULL OR e.review_status = '' OR e.review_status = 'APPROVED')"
)
