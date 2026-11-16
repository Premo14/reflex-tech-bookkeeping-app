package main

import (
	"errors"
	"testing"

	"reflex-tech-bookkeeping-app-api/utils"
)

func TestSeedDemoDataMain(t *testing.T) {
	origConnect := connectDBFn
	origReset := resetDemoDatasetFn
	origFatalf := fatalfFn
	defer func() {
		connectDBFn = origConnect
		resetDemoDatasetFn = origReset
		fatalfFn = origFatalf
	}()

	connected := false
	connectDBFn = func() { connected = true }

	// 1. Success path
	resetDemoDatasetFn = func() (utils.DemoDatasetStatus, error) {
		st := utils.DemoDatasetStatus{Active: true}
		st.Counts.Statements = 2
		st.Counts.Transactions = 10
		st.Counts.Expenses = 5
		st.Counts.Receipts = 4
		st.Counts.Invoices = 3
		return st, nil
	}
	failed := false
	fatalfFn = func(format string, v ...interface{}) {
		failed = true
	}

	main()
	if !connected || failed {
		t.Fatalf("expected connected=true and failed=false, got connected=%v failed=%v", connected, failed)
	}

	// 2. Error path
	resetDemoDatasetFn = func() (utils.DemoDatasetStatus, error) {
		return utils.DemoDatasetStatus{}, errors.New("seed failure")
	}
	main()
	if !failed {
		t.Fatal("expected fatalfFn to be invoked on ResetDemoDataset error")
	}
}
