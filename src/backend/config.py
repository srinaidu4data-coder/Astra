"""Backend configuration from environment variables."""

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Always load src/.env regardless of process cwd (fixes Gmail/Stripe "not wired" when
# the API is started from another folder).
_SRC_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _SRC_DIR / ".env"


def _load_env_file_resilient(path: Path) -> None:
    """Load .env even when saved as Windows-1252 / UTF-16 (common on Windows editors)."""
    if not path.exists():
        return
    raw = path.read_bytes()
    # Strip UTF-8 BOM
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    text = None
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", errors="replace")
    # Write a clean UTF-8 sidecar only in memory via load_dotenv stream
    from io import StringIO

    load_dotenv(stream=StringIO(text), override=False)


_load_env_file_resilient(_ENV_FILE)


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        # Values come from os.environ via _load_env_file_resilient (encoding-safe).
        # Do not re-read .env here — Windows cp1252 files break utf-8 parsers.
        env_file=None,
        extra="ignore",
    )

    OPENAI_API_KEY: str = ""
    DATABASE_URL: str = "sqlite:///./astra_backend.db"
    ALLOWED_MODELS: list[str] = ["gpt-4o", "gpt-4o-mini"]
    ALLOWED_EMBEDDING_MODELS: list[str] = ["text-embedding-3-small"]
    # Interview sessions fire classify + embed + 2 chat streams per question.
    # 20 RPM was starving live interviews (~5 requests/answer → hard 429).
    RATE_LIMIT_COMPLETIONS_RPM: int = 90
    RATE_LIMIT_EMBEDDINGS_RPM: int = 120
    RATE_LIMIT_CLASSIFICATIONS_RPM: int = 120
    OPENAI_TIMEOUT_GENERATE: float = 60.0
    OPENAI_TIMEOUT_CLASSIFY: float = 30.0

    # --- Auth / product gate ---
    # When True, UI must sign in (Google and/or email+password).
    AUTH_REQUIRED: bool = True
    # Email + password signup/login + forgot-password (Gmail SMTP reset link).
    EMAIL_PASSWORD_AUTH_ENABLED: bool = True
    # Local-only escape hatch (never enable in production).
    AUTH_DEV_BYPASS: bool = False
    JWT_SECRET: str = "change-me-in-production-use-long-random-string"
    JWT_EXPIRE_HOURS: int = 168  # 7 days
    PASSWORD_RESET_EXPIRE_MINUTES: int = 60
    FRONTEND_URL: str = "http://localhost:5173"
    PUBLIC_API_URL: str = "http://127.0.0.1:8787"

    # --- Google OAuth (Gmail sign-in) ---
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://127.0.0.1:8787/v1/auth/google/callback"

    # --- Welcome / lifecycle email (Gmail SMTP app password recommended) ---
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    WELCOME_EMAIL_ENABLED: bool = True
    BILLING_EMAIL_ENABLED: bool = True

    # --- Stripe monthly subscription ---
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_ID: str = ""  # price_... for monthly plan
    # {CHECKOUT_SESSION_ID} is filled by Stripe — required for post-pay sync without webhook race
    STRIPE_SUCCESS_URL: str = (
        "http://localhost:5173/#/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"
    )
    STRIPE_CANCEL_URL: str = "http://localhost:5173/#/billing?checkout=cancel"

    @property
    def google_oauth_configured(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID.strip() and self.GOOGLE_CLIENT_SECRET.strip())

    @property
    def stripe_configured(self) -> bool:
        return bool(self.STRIPE_SECRET_KEY.strip() and self.STRIPE_PRICE_ID.strip())

    @property
    def smtp_configured(self) -> bool:
        user = self.SMTP_USER.strip()
        # Gmail app passwords are often copied with spaces — strip them for the check
        password = self.SMTP_PASSWORD.replace(" ", "").strip()
        return bool(user and password)

    @property
    def smtp_password_clean(self) -> str:
        """Gmail app passwords: strip spaces users paste from Google UI."""
        return self.SMTP_PASSWORD.replace(" ", "").strip()


settings = Settings()
