@echo off
title Guitar AI - Live Cloudflare Studio
cd /d "%~dp0"

echo ========================================================
echo        Guitar AI - Live Cloudflare Studio Launcher
echo ========================================================
echo.

:: 1. Start FastAPI backend on port 8000
echo [*] Starting FastAPI Backend on port 8000...
start /b python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

:: Wait 3 seconds for server to bind
timeout /t 3 /nobreak > nul

:: 2. Launch Cloudflare Tunnel
echo [*] Launching Cloudflare Live Tunnel...
echo.
echo ========================================================
echo Your public live link will appear below:
echo ========================================================
echo.
cloudflared.exe tunnel --url http://127.0.0.1:8000
