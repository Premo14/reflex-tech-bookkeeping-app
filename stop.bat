@echo off
:: =============================================================================
:: Reflex Tech Bookkeeping App — Windows Shutdown Script
:: Company: Reflex Technologies LLC (Utica, NY)
:: =============================================================================
echo.
echo ======================================================
echo   Stopping Reflex Tech Bookkeeping App...
echo   Reflex Technologies LLC (Utica, NY)
echo ======================================================
echo.

docker compose down

echo.
echo [INFO] All services stopped safely.
echo [INFO] PostgreSQL database and AI model volumes are preserved.
echo [INFO] Run start.bat anytime to resume.
echo.
pause
