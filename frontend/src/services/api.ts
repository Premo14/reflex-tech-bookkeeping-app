import type { AccountingPeriod, BankTransaction, CloseAccountingPeriodResponse, FileUploadResponse, FlaggedItems, FlaggedItemsFilters, LinkExpenseResponse, MarkExpenseAsCashResponse, TransactionFilters, Expense } from "../types/models";

const API_BASE = "http://localhost:8080/api";

// ---------------------------------------------------------
// accounting periods
// ---------------------------------------------------------

export async function getAccountingPeriods(): Promise<AccountingPeriod[]> {
  const res = await fetch(`${API_BASE}/accounting-periods`)

  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }

  const data = await res.json()
  return data.accountPeriods || []
}

export async function closeAccountingPeriod(periodId: number): Promise<CloseAccountingPeriodResponse> {
  const res = await  fetch(`${API_BASE}/accounting-periods/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ periodId: periodId })
  })

  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }

  return res.json()
}

// ---------------------------------------------------------
// transactions & expenses
// ---------------------------------------------------------

export async function getTransactions(
  filters: TransactionFilters = {}
): Promise<BankTransaction[]> {
  const params = new URLSearchParams()

  if (filters.year !== undefined) {
    params.set("year", filters.year.toString())
  }

  if (filters.month !== undefined) {
    params.set("month", filters.month.toString())
  }

  if (filters.search !== undefined) {
    params.set("search", filters.search)
  }

  const url = params
    ? `${API_BASE}/transactions?${params}`
    : `${API_BASE}/transactions`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }

  const data = await res.json()
  return data.transactions || []
}

// ---------------------------------------------------------
// reconciliation (flagged items)
// ---------------------------------------------------------

export async function getFlaggedItems(
  filters: FlaggedItemsFilters = {}
): Promise<FlaggedItems> {
  const params = new URLSearchParams()

  if (filters.year !== undefined) {
    params.set("year", filters.year.toString())
  }

  if (filters.month !== undefined) {
    params.set("month", filters.month.toString())
  }

  const url = params
    ? `${API_BASE}/reconciliation/flagged?${params}`
    : `${API_BASE}/reconciliation/flagged`

  const res = await fetch(url)
  
    if (!res.ok) {
      throw new Error(`Response status: ${res.status}`)
    }

  return res.json();
}

export async function linkExpenseToTransaction(expenseId: number, transactionId: number): Promise<LinkExpenseResponse> {
  const res = await fetch(`${API_BASE}/reconciliation/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({expenseId, transactionId})
  })

  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }

  return res.json()
}

export async function unlinkExpenseFromTransaction(expenseId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/reconciliation/unlink`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({expenseId})
  })

  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }
}

export async function markExpenseAsCash(expenseId: number): Promise<MarkExpenseAsCashResponse> {
  const res = await fetch(
    `${API_BASE}/reconciliation/cash/${expenseId}`,
    {
      method: "PATCH",
    }
  )

  if (!res.ok) {
    throw new Error(`Response status: ${res.status}`)
  }

  	return res.json()
}

// ---------------------------------------------------------
// crud details
// ---------------------------------------------------------

export async function getTransaction(id: number): Promise<BankTransaction> {
  const res = await fetch(`${API_BASE}/transactions/${id}`)
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
  const data = await res.json()
  return data.transaction
}

export async function updateTransaction(id: number, updates: Partial<BankTransaction>): Promise<BankTransaction> {
  const res = await fetch(`${API_BASE}/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  })
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
  const data = await res.json()
  return data.transaction
}

export async function deleteTransaction(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/transactions/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
}

export async function getExpense(id: number): Promise<Expense> {
  const res = await fetch(`${API_BASE}/expenses/${id}`)
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
  const data = await res.json()
  return data.expense
}

export async function updateExpense(id: number, updates: Partial<Expense>): Promise<Expense> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  })
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
  const data = await res.json()
  return data.expense
}

export async function deleteExpense(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
}

export async function getUnlinkedItems(): Promise<{ transactions: BankTransaction[], expenses: Expense[] }> {
  const res = await fetch(`${API_BASE}/reconciliation/unlinked`)
  if (!res.ok) throw new Error(`Response status: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------
// file uploads
// ---------------------------------------------------------

export async function uploadFile(file: File): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file)

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData
  })

  return res.json()
}
