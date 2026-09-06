# Backend Service (Go)

The backend service is the central nervous system of the Reflex Tech Bookkeeping App. It is built in Go using the Fiber framework and handles API routing, database interactions, and the core reconciliation engine.

## Key Responsibilities
- **File Watcher**: Monitors the `inbox/` folder using `fsnotify` for new receipts or bank statements.
- **Data Persistence**: Uses PostgreSQL (via GORM) to store `Receipt`, `Expense`, and `BankTransaction` records.
- **Reconciliation Engine**: Runs a multi-pass algorithm to automatically match uploaded expenses to bank transactions.
- **API Server**: Serves the REST API consumed by the React frontend.

## Development
This service is fully containerized. The local development environment uses `air` (Air-verse) for hot-reloading. Any changes you make to the `.go` files will automatically trigger a recompile and server restart inside the Docker container.
