#!/usr/bin/env python3
"""
Interview grounding helpers — materials only, no skill-domain hardcoding.

Rules
-----
1. No product-line / skill-family tables (no ATTP, FICO, BRIM, ML, robotics packs).
2. Domain lock is always "general" — Role + Job Context + JD + Resume + question only.
3. STT prompt is generic professional interview language.
4. Guardrails tell the model to stay inside materials, without naming product families.
5. Invent check: ALL-CAPS tokens in the answer that never appear in materials/Q
   (no fixed product or acronym allowlist — ground text is the only authority).
6. Psych/math theater lines are still stripped from answers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# UI / coaching meta — never interview content
_PSYCH_ML_THEATER = frozenset(
    {
        "softmax",
        "zipf budget",
        "von restorff",
        "serial-position curve",
        "cognitive load theory",
        "implementation intention",
        "peak-end rule",
        "primacy effect",
        "recency effect",
        "psych-math",
        "psych math",
        "attention temperature",
    }
)

@dataclass
class DomainLock:
    """Legacy shape kept for callers — always general (no skill domains)."""

    domain: str = "general"
    confidence: float = 0.0
    signals: list[str] = field(default_factory=list)
    secondary: list[str] = field(default_factory=list)
    label: str = "general professional (use only the question + job context)"

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "confidence": round(self.confidence, 3),
            "signals": self.signals[:12],
            "secondary": self.secondary[:6],
            "label": self.label,
        }


def _norm(text: str) -> str:
    t = (text or "").lower()
    t = re.sub(r"\s+", " ", t)
    return t


def _materials_ground(question: str = "", job_context: str = "") -> str:
    """Question + Role/job + session JD/Resume (no domain packs)."""
    bits = [question or "", job_context or ""]
    try:
        from session_context import materials_grounding_blob

        bits.append(materials_grounding_blob(job_context))
    except Exception:
        pass
    return _norm(" ".join(bits))


def domains_compatible(a: str, b: str) -> bool:
    """No skill families — always compatible."""
    return True


def infer_domain(
    question: str = "",
    job_context: str = "",
    resume_or_pack: str = "",
) -> DomainLock:
    """No domain inference. Always general."""
    _ = (question, job_context, resume_or_pack)
    return DomainLock()


def lock_for_turn(
    question: str = "",
    job_context: str = "",
    extra_context: str | None = None,
) -> DomainLock:
    """No domain lock. Always general."""
    _ = (question, job_context, extra_context)
    return DomainLock()


def product_brand_named(domain: str, *blobs: str) -> bool:
    """Deprecated — no product brands. Always False."""
    _ = (domain, blobs)
    return False


def invented_product_hits(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
) -> list[tuple[str, str]]:
    """
    Flag ALL-CAPS jargon in the answer that never appears in materials/Q.

    Zero fixed product/acronym lists. If Role, Job Context, JD, Resume, or the
    question never used the token, it is treated as invented.
    """
    text = (answer or "").strip()
    if not text:
        return []
    ground = _materials_ground(question, job_context)
    ground_raw = f"{question or ''} {job_context or ''}"
    try:
        from session_context import materials_grounding_blob

        ground_raw = f"{ground_raw} {materials_grounding_blob(job_context)}"
    except Exception:
        pass
    ground_upper = set(re.findall(r"\b[A-Z][A-Z0-9]{1,7}\b", ground_raw))
    ground_lower = ground

    hits: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in re.finditer(r"\b[A-Z][A-Z0-9]{2,7}\b", text):
        tok = m.group(0)
        if tok in ground_upper:
            continue
        if tok.lower() in ground_lower:
            continue
        key = tok.upper()
        if key in seen:
            continue
        seen.add(key)
        hits.append(("materials", tok))
    return hits


def has_invented_product_bleed(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
) -> bool:
    """True when answer invents unexplained ALL-CAPS jargon not in materials/Q."""
    return bool(
        invented_product_hits(answer, question=question, job_context=job_context)
    )


def contamination_report(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> dict[str, Any]:
    """Legacy report shape — materials invent hits only."""
    _ = lock
    hits = invented_product_hits(answer, question=question, job_context=job_context)
    theater = [t for t in _PSYCH_ML_THEATER if t in _norm(answer)]
    foreign = [("materials", t) for _d, t in hits] + [
        ("psych_theater", t) for t in theater
    ]
    return {
        "ok": len(foreign) == 0,
        "lock": DomainLock().to_dict(),
        "foreign": foreign,
        "native_hits": 0,
        "foreign_hits": len(foreign),
    }


def sanitize_answer(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> str:
    """Strip psych/meta coaching lines only."""
    _ = (question, job_context, lock)
    text = (answer or "").strip()
    if not text:
        return text
    cleaned_lines: list[str] = []
    for line in text.splitlines():
        low = _norm(line)
        if any(t in low for t in _PSYCH_ML_THEATER):
            continue
        if re.search(
            r"\b(softmax|zipf budget|von restorff|psych-?math|serial.?position)\b",
            low,
        ):
            continue
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip() or answer.strip()


def filter_context_chunks(
    chunks: list[dict],
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> list[dict]:
    """No domain filtering — RAG should be off; pass chunks through unchanged."""
    _ = (question, job_context, lock)
    return list(chunks or [])


def stt_initial_prompt(
    job_context: str = "",
    resume_or_pack: str = "",
    question_hint: str = "",
) -> str:
    """Generic STT bias — no skill-domain vocabulary banks."""
    role = (job_context or "").strip()
    if role:
        # Use only words from the role string itself (no external skill pack)
        snippet = re.sub(r"\s+", " ", role)[:160]
        return (
            f"Professional job interview for role: {snippet}. "
            "Transcribe the interviewer's question accurately."
        )[:224]
    _ = (resume_or_pack, question_hint)
    return (
        "Professional job interview. Transcribe the interviewer's question "
        "accurately. Do not invent technical jargon from unrelated fields."
    )[:224]


def prompt_guardrails(lock: DomainLock, *, role: str = "") -> str:
    """Materials-only rules — no named product families."""
    _ = lock
    role_s = (role or "").strip()
    role_line = (
        f"- Stay inside the stated Role ({role_s[:80]}).\n" if role_s else ""
    )
    return (
        "MATERIALS-ONLY GROUNDING:\n"
        "- Answer ONLY from the interviewer's question plus THIS interview's "
        "Role, Job Context, attached Job Description, and attached Resume.\n"
        f"{role_line}"
        "- Do NOT use RAG, prior interviews, or any stored skill/domain pack.\n"
        "- Do NOT invent product modules, tools, or stack names that do not "
        "appear in Role, Job Context, JD, Resume, or the question.\n"
        "- If materials are empty, answer the question in plain professional "
        "language — do not invent a job title or product family.\n"
        "- Do NOT mention psychology techniques, softmax, Zipf, peak-end, "
        "or coaching meta-commentary — only speakable interview content.\n"
    )


def system_suffix(lock: DomainLock) -> str:
    """Short system-prompt suffix — always materials-only."""
    _ = lock
    return (
        " Use only the question plus this interview's Role, Job Context, JD, "
        "and Resume. No skill-domain packs. No psych/meta labels in the answer body."
    )


def resolve_pack_blob() -> str:
    """Disabled — never inject session pack into RAG/STT domain paths."""
    return ""
