@echo off
:: =============================================================================
:: Reflex Tech Bookkeeping App — Windows Launch Script
:: Company: Reflex Technologies LLC (Utica, NY)
:: Supports: NVIDIA (CUDA), AMD (WSL2 recommendation), CPU fallback
:: =============================================================================
setlocal EnableDelayedExpansion

echo.
echo ======================================================
echo   Reflex Tech Bookkeeping App - Starting Platform
echo   Reflex Technologies LLC (Utica, NY)
echo ======================================================
echo.

:: 1. Verify Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not installed or not found on PATH.
    echo         Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

:: 2. Verify Docker daemon is running
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is installed, but Docker Desktop is not currently running.
    echo         Please start Docker Desktop and run this script again.
    echo.
    pause
    exit /b 1
)

:: 3. Auto-initialize .env from .env.example if missing
if not exist ".env" (
    echo [INFO] No .env file detected. Creating default .env configuration...
    if exist ".env.example" (
        copy .env.example .env >nul
    ) else (
        (
            echo POSTGRES_HOST=postgres
            echo POSTGRES_PORT=5432
            echo POSTGRES_DB=reflex-tech-bookkeeping-app-postgres-db
            echo POSTGRES_USER=user
            echo POSTGRES_PASSWORD=pass
            echo OLLAMA_HOST=ollama:11434
            echo DOCUMENT_DATA_PATH=./document-data
            echo FILE_PROCESSOR_URL=http://file-processor:8081/process
        ) > .env
    )
    echo [INFO] Generated .env successfully.
)

:: 4. Ensure document intake directories exist
if not exist "document-data\inbox" mkdir "document-data\inbox"
if not exist "document-data\processed" mkdir "document-data\processed"

:: 5. Hardware auto-detection
echo [INFO] Detecting hardware configuration...

where nvidia-smi >nul 2>nul
if %ERRORLEVEL% equ 0 (
    nvidia-smi >nul 2>nul
    if !ERRORLEVEL! equ 0 (
        echo [INFO] NVIDIA GPU detected with CUDA support.
        echo [INFO] Starting with CUDA GPU acceleration...
        docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
        goto :running
    )
)

wmic path Win32_VideoController get Name 2>nul | findstr /i "AMD Radeon" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] AMD GPU detected.
    echo [WARN] Native Windows Docker does not yet officially support AMD ROCm passthrough.
    echo [WARN] For full AMD GPU acceleration, run this inside WSL2 using ./start.sh instead.
    echo [WARN] Starting in CPU mode...
    docker compose -f docker-compose.yml up -d
    goto :running
)

echo [WARN] No supported dedicated GPU detected. Starting in CPU mode.
docker compose -f docker-compose.yml up -d

:running
echo.
echo ======================================================
echo   Reflex Tech Bookkeeping App is Ready!
echo ======================================================
echo.
echo   Web Application:    http://localhost:5173
echo   Backend API:        http://localhost:8080 (or http://localhost:5173/api)
echo   Network Scanner:    \\localhost\inbox (or \\^<your-ip^>\inbox)
echo                       Credentials: scanner / password123
echo.
echo   AI Engine (Ollama):
echo     Running locally and private. On first run, models
echo     (qwen2.5vl & llama3.1) initialize in the background.
echo.
echo   Useful Commands:
echo     Stop App:         stop.bat
echo     View Live Logs:   docker compose logs -f
echo     System Status:    http://localhost:5173/api/health
echo ======================================================
echo.
pause
