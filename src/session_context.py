"""
Pre-session context pack for live interviews.

Competitors (Final Round, Sensei) pre-load resume + JD + stories before the call
so live generation is incremental, not cold. This module stores a process-local
pack and formats it for answer prompts.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

_lock = threading.RLock()


@dataclass
class SessionContextPack:
    role: str = ""
    company: str = ""
    seniority: str = ""
    interview_type: str = ""  # behavioral | technical | mixed | coding
    job_description: str = ""
    resume_text: str = ""
    stories: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    depth: str = "balanced"  # fast | balanced | deep
    outline_first: bool = True
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def is_empty(self) -> bool:
        return not any(
            [
                self.role.strip(),
                self.company.strip(),
                self.job_description.strip(),
                self.resume_text.strip(),
                self.stories,
                self.keywords,
            ]
        )


_PACK = SessionContextPack()


def get_pack() -> SessionContextPack:
    with _lock:
        return SessionContextPack(**asdict(_PACK))


def update_pack(**kwargs: Any) -> SessionContextPack:
    """Merge fields into the active pack. Empty strings are ignored unless clear=True."""
    clear = bool(kwargs.pop("clear", False))
    with _lock:
        global _PACK
        if clear:
            _PACK = SessionContextPack()
        for k, v in kwargs.items():
            if not hasattr(_PACK, k):
                continue
            if k == "stories" and v is not None:
                if isinstance(v, str):
                    stories = [s.strip() for s in re.split(r"\n{2,}|\|;\|", v) if s.strip()]
                else:
                    stories = [str(s).strip() for s in v if str(s).strip()]
                _PACK.stories = stories[:12]
            elif k == "keywords" and v is not None:
                if isinstance(v, str):
                    kws = [x.strip() for x in re.split(r"[,;\n]", v) if x.strip()]
                else:
                    kws = [str(x).strip() for x in v if str(x).strip()]
                _PACK.keywords = kws[:40]
            elif k == "outline_first":
                _PACK.outline_first = bool(v)
            elif k == "depth":
                d = str(v or "balanced").strip().lower()
                if d in ("fast", "balanced", "deep", "quality"):
                    if d == "quality":
                        d = "deep"
                    _PACK.depth = d
            elif k in ("role", "company", "seniority", "interview_type") and v is not None:
                # Allow empty string so UI can clear Role / Job context defaults
                setattr(_PACK, k, str(v).strip() if isinstance(v, str) else v)
            elif v is not None and str(v).strip():
                setattr(_PACK, k, str(v).strip() if isinstance(v, str) else v)
        _PACK.updated_at = time.time()
        return SessionContextPack(**asdict(_PACK))


def clear_pack() -> None:
    update_pack(clear=True)


def format_for_prompt(max_chars: int = 1800) -> str:
    """Compact block for LLM user prompt. Empty if no context loaded."""
    pack = get_pack()
    if pack.is_empty() and not pack.role:
        return ""
    parts: list[str] = ["PRE-SESSION CONTEXT (use only facts here; never invent experience):"]
    if pack.role:
        parts.append(f"Target role: {pack.role}")
    if pack.company:
        parts.append(f"Company: {pack.company}")
    if pack.seniority:
        parts.append(f"Seniority: {pack.seniority}")
    if pack.interview_type:
        parts.append(f"Interview type: {pack.interview_type}")
    if pack.keywords:
        parts.append("Keywords: " + ", ".join(pack.keywords[:20]))
    if pack.job_description:
        jd = pack.job_description.strip()
        if len(jd) > 600:
            jd = jd[:600] + "…"
        parts.append(f"Job description excerpt:\n{jd}")
    if pack.resume_text:
        rv = pack.resume_text.strip()
        if len(rv) > 700:
            rv = rv[:700] + "…"
        parts.append(f"Resume / experience excerpt:\n{rv}")
    if pack.stories:
        parts.append("Candidate stories (pick the best fit, do not invent):")
        for i, s in enumerate(pack.stories[:6], 1):
            snip = s if len(s) <= 220 else s[:220] + "…"
            parts.append(f"  {i}. {snip}")
    text = "\n".join(parts)
    if len(text) > max_chars:
        text = text[: max_chars - 1] + "…"
    return text


def effective_job_context(fallback: str = "") -> str:
    """
    Resolve display role for prompts.

    Explicit job_context (fallback) always wins when provided so a user-set
    role or per-turn context is never overwritten by a stale session pack
    (e.g. leftover SAP ATTP bootstrap).
    """
    explicit = (fallback or "").strip()
    if explicit:
        return explicit[:120]
    pack = get_pack()
    bits = [b for b in (pack.role, pack.company, pack.seniority) if b]
    if bits:
        return " · ".join(bits)[:120]
    return ""


def get_depth() -> str:
    return get_pack().depth or "balanced"


def outline_first_enabled() -> bool:
    pack = get_pack()
    if not pack.outline_first:
        return False
    # Env override
    import os

    raw = os.environ.get("ASTRA_OUTLINE_FIRST", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")
