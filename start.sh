#!/bin/bash
# =============================================================================
# Reflex Tech Bookkeeping App — Launch Script
# Detects the host GPU and starts the correct Docker Compose configuration.
# Supports: NVIDIA (CUDA), AMD (ROCm), and CPU fallback.
# =============================================================================
set -e

echo ""
echo "======================================"
echo "  Reflex Tech Bookkeeping App"
echo "======================================"
echo ""
echo "Detecting hardware configuration..."

OS="$(uname -s)"

# --- macOS -------------------------------------------------------------------
# Docker Desktop for Mac does not support GPU passthrough into Linux containers.
# Apple Silicon (Metal) and Intel Macs both fall back to CPU mode.
if [ "$OS" = "Darwin" ]; then
    echo "[INFO] macOS detected."
    echo "[INFO] Docker Desktop for Mac does not support GPU passthrough."
    echo "[INFO] Starting in CPU mode..."
    docker compose -f docker-compose.yml up -d
    exit 0
fi

# --- NVIDIA ------------------------------------------------------------------
# nvidia-smi is the standard CLI tool shipped with every NVIDIA driver.
# If it runs successfully, an NVIDIA GPU + driver is present.
if command -v nvidia-smi > /dev/null 2>&1 && nvidia-smi > /dev/null 2>&1; then
    echo "[INFO] NVIDIA GPU detected."
    nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | while IFS= read -r gpu; do
        echo "      -> $gpu"
    done
    echo "[INFO] Starting with CUDA (NVIDIA) support..."
    docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
    exit 0
fi

# --- AMD ---------------------------------------------------------------------
# /dev/kfd is the AMD Kernel Fusion Driver device node — it only exists when
# the ROCm driver stack is installed and an AMD GPU is present.
# rocm-smi is the ROCm equivalent of nvidia-smi.
if [ -e "/dev/kfd" ] || command -v rocm-smi > /dev/null 2>&1; then
    echo "[INFO] AMD GPU detected (ROCm)."
    if command -v rocm-smi > /dev/null 2>&1; then
        rocm-smi --showproductname 2>/dev/null | grep -i "card\|gpu" || true
    fi
    echo "[INFO] Starting with ROCm (AMD) support..."
    echo "[WARN] AMD ROCm GPU passthrough requires Linux with the ROCm driver stack installed."
    docker compose -f docker-compose.yml -f docker-compose.amd.yml up -d
    exit 0
fi

# --- CPU Fallback ------------------------------------------------------------
echo "[WARN] No supported GPU detected (NVIDIA or AMD)."
echo "[WARN] Starting in CPU mode. Performance will be significantly reduced."
echo "[WARN] Large language model inference without a GPU can be very slow."
docker compose -f docker-compose.yml up -d
