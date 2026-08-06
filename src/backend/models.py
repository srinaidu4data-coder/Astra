"""SQLModel database models for users, billing, Sprint opportunities, stories, packs."""

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
    # Current plan code for subscription products (pro_monthly, etc.)
    plan_code: Optional[str] = Field(default=None, index=True)

    # Admin + per-user LLM assignment (InterviewPulse answer engine)
    is_admin: bool = Field(default=False)
    # Primary model for interview answers (e.g. gpt-4o). Null → global default.
    answer_model: Optional[str] = Field(default=None)
    # Fallback if primary fails (e.g. gpt-4o-mini). Null → global fallback default.
    fallback_model: Optional[str] = Field(default=None)

    # Growth
    referral_code: Optional[str] = Field(default=None, unique=True, index=True)
    referred_by_user_id: Optional[int] = Field(default=None, foreign_key="users.id")
    # Comp access (admin-issued)
    complimentary_until: Optional[datetime] = None
    complimentary_reason: Optional[str] = None


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


class Entitlement(SQLModel, table=True):
    """Server-side paid access grant (Pass / Sprint / Pro / pack / comp)."""

    __tablename__ = "entitlements"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="users.id")
    plan_code: str = Field(index=True)
    # active | expired | refunded | revoked | consumed
    status: str = Field(default="active", index=True)
    opportunity_id: Optional[int] = Field(default=None, index=True)
    live_minutes_total: int = Field(default=0)
    live_minutes_used: int = Field(default=0)
    max_opportunities: int = Field(default=1)
    unlimited_mocks: bool = Field(default=True)
    starts_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = Field(default=None, index=True)
    stripe_checkout_session_id: Optional[str] = Field(default=None, index=True)
    stripe_payment_intent_id: Optional[str] = Field(default=None, index=True)
    stripe_subscription_id: Optional[str] = Field(default=None, index=True)
    pack_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    meta_json: Optional[str] = None  # small JSON blob, no secrets


class JobOpportunity(SQLModel, table=True):
    """Company Twin target job — one Sprint unit of work."""

    __tablename__ = "job_opportunities"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="users.id")
    company: str = Field(default="")
    role: str = Field(default="")
    job_description: str = Field(default="")
    resume_text: str = Field(default="")
    # recruiter|hiring_manager|technical|behavioral|case_study|panel|executive|final
    interview_stage: str = Field(default="hiring_manager")
    interview_at: Optional[datetime] = None
    timezone: str = Field(default="UTC")
    duration_minutes: Optional[int] = None
    interviewer_json: Optional[str] = None  # [{name,title,url}]
    concerns_json: Optional[str] = None  # [str,str,str]
    answer_tone: str = Field(default="professional")
    answer_length: str = Field(default="medium")  # short|medium|long
    status: str = Field(default="draft", index=True)  # draft|active|archived
    diagnostic_json: Optional[str] = None
    dossier_json: Optional[str] = None
    readiness_score: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StoryBankItem(SQLModel, table=True):
    """Candidate-approved STAR story for live/mock grounding."""

    __tablename__ = "story_bank_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="users.id")
    opportunity_id: Optional[int] = Field(default=None, index=True)
    title: str = Field(default="")
    situation: str = Field(default="")
    task: str = Field(default="")
    actions: str = Field(default="")
    result: str = Field(default="")
    technologies_json: Optional[str] = None
    metrics: str = Field(default="")
    answers_questions_json: Optional[str] = None
    confidence: int = Field(default=50)  # 0-100 supported by resume/user
    missing_details: str = Field(default="")
    # draft|pending_review|verified|rejected
    status: str = Field(default="draft", index=True)
    source: str = Field(default="resume")  # resume|user_answer|manual
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SprintSession(SQLModel, table=True):
    """Mock or live session linked to an opportunity (debrief storage)."""

    __tablename__ = "sprint_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="users.id")
    opportunity_id: int = Field(index=True, foreign_key="job_opportunities.id")
    kind: str = Field(default="mock")  # mock|live
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    live_minutes_consumed: int = Field(default=0)
    readiness_before: Optional[int] = None
    readiness_after: Optional[int] = None
    debrief_json: Optional[str] = None
    turns_json: Optional[str] = None  # sanitized summaries only


class PremiumPack(SQLModel, table=True):
    """Marketplace pack metadata (admin-published initially)."""

    __tablename__ = "premium_packs"

    id: Optional[int] = Field(default=None, primary_key=True)
    pack_key: str = Field(unique=True, index=True)  # e.g. sap-fico-final-50
    name: str
    description: str = Field(default="")
    category: str = Field(default="general", index=True)
    author: str = Field(default="InterviewPulse")
    price_cents: int = Field(default=0)
    currency: str = Field(default="usd")
    version: str = Field(default="1.0.0")
    target_roles_json: Optional[str] = None
    difficulty: str = Field(default="hard")
    question_bank_json: Optional[str] = None
    personas_json: Optional[str] = None
    rubric_json: Optional[str] = None
    required_skills_json: Optional[str] = None
    preview_questions_json: Optional[str] = None
    stripe_price_id: Optional[str] = None
    published: bool = Field(default=False)
    rating_sum: float = Field(default=0.0)
    rating_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AnalyticsEvent(SQLModel, table=True):
    """Privacy-safe product funnel events (no resume/transcript payloads)."""

    __tablename__ = "analytics_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, index=True)
    event_name: str = Field(index=True)
    source: Optional[str] = None  # acquisition
    role_category: Optional[str] = None
    meta_json: Optional[str] = None  # only non-PII counters/flags
    created_at: datetime = Field(default_factory=datetime.utcnow)
