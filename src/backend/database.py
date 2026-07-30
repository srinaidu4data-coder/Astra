"""Database engine setup, session management, and light SQLite migrations."""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from backend.config import settings

logger = logging.getLogger("astra.db")

# Prefer DB file next to src/ when using relative sqlite path
_db_url = settings.DATABASE_URL
if _db_url.startswith("sqlite:///./"):
    src_dir = Path(__file__).resolve().parent.parent
    db_name = _db_url.replace("sqlite:///./", "")
    _db_url = f"sqlite:///{(src_dir / db_name).as_posix()}"

engine = create_engine(_db_url, echo=False)


def _sqlite_add_column_if_missing(table: str, column: str, coltype: str) -> None:
    """Idempotent ALTER for SQLite (create_all does not add new columns)."""
    if not str(engine.url).startswith("sqlite"):
        return
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        existing = {r[1] for r in rows}  # name is index 1
        if column in existing:
            return
        if not existing:
            return  # table not created yet
        logger.info("Migrating %s: add column %s %s", table, column, coltype)
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))
        conn.commit()


def migrate_schema() -> None:
    """Apply additive column migrations for users table."""
    _sqlite_add_column_if_missing("users", "last_email_error", "TEXT")
    _sqlite_add_column_if_missing("users", "access_revoked_reason", "TEXT")
    _sqlite_add_column_if_missing("users", "last_refund_at", "DATETIME")
    _sqlite_add_column_if_missing("users", "last_refund_id", "TEXT")
    _sqlite_add_column_if_missing("users", "welcome_email_sent", "BOOLEAN DEFAULT 0")
    _sqlite_add_column_if_missing("users", "stripe_customer_id", "TEXT")
    _sqlite_add_column_if_missing("users", "stripe_subscription_id", "TEXT")
    _sqlite_add_column_if_missing("users", "subscription_status", "TEXT DEFAULT 'none'")
    _sqlite_add_column_if_missing("users", "subscription_current_period_end", "DATETIME")
    _sqlite_add_column_if_missing("users", "last_login_at", "DATETIME")
    _sqlite_add_column_if_missing("users", "picture_url", "TEXT")
    _sqlite_add_column_if_missing("users", "name", "TEXT")
    _sqlite_add_column_if_missing("users", "password_hash", "TEXT")
    _sqlite_add_column_if_missing("users", "password_reset_token_hash", "TEXT")
    _sqlite_add_column_if_missing("users", "password_reset_expires", "DATETIME")
    _sqlite_add_column_if_missing("users", "is_admin", "BOOLEAN DEFAULT 0")
    _sqlite_add_column_if_missing("users", "answer_model", "TEXT")
    _sqlite_add_column_if_missing("users", "fallback_model", "TEXT")
    _sqlite_add_column_if_missing("license_keys", "user_id", "INTEGER")


def create_db_and_tables() -> None:
    """Create all database tables from SQLModel metadata + migrate columns."""
    SQLModel.metadata.create_all(engine)
    try:
        migrate_schema()
    except Exception:
        logger.exception("Schema migration failed")


def get_session():
    """Yield a database session for FastAPI Depends()."""
    with Session(engine) as session:
        yield session
