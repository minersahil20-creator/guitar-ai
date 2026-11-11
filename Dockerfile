# Multi-stage Dockerfile for Guitar AI on Hugging Face Spaces
# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend with Audio Processing & PyTorch
FROM python:3.10-slim

# System dependencies for audio (ffmpeg, libsndfile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up user for Hugging Face Spaces security (UID 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /home/user/app

# Install Python dependencies
COPY --chown=user:user backend/requirements.txt ./backend/
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend code, models, and frontend build
COPY --chown=user:user backend/ ./backend/
COPY --chown=user:user --from=frontend-build /app/frontend/dist ./frontend/dist

# Create uploads and processed directories
RUN mkdir -p uploads processed && chmod 777 uploads processed

EXPOSE 7860

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
