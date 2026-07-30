"""SQLModel database models for users, billing, license keys, and usage logs."""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    """Account: Google and/or email+password + Stripe subscription state."""

    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    # Null for email/password-only accounts (SQLite allows multiple NULLs in UNIQUE)
    google_sub: Optional[str] = Field(default=None, unique=True, index=True)
    # pbkdf2 hash; null for Google-only accounts
    password_hash: Optional[str] = None
    # Forgot-password: store hash of one-time token, never the raw token
    password_reset_token_hash: Optional[str] = None
    password_reset_expires: Optional[datetime] = None
    name: Optional[str] = None
    picture_url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login_at: Optional[datetime] = None
    welcome_email_sent: bool = Field(default=False)
    last_email_error: Optional[str] = None

    # Stripe
    stripe_customer_id: Optional[str] = Field(default=None, index=True)
    stripe_subscription_id: Optional[str] = Field(default=None, index=True)
    # none|trialing|active|past_due|canceled|unpaid|refunded
    subscription_status: str = Field(default="none")
    subscription_current_period_end: Optional[datetime] = None
    # Full refund of latest charge → access revoked until they resubscribe
    access_revoked_reason: Optional[str] = None  # refund|cancel|payment_failed|None
    last_refund_at: Optional[datetime] = None
    last_refund_id: Optional[str] = None

    # Admin + per-user LLM assignment (InterviewPulse answer engine)
    is_admin: bool = Field(default=False)
    # Primary model for interview answers (e.g. gpt-4o). Null → global default.
    answer_model: Optional[str] = Field(default=None)
    # Fallback if primary fails (e.g. gpt-4o-mini). Null → global fallback default.
    fallback_model: Optional[str] = Field(default=None)


class LicenseKey(SQLModel, table=True):
    """License key record for gating access to the proxy."""

    __tablename__ = "license_keys"

    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(unique=True, index=True)  # UUID v4 format
    tier: str = Field(default="standard")
    status: str = Field(default="unused")  # unused, active, revoked
    created_at: datetime = Field(default_factory=datetime.utcnow)
    activated_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    hardware_id: Optional[str] = None  # hashed machine identifier
    email: Optional[str] = None
    last_validated_at: Optional[datetime] = None
    user_id: Optional[int] = Field(default=None, foreign_key="users.id")


class UsageLog(SQLModel, table=True):
    """Per-request usage log for tracking token consumption."""

    __tablename__ = "usage_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    license_key_id: int = Field(foreign_key="license_keys.id")
    endpoint: str
    model: str
    prompt_tokens: int = Field(default=0)
    completion_tokens: int = Field(default=0)
    status_code: int
    latency_ms: float
    created_at: datetime = Field(default_factory=datetime.utcnow)
