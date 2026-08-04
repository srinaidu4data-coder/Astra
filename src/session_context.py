"""
Pre-session context pack for live interviews.

Competitors (Final Round, Sensei) pre-load resume + JD + stories before the call
so live generation is incremental, not cold.

Packs are scoped by session_id (contextvar) so concurrent WebSocket users
do not share role/JD/resume state.
"""

from __future__ import annotations

import contextvars
import re
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from typing import Any, Generator, Optional

_lock = threading.RLock()

# Active pack key for this thread/async task (WS connection / HTTP request)
_session_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "astra_session_id", default="default"
)

# session_id → pack
_PACKS: dict[str, SessionContextPack] = {}


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


def new_session_id() -> str:
    return uuid.uuid4().hex[:16]


def get_session_id() -> str:
    return _session_id_var.get() or "default"


def set_session_id(session_id: str) -> contextvars.Token:
    """Bind pack scope for this task/thread. Returns token for reset."""
    sid = (session_id or "").strip() or "default"
    return _session_id_var.set(sid)


def reset_session_id(token: contextvars.Token) -> None:
    try:
        _session_id_var.reset(token)
    except Exception:
        pass


@contextmanager
def session_scope(session_id: str) -> Generator[str, None, None]:
    """Context manager: all get_pack/update_pack use this session_id."""
    token = set_session_id(session_id)
    try:
        yield get_session_id()
    finally:
        reset_session_id(token)


def _pack_ref() -> SessionContextPack:
    sid = get_session_id()
    with _lock:
        if sid not in _PACKS:
            _PACKS[sid] = SessionContextPack()
        return _PACKS[sid]


def get_pack() -> SessionContextPack:
    with _lock:
        p = _pack_ref()
        return SessionContextPack(**asdict(p))


def update_pack(**kwargs: Any) -> SessionContextPack:
    """Merge fields into the active session pack."""
    clear = bool(kwargs.pop("clear", False))
    with _lock:
        sid = get_session_id()
        if clear:
            _PACKS[sid] = SessionContextPack()
        pack = _PACKS.setdefault(sid, SessionContextPack())
        for k, v in kwargs.items():
            if not hasattr(pack, k):
                continue
            if k == "stories" and v is not None:
                if isinstance(v, str):
                    stories = [
                        s.strip() for s in re.split(r"\n{2,}|\|;\|", v) if s.strip()
                    ]
                else:
                    stories = [str(s).strip() for s in v if str(s).strip()]
                pack.stories = stories[:12]
            elif k == "keywords" and v is not None:
                if isinstance(v, str):
                    kws = [x.strip() for x in re.split(r"[,;\n]", v) if x.strip()]
                else:
                    kws = [str(x).strip() for x in v if str(x).strip()]
                pack.keywords = kws[:40]
            elif k == "outline_first":
                pack.outline_first = bool(v)
            elif k == "depth":
                d = str(v or "balanced").strip().lower()
                if d in ("fast", "balanced", "deep", "quality"):
                    if d == "quality":
                        d = "deep"
                    pack.depth = d
            elif k in ("role", "company", "seniority", "interview_type") and v is not None:
                setattr(pack, k, str(v).strip() if isinstance(v, str) else v)
            elif v is not None and str(v).strip():
                setattr(pack, k, str(v).strip() if isinstance(v, str) else v)
        pack.updated_at = time.time()
        return SessionContextPack(**asdict(pack))


def clear_pack() -> None:
    update_pack(clear=True)


def drop_session(session_id: str | None = None) -> None:
    """Remove a session pack entirely (WS disconnect)."""
    sid = (session_id or get_session_id() or "").strip() or "default"
    if sid == "default":
        clear_pack()
        return
    with _lock:
        _PACKS.pop(sid, None)


def format_for_prompt(max_chars: int = 1800) -> str:
    """Compact block for LLM user prompt. Empty if no context loaded."""
    pack = get_pack()
    if pack.is_empty() and not pack.role:
        return ""
    parts: list[str] = [
        "PRE-SESSION CONTEXT (use only facts here; never invent experience):"
    ]
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


def effective_job_context(
    fallback: str = "",
    *,
    allow_pack: bool = False,
) -> str:
    """
    Resolve role string for prompts.

    - Non-empty fallback always wins (live session / request job_context).
    - Empty fallback: do NOT invent a role from pack unless allow_pack=True.
    """
    explicit = (fallback or "").strip()
    if explicit:
        return explicit[:120]
    if not allow_pack:
        return ""
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
    import os

    raw = os.environ.get("ASTRA_OUTLINE_FIRST", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")
