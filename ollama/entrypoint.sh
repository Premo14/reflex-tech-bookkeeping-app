#!/bin/bash
set -e

echo "[ollama] Starting Ollama server in background..."
ollama serve &
OLLAMA_PID=$!

echo "[ollama] Waiting for server to be ready..."
until ollama list > /dev/null 2>&1; do
    sleep 2
done
echo "[ollama] Server is up."

echo "[ollama] Pulling llama3.1:8b (text model)..."
ollama pull llama3.1:8b

echo "[ollama] Pulling qwen2.5vl:3b (vision model)..."
ollama pull qwen2.5vl:3b

echo "[ollama] All models ready. Handing off to server."
wait $OLLAMA_PID