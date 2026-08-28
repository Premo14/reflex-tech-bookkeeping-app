# Reflex Tech Bookkeeping App

A single-entry bookkeeping system designed to minimize manual data entry. The application ingests raw receipts and bank statements, extracts structured data via a local AI pipeline, reconciles the two datasets, and presents the results through a web interface.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Go, Fiber v3, GORM |
| File Processor | Go, fasthttp |
| Database | PostgreSQL |
| Frontend | React, TypeScript, Tailwind CSS, Vite |
| Containerization | Docker, Docker Compose |

---

## Dependencies

### Backend
- **[Fiber v3](https://github.com/gofiber/fiber)** — HTTP web framework
- **[GORM](https://gorm.io/)** — ORM for PostgreSQL
- **[goheif](https://github.com/adrium/goheif)** — Decodes iPhone `.heic` images to `.png`
- **[ofxgo](https://github.com/aclindsa/ofxgo)** — Parses `.ofx` and `.qfx` bank statement files
- **[fsnotify](https://github.com/fsnotify/fsnotify)** — File system watcher for the inbox

### File Processor
- **[fasthttp](https://github.com/valyala/fasthttp)** — High-performance HTTP server and client
- **[Tesseract OCR](https://github.com/tesseract-ocr/tesseract)** — CPU-based OCR engine for extracting text from receipt images and PDFs
- **[Poppler Utils](https://poppler.freedesktop.org/)** — PDF-to-image conversion via `pdftoppm`
- **[Ollama](https://ollama.com/)** — Local LLM runtime serving `llama3.1:8b`
- **[llama3.1:8b](https://ollama.com/library/llama3.1)** — Text-only language model used to structure raw OCR output into typed JSON

### Frontend
- **[React](https://react.dev/)** — UI framework
- **[React Router](https://reactrouter.com/)** — Client-side routing
- **[Tailwind CSS](https://tailwindcss.com/)** — Utility-first CSS framework

---

## Running the Application

### Prerequisites
- Docker & Docker Compose
- Go 1.21+
- Ollama with `llama3.1:8b` pulled (`ollama pull llama3.1:8b`)
- Tesseract OCR (`sudo apt-get install tesseract-ocr`)
- Poppler Utils (`sudo apt-get install poppler-utils`)

### Start the Docker Services
```bash
docker compose up -d
```

### Start the File Processor
```bash
cd file-processor
go run main.go
```

### Service Endpoints

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080 |
| File Processor | http://localhost:8081 |

---

## How It Works

### 1. File Ingestion
Receipt files (`.png`, `.jpg`, `.jpeg`, `.heic`, `.pdf`) and bank statements (`.ofx`, `.qfx`) are dropped into an inbox folder via the UI upload or by mapping the SMB share to a local network scanner.

### 2. File Processing Pipeline
A background file watcher monitors the inbox. On each new file event, it debounces rapid OS write bursts, validates the file extension, generates a SHA-256 hash to reject duplicates, converts `.heic` images to `.png`, and moves the file to a `processed/` directory. A database record is created for each receipt.

### 3. AI Extraction Pipeline
Once a receipt is saved, it is forwarded to the File Processor service on port `8081`. For PDFs, `pdftoppm` converts each page to a PNG image. Tesseract OCR runs sequentially on each page image and the extracted text is concatenated into a single string. That string is sent to `llama3.1:8b` via Ollama, which returns a structured `Expense` JSON object. The expense is saved to the database and linked to the receipt.

### 4. Bank Statement Parsing
`.ofx` and `.qfx` files are parsed into `BankTransaction` records. Duplicate transactions are automatically rejected using the bank-issued `FITID` unique identifier.

### 5. Reconciliation Engine
A multi-pass algorithm autonomously attempts to link expenses to bank transactions:

- **Pass 1 — Scoring (Direct Matches):** Each expense is scored against available transactions. Points are awarded for an exact amount match (+50), date proximity (+10 to +30), and vendor name similarity (+20). Scores of 80+ are auto-linked. Scores above 0 are flagged as suggested matches for manual review.
- **Pass 2 — Split Transactions:** A recursive subset-sum algorithm identifies combinations of multiple expenses on the same day that sum to an unmatched transaction amount.
- **Pass 3 — Status Flags:** Each transaction is marked `MATCHED` or `UNMATCHED` based on whether the sum of its linked expenses equals its total amount.

### 6. Accounting Periods
The app manages open and closed accounting periods. A period cannot be closed if unresolved orphaned expenses or unmatched transactions remain.
