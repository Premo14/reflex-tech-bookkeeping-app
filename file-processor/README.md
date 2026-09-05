# File Processor

A lightweight, high-performance microservice that accepts raw receipt files and returns AI-extracted, structured expense data as JSON. It acts as the document intelligence layer between the bookkeeping app's backend and a locally running Ollama LLM instance — all processing happens on-device with no data sent to any external service.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [How It Works — Per File Type](#how-it-works--per-file-type)
3. [Tech Stack](#tech-stack)
4. [API](#api)
5. [Prerequisites](#prerequisites)
6. [Running](#running)
7. [Configuration](#configuration)

---

## What It Does

The file processor exposes a single HTTP endpoint (`POST /process`) that accepts a receipt file and returns a structured JSON expense object. The parent bookkeeping app's backend calls this service automatically whenever a new receipt is ingested from the inbox folder.

**Input:** A receipt file (`multipart/form-data`)  
**Output:** A JSON object with the extracted expense details:

```json
{
  "timestamp": "2023-08-16T18:51:49Z",
  "vendor": "Walmart",
  "description": "Groceries",
  "amount": 181.13,
  "tender": "VISA"
}
```

---

## How It Works — Per File Type

### Image Files (`.jpg`, `.jpeg`, `.png`)

**Pipeline: Pillow resize → base64 encode → Ollama vision model**

1. **Save** — The uploaded image is written to a temporary path on disk.
2. **Resize (PIL / Pillow)** — A Python subprocess runs an inline Pillow script to:
   - Apply EXIF orientation correction (so camera photos aren't rotated)
   - If the image exceeds 2000px on its longest dimension: downsample to 2000px using **BOX** filtering (avoids Moiré aliasing artifacts that cause vision models to fail)
   - Then further downsample to a maximum of **1200px** using **LANCZOS** interpolation for high quality
   - Save as JPEG at quality 85

   This two-stage resize is intentional: jumping directly from 4000px to 1200px with a single LANCZOS pass produces aliasing patterns that visually corrupt text in the image, causing the model to hallucinate incorrect values.

3. **Base64 encode** — The resized image bytes are read and base64-encoded.
4. **Vision model inference** — The encoded image and a structured prompt are sent to Ollama's `/api/generate` endpoint using the `qwen2.5vl:3b` model (a 3-billion-parameter multimodal vision-language model). The model reads the receipt image directly and returns raw JSON.
5. **Response** — The model's raw JSON response is forwarded as-is to the caller.

### PDF Files (`.pdf`)

**Pipeline: pdftoppm rasterise → Tesseract OCR → Ollama text model**

1. **Save** — The uploaded PDF is written to a temporary path on disk.
2. **Rasterise pages** — `pdftoppm` (from Poppler Utils) converts each page of the PDF to a PNG image at **150 DPI**. This resolution gives Tesseract enough detail for accurate character recognition without producing excessively large files.
3. **OCR** — `tesseract` runs on each page image sequentially, extracting raw text. The text from all pages is concatenated with double newline separators.
4. **Text model inference** — The full OCR text is appended to a structured prompt and sent to Ollama's `/api/generate` endpoint using the `llama3.1:8b` model (a text-only LLM). The model is instructed to parse the OCR output and return only a valid JSON object with no markdown or explanation.
5. **Cleanup** — All temporary files (original PDF, per-page PNGs, resized images) are deleted after processing.
6. **Response** — The model's JSON response is forwarded to the caller.

### Why Two Different Models?

| File Type | Model | Reason |
|-----------|-------|--------|
| Images | `qwen2.5vl:3b` | A vision-capable model can directly interpret pixel-level receipt layouts, logos, handwriting, and formatting that OCR would misread |
| PDFs | `llama3.1:8b` | PDFs typically produce clean, accurate OCR text; a fast text-only model is more reliable and efficient for structured text parsing than running vision inference on rasterised pages |

---

## Tech Stack

### Languages

| Language | Version | Purpose |
|----------|---------|---------|
| Go | 1.26.5 | HTTP server, request handling, subprocess orchestration |
| Python | 3.x (system) | Image resizing via Pillow — called as an inline subprocess by Go |

### Go Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [fasthttp](https://github.com/valyala/fasthttp) | v1.73.0 | HTTP server (handles incoming `/process` requests) and HTTP client (calls Ollama's API) |
| [brotli](https://github.com/andybalholm/brotli) | v1.2.2 | Brotli compression support (transitive dependency of fasthttp) |
| [compress](https://github.com/klauspost/compress) | v1.19.1 | General compression (transitive dependency of fasthttp) |

### System Tools (must be installed on the host)

| Tool | Purpose | Install |
|------|---------|---------|
| [Pillow (PIL)](https://python-pillow.org/) | Image resizing and EXIF orientation correction | `pip3 install Pillow` |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | Extracts text from rasterised PDF page images | `sudo apt-get install tesseract-ocr` |
| [Poppler / pdftoppm](https://poppler.freedesktop.org/) | Converts PDF pages to PNG images at a target DPI | `sudo apt-get install poppler-utils` |

### AI Models (via Ollama)

| Model | Parameters | Type | Used For |
|-------|-----------|------|----------|
| [qwen2.5vl:3b](https://ollama.com/library/qwen2.5vl) | 3B | Vision-Language | Extracting expense data directly from receipt images |
| [llama3.1:8b](https://ollama.com/library/llama3.1) | 8B | Text-only | Structuring raw OCR text from PDFs into JSON |

---

## API

### `POST /process`

Accepts a file upload and returns extracted expense JSON.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document` | file | Yes | The receipt file to process (`.jpg`, `.jpeg`, `.png`, `.pdf`) |
| `prompt` | string | No | Override the default extraction prompt sent to the model |

**Response:** `application/json`

```json
{
  "timestamp": "2023-08-16T18:51:49Z",
  "vendor": "Walmart",
  "description": "Groceries",
  "amount": 181.13,
  "tender": "VISA"
}
```

**Field rules enforced by the model prompt:**
- `timestamp` — RFC3339 format (e.g. `2023-08-16T18:51:49Z`). Midnight UTC is used if no time is visible.
- `amount` — The **total paid** (not subtotal), as a number with no currency symbol.
- `tender` — Payment method string (e.g. `VISA`, `CASH`, `MASTERCARD`, `DEBIT`).
- `vendor` — The store or business name, not the address.
- `vendor`, `description`, `tender` — Empty string `""` if not determinable.
- `amount` — `0` if the total cannot be determined.

**Error responses:**

| Status | Cause |
|--------|-------|
| `400 Bad Request` | No file provided in the request |
| `500 Internal Server Error` | PIL resize failed, `pdftoppm` conversion failed, Tesseract produced no output, or Ollama call failed |
| `404 Not Found` | Any path other than `POST /process` |

---

## Prerequisites

1. **Go 1.26.5+** — to build or run the service
2. **Python 3 + Pillow** — for image resizing:
   ```bash
   pip3 install Pillow
   ```
3. **Tesseract OCR** — for PDF text extraction:
   ```bash
   sudo apt-get install tesseract-ocr
   ```
4. **Poppler Utils** — for PDF-to-image conversion:
   ```bash
   sudo apt-get install poppler-utils
   ```
5. **Ollama** — running locally with both models pulled:
   ```bash
   # Install from https://ollama.com
   ollama pull qwen2.5vl:3b
   ollama pull llama3.1:8b
   ```

---

## Running

### From source

```bash
go run main.go
```

### Pre-built binary

```bash
./file-processor
```

The service starts on **port 8081** and is ready to accept requests at `http://localhost:8081/process`.

---

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `OLLAMA_HOST` | `127.0.0.1:11434` | Hostname and port of the Ollama API. Can be set with or without the `http://` prefix. |

**Example** — Ollama running on a different machine on the same network:

```bash
OLLAMA_HOST=192.168.1.50:11434 ./file-processor
```
