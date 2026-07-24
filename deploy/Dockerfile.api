# InterviewPulse / Job Interview Cracker — production API (Linux/Railway)
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COPILOT_API_HOST=0.0.0.0 \
    COPILOT_API_PORT=8787 \
    HF_HOME=/data/hf \
    XDG_CACHE_HOME=/data/cache

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# API-only deps (no Windows PortAudio / sounddevice)
RUN pip install --upgrade pip \
 && pip install \
      "fastapi[standard]>=0.115.0" \
      "uvicorn[standard]>=0.30.0" \
      websockets \
      python-multipart \
      "openai>=1.58.0" \
      "python-dotenv>=1.0.0" \
      "pydantic-settings>=2.0.0" \
      "sqlmodel>=0.0.22" \
      "PyJWT>=2.8.0" \
      "stripe>=11.0.0" \
      "httpx>=0.28.1" \
      "numpy>=1.24.0,<2.0.0" \
      "faster-whisper>=1.0.0,<1.1.0" \
      "onnxruntime>=1.14.0,<1.20.0" \
      "rank_bm25>=0.2.2" \
      "requests>=2.28.0" \
      "platformdirs>=4.0.0" \
      "pyyaml>=6.0.0" \
      "pdfplumber>=0.9.0" \
      "chromadb>=0.5.0,<1.0.0"

COPY src/ /app/

RUN mkdir -p /data/hf /data/cache /data/db
ENV DATABASE_URL=sqlite:////data/db/astra_backend.db

EXPOSE 8787

# Railway injects PORT; bind all interfaces
CMD ["sh", "-c", "export COPILOT_API_HOST=0.0.0.0; python copilot_api.py"]
