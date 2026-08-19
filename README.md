# reflex-tech-bookkeeping-app
Bookkeeping project for Reflex Technologies

## Overview
A single-entry bookkeeping system designed to minimize manual data entry. It ingests raw receipts and bank statements, extracts structured data, reconciles the two datasets automatically, and presents the results through a clean web interface. The primary goal is to fully automate the reconciliation process for monthly accounting periods.

## How to Run

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/) installed.
- (Optional for development) [Node.js](https://nodejs.org/) & [Go](https://go.dev/) installed.

### Running the App
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd reflex-tech-bookkeeping-app
   ```

2. Start the services using Docker:
   ```bash
   docker compose up -d
   ```

3. Access the application:
   - **Frontend UI:** [http://localhost:5173](http://localhost:5173)
   - **Backend API:** [http://localhost:8080](http://localhost:8080)

## Tech Stack & Key Dependencies
- **Backend:** Go, Fiber (API Framework), GORM (ORM)
- **Database:** PostgreSQL
- **Frontend:** React, TypeScript, Tailwind CSS, React Router, Vite
- **Key Libraries:**
  - `goheif`: Natively decodes iPhone `.heic` images into standard `.png` formats for browser compatibility.
  - `parseOfx`: Idempotently parses Open Financial Exchange (`.ofx`) bank statements.

## Birds Eye View
1. **File Ingestion:** Users drop receipt files or `.ofx` bank statements into an inbox folder (via UI upload or local folder syncing).
2. **File Processing Pipeline:** A background watcher debounces rapid OS write events, verifies extensions, handles HEIC image conversions, and hashes files to prevent duplicate uploads.
3. **AI Image Processing (The Current Hole):** ⚠️ *Currently, the AI extraction from receipt images to structured data is mocked. This is the main missing piece.* Once implemented, it will read a physical receipt and extract the Vendor, Amount, Date, and Tender type.
4. **Bank Parsing:** Open Financial Exchange (`.ofx`) files are parsed into database bank transactions. The system automatically ignores duplicates using the bank's unique `FITID`.
5. **Reconciliation Engine:** A multi-pass algorithm attempts to autonomously link extracted expenses (receipts) to bank transactions.
6. **Accounting Periods:** The app dynamically manages open/closed accounting periods, strictly preventing the closing of a month if there are unresolved orphaned expenses or unmatched transactions.

## Business-Level Logic: The Scoring System & Reconciliation
The core matching engine runs autonomously in three main passes to link expenses to transactions:

- **Pass 1: The Scoring System (Direct Matches)**
  The app calculates a match score for each expense against available bank transactions:
  - **Amount:** Exact match = +50 points
  - **Date Window:** Same day = +30 points, 1 day apart = +20 points, 2-4 days apart = +10 points
  - **String Similarity:** Extracted vendor name found in bank transaction description = +20 points
  - **Outcome:** A score of `80+` results in an automatic hard link. A score `> 0` results in a soft link (Suggested Match) for the user to approve manually in the UI.

- **Pass 2: Split Transactions (Subset-Sum Algorithm)**
  If there are remaining unmatched bank transactions, the app uses a recursive subset-sum algorithm. It finds specific combinations of multiple split receipts on the same day that add up perfectly to the target bank transaction amount.

- **Pass 3: Status Flags**
  Finally, the system verifies that the sum of all attached expenses equals the bank transaction amount, marking it as `MATCHED` or `UNMATCHED`.

## Database Management & Mocking
Since the AI processing step is currently skipped, you can seed the database with mock expenses to test the reconciliation engine:
```bash
docker exec -it backend sh -c "cd seed && go run seed.go"
```
*Note: This command truncates all existing data and re-seeds it from scratch.*
