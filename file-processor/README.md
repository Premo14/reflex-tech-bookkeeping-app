# File Processor Service (Go)

This service is a self-contained document extraction pipeline. It is responsible for taking raw receipt images and bank statement PDFs, performing OCR, and calling the AI models to extract structured JSON data.

## Key Responsibilities
- **PDF Rasterization**: Uses `pdftoppm` (Poppler) to convert PDFs into PNG images.
- **OCR**: Uses Tesseract to extract raw text from document images.
- **Image Optimization**: Uses Python and Pillow to resize and optimize extremely large photos to prevent LLM memory exhaustion.
- **AI Orchestration**: Takes the processed images/text and sends them to the `ollama` container to extract structured JSON.

## Development
Like the backend, this service is fully containerized and uses `air` for hot-reloading during development. You do not need to install Tesseract or Poppler on your host machine to work on this code.
