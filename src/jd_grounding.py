#!/usr/bin/env python3
"""
JD / role grounding for interview answers.

Policy (multi-tenant, per-login):
  - Ground ONLY from the Role + Job context the user set for THIS interview.
  - Never pull ambient disk practice JD into another user's answers.
  - No "SAP family" compatibility — product lines do not share skills.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

_SRC = Path(__file__).resolve().parent
_JD_DIR = _SRC / "jd and resume"

_OFF_DOMAIN_FILLER = re.compile(
    r"\b("
    r"p99|qps|kubernetes|k8s|microservice|microservices|serverless|"
    r"gradient descent|overfitting|pytorch|tensorflow|embedding model|"
    r"neural network|llm fine-?tun|"
    r"synergy|synergies|leverage|robust solution|best[- ]in[- ]class|"
    r"circle back|going forward|move the needle|low[- ]hanging fruit|"
    r"paradigm shift|holistic approach|thought leadership"
    r")\b",
    re.I,
)

_JD_KEEP = re.compile(
    r"\b("
    r"ATTP|EPCIS|GS1|GTIN|GLN|SSCC|SGTIN|DSCSA|FMD|EMVS|MAH|CMO|3PL|"
    r"BRIM|CI|CC|SOM|RAR|FICA|FI-CA|"
    r"commissioning|aggregation|deaggregation|serialization|seriali[sz]ation|"
    r"subscription|billing|provider contract|convergent|"
    r"BOOMI|AS2|SFTP|GAMP|Part\s*11|21\s*CFR|RISE|S/?4HANA|AIF|IDoc|ALE|"
    r"Implementation Guidelines?|mapping|repository|trading partner|"
    r"saleable returns|VRS|DataMatrix|UAT|IQ|OQ|PQ"
    r")\b",
    re.I,
)

_STOP = frozenset(
    """
    a an the and or but if then to of in on for with about as at by from is are
    was were be been being i you we they it this that what how why when where
    which tell me your can could would should please role job description
    experience qualifications ability strong deep proven related field years
    including such etc hands on
    """.split()
)


def _practice_jd_enabled() -> bool:
    """Disk practice pack is local-dev only; never auto for multi-user prod."""
    raw = (os.environ.get("ASTRA_PRACTICE_JD") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


@lru_cache(maxsize=1)
def _load_jd_text_disk() -> str:
    p = _JD_DIR / "jd.txt"
    if not p.exists():
        return ""
    try:
        return p.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return ""


def load_jd_text() -> str:
    """Practice JD from disk only when ASTRA_PRACTICE_JD=1 (not used in answer path)."""
    if not _practice_jd_enabled():
        return ""
    return _load_jd_text_disk()


@lru_cache(maxsize=1)
def _load_resume_text_disk(max_chars: int = 6000) -> str:
    pdfs = sorted(_JD_DIR.glob("*.pdf"))
    if not pdfs:
        return ""
    try:
        import pdfplumber

        chunks: list[str] = []
        with pdfplumber.open(str(pdfs[0])) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                if t.strip():
                    chunks.append(t)
        return "\n".join(chunks)[:max_chars].strip()
    except Exception:
        return ""


def load_resume_text(max_chars: int = 6000) -> str:
    if not _practice_jd_enabled():
        return ""
    return _load_resume_text_disk(max_chars)


def _tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z0-9+./-]{1,}", text or "")


def extract_lexicon(
    *blobs: str,
    max_terms: int = 80,
) -> list[str]:
    """High-signal terms from provided text only (role / question / user JD)."""
    joined = "\n".join(b for b in blobs if b)
    if not joined.strip():
        return []

    scores: dict[str, float] = {}

    for m in re.finditer(r"\b[A-Z][A-Z0-9]{1,7}\b", joined):
        t = m.group(0)
        if t.lower() in _STOP:
            continue
        scores[t] = scores.get(t, 0) + 3.0

    phrases = [
        r"serial number requests?",
        r"partial pallets?",
        r"trading partners?",
        r"business partners?",
        r"master data",
        r"functional specifications?",
        r"subscription billing",
        r"provider contracts?",
        r"convergent invoicing",
        r"convergent charging",
        r"revenue recognition",
        r"end-to-end",
        r"E2E integration",
        r"saleable returns?",
        r"RISE with SAP",
        r"contract manufacturers?",
        r"third-party logistics",
    ]
    for pat in phrases:
        mm = re.search(pat, joined, re.I)
        if mm:
            term = re.sub(r"\s+", " ", mm.group(0)).strip()
            scores[term] = scores.get(term, 0) + 4.0

    for tok in _tokens(joined):
        low_t = tok.lower()
        if low_t in _STOP or len(low_t) < 4:
            continue
        w = 1.0
        if any(c.isupper() for c in tok[1:]):
            w += 0.5
        if re.search(r"\d", tok):
            w += 0.5
        scores[tok] = scores.get(tok, 0) + w

    ranked = sorted(scores.items(), key=lambda x: (-x[1], -len(x[0]), x[0].lower()))
    out: list[str] = []
    seen = set()
    for term, _ in ranked:
        k = term.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(term)
        if len(out) >= max_terms:
            break
    return out


def lexicon_for_turn(
    question: str = "",
    job_context: str = "",
    *,
    job_description: str = "",
    max_terms: int = 18,
) -> list[str]:
    """
    Lexicon for THIS interview only: question + Role/job_context + optional
    user-supplied job description. Never ambient disk ATTP.
    """
    return extract_lexicon(
        question or "",
        job_context or "",
        job_description or "",
        max_terms=max_terms,
    )


def jd_grounding_applies(question: str = "", job_context: str = "") -> bool:
    """
    True when the user set a Role/Job for this interview.

    No domain-compatibility matrix. No disk JD. No cross-user pack.
    """
    return bool((job_context or "").strip())


def role_from_jd(jd: str = "") -> str:
    text = (jd or "").strip()
    if not text:
        return ""
    m = re.search(r"Role\s*[:-]+\s*(.+)", text, re.I)
    if not m:
        return ""
    return m.group(1).strip().split("\n")[0].strip(" -\t")


def pack_domain_blob(*, include_disk_jd: bool = False) -> str:
    """Role + user pack text only (disk JD never for multi-tenant)."""
    bits: list[str] = []
    try:
        from session_context import get_pack

        pack = get_pack()
        bits.extend(
            [
                pack.role or "",
                pack.job_description[:1200] if pack.job_description else "",
                " ".join(pack.keywords[:25]),
            ]
        )
    except Exception:
        pass
    if include_disk_jd and _practice_jd_enabled():
        jd = load_jd_text()
        if jd:
            bits.append(jd[:1200])
    return " ".join(b for b in bits if b)


def disk_jd_matches_role(job_context: str = "") -> bool:
    """Disk practice JD is never used for multi-tenant answer grounding."""
    return False


def bootstrap_session_from_jd_resume(
    *,
    force: bool = False,
    role_hint: str = "",
) -> dict[str, Any]:
    """
    Disabled for multi-user: does not load ambient ATTP into the session.
    Local practice only when ASTRA_PRACTICE_JD=1 and force=True with role_hint.
    """
    if not _practice_jd_enabled() or not force:
        return {
            "ok": True,
            "skipped": True,
            "role": "",
            "reason": "practice_jd_disabled_or_not_forced",
        }
    # Explicit local practice only
    try:
        from session_context import update_pack

        jd = load_jd_text()
        resume = load_resume_text(3500)
        role = (role_hint or "").strip() or role_from_jd(jd)
        if not role:
            return {"ok": True, "skipped": True, "role": "", "empty": True}
        lex = extract_lexicon(jd, resume, role, max_terms=40)
        update_pack(
            role=role,
            job_description=jd[:4000] if jd else "",
            resume_text=resume[:3500] if resume else "",
            keywords=lex[:40],
            interview_type="technical",
            depth="balanced",
        )
        return {
            "ok": True,
            "skipped": False,
            "role": role,
            "jd_chars": len(jd),
            "resume_chars": len(resume),
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def ensure_grounded_job_context(
    job_context: str = "",
    *,
    question: str = "",
) -> str:
    """Role string is only what the caller passed (per interview)."""
    _ = question
    return (job_context or "").strip()


def strip_off_domain_filler(
    answer: str, *, question: str = "", job_context: str = ""
) -> str:
    """Light strip of universal corporate fog; keep role/JD terms."""
    text = (answer or "").strip()
    if not text:
        return text

    def repl(m: re.Match[str]) -> str:
        w = m.group(0)
        if _JD_KEEP.search(w):
            return w
        if w.lower() in (question or "").lower():
            return w
        if w.lower() in (job_context or "").lower():
            return w
        return ""

    cleaned = _OFF_DOMAIN_FILLER.sub(repl, text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    return cleaned.strip()
