@echo off
:: =============================================================================
:: Reflex Tech Bookkeeping App - Launch Script (Windows)
:: Detects the host GPU and starts the correct Docker Compose configuration.
:: Supports: NVIDIA (CUDA), AMD (noted with WSL guidance), and CPU fallback.
:: =============================================================================
setlocal EnableDelayedExpansion

echo.
echo ======================================
echo   Reflex Tech Bookkeeping App
echo ======================================
echo.
echo Detecting hardware configuration...

:: --- NVIDIA ------------------------------------------------------------------
:: nvidia-smi.exe is installed alongside every NVIDIA driver on Windows.
:: If it is on the PATH and exits cleanly, an NVIDIA GPU is present.
where nvidia-smi >nul 2>nul
if %ERRORLEVEL% equ 0 (
    nvidia-smi >nul 2>nul
    if !ERRORLEVEL! equ 0 (
        echo [INFO] NVIDIA GPU detected.
        for /f "tokens=*" %%G in ('nvidia-smi --query-gpu^=name --format^=csv^,noheader 2^>nul') do (
            echo       -^> %%G
        )
        echo [INFO] Starting with CUDA ^(NVIDIA^) support...
        docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d
        goto :eof
    )
)

:: --- AMD ---------------------------------------------------------------------
:: On native Windows, ROCm GPU passthrough into Docker is not yet officially
:: supported. We detect AMD hardware via WMI and give a clear message.
wmic path Win32_VideoController get Name 2>nul | findstr /i "AMD Radeon" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] AMD GPU detected.
    echo [WARN] ROCm GPU passthrough on native Windows is not officially supported by Docker.
    echo [WARN] To use your AMD GPU, run this app inside WSL2 and use ./start.sh instead.
    echo [WARN] Falling back to CPU mode. Performance will be significantly reduced.
    docker compose -f docker-compose.yml up -d
    goto :eof
)

:: --- CPU Fallback ------------------------------------------------------------
echo [WARN] No supported GPU detected ^(NVIDIA or AMD^).
echo [WARN] Starting in CPU mode. Performance will be significantly reduced.
echo [WARN] Large language model inference without a GPU can be very slow.
docker compose -f docker-compose.yml up -d
