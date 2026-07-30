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
    # Interview answer models admins can assign (Chat Completions–compatible IDs).
    # Availability depends on the OpenAI account; failures fall back to DEFAULT_FALLBACK_MODEL.
    ALLOWED_MODELS: list[str] = [
        # --- GPT-5.6 frontier (2026) ---
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        # --- GPT-5.x ---
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.2",
        "gpt-5",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5-pro",
        # --- GPT-4.1 / 4o family ---
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-4o",
        "gpt-4o-mini",
        "chatgpt-4o-latest",
        "gpt-4-turbo",
        "gpt-4",
        # --- Reasoning (o-series) — slower, often stronger ---
        "o4-mini",
        "o3",
        "o3-mini",
        "o3-pro",
        "o1",
        "o1-mini",
        "o1-pro",
    ]
    ALLOWED_EMBEDDING_MODELS: list[str] = ["text-embedding-3-small"]
    # Global defaults for interview answers (admin can override per user)
    DEFAULT_ANSWER_MODEL: str = "gpt-4o"
    DEFAULT_FALLBACK_MODEL: str = "gpt-4o-mini"
    # Comma-separated emails promoted to admin on login (bootstrap)
    ADMIN_EMAILS: str = ""
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
    def admin_email_set(self) -> set[str]:
        raw = self.ADMIN_EMAILS or ""
        return {e.strip().lower() for e in raw.split(",") if e.strip()}

    @property
    def catalog_answer_models(self) -> list[dict]:
        """Models admins can assign (id + labels + groups for UI)."""
        # label, group, optional note
        meta: dict[str, tuple[str, str, str]] = {
            "gpt-5.6-sol": (
                "GPT-5.6 Sol (flagship reasoning)",
                "GPT-5.6 frontier",
                "Highest quality — slower / pricier",
            ),
            "gpt-5.6-terra": (
                "GPT-5.6 Terra (balanced)",
                "GPT-5.6 frontier",
                "Strong quality vs cost",
            ),
            "gpt-5.6-luna": (
                "GPT-5.6 Luna (efficient)",
                "GPT-5.6 frontier",
                "Cost-sensitive volume",
            ),
            "gpt-5.5": ("GPT-5.5", "GPT-5 family", "Coding + professional work"),
            "gpt-5.4": ("GPT-5.4", "GPT-5 family", ""),
            "gpt-5.2": ("GPT-5.2", "GPT-5 family", ""),
            "gpt-5": ("GPT-5", "GPT-5 family", "General flagship-class"),
            "gpt-5-mini": ("GPT-5 mini", "GPT-5 family", "Faster / cheaper GPT-5"),
            "gpt-5-nano": ("GPT-5 nano", "GPT-5 family", "Lowest latency GPT-5"),
            "gpt-5-pro": (
                "GPT-5 pro (deep reasoning)",
                "GPT-5 family",
                "Slowest, max quality",
            ),
            "gpt-4.1": (
                "GPT-4.1 (instruction quality)",
                "GPT-4.1 / 4o",
                "Strong interviews",
            ),
            "gpt-4.1-mini": ("GPT-4.1 mini", "GPT-4.1 / 4o", "Fast + solid"),
            "gpt-4.1-nano": (
                "GPT-4.1 nano (lowest latency)",
                "GPT-4.1 / 4o",
                "Ultra-fast",
            ),
            "gpt-4o": (
                "GPT-4o (recommended default)",
                "GPT-4.1 / 4o",
                "Fast + strong interview answers",
            ),
            "gpt-4o-mini": (
                "GPT-4o mini (default fallback)",
                "GPT-4.1 / 4o",
                "Fastest / cheapest fallback",
            ),
            "chatgpt-4o-latest": (
                "ChatGPT-4o latest",
                "GPT-4.1 / 4o",
                "Tracks ChatGPT 4o flavor",
            ),
            "gpt-4-turbo": ("GPT-4 Turbo", "GPT-4 classic", "Legacy strong"),
            "gpt-4": ("GPT-4", "GPT-4 classic", "Legacy"),
            "o4-mini": (
                "o4-mini (reasoning)",
                "Reasoning (o-series)",
                "Good reasoning, moderate latency",
            ),
            "o3": ("o3 (reasoning)", "Reasoning (o-series)", "Deep reasoning"),
            "o3-mini": ("o3-mini", "Reasoning (o-series)", "Faster reasoning"),
            "o3-pro": ("o3-pro", "Reasoning (o-series)", "Highest o3 quality"),
            "o1": ("o1", "Reasoning (o-series)", "Classic reasoning"),
            "o1-mini": ("o1-mini", "Reasoning (o-series)", "Faster o1"),
            "o1-pro": ("o1-pro", "Reasoning (o-series)", "Max o1 quality"),
        }
        out = []
        for mid in self.ALLOWED_MODELS:
            label, group, note = meta.get(mid, (mid, "Other", ""))
            out.append(
                {
                    "id": mid,
                    "label": label,
                    "group": group,
                    "note": note,
                    "is_default": mid == (self.DEFAULT_ANSWER_MODEL or "gpt-4o"),
                    "is_fallback_default": mid
                    == (self.DEFAULT_FALLBACK_MODEL or "gpt-4o-mini"),
                    "is_reasoning": mid.startswith("o1")
                    or mid.startswith("o3")
                    or mid.startswith("o4")
                    or mid.endswith("-pro")
                    or mid
                    in (
                        "gpt-5.6-sol",
                        "gpt-5-pro",
                    ),
                }
            )
        return out

    def normalize_model_id(self, model: str | None) -> str | None:
        if not model or not str(model).strip():
            return None
        m = str(model).strip()
        allowed = set(self.ALLOWED_MODELS) | {
            self.DEFAULT_ANSWER_MODEL,
            self.DEFAULT_FALLBACK_MODEL,
        }
        if m not in allowed:
            return None
        return m

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
