"""Astra Proxy — FastAPI application entry point."""

import logging
import sys
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from backend.config import settings
from backend.database import create_db_and_tables

logger = logging.getLogger("astra.server")

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown hooks."""
    # Startup: create database tables
    create_db_and_tables()

    # Store settings on app state for access in endpoints
    app.state.settings = settings

    # Create shared AsyncOpenAI client with explicit timeouts (PROXY-05)
    if settings.OPENAI_API_KEY:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=httpx.Timeout(
                connect=5.0,
                read=60.0,
                write=10.0,
                pool=5.0,
            ),
        )
        app.state.openai_client = client

        # Startup validation (REL-05): verify OpenAI API key is valid
        try:
            await client.models.list()
            logger.info("OpenAI API key validated successfully")
        except Exception as exc:
            from openai import AuthenticationError

            if isinstance(exc, AuthenticationError):
                logger.critical(
                    "FATAL: OPENAI_API_KEY is invalid. Server refusing to start."
                )
                sys.exit(1)
            else:
                logger.warning(
                    "OpenAI unreachable during startup (may be temporary): %s", exc
                )
    else:
        app.state.openai_client = None
        logger.critical(
            "FATAL: OPENAI_API_KEY is missing. Server refusing to start."
        )
        sys.exit(1)

    yield

    # Shutdown: close OpenAI client if it was created
    if app.state.openai_client is not None:
        await app.state.openai_client.close()


app = FastAPI(
    title="Astra Proxy",
    version="3.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Global error handlers (REL-03)
# ---------------------------------------------------------------------------


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return 400 with structured error for malformed requests."""
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "invalid_request",
                "message": str(exc.errors()[0]["msg"]) if exc.errors() else "Invalid request.",
            }
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Catch-all: never return stack traces to the client (REL-03)."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "Something went wrong. Please try again.",
            }
        },
    )


# ---------------------------------------------------------------------------
# Request logging middleware (REL-04)
# ---------------------------------------------------------------------------

from backend.middleware import RequestLoggingMiddleware  # noqa: E402

app.add_middleware(RequestLoggingMiddleware)


# ---------------------------------------------------------------------------
# Health check endpoint (REL-01)
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def root():
    """Browser-friendly homepage (JSON 404 on / was confusing)."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Astra API — local</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; color: #222; }
    h1 { color: #2b6cb0; }
    .ok { background: #e6ffed; border: 1px solid #68d391; padding: 1rem; border-radius: 8px; }
    a { color: #2b6cb0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    li { margin: 0.4rem 0; }
  </style>
</head>
<body>
  <h1>This is NOT the interview app</h1>
  <div class="ok">
    <strong>You opened the backend API only.</strong><br/>
    The real product is a <strong>desktop window</strong>, not this page.
  </div>
  <h2>How to open the real app</h2>
  <ol>
    <li>Go to folder <code>C:\\Users\\montg\\OneDrive\\Desktop\\Astra\\src</code></li>
    <li>Double‑click <code>run.bat</code> or <code>START_HERE.bat</code></li>
    <li>Look on the Windows taskbar for <strong>Astra</strong></li>
    <li>Press the big green button: <strong>Start helping me!</strong></li>
  </ol>
  <p>You can close this browser tab. You do not need it for interviews
     (licensing is off — the desktop app talks to OpenAI directly).</p>
  <p style="color:#718096;font-size:0.9rem;">
    Dev only: <a href="/health">/health</a> · <a href="/docs">/docs</a> (API for engineers)
  </p>
</body>
</html>
"""


@app.get("/v1")
async def v1_root():
    """Avoid bare /v1 showing FastAPI Not Found."""
    return RedirectResponse(url="/docs")


@app.get("/health")
async def health_check(request: Request):
    """Health check — reports server status and OpenAI reachability."""
    result = {"status": "ok", "version": "3.0.0"}

    openai_client = request.app.state.openai_client
    if openai_client is not None:
        try:
            await openai_client.models.list()
            result["openai"] = "reachable"
        except Exception:
            result["openai"] = "unreachable"
    else:
        result["openai"] = "not_configured"

    return result


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

from backend.auth import router as license_router  # noqa: E402
from backend.billing import router as billing_router  # noqa: E402
from backend.google_oauth import router as oauth_router  # noqa: E402
from backend.mock_interview import router as mock_router  # noqa: E402
from backend.password_auth import router as password_router  # noqa: E402
from backend.proxy import router as proxy_router  # noqa: E402

app.include_router(license_router)
app.include_router(oauth_router)
app.include_router(password_router)
app.include_router(billing_router)
app.include_router(mock_router)
app.include_router(proxy_router)
