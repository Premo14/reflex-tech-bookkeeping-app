#!/bin/bash
set -e

echo "[ollama] Starting Ollama server in background..."
ollama serve &
OLLAMA_PID=$!

echo "[ollama] Waiting for server to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
until ollama list > /dev/null 2>&1; do
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "[ollama] ERROR: Server did not start within $((MAX_RETRIES * 2))s."
        exit 1
    fi
done
echo "[ollama] Server is up."

echo "[ollama] Pulling llama3.1:8b (text model)..."
ollama pull llama3.1:8b

echo "[ollama] Pulling qwen2.5vl:3b (vision model)..."
ollama pull qwen2.5vl:3b

# Verify both models loaded successfully (not just that server responded)
echo "[ollama] Verifying models are loaded..."
if ! ollama list | grep -q 'llama3.1'; then
    echo "[ollama] ERROR: llama3.1 model not found after pull."
    exit 1
fi
if ! ollama list | grep -q 'qwen2.5vl'; then
    echo "[ollama] ERROR: qwen2.5vl model not found after pull."
    exit 1
fi
echo "[ollama] All models verified ready. Handing off to server."
wait $OLLAMA_PID