# Reflex Tech Bookkeeping App

A single-entry bookkeeping system designed to eliminate manual data entry. The application accepts raw receipt images and bank statement exports, extracts structured data using a fully local AI pipeline, automatically reconciles the two datasets, and presents everything through a clean web interface — with no data ever leaving your network.

---

## Table of Contents

1. [How It Works — End to End](#how-it-works--end-to-end)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Data Models](#data-models)
5. [API Reference](#api-reference)
6. [Running the Application](#running-the-application)
7. [Environment Variables](#environment-variables)
8. [Directory Structure](#directory-structure)

---

## How It Works — End to End

### Step 1 — Getting Files Into the App

Files enter the system through **four ingestion paths**:

**A. Web UI Upload**
Users upload receipt images or bank statement files directly through the browser. The frontend sends the file to the backend API (`POST /upload`), which saves it into the `document-data/inbox/` folder.

**B. Network Scanner (SMB Share)**
A Samba container exposes the same `document-data/inbox/` folder as a network share named `inbox` (accessible via `\\<server-ip>\inbox`). A physical document scanner, smartphone scanning app, or any networked device can drop files directly into this share. Credentials: `scanner / password123`.

**C. Direct File System Drop**
Because the backend continuously monitors the folder, users or automated scripts running on the host machine can simply move or copy files directly into the `document-data/inbox/` directory.

**D. Syncthing & Synctrain (Mobile Sync)**
Users can use Syncthing and Synctrain to automatically sync receipt photos taken on their mobile devices directly to the `document-data/inbox/` folder on the server.

---

### Step 2 — File Watcher & Ingestion

The backend runs a **background file watcher** (`fsnotify`) that monitors `document-data/inbox/` continuously. When a new file appears:

1. **Debounce** — A short delay absorbs rapid OS-level write events caused by large file copies, ensuring the file is fully written before processing begins.
2. **Extension validation** — Only known file types are accepted:
   - Receipt images: `.jpg`, `.jpeg`, `.png`, `.heic`
   - PDF receipts: `.pdf`
   - Bank statements: `.ofx`, `.qfx`
3. **SHA-256 deduplication** — The file is hashed. If a matching hash already exists in the database, the file is silently rejected to prevent duplicate imports.
4. **HEIC conversion** — iPhone `.heic` photos are decoded by `goheif` and re-encoded as `.png` in memory before further processing.
5. **Move to processed** — The file is moved from `inbox/` to `processed/`, and a `Receipt` or `BankStatement` database record is created with its path, extension, and hash.

---

### Step 3 — AI Extraction Pipeline (Receipt & PDF Files)

Once a receipt file is saved to the database, it is forwarded to the **File Processor** service running on port `8081`. Two separate paths exist depending on file type:

#### Image Path (`.jpg`, `.jpeg`, `.png`)

1. The image is POSTed as `multipart/form-data` to the file processor.
2. **PIL / Pillow** resizes the image: very large photos (e.g. 4000px+ from a camera) are first down-stepped to 2000px using box filtering to avoid Moiré aliasing artifacts, then down to a maximum of 1200px using LANCZOS interpolation. EXIF orientation metadata is applied so the image is never sideways or upside-down.
3. The resized image is base64-encoded and sent to **Ollama** running the `qwen2.5vl:3b` vision model.
4. The vision model reads the receipt image directly and returns a structured JSON object.

#### PDF Path (`.pdf`)

1. The PDF is saved to disk and each page is rasterised to a PNG at 150 DPI using **`pdftoppm`** (from Poppler Utils).
2. **Tesseract OCR** runs on each page image and extracts raw text.
3. The concatenated OCR text from all pages is sent as a text prompt to **Ollama** running `llama3.1:8b` (a text-only LLM).
4. The model structures the raw OCR output into a typed JSON expense object.

#### Extracted JSON Schema (both paths)

```json
{
  "timestamp": "2023-08-16T18:51:49Z",
  "vendor": "Walmart",
  "description": "Groceries",
  "amount": 181.13,
  "tender": "VISA"
}
```

The backend saves this as an `Expense` record in PostgreSQL and links it to its parent `Receipt`.

---

### Step 4 — Bank Statement Parsing (`.ofx` / `.qfx` Files)

OFX/QFX files (exported from most major Canadian and US banks) are parsed using the **`ofxgo`** library. Each transaction element in the file becomes a `BankTransaction` record containing:

- Transaction date
- Description (merchant name from the bank)
- Amount
- Transaction type (`DEBIT`, `DEP`, `PAYMENT`, etc.)
- `FITID` — the bank's own unique identifier, used as a unique key to prevent duplicate imports across overlapping statement exports

---

### Step 5 — Automatic Reconciliation Engine

After every new import (and after any manual link/unlink action), a multi-pass reconciliation algorithm runs across all unlinked records:

**Pass 1 — Scored Direct Matching**

Each unlinked `Expense` is scored against each `UNLINKED` `BankTransaction`:

| Signal | Points |
|--------|--------|
| Exact amount match | +50 |
| Same-day date match | +30 |
| 1-day date proximity | +20 |
| 2-day date proximity | +10 |
| Vendor name similarity (fuzzy) | +20 |

- **Score ≥ 80** → auto-linked with status `confirmed`
- **Score > 0** → saved as a `suggested` link for human review in the UI

**Pass 2 — Split-Transaction Detection**

A recursive subset-sum algorithm identifies groups of expenses from the same day whose amounts add up exactly to an unlinked transaction total. This handles cases like one bank debit covering multiple individual receipts.

**Pass 3 — Status Propagation**

Every `BankTransaction` and `Expense` is re-evaluated:
- `BALANCED` — the sum of all linked confirmed expenses equals the transaction amount
- `PARTIALLY_ALLOCATED` / `OVER_ALLOCATED` — linked but amounts don't sum to the transaction total
- `UNLINKED` — no confirmed links exist

---

### Step 6 — Web Interface

The React frontend provides three primary views:

**Dashboard** — A summary of the current reconciliation state: how many transactions are balanced, unlinked, or have AI-generated suggestions pending review.

**Month Ledger** — A paginated, filterable table of all bank transactions and expenses for a selected accounting period. Users can filter by status (`BALANCED`, `UNLINKED`, `PARTIAL`, `OVER-ALLOCATED`), approve AI-suggested links in one click, manually link/unlink records, and mark expenses as cash (removing them from the reconciliation queue).

**Detail View** — A two-column side-by-side view of a single `BankTransaction` and its linked `Expense(s)`. Supports a carousel when multiple expenses link to one transaction. Users can edit fields, view the physical receipt image or PDF in a modal, link or unlink records manually, and create a new corresponding record on the fly.

---

### Step 7 — Period Lock & Books Closed Control

When a period (e.g. month-end or fiscal year-end) is complete, a user locks the books up to a selected date via **Books Closed Date** in Global Settings.

The system enforces strict accounting controls:
- **Preflight Validation (`GET /api/settings/close-preflight`)**: The books cannot be closed if any unlinked bank transactions or orphaned expenses exist on or before the target closing date.
- **Immutable Historical Records**: Once locked, all transactions, expenses, receipts, splits, and reconciliations on or before the `BooksClosedDate` are strictly **read-only**. Any attempt to create, edit, delete, link, unlink, or exclude records in a closed period is rejected with HTTP `403 Forbidden`.
- **Tamper-Evident Audit Trail**: Every change to the Books Closed Date is logged in `period_audit_logs` with the previous date, new date, timestamp, user IP, and client user-agent.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│              React + TypeScript + Tailwind              │
│           (localhost:5173 via Vite dev server)          │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP REST
┌──────────────────────▼──────────────────────────────────┐
│                  Backend API (Go)                        │
│         Fiber v3 · GORM · fsnotify · ofxgo              │
│                   localhost:8080                         │
└─────────┬───────────────────────────────────────────────┘
          │ multipart/form-data (POST /process)
┌─────────▼───────────────────────────────────────────────┐
│              File Processor (Go)                         │
│        fasthttp · Pillow · Tesseract · pdftoppm         │
│                   localhost:8081                         │
└─────────┬───────────────────────────────────────────────┘
          │ /api/generate (JSON)
┌─────────▼───────────────────────────────────────────────┐
│                  Ollama (local LLM runtime)              │
│       qwen2.5vl:3b (images) · llama3.1:8b (text)        │
│                   localhost:11434                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              PostgreSQL 18 (Docker)                      │
│  Receipts · Expenses · BankTransactions · Periods       │
│                   localhost:5432                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Samba SMB Share (Docker)                    │
│    \\<server-ip>\inbox  →  document-data/inbox/         │
│            ports 139, 445                               │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Languages

| Language | Used For |
|----------|----------|
| Go | Backend API and File Processor |
| TypeScript | Frontend |
| Python | Image resizing helper (inline script called by the file processor via `exec`) |
| SQL | PostgreSQL queries (via GORM) |

### Backend (`backend/`)

| Library | Version | Purpose |
|---------|---------|---------|
| [Fiber v3](https://github.com/gofiber/fiber) | v3.4.0 | HTTP web framework — routing, middleware, request binding |
| [GORM](https://gorm.io/) | v1.31.2 | ORM — schema migration, queries, associations |
| [pgx v5](https://github.com/jackc/pgx) | v5.10.0 | PostgreSQL driver (used internally by GORM) |
| [goheif](https://github.com/adrium/goheif) | latest | Decodes iPhone `.heic` images to standard JPEG/PNG |
| [ofxgo](https://github.com/aclindsa/ofxgo) | v0.1.3 | Parses `.ofx` and `.qfx` bank statement files |
| [fsnotify](https://github.com/fsnotify/fsnotify) | v1.10.1 | Cross-platform filesystem event watcher for the inbox folder |

### File Processor (`file-processor/`)

| Library / Tool | Purpose |
|----------------|---------|
| [fasthttp](https://github.com/valyala/fasthttp) v1.73.0 | High-performance HTTP server (serves `/process`) and HTTP client (calls Ollama) |
| [Pillow (PIL)](https://python-pillow.org/) | Image resizing with EXIF correction — called as an inline `python3 -c` subprocess |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | CPU-based OCR engine — extracts raw text from rasterised PDF pages |
| [Poppler / pdftoppm](https://poppler.freedesktop.org/) | Rasterises PDF pages to PNG images at 150 DPI |
| [Ollama](https://ollama.com/) | Local LLM runtime — serves both models via `/api/generate` |
| [qwen2.5vl:3b](https://ollama.com/library/qwen2.5vl) | Multimodal vision-language model — reads receipt images directly |
| [llama3.1:8b](https://ollama.com/library/llama3.1) | Text language model — structures raw OCR output into JSON |

### Frontend (`frontend/`)

| Library | Version | Purpose |
|---------|---------|---------|
| [React](https://react.dev/) | v19 | UI component framework |
| [React Router DOM](https://reactrouter.com/) | v7 | Client-side routing |
| [Tailwind CSS](https://tailwindcss.com/) | v4 | Utility-first CSS — all styling |
| [Vite](https://vitejs.dev/) | v8 | Dev server with HMR and production bundler |
| [pdfjs-dist](https://mozilla.github.io/pdf.js/) | v6 | Renders PDF receipt previews in the browser |
| [heic2any](https://github.com/alexcorvi/heic2any) | v0.0.4 | Client-side HEIC → JPEG conversion for browser preview before upload |
| TypeScript | ~6.0 | Static typing across all frontend code |

### Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| Containerization | Docker + Docker Compose | Orchestrates frontend, backend, database, and Samba |
| Database | PostgreSQL 18.4 (Alpine) | Primary data store |
| Network File Share | Samba (`dperson/samba`) | Exposes inbox to scanners and networked devices over SMB |
| File Storage | Local bind mount (`document-data/`) | Persists uploaded documents across container restarts |

---

## Data Models

### `ChartAccount`
Defines the five-tier Chart of Accounts (COA) for single-entry categorization.
- `id`: uint (Primary Key)
- `code`: string (e.g. "1010", "4010", "5020", unique)
- `name`: string (e.g. "Operating Checking", "Consulting Revenue", "Advertising")
- `type`: string (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`)
- `parentId`: *uint (Sub-account hierarchy)
- `ofxAccountId`: *string (Statement mapping key for auto-attributing imported transactions)
- `scheduleCLine`: string (Tax line mapping, e.g. "Line 8 - Advertising", "Line 24b - Meals")
- `active`: bool (Soft-disable inactive accounts)
- `isDefault`: bool (System default accounts protected from deletion)

### `BankRule`
Automated categorization engine executing regex/exact rules upon statement import or manual re-application.
- `id`: uint (Primary Key)
- `name`: string (User-friendly rule label)
- `priority`: int (Execution order — evaluated ascending)
- `active`: bool (Rule enabled/disabled state)
- `conditions`: JSON string/array (Array of `field`, `operator` (`contains`, `equals`, `starts_with`, `ends_with`, `regex`), `value`, `caseSensitive`)
- `targetCategoryId`: uint (FK to `ChartAccount`)
- `renameVendor`: string (Standardized merchant name override)

### `Invoice`
Lightweight client invoicing with accounts receivable aging and 1-click deposit matching.
- `id`: uint (Primary Key)
- `invoiceNumber`: string (e.g. "INV-1001", unique)
- `clientName`: string (Client or company name)
- `clientEmail`: string (Billing contact email)
- `clientAddress`: string (Billing address)
- `issueDate`: time (Invoice date)
- `dueDate`: time (Payment due date — validated `dueDate >= issueDate`)
- `items`: string (JSON serialized line items `[{description, quantity, unitPrice, amount}]`)
- `subtotal`: float64 (Sum of line items)
- `taxRate`: float64 (Sales tax percentage)
- `taxAmount`: float64 (Calculated sales tax)
- `totalAmount`: float64 (Total invoice amount)
- `amountPaid`: float64 (Total payments matched)
- `balanceDue`: float64 (Remaining unpaid balance)
- `paymentTerms`: string (e.g. "Net 30", "Due on Receipt")
- `status`: string (`DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`)
- `paidDate`: *time (Date full or partial payment was received)
- `bankTransactionId`: *uint (Matched bank deposit FK)
- `categoryAccountId`: *uint (Target revenue account FK)

### `BankTransaction`
One line item from an imported bank statement.
- `id`: uint (Primary key)
- `bankStatementId`: *uint (FK to parent `BankStatement`)
- `chartAccountId`: *uint (Bank/Credit-Card account FK — ASSET or LIABILITY)
- `categoryAccountId`: *uint (Category account FK — REVENUE or EXPENSE)
- `date`: time (Transaction date)
- `description`: string (Merchant name reported by bank)
- `amount`: float64 (Amount: negative for debits/withdrawals, positive for deposits)
- `transactionType`: string (`DEBIT`, `DEP`, `PAYMENT`, etc.)
- `fitId`: string (Bank-issued unique ID — prevents duplicate statement imports)
- `allocationStatus`: string (`BALANCED`, `PARTIALLY_ALLOCATED`, `OVER_ALLOCATED`, `UNLINKED`)
- `reviewStatus`: string (`PENDING`, `APPROVED`, `IGNORED`, `WARNINGS_IGNORED`, `DELETED`)

### `Expense`
AI-extracted structured data representing one receipt purchase.
- `id`: uint (Primary key)
- `timestamp`: time (Date/time from receipt)
- `vendor`: string (Merchant name)
- `description`: string (Short purchase description)
- `amount`: float64 (Total purchase amount)
- `tender`: string (Payment method: `card`, `cash`, `check`, etc.)
- `chartAccountId`: *uint (Assigned expense category FK)
- `allocationStatus`: string (`BALANCED`, `PARTIALLY_ALLOCATED`, `OVER_ALLOCATED`, `UNLINKED`)
- `reviewStatus`: string (`PENDING`, `APPROVED`, `IGNORED`, `WARNINGS_IGNORED`, `DELETED`)
- `receipts`: []Receipt (Attached image or PDF files)

### `BankStatement`
Metadata about an imported OFX/QFX file.
- `id`: uint (Primary key)
- `documentUri`: string (Path to file in `processed/`)
- `fileExt`: string (`.ofx` or `.qfx`)
- `accountId`: string (Bank account number from OFX header)
- `bankId`: string (Routing/institution ID)
- `startDate`: time / `endDate`: time (Statement period)
- `endingBalance`: *float64 / `balanceAsOf`: *time (Authoritative ending ledger balance)
- `chartAccountId`: *uint (Linked bank ChartAccount FK)

### `Receipt`
Physical file record stored in `document-data/processed/`.
- `id`: uint (Primary key)
- `expenseId`: *uint (FK to parent `Expense`)
- `documentUri`: string (Absolute file path)
- `fileExt`: string (`.jpg`, `.png`, `.pdf`, etc.)
- `fileHash`: string (SHA-256 hash for deduplication)

### `PeriodAuditLog` & `ItemAuditLog`
Audit trails for period locks and item lifecycle events.
- `PeriodAuditLog`: Tracks closing date shifts (`id`, `changedAt`, `action`, `previousDate`, `newDate`, `reason`, `userIp`, `userAgent`)
- `ItemAuditLog`: Tracks lifecycle events (`id`, `itemType`, `itemId`, `action`, `previousStatus`, `newStatus`, `details`, `timestamp`)

---

## API Reference

All backend endpoints are served under `/api` (proxied via Nginx on port 5173 or direct on port 8080).

### Core & Files
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health status and timestamp. |
| `POST` | `/api/upload` | Upload receipt or bank statement (`multipart/form-data`). |
| `GET` | `/api/events` | Server-Sent Events (SSE) live sync stream. |
| `GET` | `/images/:filename` | Serve receipt image or PDF file. |

### Chart of Accounts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/accounts` | List all accounts in the Chart of Accounts. |
| `POST` | `/api/accounts` | Create an account (`code`, `name`, `type`, `parentId`, `scheduleCLine`). |
| `PATCH` | `/api/accounts/:id` | Update account details (name, ofxAccountId, scheduleCLine, active). |
| `DELETE` | `/api/accounts/:id` | Delete account. Blocked if default or referenced by transactions. |

### Bank Rules
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rules` | List all automated categorization rules in priority order. |
| `POST` | `/api/rules` | Create rule (validates regex patterns before saving). |
| `PATCH` | `/api/rules/:id` | Update rule conditions or target category. |
| `DELETE` | `/api/rules/:id` | Delete rule. |
| `POST` | `/api/rules/reorder` | Update rule priority ordering. |
| `POST` | `/api/rules/apply-all` | Batch-execute all active rules against historical bank transactions. |
| `POST` | `/api/rules/preview` | Dry-run a rule against existing transactions without mutating data. |

### Invoicing & Accounts Receivable
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invoices` | List invoices and receivables summary metrics. |
| `POST` | `/api/invoices` | Create invoice (validates `dueDate >= issueDate`). |
| `GET` | `/api/invoices/:id` | Get single invoice with itemized line items. |
| `PATCH` | `/api/invoices/:id` | Update invoice details or status. |
| `DELETE` | `/api/invoices/:id` | Void or delete invoice (blocked if in closed period). |
| `POST` | `/api/invoices/:id/match-payment` | Match bank deposit; supports partial payments (`PARTIALLY_PAID`) or full settlement (`PAID`). |
| `POST` | `/api/invoices/:id/unmatch-payment` | Unlink matched bank deposit and revert status to `SENT`. |
| `GET` | `/api/invoices/:id/candidates` | Rank candidate deposits by exact total, remaining balance, and client name. |

### Bank Transactions & Expenses
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/transactions` | List bank transactions (`?year=&month=&status=&accountId=`). |
| `POST` | `/api/transactions` | Create manual bank transaction. |
| `GET` | `/api/transactions/:id` | Get single transaction with linked expenses and suggestions. |
| `PATCH` | `/api/transactions/:id` | Update transaction description, category, or note. |
| `DELETE` | `/api/transactions/:id` | Soft-delete transaction (blocked if period is closed). |
| `GET` | `/api/transactions/export` | Export transactions as CSV (OWASP formula injection sanitized). |
| `GET` | `/api/expenses` | List expenses (`?year=&month=&status=&accountId=`). |
| `POST` | `/api/expenses` | Create manual expense. |
| `GET` | `/api/expenses/:id` | Get single expense with receipt attachments and links. |
| `PATCH` | `/api/expenses/:id` | Update vendor, description, amount, tender, or category. |
| `DELETE` | `/api/expenses/:id` | Soft-delete expense (blocked if period is closed). |
| `POST` | `/api/expenses/:id/split` | Split one expense across multiple categories. |
| `POST` | `/api/expenses/:id/receipt` | Attach additional receipt file to an expense. |
| `PATCH` | `/api/expenses/:id/cash` | Mark expense as cash (bypasses bank reconciliation). |
| `GET` | `/api/expenses/export` | Export expenses as CSV (OWASP formula injection sanitized). |

### Reconciliation
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reconciliation/flagged` | Unlinked transactions and non-cash expenses. |
| `GET` | `/api/reconciliation/unlinked` | Unlinked items for manual reconciliation modal. |
| `POST` | `/api/reconciliation/link` | Link expense(s) to transaction (blocks over-allocation by default). |
| `POST` | `/api/reconciliation/create-and-link` | Create missing counter-record and link in one step. |
| `POST` | `/api/reconciliation/unlink` | Detach linked expense from transaction. |

### Financial Reports
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reports/pl` | Profit & Loss statement grouped by Chart of Accounts. |
| `GET` | `/api/reports/schedule-c` | Form 1040 Schedule C / T2125 tax mapping report. |
| `GET` | `/api/reports/cash-flow` | Cash Flow summary tracking Cash & Cash Equivalents without credit card double-counting. |
| `GET` | `/api/reports/vendor-spend` | Aggregated vendor expenditure metrics and Pareto 80/20 spend. |
| `GET` | `/api/reports/ar-aging` | Accounts Receivable aging buckets (Current, 1-30, 31-60, 61-90, 90+) reflecting remaining balance due and excluding unapproved draft quotes. |
| `GET` | `/api/reports/tax-pack` | Download CPA Tax Pack ZIP bundle (CSV ledgers + all receipt images/PDFs). |

### Global Settings & Period Controls
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Read current app settings (e.g. `BooksClosedDate`). |
| `POST` | `/api/settings` | Update settings (updates `BooksClosedDate` with preflight verification). |
| `GET` | `/api/settings/close-preflight` | Preflight check validating 0 unlinked items exist prior to closing. |
| `GET` | `/api/settings/audit-logs` | Retrieve chronological period lock audit history. |
| `GET` | `/api/settings/directories` | Sandboxed host directory browser confined to host home directory. |

### Review Queue & Lifecycle
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/review-queue` | Pending review items with AI suggestions. |
| `GET` | `/api/review-queue/counts` | Aggregated count badges for review queue tabs. |
| `POST` | `/api/review-queue/resolve` | Bulk approve or ignore AI-suggested links. |
| `POST` | `/api/review-queue/batch-categorize` | Bulk categorize items to a selected ChartAccount. |
| `POST` | `/api/items/exclude` | Exclude transaction or expense with reason (DUPLICATE, PERSONAL). |
| `POST` | `/api/items/restore` | Restore excluded item back to active ledger. |
| `POST` | `/api/items/delete-bulk` | Move items to Trash. |
| `POST` | `/api/items/delete-permanent` | Permanently purge items from database. |

---

## Running the Application

### Prerequisites

**Docker & Docker Compose** — The only dependency required on the host machine. Everything else (Ollama, the file processor, Tesseract, Poppler, Pillow, and all models) runs inside Docker containers and is set up automatically on first launch.

Download Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop/).

---

### 1. Configure Environment

Copy the example environment file and fill in your values:
```bash
cp .env.example .env
```

The defaults work out of the box for local development. The only value you should change is `POSTGRES_PASSWORD`.

---

### 2. Start the App

The application uses a GPU-aware launch script that auto-detects your hardware and starts the correct configuration automatically. On first launch, Ollama will pull the required AI models — this can take several minutes depending on your connection.

**On Linux or macOS:**
```bash
./start.sh
```

**On Windows (Command Prompt or double-click):**
```bat
start.bat
```

The script will detect your GPU and print what it found:

| Detected Hardware | Ollama Mode |
|-------------------|-------------|
| NVIDIA GPU (`nvidia-smi` present) | CUDA — `docker-compose.nvidia.yml` overlay applied |
| AMD GPU (`/dev/kfd` or `rocm-smi` present) | ROCm — `docker-compose.amd.yml` overlay applied |
| No GPU / macOS | CPU fallback |

> **AMD on Windows:** ROCm GPU passthrough into Docker is not yet officially supported on native Windows. If you have an AMD GPU and want to use it, run the app inside **WSL2** and use `./start.sh` instead.

> **Manual override:** If you want to force a specific mode without using the script, you can run Docker Compose directly:
> ```bash
> # Force NVIDIA
> docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
> # Force AMD (Linux only)
> docker compose -f docker-compose.yml -f docker-compose.amd.yml up -d
> # Force CPU
> docker compose -f docker-compose.yml up -d
> ```

This starts:
- `ollama` — Local LLM runtime (GPU-accelerated if detected). Pulls `llama3.1:8b` and `qwen2.5vl:3b` automatically on first run.
- `file-processor` — Receipt/PDF processing service on port 8081
- `frontend` — React dev server on port 5173
- `backend` — Go API server on port 8080
- `postgres` — PostgreSQL 18 on port 5432
- `scanner-smb` — Samba file share on ports 139 and 445

---

### Service Endpoints

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080 |
| File Processor | http://localhost:8081 |
| PostgreSQL | localhost:5432 |
| SMB Share (scanner drop) | `\\<host-ip>\inbox` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `pass` | PostgreSQL password |
| `POSTGRES_DB` | `reflex-tech-bookkeeping-app-postgres-db` | Database name |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `BACKEND_PORT` | `8080` | Backend API port |
| `FRONTEND_PORT` | `5173` | Frontend dev server port |
| `DOCUMENTS_PATH` | `/app/documents` | Path inside the backend container where files are stored |
| `OLLAMA_HOST` | `127.0.0.1:11434` | Ollama API host (file processor only — set if Ollama runs on a different machine) |

---

## Directory Structure

```
reflex-tech-bookkeeping-app/
├── docker-compose.yml          # Service orchestration
├── .env                        # Local environment variables
├── document-data/
│   ├── inbox/                  # Drop zone — watched by backend file watcher
│   │                           # Also exposed as \\<host>\inbox via Samba
│   └── processed/              # Files moved here after successful ingestion
├── backend/                    # Go API server
│   ├── main.go                 # Entry point — starts Fiber and the file watcher
│   ├── controllers/
│   │   ├── uploadController.go
│   │   ├── transactionController.go
│   │   ├── expenseController.go
│   │   ├── reconciliationController.go
│   │   └── accountingController.go
│   ├── models/
│   │   ├── receipt.go          # Expense + Receipt structs
│   │   ├── bank.go             # BankStatement + BankTransaction structs
│   │   ├── expenseBankTransaction.go
│   │   └── accountingPeriod.go
│   ├── db/                     # Database connection and auto-migration
│   ├── routes/                 # Route registration
│   ├── utils/                  # Reconciliation engine and helpers
│   └── app/                    # File watcher and ingestion logic
└── frontend/                   # React TypeScript app
    ├── src/
    │   ├── pages/
    │   │   ├── Dashboard.tsx   # Summary stats and quick actions
    │   │   ├── MonthLedger.tsx # Per-month transaction/expense table
    │   │   └── DetailsView.tsx # Side-by-side detail view + receipt image modal
    │   ├── services/api.ts     # Typed fetch wrappers for all API endpoints
    │   ├── types/models.ts     # TypeScript interfaces mirroring backend models
    │   └── components/         # Shared UI components
    └── package.json
