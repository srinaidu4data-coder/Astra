"""Backend configuration from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

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


settings = Settings()
