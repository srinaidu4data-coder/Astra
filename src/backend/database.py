"""Database engine setup and session management."""

from sqlmodel import Session, SQLModel, create_engine

from backend.config import settings

engine = create_engine(settings.DATABASE_URL, echo=False)


def create_db_and_tables() -> None:
    """Create all database tables from SQLModel metadata."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Yield a database session for FastAPI Depends()."""
    with Session(engine) as session:
        yield session
