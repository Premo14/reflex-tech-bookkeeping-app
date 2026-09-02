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

Files enter the system through **three ingestion paths**:

**A. Web UI Upload**
Users upload receipt images or bank statement files directly through the browser. The frontend sends the file to the backend API (`POST /upload`), which saves it into the `document-data/inbox/` folder.

**B. Network Scanner (SMB Share)**
A Samba container exposes the same `document-data/inbox/` folder as a network share named `inbox` (accessible via `\\<server-ip>\inbox`). A physical document scanner, smartphone scanning app, or any networked device can drop files directly into this share. Credentials: `scanner / password123`.

**C. Direct File System Drop**
Because the backend continuously monitors the folder, users or automated scripts running on the host machine can simply move or copy files directly into the `document-data/inbox/` directory.

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

After every new import (and after any manual link/unlink action), a multi-pass reconciliation algorithm runs across all unmatched records:

**Pass 1 — Scored Direct Matching**

Each unlinked `Expense` is scored against each `UNMATCHED` `BankTransaction`:

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

A recursive subset-sum algorithm identifies groups of expenses from the same day whose amounts add up exactly to an unmatched transaction total. This handles cases like one bank debit covering multiple individual receipts.

**Pass 3 — Status Propagation**

Every `BankTransaction` and `Expense` is re-evaluated:
- `MATCHED` — the sum of all linked confirmed expenses equals the transaction amount
- `PARTIAL` — linked but amounts don't sum to the transaction total
- `UNMATCHED` — no confirmed links exist

---

### Step 6 — Web Interface

The React frontend provides three primary views:

**Dashboard** — A summary of the current reconciliation state: how many transactions are matched, unmatched, or have AI-generated suggestions pending review.

**Month Ledger** — A paginated, filterable table of all bank transactions and expenses for a selected accounting period. Users can filter by status (`MATCHED`, `UNMATCHED`, `PARTIAL`), approve AI-suggested links in one click, manually link/unlink records, and mark expenses as cash (removing them from the reconciliation queue).

**Detail View** — A two-column side-by-side view of a single `BankTransaction` and its linked `Expense(s)`. Supports a carousel when multiple expenses link to one transaction. Users can edit fields, view the physical receipt image or PDF in a modal, link or unlink records manually, and create a new matching record on the fly.

---

### Step 7 — Accounting Period Close

When a month is complete, a user can **close** the accounting period. The system enforces that:
- No `UNMATCHED` transactions remain
- No orphaned (unlinked, non-cash) expenses remain

Once closed, all records for that period become **read-only** — edits, links, and unlinks are rejected with a `403 Forbidden` response.

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

### `Receipt`
Represents a physical file on disk. Created immediately when a file is ingested.

| Field | Type | Description |
|-------|------|-------------|
| `id` | uint | Primary key |
| `expenseId` | *uint | FK to `Expense` (nullable — set after AI extraction completes) |
| `documentUri` | string | Absolute path to the file in `processed/` |
| `fileExt` | string | Original file extension (e.g. `.jpg`, `.pdf`) |
| `fileHash` | string | SHA-256 hash — unique, prevents duplicate file ingestion |

### `Expense`
AI-extracted structured data representing one purchase.

| Field | Type | Description |
|-------|------|-------------|
| `id` | uint | Primary key |
| `timestamp` | time | Date/time of the purchase as read from the receipt |
| `vendor` | string | Store or business name |
| `description` | string | Short description of the purchase |
| `amount` | float64 | Total amount paid (not subtotal, inclusive of tax) |
| `tender` | string | Payment method (`VISA`, `CASH`, `DEBIT`, etc.) |
| `reconciliationStatus` | string | `MATCHED`, `PARTIAL`, or `UNMATCHED` |
| `hasSuggestions` | bool | True if the reconciler found a suggested bank match |
| `receipts` | []Receipt | All physical files belonging to this expense |

### `BankTransaction`
One line item from an imported bank statement.

| Field | Type | Description |
|-------|------|-------------|
| `id` | uint | Primary key |
| `bankStatementId` | *uint | FK to parent `BankStatement` (nullable for manually created transactions) |
| `date` | time | Transaction date |
| `description` | string | Merchant name as reported by the bank |
| `amount` | float64 | Transaction amount |
| `transactionType` | string | `DEBIT`, `DEP`, `PAYMENT`, or `OTHER` |
| `fitId` | string | Bank-issued unique ID — unique constraint prevents duplicate imports |
| `reconciliationStatus` | string | `MATCHED`, `PARTIAL`, or `UNMATCHED` |
| `hasSuggestions` | bool | True if the reconciler has a suggested expense match |

### `BankStatement`
Metadata about an imported OFX/QFX file.

| Field | Type | Description |
|-------|------|-------------|
| `id` | uint | Primary key |
| `documentUri` | string | Path to the raw statement file in `processed/` |
| `fileExt` | string | `.ofx` or `.qfx` |
| `accountId` | string | Bank account number from the OFX header |
| `bankId` | string | Bank routing/institution ID from the OFX header |
| `startDate` | time | Statement period start |
| `endDate` | time | Statement period end |

### `AccountingPeriod`
Tracks the open/closed state of each calendar month.

| Field | Type | Description |
|-------|------|-------------|
| `year` | int | Calendar year |
| `month` | int | Calendar month (1–12) |
| `status` | string | `OPEN` or `CLOSED` |

### `ExpenseBankTransaction` (join table)
Many-to-many link between expenses and bank transactions.

| Field | Type | Description |
|-------|------|-------------|
| `expenseId` | uint | FK to `Expense` |
| `bankTransactionId` | uint | FK to `BankTransaction` |
| `status` | string | `confirmed` (user-approved or auto-linked) or `suggested` (AI candidate) |

---

## API Reference

All endpoints are served from `http://localhost:8080`.

### Upload
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload a receipt or bank statement. Accepts `multipart/form-data` with field `document`. |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/transactions` | List all bank transactions. Supports `?year=&month=&status=` filters. |
| `GET` | `/transactions/:id` | Get a single transaction with its linked expenses and reconciliation detail. |
| `POST` | `/transactions` | Manually create a bank transaction. |
| `PUT` | `/transactions/:id` | Update a transaction's description or amount. |
| `DELETE` | `/transactions/:id` | Delete a transaction. Blocked if the accounting period is closed. |

### Expenses
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/expenses` | List all expenses. Supports `?year=&month=&status=` filters. |
| `GET` | `/expenses/:id` | Get a single expense with its receipts and linked transactions. |
| `POST` | `/expenses` | Manually create an expense. |
| `PUT` | `/expenses/:id` | Update vendor, description, amount, or tender. |
| `DELETE` | `/expenses/:id` | Delete an expense and its associated receipts. |

### Reconciliation
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/flagged` | Return all unmatched transactions and orphaned expenses. Supports `?year=&month=` filters. |
| `GET` | `/unlinked` | Return all unmatched transactions and unlinked expenses (used by the manual link picker). |
| `POST` | `/link` | Manually link an expense to a bank transaction. Body: `{ expenseId, transactionId }`. |
| `POST` | `/unlink` | Remove a confirmed link. Body: `{ expenseId, transactionId }`. |
| `POST` | `/expenses/:id/mark-cash` | Mark an expense as cash, removing it from the reconciliation queue. |

### Accounting Periods
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/accounting-periods` | List all accounting periods and their statuses. |
| `POST` | `/accounting-periods` | Create or update a period. Closing validates all items are resolved first. |

### Static Files
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/images/:filename` | Serve a receipt image or PDF from the `processed/` directory. |

---

## Running the Application

### Prerequisites

**System dependencies** (must be installed on the host — not inside Docker):
```bash
# Tesseract OCR (for PDF text extraction)
sudo apt-get install tesseract-ocr

# Poppler utilities (for PDF-to-image conversion)
sudo apt-get install poppler-utils

# Python3 + Pillow (for image resizing in the file processor)
pip3 install Pillow
```

**Ollama** — Install from [ollama.com](https://ollama.com), then pull the required models:
```bash
ollama pull qwen2.5vl:3b
ollama pull llama3.1:8b
```

**Docker & Docker Compose** — Required to run the backend, frontend, database, and Samba share.

**Go 1.27+** — Required to build and run the file processor.

---

### 1. Configure Environment

Create a `.env` file in the project root (or use the defaults):
```env
POSTGRES_USER=user
POSTGRES_PASSWORD=pass
POSTGRES_DB=reflex-tech-bookkeeping-app-postgres-db
POSTGRES_PORT=5432
BACKEND_PORT=8080
FRONTEND_PORT=5173
DOCUMENTS_PATH=/app/documents
```

---

### 2. Start Docker Services

```bash
docker compose up -d
```

This starts:
- `frontend` — React dev server on port 5173
- `backend` — Go API server on port 8080
- `postgres` — PostgreSQL 18 on port 5432
- `scanner-smb` — Samba file share on ports 139 and 445

---

### 3. Start the File Processor

The file processor runs **outside Docker** so it can access the local Ollama instance and system tools (Tesseract, Pillow, pdftoppm):

```bash
cd /path/to/file-processor
go run main.go
# or run the pre-built binary:
./file-processor
```

The processor listens on port `8081`.

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
