"""SQLModel database models for license keys and usage logs."""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


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
