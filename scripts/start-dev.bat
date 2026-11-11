@echo off
REM ─────────────────────────────────────────────────────────────
REM  Start both servers (Windows)
REM    scripts\start-dev.bat
REM ─────────────────────────────────────────────────────────────
cd /d "%~dp0\.."

echo Starting backend (FastAPI) on http://localhost:8000/docs
cd backend
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
REM Link fetching (paste a link instead of a file) + static ffmpeg for mp3/m4a/video
python -c "import yt_dlp" 2>nul || pip install -q yt-dlp
python -c "import imageio_ffmpeg" 2>nul || pip install -q imageio-ffmpeg
start "Guitar AI - Backend" cmd /k "call .venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

cd ..\frontend
if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
)
echo Starting frontend (Vite) on http://localhost:5173
start "Guitar AI - Frontend" cmd /k "npm run dev"

echo.
echo Both servers are starting in separate windows.
echo   Frontend: http://localhost:5173
echo   Backend : http://localhost:8000/docs
pause
