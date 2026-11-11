#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Start both servers (macOS / Linux)
#   chmod +x scripts/start-dev.sh
#   ./scripts/start-dev.sh
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

echo "▶ Backend  (FastAPI)  →  http://localhost:8000/docs"
cd backend
if [ ! -d ".venv" ]; then
  echo "  creating virtual environment…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

# PyPI wheels for torch are big; /tmp is often a small RAM disk on Linux.
# Point pip's temp dir somewhere roomy so the download cannot fail.
export TMPDIR="${TMPDIR:-$HOME/.pip-tmp}"
mkdir -p "$TMPDIR"

# Link fetching (paste a YouTube / SoundCloud link instead of a file).
# yt-dlp does the downloading; imageio-ffmpeg ships a static ffmpeg so
# mp3/m4a/video decoding works without installing ffmpeg system-wide.
python3 -c "import yt_dlp" 2>/dev/null || pip install -q yt-dlp
python3 -c "import imageio_ffmpeg" 2>/dev/null || pip install -q imageio-ffmpeg

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND=$!

echo "▶ Frontend (Vite)     →  http://localhost:5173"
cd ../frontend
if [ ! -d "node_modules" ]; then
  echo "  installing npm packages…"
  npm install
fi
npm run dev &
FRONTEND=$!

trap 'echo "Shutting down…"; kill $BACKEND $FRONTEND 2>/dev/null' EXIT
wait
