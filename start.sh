#!/bin/bash
# =============================================================================
# Reflex Tech Bookkeeping App — Unified Launch Script
# Company: Reflex Technologies LLC (Utica, NY)
# Supports: macOS (Apple Silicon / Intel), Linux (NVIDIA CUDA, AMD ROCm, CPU)
# =============================================================================
set -e

echo ""
echo "======================================================"
echo "  Reflex Tech Bookkeeping App — Starting Platform"
echo "  Reflex Technologies LLC (Utica, NY)"
echo "======================================================"
echo ""

# 1. Verify Docker is installed
if ! command -v docker > /dev/null 2>&1; then
    echo "[ERROR] Docker is not installed on this system."
    echo "        Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/"
    echo ""
    exit 1
fi

# 2. Verify Docker daemon is running
if ! docker info > /dev/null 2>&1; then
    echo "[ERROR] Docker is installed, but the Docker daemon is not running."
    echo "        Please launch Docker Desktop (or start the Docker service) and re-run this script."
    echo ""
    exit 1
fi

# 3. Auto-initialize .env from .env.example if missing
if [ ! -f ".env" ]; then
    echo "[INFO] No .env file detected. Creating default .env configuration..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        cat << 'EOF' > .env
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=reflex-tech-bookkeeping-app-postgres-db
POSTGRES_USER=user
POSTGRES_PASSWORD=pass
OLLAMA_HOST=ollama:11434
DOCUMENT_DATA_PATH=./document-data
FILE_PROCESSOR_URL=http://file-processor:8081/process
EOF
    fi
    echo "[INFO] Generated .env successfully."
fi

# 4. Ensure document intake directories exist with proper write permissions
mkdir -p ./document-data/inbox ./document-data/processed
chmod -R 755 ./document-data 2>/dev/null || true
# Allow scanner UID 1000 to write to inbox; owner gets rw via umask
chmod 775 ./document-data ./document-data/inbox ./document-data/processed 2>/dev/null || true

# 5. Hardware auto-detection
echo "[INFO] Detecting hardware configuration..."
OS="$(uname -s)"
COMPOSE_ARGS=("-f" "docker-compose.yml")

if [ "$OS" = "Darwin" ]; then
    echo "[INFO] macOS detected (Apple Silicon / Intel)."
    echo "[INFO] Running in CPU mode (Docker Mac does not support GPU container passthrough)."
elif command -v nvidia-smi > /dev/null 2>&1 && nvidia-smi > /dev/null 2>&1; then
    echo "[INFO] NVIDIA GPU detected:"
    nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | while IFS= read -r gpu; do
        echo "       -> $gpu"
    done
    echo "[INFO] Starting with CUDA (NVIDIA) GPU acceleration..."
    COMPOSE_ARGS+=("-f" "docker-compose.nvidia.yml")
elif [ -e "/dev/kfd" ] || command -v rocm-smi > /dev/null 2>&1; then
    echo "[INFO] AMD GPU detected (ROCm)."
    COMPOSE_ARGS+=("-f" "docker-compose.amd.yml")
else
    echo "[WARN] No supported dedicated GPU detected. Starting in CPU mode."
fi

# 6. Launch Docker containers
echo "[INFO] Starting containers via Docker Compose..."
docker compose "${COMPOSE_ARGS[@]}" up -d

echo ""
echo "======================================================"
echo "  Reflex Tech Bookkeeping App is Ready!"
echo "======================================================"
echo ""
echo "  Web Application:    http://localhost:5173"
echo "  Backend API:        http://localhost:8080 (or http://localhost:5173/api)"
echo "  Network Scanner:    \\\\<your-ip>\\inbox  (SMB port 445/139)"
echo "                      Credentials: scanner / password123"
echo ""
echo "  AI Engine (Ollama):"
echo "    Running locally and private. On first run, models"
echo "    (qwen2.5vl & llama3.1) initialize in the background."
echo ""
echo "  Useful Commands:"
echo "    Stop App:         ./stop.sh"
echo "    View Live Logs:   docker compose logs -f"
echo "    System Status:    curl http://localhost:5173/api/health"
echo "======================================================"
echo ""
