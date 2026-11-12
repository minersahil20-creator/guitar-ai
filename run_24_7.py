"""
run_24_7.py — Supervised 24/7 runner for Guitar AI + Cloudflare Tunnel.

Starts the FastAPI server (which serves both the backend API and the compiled
React frontend) and pairs it with Cloudflare Tunnel to expose a secure public
HTTPS URL with unlimited RAM, fast local CPU, and residential IP (no YouTube blocks).
"""

import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
CLOUDFLARED_BIN = ROOT_DIR / "tools" / "cloudflared.exe"
URL_FILE = ROOT_DIR / "CLOUDFLARE_URL.txt"
LOG_DIR = ROOT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

PYTHON_EXE = sys.executable

def check_backend_health() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False

def main():
    print("=" * 60)
    print(" Guitar AI — 24/7 Cloudflare Tunnel Supervisor")
    print("=" * 60)

    # 1. Start backend process
    print("[1/3] Starting backend FastAPI + UI server on http://127.0.0.1:8000 ...")
    backend_log = open(LOG_DIR / "backend.log", "a", encoding="utf-8")
    backend_proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(BACKEND_DIR),
        stdout=backend_log,
        stderr=subprocess.STDOUT,
    )

    # Wait for backend to be healthy
    for _ in range(30):
        if check_backend_health():
            print("      Backend is healthy and ready!")
            break
        time.sleep(0.5)
    else:
        print("      Warning: Backend took longer than expected to report health.")

    # 2. Start Cloudflare Tunnel
    print("[2/3] Launching Cloudflare Tunnel ...")
    tunnel_log = open(LOG_DIR / "tunnel.log", "a", encoding="utf-8")
    tunnel_proc = subprocess.Popen(
        [str(CLOUDFLARED_BIN), "tunnel", "--url", "http://127.0.0.1:8000"],
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    # 3. Read output to find the public URL
    print("[3/3] Establishing Cloudflare edge connection ...")
    tunnel_url = None
    url_regex = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    start_time = time.time()
    while time.time() - start_time < 30:
        line = tunnel_proc.stdout.readline()
        if not line:
            break
        tunnel_log.write(line)
        tunnel_log.flush()
        match = url_regex.search(line)
        if match:
            tunnel_url = match.group(0)
            break

    if tunnel_url:
        print("\n" + "*" * 60)
        print(f" PUBLIC 24/7 URL: {tunnel_url}")
        print("*" * 60 + "\n")
        URL_FILE.write_text(f"{tunnel_url}\n", encoding="utf-8")
    else:
        print("Tunnel started. Check logs/tunnel.log for connection details.")

    # 4. Supervision loop: restart if either exits
    try:
        while True:
            time.sleep(5)
            # Drain tunnel stdout to log
            while True:
                line = tunnel_proc.stdout.readline()
                if not line:
                    break
                tunnel_log.write(line)
                tunnel_log.flush()
                m = url_regex.search(line)
                if m and m.group(0) != tunnel_url:
                    tunnel_url = m.group(0)
                    URL_FILE.write_text(f"{tunnel_url}\n", encoding="utf-8")
                    print(f"Updated Public URL: {tunnel_url}")

            if backend_proc.poll() is not None:
                print("Backend exited unexpectedly. Restarting backend...")
                backend_proc = subprocess.Popen(
                    [PYTHON_EXE, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
                    cwd=str(BACKEND_DIR),
                    stdout=backend_log,
                    stderr=subprocess.STDOUT,
                )

            if tunnel_proc.poll() is not None:
                print("Tunnel exited unexpectedly. Restarting tunnel...")
                tunnel_proc = subprocess.Popen(
                    [str(CLOUDFLARED_BIN), "tunnel", "--url", "http://127.0.0.1:8000"],
                    cwd=str(ROOT_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
    except KeyboardInterrupt:
        print("Shutting down servers...")
        backend_proc.terminate()
        tunnel_proc.terminate()

if __name__ == "__main__":
    main()
