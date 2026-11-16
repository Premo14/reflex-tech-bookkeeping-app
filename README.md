# Reflex Tech Bookkeeping Platform

**Company**: Reflex Technologies LLC (Utica, NY)  
**Product**: Local-first automated bookkeeping and financial intelligence web application, architected with a seamless evolution path to double-entry multi-client accounting.

---

## Executive Summary & Core Tenets

Reflex Bookkeeping is built from the ground up for solopreneurs, non-financial small business owners, and CPAs. It eliminates manual bookkeeping toil through local multimodal AI vision extraction, direct LAN scanner drops, and intelligent statement reconciliation — with zero data leaving your network, zero cloud subscription fees, and complete cryptographic auditability.

### Key Tenets
1. **100% Private & Fully Offline-Capable**: Powered by local private LLM & Vision models (`qwen2.5vl:3b` & `llama3.1:8b` via Ollama). No financial statements, receipt images, vendor details, or banking credentials are ever transmitted to third-party cloud servers.
2. **Effortless Out-of-the-Box Operation**: Starts in a single command (`./start.sh` or `start.bat`). Environment files, database migrations, Chart of Accounts, and directories initialize automatically.
3. **Exact Financial Precision**: All monetary values are calculated using exact integer cents (`models.Money`), eliminating IEEE-754 floating-point rounding errors.
4. **LAN Network Scanner Drops (SMB Share)**: Physical office scanners can deposit paper receipts straight to `\\<server-ip>\inbox` over Samba SMB without manual web uploads.
5. **Cryptographic Auditability & Closed-Period Lockout**: SHA-256 deduplication hashing for receipts, strict period locking preventing retroactive tampering, and 1-Click CPA Tax Packs (.zip).
6. **GAAP-Conforming Hierarchy & Double-Entry Verification**: Single-entry ledger workflow today paired with a mathematical GAAP Trial Balance proof confirming $\sum \text{Debits} \equiv \sum \text{Credits}$.

---

## Table of Contents

1. [Quick Start (2-Step Launch)](#1-quick-start-2-step-launch)
2. [Architecture Overview](#2-architecture-overview)
3. [End-to-End Workflow & Capabilities](#3-end-to-end-workflow--capabilities)
   - [Document Intake & Ingestion](#a-four-document-intake-pipelines)
   - [AI Receipt Vision & PDF OCR Pipeline](#b-local-ai-receipt-vision--pdf-ocr-pipeline)
   - [Bank Statement Import & FITID Deduplication](#c-bank-statement-import--fitid-deduplication)
   - [Intelligent Reconciliation Engine](#d-intelligent-reconciliation-engine)
   - [Unified Ledger & Detail Drawer with Hotkeys](#e-unified-ledger--detail-drawer-with-hotkeys)
   - [Client Invoicing & Accounts Receivable (A/R)](#f-client-invoicing--accounts-receivable-ar)
   - [Automated Bank Rules Engine](#g-automated-bank-rules-engine)
   - [Closed Period Lockout & Preflight Audits](#h-closed-period-lockout--preflight-audits)
   - [Financial & CPA Tax Reports (6 Core Reports)](#i-financial--cpa-tax-reports-6-core-reports)
   - [Data Sovereignty: Full JSON Backup & Restore](#j-data-sovereignty-full-json-backup--restore)
4. [Hardware Auto-Detection & GPU Acceleration](#4-hardware-auto-detection--gpu-acceleration)
5. [Tech Stack & Versions](#5-tech-stack--versions)
6. [Data Models Reference](#6-data-models-reference)
7. [API Reference](#7-api-reference)
8. [Configuration & Environment Variables](#8-configuration--environment-variables)
9. [Project Directory Structure](#9-project-directory-structure)
10. [Troubleshooting & Maintenance](#10-troubleshooting--maintenance)

---

## 1. Quick Start (2-Step Launch)

The platform is designed to run with zero manual configuration. The only host requirement is **Docker Desktop** (or Docker Engine with Docker Compose).

### Step 1: Clone the Repository
```bash
git clone https://github.com/reflextechnologies/reflex-tech-bookkeeping-app.git
cd reflex-tech-bookkeeping-app
```

### Step 2: Run the Launch Script

**On macOS or Linux:**
```bash
./start.sh
```

**On Windows (Command Prompt or double-click):**
```cmd
start.bat
```

That's it! The launch script automatically:
1. Verifies Docker daemon status.
2. Initializes your `.env` configuration file if one does not exist.
3. Pre-creates the `document-data/inbox` and `document-data/processed` folders with write permissions.
4. Auto-detects your host hardware (macOS CPU, Linux NVIDIA CUDA, Linux AMD ROCm, Windows CUDA/CPU).
5. Orchestrates and starts all containers in detached mode.
6. Pulls local AI models in the background while making the web UI ready immediately.

### Stopping the Application
To stop all services safely while preserving all database records and downloaded AI models:
```bash
# macOS / Linux
./stop.sh

# Windows
stop.bat
```

### Service URLs
| Service | URL / Path | Details |
|---|---|---|
| **Web Application** | `http://localhost:5173` | Unified client ledger, drawers, reports, and settings |
| **Backend REST API** | `http://localhost:8080` (or `http://localhost:5173/api`) | Fiber v3 Go API |
| **System Health API** | `http://localhost:5173/api/health` | Real-time status of DB, Ollama, File-Processor & storage |
| **File Processor** | `http://localhost:8081` | Microservice handling resizing, Tesseract OCR & Ollama |
| **Network Scanner SMB** | `\\<server-ip>\inbox` | SMB Share (user: `scanner`, pass: `password123`) |
| **PostgreSQL Database** | `localhost:5432` | DB: `reflex-tech-bookkeeping-app-postgres-db` |

---

## 2. Architecture Overview

```
                      ┌──────────────────────────────────────────┐
                      │          Local Network Scanner           │
                      │     (SMB Drop: \\<ip>\inbox)             │
                      └────────────────────┬─────────────────────┘
                                           │
 ┌─────────────────────────┐               │ SMB (ports 139, 445)
 │   User Web Browser      │               ▼
 │ React 19 Client (5173)  │     ┌───────────────────┐
 └───────────┬─────────────┘     │  Samba SMB Share  │
             │ HTTP              └─────────┬─────────┘
             ▼                             │
 ┌─────────────────────────┐               │ Mounts /mnt/inbox
 │   Nginx Reverse Proxy   │               ▼
 │   Port 5173             │    ┌─────────────────────────┐
 └─────┬──────────────┬────┘    │  Watched Storage Root   │
       │ /            │ /api    │  ./document-data/inbox  │
       ▼              ▼         └──────────┬──────────────┘
┌────────────┐  ┌───────────────────────┐  │
│  Frontend  │  │   Backend API (Go)    │◄─┘ fsnotify watcher
│  React 19  │  │   Fiber v3 (port 8080)│
└────────────┘  └──────┬────────────┬───┘
                       │            │
      multipart /process│            │ SQL
                       ▼            ▼
         ┌───────────────────┐  ┌───────────────────┐
         │  File Processor   │  │   PostgreSQL 18   │
         │  fasthttp (8081)  │  │   (port 5432)     │
         └─────────┬─────────┘  └───────────────────┘
                   │ /api/generate
                   ▼
         ┌───────────────────┐
         │  Ollama AI Engine │
         │  qwen2.5vl:3b     │  (Vision: Images)
         │  llama3.1:8b      │  (Text: PDFs / Reasoning)
         └───────────────────┘
```

---

## 3. End-to-End Workflow & Capabilities

### A. Four Document Intake Pipelines
1. **Web Drag-and-Drop**: Upload receipt images (`.jpg`, `.png`, `.heic`), PDF receipts, or bank statements (`.ofx`, `.qfx`, `.qbo`) via the "Upload Files" button in the header. (Note: CSV bank uploads are disallowed as CSV schemas vary wildly across financial institutions; standardized OFX/QFX/QBO formats ensure deterministic transaction parsing).
2. **Network Scanner (SMB Share)**: Any multi-function printer or document scanner on the office LAN can scan directly to `\\<server-ip>\inbox` using user `scanner` and password `password123`.
3. **Local Directory Drop**: Host scripts or automated tools can drop files into `./document-data/inbox/`.
4. **Mobile Camera Sync**: Syncthing or mobile photo sync apps can continuously deposit receipt camera photos directly into `./document-data/inbox/`.

### B. Local AI Receipt Vision & PDF OCR Pipeline
- **Background File Watcher**: Backend uses `fsnotify` with debounce to absorb partial writes from network scanners.
- **SHA-256 Deduplication**: Every incoming file is cryptographically hashed; duplicate receipts are automatically detected and rejected to avoid double-counting.
- **HEIC Decoding**: Apple iPhone `.heic` photos are decoded in-memory via `goheif` and converted to standard PNG.
- **Two Specialized AI Extraction Paths**:
  - **Images (`.jpg`, `.png`, `.heic`)**: Resized using box filtering and Lanczos interpolation to prevent Moiré artifacts while respecting EXIF orientation, base64-encoded, and read by the multimodal `qwen2.5vl:3b` vision model.
  - **PDF Documents (`.pdf`)**: Converted to 300 DPI images via `pdftoppm`, processed through `tesseract` OCR, and parsed by `llama3.1:8b` text LLM.
- **Extracted Fields**: Vendor, Purchase Date (RFC3339), Description, Total Amount (integer cents), Sales Tax Amount, Tender Type (`card`, `cash`, `check`), and Chart of Accounts category suggestion.
- **Cash Tender Auto-Balancing**: Receipts with cash tender (`cash`, `cash / paper`) are automatically initialized as `BALANCED` since they do not appear on bank statements.

### C. Bank Statement Import & FITID Deduplication
- Supports standardized financial institution exports in `.ofx`, `.qfx`, and `.qbo` formats.
- **FITID Unique Key**: Every transaction's bank reference ID (`FITID`) is indexed to guarantee overlapping statement exports never create duplicate ledger entries.
- **Bank Deposits**: Deposits ($\ge 0$) automatically balance client invoices or revenue categories.

### D. Intelligent Reconciliation Engine
Runs automatically in the background on every import and manual edit:
- **Pass 1 — Scored Direct Matching**: Scores unlinked expenses against unlinked bank debits based on exact amount match (+50 pts), same-day date match (+30 pts), date proximity (+10 to +20 pts), and vendor fuzzy text similarity (+20 pts). Scores $\ge 80$ are confirmed automatically; positive scores are surfaced as suggested links.
- **Pass 2 — Split-Transaction Detection**: Subset-sum algorithm matches multiple receipts from the same day that sum exactly to a single composite bank debit.
- **Pass 3 — Status Propagation**: Real-time evaluation into `BALANCED`, `PARTIALLY_ALLOCATED`, `OVER_ALLOCATED`, or `UNLINKED`.

### E. Unified Ledger & Detail Drawer with Hotkeys
- **High-Density Dual View**: Segments receipts and client invoices into clean pills (`[ Receipts & Slips (N) ]` and `[ Client Invoices (N) ]`).
- **Inspection Canvas**: Slide-over drawer with interactive canvas for physical receipts featuring:
  - Stepped Zoom In / Zoom Out (`+` / `-`)
  - 90° Clockwise Rotation (`R`)
  - Zoom Reset (`0`)
  - Multi-page receipt navigation (`←` / `→`)
- **Split Expense Modal**: Split a single receipt across multiple expense categories with exact integer-cent remainder allocation.
- **Live Search**: Multi-field full-text search across `vendor`, `description`, `notes`, and bank reference `FITID`.

### F. Client Invoicing & Accounts Receivable (A/R)
- **Invoice Lifecycle**: Full tracking of `DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, and `VOID` client invoices.
- **Line Items & Tax**: Itemized tables with unit prices, quantities, and automatic sales tax computation.
- **Printable Invoices**: Built-in clean printable layout for 1-click browser printing or PDF saving (`window.print()`).
- **1-Click Bank Deposit Matching**: Rank candidate bank deposits by exact total, client name, and date proximity with 1-click settlement.

### G. Automated Bank Rules Engine
- Automated transaction categorization rules executed on statement import or batch-applied across historical records.
- Condition operators: `contains`, `equals`, `starts_with`, `ends_with`, and `regex` with optional case-sensitivity.
- **Live Rule Dry-Run Preview**: Test rule match counts against your current database before saving.
- **Priority Reordering**: Drag-and-drop or rank rules by priority order.

### H. Closed Period Lockout & Preflight Audits
- **Books Closed Date**: Once books are closed through a specified date, all transactions, expenses, receipts, splits, and reconciliations on or before that date become strictly immutable (`HTTP 403 Forbidden`).
- **Preflight Verification**: Blocks closing if any unlinked bank transactions or orphaned expenses exist in the target period.
- **Audit Logging**: Every date change and item status alteration is recorded in `period_audit_logs` and `item_audit_logs`.

### I. Financial & CPA Tax Reports (6 Core Reports)
All reports support custom date ranges, active account filtering, and instant exports:
1. **Profit & Loss (P&L)**: Revenue vs Operating Expenses, gross margin, and net operating income grouped by Chart of Accounts.
2. **Cash Flow Statement**: Net cash flow tracking Cash & Cash Equivalents without credit card double-counting.
3. **Vendor Spend & 1099-NEC Monitoring**: Aggregated payee spend with automated \$600 IRS reporting threshold badges and contractor count tracking.
4. **Accounts Receivable (A/R) Aging**: Balances bucketed into Current, 1–30, 31–60, 61–90, and 90+ days overdue.
5. **Form 1040 Schedule C Tax Summary**:
   - Lines 1–31 IRS tax line mapping.
   - Form 1040-ES Quarterly Estimated Tax projections and Schedule SE self-employment tax calculations.
   - IRC § 162 Business Mileage Optimizer (compares 2024–2026 IRS standard mileage rates against actual vehicle expenses).
   - IRC § 280A Simplified Home Office Deduction calculator with estimated tax savings.
6. **GAAP Trial Balance & Double-Entry Proof**:
   - Denormalizes single-entry banking and cash flows into debits and credits.
   - Live banner mathematically confirming $\sum \text{Debits} \equiv \sum \text{Credits}$ with \$0.00 variance.
   - 4 Health Cards: Total Debits, Total Credits, Net Variance, Active Accounts.
   - 1-Click CPA Trial Balance CSV Export.
7. **1-Click CPA Tax Pack (.zip)**: Bundles CSV registers, Schedule C summary, and SHA-256 verified receipt images into a single zip archive for your accountant.

### J. Data Sovereignty: Full JSON Backup & Restore
- **1-Click Backup**: Download a complete, self-contained JSON snapshot containing company profile, Chart of Accounts, bank statements, transactions, receipts, invoices, bank rules, and audit logs (`GET /api/system/backup/export`).
- **1-Click Restore**: Safely upload and restore a JSON snapshot (`POST /api/system/backup/restore`) with transactional integrity and automatic reconciliation recalculation.

---

## 4. Hardware Auto-Detection & GPU Acceleration

The `start.sh` and `start.bat` scripts inspect your machine and apply the optimal configuration automatically:

| Detected Hardware | Launch Mode | Configuration Applied |
|---|---|---|
| **macOS (Apple Silicon M1-M4 or Intel)** | CPU Fallback | `docker-compose.yml` (Docker Desktop for Mac does not pass host GPUs into Linux containers) |
| **Linux with NVIDIA GPU** (`nvidia-smi`) | NVIDIA CUDA | `docker-compose.yml` + `docker-compose.nvidia.yml` |
| **Linux with AMD GPU** (`/dev/kfd`, `rocm-smi`) | AMD ROCm | `docker-compose.yml` + `docker-compose.amd.yml` |
| **Windows with NVIDIA GPU** | NVIDIA CUDA | `docker-compose.yml` + `docker-compose.nvidia.yml` |
| **Windows with AMD GPU** | CPU (WSL2 recommended) | `docker-compose.yml` (Native Windows does not pass ROCm into Docker; run inside WSL2 for GPU) |

---

## 5. Tech Stack & Versions

```text
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│              React + TypeScript + Tailwind              │
│                 http://localhost:5173                   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (via Nginx)
┌──────────────────────▼──────────────────────────────────┐
│                   Nginx (Docker)                        │
│     Routes `/` to Frontend, `/api/` to Backend          │
│               Exposed on port 5173                      │
└─────────┬───────────────────────────────┬───────────────┘
          │ /                             │ /api/ & /images/
┌─────────▼───────────────┐     ┌─────────▼───────────────┐
│     Frontend (Docker)   │     │      Backend (Docker)   │
│       Vite dev server   │     │    Go Fiber · fsnotify  │
│        (Internal)       │     │       (Internal)        │
└─────────────────────────┘     └─────────┬───────────────┘
                                          │ HTTP POST /process
┌─────────────────────────────────────────▼───────────────┐
│                 File Processor (Docker)                 │
│         Go · Pillow · Tesseract · pdftoppm              │
│                       (Internal)                        │
└─────────┬───────────────────────────────────────────────┘
          │ HTTP /api/generate
┌─────────▼───────────────────────────────────────────────┐
│                  Ollama (Docker)                        │
│       qwen2.5vl:3b (images) · llama3.1:8b (text)        │
│                       (Internal)                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              PostgreSQL 18 (Docker)                     │
│                 (Internal Only)                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Samba SMB Share (Docker)                   │
│    \\<server-ip>\inbox  →  DOCUMENT_DATA_PATH/inbox/ │
│            Exposed on ports 139, 445                    │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Data Models Reference

### `ChartAccount`
Defines the five GAAP account types: `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`.
- `Code`: Unique account code (e.g. `1010` Checking, `4010` Sales, `5010` Rent).
- `Name`: Account display name.
- `Type`: Account classification.
- `ParentID`: Sub-account relationship.
- `ScheduleCLine`: IRS tax line mapping (e.g. `Line 8 - Advertising`, `Line 18 - Office expense`).
- `Active`: Soft-disable toggle.
- `IsDefault`: Protected standard account flag.

### `BankTransaction`
Bank statement transaction records.
- `Date`: Transaction posting date.
- `Description`: Merchant name or statement line item.
- `Amount`: `models.Money` integer cents (negative for debits, positive for deposits).
- `FITID`: Financial Institution Transaction ID (prevents duplicates).
- `AllocationStatus`: `BALANCED`, `PARTIALLY_ALLOCATED`, `OVER_ALLOCATED`, `UNLINKED`.
- `ReviewStatus`: `PENDING`, `APPROVED`, `IGNORED`, `WARNINGS_IGNORED`, `DELETED`.

### `Expense`
Structured purchase record extracted from receipts.
- `Timestamp`: Receipt date/time.
- `Vendor`: Store or merchant name.
- `Amount`: `models.Money` integer cents.
- `TaxAmount`: `models.Money` integer cents.
- `Tender`: `card`, `cash`, `check`, `transfer`, etc.
- `ChartAccountID`: Category classification.
- `AllocationStatus`: `BALANCED`, `UNLINKED`, etc.

### `Invoice`
Accounts receivable client invoices.
- `InvoiceNumber`: Unique code (e.g. `INV-1001`).
- `ClientName`, `ClientEmail`, `ClientAddress`: Customer details.
- `IssueDate`, `DueDate`: Date windowing (enforces `dueDate >= issueDate`).
- `Items`: JSON array of line items with quantities, rates, and amounts.
- `TotalAmount`, `AmountPaid`, `BalanceDue`: Exact integer-cent balances.
- `Status`: `DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`.

### `BankRule`
Automated categorization rule.
- `Name`: Friendly label.
- `Priority`: Ascending execution order.
- `Conditions`: JSON array of conditions (`field`, `operator`, `value`, `caseSensitive`).
- `TargetCategoryID`: Target `ChartAccount` foreign key.
- `RenameVendor`: Standardized merchant name override.

---

## 7. API Reference

All API routes are served under `/api` via Nginx (port 5173) or directly on port 8080:

### System & Health
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Comprehensive health report (DB, Ollama models, File Processor, storage) |
| `GET` | `/health` | Docker container liveness probe |
| `GET` | `/api/events` | Server-Sent Events (SSE) live sync stream |
| `GET` | `/api/system/backup/export` | Download full JSON system snapshot |
| `POST` | `/api/system/backup/restore` | Restore full JSON system snapshot |

### Ledger & Ingestion
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Multipart file upload for receipts and bank statements |
| `GET` | `/api/images/*` | Securely serves processed receipt images/PDFs |
| `GET` | `/api/transactions` | Query bank transactions (`?startDate=&endDate=&status=&accountId=`) |
| `POST` | `/api/transactions` | Create manual bank transaction |
| `PATCH` | `/api/transactions/:id` | Update transaction category, note, or description |
| `DELETE` | `/api/transactions/:id` | Soft-delete transaction (blocked in closed period) |
| `GET` | `/api/transactions/export` | Export bank transactions to sanitized CSV |
| `GET` | `/api/expenses` | Query expense receipts |
| `POST` | `/api/expenses` | Create manual expense |
| `PATCH` | `/api/expenses/:id` | Update expense details |
| `DELETE` | `/api/expenses/:id` | Soft-delete expense (blocked in closed period) |
| `POST` | `/api/expenses/:id/split` | Split expense across multiple accounts |
| `PATCH` | `/api/expenses/:id/cash` | Mark expense as cash (bypasses reconciliation) |
| `GET` | `/api/expenses/export` | Export expenses to sanitized CSV |

### Invoices & Receivables
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/invoices` | List invoices with A/R metric cards |
| `POST` | `/api/invoices` | Create invoice |
| `GET` | `/api/invoices/:id` | Get single invoice details |
| `PATCH` | `/api/invoices/:id` | Update invoice status or details |
| `DELETE` | `/api/invoices/:id` | Void or delete invoice |
| `POST` | `/api/invoices/:id/match-payment` | Match incoming bank deposit to invoice |
| `POST` | `/api/invoices/:id/unmatch-payment` | Unlink matched bank deposit |
| `GET` | `/api/invoices/:id/candidates` | Candidate bank deposits ranked for invoice settlement |

### Reports & Compliance
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/reports/pl` | Profit & Loss statement |
| `GET` | `/api/reports/cash-flow` | Cash Flow statement |
| `GET` | `/api/reports/vendor-spend` | Vendor spend summary with 1099-NEC \$600 threshold tracking |
| `GET` | `/api/reports/ar-aging` | A/R aging buckets (Current, 1-30, 31-60, 61-90, 90+) |
| `GET` | `/api/reports/schedule-c` | Form 1040 Schedule C summary, 1040-ES & Schedule SE |
| `GET` | `/api/reports/trial-balance` | GAAP Trial Balance double-entry verification ($\sum D \equiv \sum C$) |
| `GET` | `/api/reports/trial-balance/export` | Export GAAP Trial Balance to CSV |
| `GET` | `/api/reports/tax-pack` | Download CPA Tax Pack .zip bundle |

---

## 8. Configuration & Environment Variables

This is a production-grade development environment. The entire stack (including the AI models, OCR, Database, and Web servers) runs inside a unified Docker Compose network. There are absolutely no host-level dependencies other than Docker itself.

### Prerequisites
- **Docker & Docker Compose**

### 1. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

If you want the inbox folder to live somewhere else (like your Desktop), update the `DOCUMENT_DATA_PATH` in `.env`:
```env
DOCUMENT_DATA_PATH=/path/to/your/Desktop/document-data
```

### 2. Start the Stack

Run the following command to build and boot the entire infrastructure:
```bash
docker compose up -d --build
```

**Note on first boot:** The `ollama` container will take several minutes to automatically download the AI models (`llama3.1:8b` and `qwen2.5vl:3b`). The `file-processor` and `backend` containers will automatically wait for this to finish before booting.

### 3. Access the Application

Once all containers are healthy, open your browser to:
- **http://localhost:5173**

You can drop receipts directly into the `DOCUMENT_DATA_PATH/inbox/` folder on your machine, or connect to the SMB share at `\\localhost\inbox` (User: `scanner`, Pass: `password123`).

---

## Service Endpoints

Only Nginx and the SMB share are exposed to your host machine. Everything else communicates securely inside the internal Docker network.

| Service | Access |
|---------|--------|
| Web App (via Nginx) | http://localhost:5173 |
| SMB Share (scanner drop) | `\\localhost\inbox` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `pass` | PostgreSQL password |
| `POSTGRES_DB` | `reflex-tech-bookkeeping-app-postgres-db` | Database name |
| `DOCUMENT_DATA_PATH` | `./document-data` | Host path where the inbox/processed folders will be created |
| `FILE_PROCESSOR_URL` | `http://file-processor:8081/process` | Internal Docker URL for the AI processor |
| `OLLAMA_HOST` | `ollama:11434` | Internal Docker URL for Ollama |

---

**Built with pride by Reflex Technologies LLC — Utica, NY.**
