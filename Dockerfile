# Lightweight Dockerfile for Guitar AI (Render & Cloud compatible)
FROM python:3.10-slim

# System dependencies for audio (ffmpeg, libsndfile) and YouTube JS challenges (nodejs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set up user for security (UID 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONPATH=/home/user/app/backend:$PYTHONPATH \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /home/user/app

# Install lightweight Python dependencies
COPY --chown=user:user backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend code and pre-built frontend distribution
COPY --chown=user:user backend/ ./backend/
COPY --chown=user:user frontend/dist ./frontend/dist

# Create uploads and processed directories
RUN mkdir -p uploads processed && chmod 777 uploads processed

EXPOSE 10000 7860 8000

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
