# Ollama AI Service

This service provides the local Large Language Models (LLMs) used to extract structured data from receipts and documents. By running these models locally, no sensitive financial data ever leaves your network.

## The Models
- **`qwen2.5vl:3b`**: A Vision-Language Model (VLM) used to directly read and extract structured data from photo receipts (JPG/PNG/HEIC).
- **`llama3.1:8b`**: A text-based LLM used to process the raw OCR text extracted from PDFs.

## How It Works
The standard Ollama Docker image does not download models automatically. We use a custom `entrypoint.sh` script that:
1. Starts the Ollama server in the background.
2. Waits for the server to become responsive.
3. Automatically runs `ollama pull` for the required models.
4. Keeps the server running indefinitely.

*Note: On the first boot, this container may take several minutes to download the models. Dependent containers will wait for the healthcheck to pass before starting.*
