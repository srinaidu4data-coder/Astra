# InterviewPulse / Job Interview Cracker — production API
# Python FastAPI + Whisper STT + Google OAuth
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COPILOT_API_HOST=0.0.0.0 \
    COPILOT_API_PORT=8787 \
    # HuggingFace / ctranslate2 model cache
    HF_HOME=/data/hf \
    XDG_CACHE_HOME=/data/cache

WORKDIR /app

# System libs for audio + building wheels when needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install deps without chromadb native build pain when possible
COPY src/requirements.txt /tmp/requirements.txt
COPY src/backend/requirements.txt /tmp/backend-requirements.txt

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
      "sounddevice>=0.4.6" \
 && pip install "chromadb==0.5.5" --no-deps \
 && pip install "chroma-hnswlib==0.7.6a9" \
      build posthog overrides pypika \
      opentelemetry-api opentelemetry-sdk \
      opentelemetry-exporter-otlp-proto-grpc \
      opentelemetry-instrumentation-fastapi \
      kubernetes mmh3 orjson bcrypt tenacity typer rich \
      importlib-resources grpcio \
 || true

# App source (backend lives under /app as copilot_api root)
COPY src/ /app/

# Persist SQLite + model cache
RUN mkdir -p /data/hf /data/cache /data/db
ENV DATABASE_URL=sqlite:////data/db/astra_backend.db

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${COPILOT_API_PORT}/api/health" || exit 1

# Respect platform PORT (Railway/Render) when set
CMD ["sh", "-c", "export COPILOT_API_HOST=0.0.0.0; export COPILOT_API_PORT=${PORT:-8787}; python copilot_api.py"]
