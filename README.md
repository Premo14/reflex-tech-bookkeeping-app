# reflex-tech-bookkeeping-app
Bookkeeping project for Reflex Technologies

## Overview
A single-entry bookkeeping system that ingests raw receipts and bank statements, extracts structured data from them, reconciles the two datasets automatically, and presents the results through a clean web interface.

## How to Run

### Running with Docker
This method runs the frontend, backend, and PostgreSQL database together in isolated containers.

```bash
# 1. Clone the repository
git clone <repository-url>
cd reflex-tech-bookkeeping-app

# 2. Start the services
docker compose up -d

# The frontend will be available at http://localhost:5173
# The backend API will be available at http://localhost:8080
```

## Current Notes

### Processing Pipeline
- **Server-Side Conversion:** All image processing, including converting iPhone `.heic` files to standard `.png` format, is handled by the Go backend (via `goheif`).
- **Drop Zone Ingestion:** The backend watches the `/app/documents/inbox/{user}/` folder for new files. Uploads can be handled via the web UI or external sync tools like Syncthing.
