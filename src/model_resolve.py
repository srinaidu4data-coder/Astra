"""Resolve primary + fallback OpenAI models for answer generation."""

from __future__ import annotations

import os
from typing import Optional, Tuple

# Defaults when backend settings are unavailable (e.g. pure local path)
# nano/mini for sub-1s live interviews
_DEFAULT_PRIMARY = "gpt-4.1-nano"
_DEFAULT_FALLBACK = "gpt-4o-mini"


def resolve_answer_models(
    *,
    answer_model: Optional[str] = None,
    fallback_model: Optional[str] = None,
    user_answer_model: Optional[str] = None,
    user_fallback_model: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Priority for primary:
      1) explicit request answer_model (if allowed)
      2) user.answer_model
      3) env ASTRA_ANSWER_MODEL / DEFAULT_ANSWER_MODEL
      4) gpt-4o

    Fallback:
      1) explicit fallback_model
      2) user.fallback_model
      3) env / DEFAULT_FALLBACK_MODEL
      4) gpt-4o-mini
    """
    try:
        from backend.config import settings

        allowed = set(settings.ALLOWED_MODELS or [])
        global_primary = (
            settings.DEFAULT_ANSWER_MODEL or _DEFAULT_PRIMARY
        ).strip() or _DEFAULT_PRIMARY
        global_fallback = (
            settings.DEFAULT_FALLBACK_MODEL or _DEFAULT_FALLBACK
        ).strip() or _DEFAULT_FALLBACK
    except Exception:
        allowed = {_DEFAULT_PRIMARY, _DEFAULT_FALLBACK}
        global_primary = (
            os.environ.get("ASTRA_ANSWER_MODEL")
            or os.environ.get("DEFAULT_ANSWER_MODEL")
            or _DEFAULT_PRIMARY
        ).strip()
        global_fallback = (
            os.environ.get("ASTRA_FALLBACK_MODEL")
            or os.environ.get("DEFAULT_FALLBACK_MODEL")
            or _DEFAULT_FALLBACK
        ).strip()

    def pick(candidate: Optional[str], default: str) -> str:
        if not candidate or not str(candidate).strip():
            return default
        c = str(candidate).strip()
        if allowed and c not in allowed and c not in (global_primary, global_fallback):
            return default
        return c

    primary = pick(answer_model, pick(user_answer_model, global_primary))
    fallback = pick(fallback_model, pick(user_fallback_model, global_fallback))
    if fallback == primary:
        # Ensure a distinct fallback when possible
        if primary != global_fallback:
            fallback = global_fallback
        elif primary != _DEFAULT_FALLBACK:
            fallback = _DEFAULT_FALLBACK
    return primary, fallback
