#!/usr/bin/env python3
"""
JD-grounded vocabulary + reasoning for interview answers.

Why irrelevant buzzwords appear (reasoning):
  1) Job context / session pack often empty → model free-associates elite English
  2) VOCAB_PSYCH listed generic power words (invariant, fail closed, land…) → model plants them
  3) No explicit ALLOWED-TERM bank from the actual JD/resume
  4) SpeakCanvas bold lists amplified generic verbs even when answer was SAP ATTP

Fix:
  - Load JD + resume from disk (jd and resume/)
  - Extract a lexicon of high-signal terms from JD/resume/question
  - Inject GROUNDING + REASONING block into every answer prompt
  - Soft-strip known off-domain filler when domain lock is SAP ATTP
  - Bootstrap session_context pack so live sessions stay grounded
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

_SRC = Path(__file__).resolve().parent
_JD_DIR = _SRC / "jd and resume"

# Soft strip when ATTP-locked: SWE/ML theater that sneaks in
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

# Prefer keeping these when present in JD (never strip)
_JD_KEEP = re.compile(
    r"\b("
    r"ATTP|EPCIS|GS1|GTIN|GLN|SSCC|SGTIN|DSCSA|FMD|EMVS|MAH|CMO|3PL|"
    r"commissioning|aggregation|deaggregation|serialization|seriali[sz]ation|"
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
    """
    Disk practice JD/resume under jd and resume/ is opt-in.

    Default OFF so multi-tenant / empty-Role sessions never inherit ambient ATTP.
    Set ASTRA_PRACTICE_JD=1 for local single-candidate practice packs.
    """
    import os

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
    """Practice JD from disk only when ASTRA_PRACTICE_JD=1."""
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
    """Best-effort PDF text from jd and resume folder (opt-in practice pack)."""
    if not _practice_jd_enabled():
        return ""
    return _load_resume_text_disk(max_chars)


def _tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z0-9+./-]{1,}", text or "")


def extract_lexicon(
    *blobs: str,
    max_terms: int = 80,
) -> list[str]:
    """
    High-signal terms from JD/resume/question:
    - ALL-CAPS / Camel / multi-digit codes
    - multi-word technical phrases already in source
    - repeated content words length ≥ 4
    """
    joined = "\n".join(b for b in blobs if b)
    if not joined.strip():
        return []

    scores: dict[str, float] = {}

    # Acronyms / codes
    for m in re.finditer(r"\b[A-Z][A-Z0-9]{1,7}\b", joined):
        t = m.group(0)
        if t.lower() in _STOP:
            continue
        scores[t] = scores.get(t, 0) + 3.0

    # Important multi-word phrases from JD (capture common patterns)
    phrases = [
        r"serial number requests?",
        r"partial pallets?",
        r"trading partners?",
        r"business partners?",
        r"master data",
        r"functional specifications?",
        r"configuration specifications?",
        r"implementation guidelines?",
        r"mapping specifications?",
        r"end-to-end",
        r"E2E integration",
        r"saleable returns?",
        r"RISE with SAP",
        r"contract manufacturers?",
        r"third-party logistics",
        r"packaging and aggregation",
        r"system of record",
        r"fail closed",
    ]
    low = joined.lower()
    for pat in phrases:
        if re.search(pat, low, re.I):
            # normalize display form from match
            mm = re.search(pat, joined, re.I)
            if mm:
                term = re.sub(r"\s+", " ", mm.group(0)).strip()
                scores[term] = scores.get(term, 0) + 4.0

    # Content words
    for tok in _tokens(joined):
        low_t = tok.lower()
        if low_t in _STOP or len(low_t) < 4:
            continue
        # prefer technical-looking
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


def build_grounding_block(
    question: str = "",
    job_context: str = "",
    *,
    include_jd_excerpt: bool = True,
    max_jd_chars: int = 1400,
    max_resume_chars: int = 900,
) -> str:
    """
    Prompt block: JD + resume + allowed lexicon + reasoning rules.
    """
    jd = load_jd_text()
    resume = load_resume_text(max_resume_chars + 500)
    job = (job_context or "").strip()
    q = (question or "").strip()

    # Prefer pack from session if richer
    try:
        from session_context import get_pack

        pack = get_pack()
        if pack.job_description and len(pack.job_description) > len(jd):
            jd = pack.job_description
        if pack.resume_text and len(pack.resume_text) > len(resume):
            resume = pack.resume_text
        if pack.role and not job:
            job = pack.role
    except Exception:
        pass

    lexicon = extract_lexicon(jd, resume, job, q, max_terms=70)
    parts: list[str] = [
        "=== JD GROUNDING (REASONING — MANDATORY) ===",
        "You must answer as if a hiring panel for THIS role is listening.",
        "Every technical noun/verb must earn its place from the sources below.",
        "",
        "REASONING STEPS (do these silently, then write the answer):",
        "1) Identify what the interviewer asked (decision / mechanism / tradeoff / story).",
        "2) Map the answer onto the JD's process objects (events, partners, master data,",
        "   integration, validation) — not onto generic software-engineering slang.",
        "3) Pick vocabulary ONLY from: (a) the question, (b) ALLOWED TERMS, (c) JD/resume",
        "   excerpts. If a concept is not in those sources, use plain English — do NOT",
        "   invent elite buzzwords (invariant, p99, microservice, paradigm, synergy,",
        "   thought leadership, land the narrative, etc.).",
        "4) Prefer JD nouns: EPCIS, GTIN, GLN, SSCC, MAH, CMO, 3PL, commissioning,",
        "   aggregation, DSCSA, FMD, GAMP 5, BOOMI, AS2, IG/mapping, UAT, RISE.",
        "5) Reject filler upgrades that are not in the JD (e.g. 'fail closed' only if",
        "   you mean a real control in this process — name the control in domain words).",
        "",
    ]
    if job:
        parts.append(f"TARGET ROLE: {job[:160]}")
    if include_jd_excerpt and jd:
        excerpt = jd if len(jd) <= max_jd_chars else jd[: max_jd_chars - 1] + "…"
        parts.append("JOB DESCRIPTION (source of truth):\n" + excerpt)
    if resume:
        rv = resume if len(resume) <= max_resume_chars else resume[: max_resume_chars - 1] + "…"
        parts.append("RESUME EXCERPT (use only real experience; never invent):\n" + rv)
    if lexicon:
        parts.append(
            "ALLOWED TERMS (prefer these; do not force all of them):\n"
            + ", ".join(lexicon[:60])
        )
    else:
        parts.append(
            "ALLOWED TERMS: none loaded — stay strictly on the question wording; "
            "no imported buzzword banks."
        )
    parts.append(
        "BANNED unless in question/JD: p99, QPS, kubernetes, microservice, neural/ML slang, "
        "synergy, leverage, paradigm, thought leadership, world-class, passionate."
    )
    parts.append("=== END JD GROUNDING ===")
    return "\n".join(parts)


def strip_off_domain_filler(answer: str, *, question: str = "", job_context: str = "") -> str:
    """Remove known off-domain filler tokens when answer is JD/SAP-domain."""
    text = (answer or "").strip()
    if not text:
        return text
    try:
        from common_sense import lock_for_turn

        lock = lock_for_turn(question, job_context, load_jd_text() + " " + load_resume_text(400))
        if lock.domain not in ("sap_attp", "sap_fico", "sap_general") and lock.confidence < 0.3:
            # Still strip universal corporate fog lightly
            return _OFF_DOMAIN_FILLER.sub(
                lambda m: m.group(0)
                if _JD_KEEP.search(m.group(0) or "")
                else "",
                text,
            )
    except Exception:
        pass

    def repl(m: re.Match[str]) -> str:
        w = m.group(0)
        if _JD_KEEP.search(w):
            return w
        # keep if question explicitly contains it
        if w.lower() in (question or "").lower():
            return w
        return ""

    cleaned = _OFF_DOMAIN_FILLER.sub(repl, text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    return cleaned.strip()


def role_from_jd(jd: str = "") -> str:
    """Parse Role line from JD text; empty if not present."""
    text = (jd or "").strip() or load_jd_text()
    if not text:
        return ""
    m = re.search(r"Role\s*[:-]+\s*(.+)", text, re.I)
    if not m:
        return ""
    return m.group(1).strip().split("\n")[0].strip(" -\t")


def pack_domain_blob(*, include_disk_jd: bool = False) -> str:
    """
    Compact pack text for domain compatibility checks.

    Disk jd.txt is NOT included by default — empty Role must not inherit
    ambient practice-JD domain scores. Pass include_disk_jd=True only for
    explicit practice-pack flows.
    """
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
    if include_disk_jd:
        jd = load_jd_text()
        if jd:
            bits.append(jd[:1200])
    return " ".join(b for b in bits if b)


def disk_jd_matches_role(job_context: str = "") -> bool:
    """True only when practice disk JD is same product family as the user Role."""
    job = (job_context or "").strip()
    jd = load_jd_text()
    if not job or not jd:
        return False
    try:
        from common_sense import domains_compatible, infer_domain

        job_lock = infer_domain("", job, "")
        jd_lock = infer_domain("", "", jd[:2000])
        if job_lock.domain == "general" or jd_lock.domain == "general":
            # Ambiguous role — do not force disk ATTP onto BRIM-like titles
            if "attp" in jd.lower() and "attp" not in job.lower():
                return False
            if "brim" in job.lower() and "attp" in jd.lower():
                return False
            return "attp" not in jd.lower() or "attp" in job.lower()
        return domains_compatible(job_lock.domain, jd_lock.domain)
    except Exception:
        return False


def lexicon_for_turn(question: str = "", job_context: str = "", max_terms: int = 18) -> list[str]:
    """
    Lexicon for prompts: question + role only, unless disk JD matches the role.
    Never merges ATTP disk terms into a BRIM Role interview.
    """
    q = question or ""
    job = job_context or ""
    if disk_jd_matches_role(job):
        return extract_lexicon(load_jd_text(), q, job, max_terms=max_terms)
    return extract_lexicon(q, job, max_terms=max_terms)


def jd_grounding_applies(question: str = "", job_context: str = "") -> bool:
    """
    True when session pack *matching the role* should bias this answer.

    Never grounds an ATTP practice JD into a BRIM (or other non-ATTP) Role.
    Disk JD only participates when disk_jd_matches_role(job).
    """
    q = (question or "").strip()
    job = (job_context or "").strip()
    pack_blob = pack_domain_blob()
    # Strip disk-incompatible pack JD from consideration
    if not pack_blob and not job:
        return False

    try:
        from common_sense import domains_compatible, infer_domain

        q_lock = infer_domain(q, "", "")
        job_lock = infer_domain("", job, "") if job else None
        # Pack domain from role + pack text — but if pack JD is ATTP and role is BRIM, ignore pack JD
        pack_for_lock = pack_blob
        if job and pack_blob:
            jd_part = ""
            try:
                from session_context import get_pack

                jd_part = (get_pack().job_description or "")[:800]
            except Exception:
                pass
            if jd_part and job_lock and job_lock.domain not in ("general",):
                jd_lock = infer_domain("", "", jd_part)
                if (
                    jd_lock.domain not in ("general",)
                    and not domains_compatible(job_lock.domain, jd_lock.domain)
                ):
                    # Use role only — drop conflicting practice JD from pack blob
                    pack_for_lock = job
        pack_lock = infer_domain("", job, pack_for_lock)

        # Strong off-domain question beats stored pack / role
        if (
            q_lock.domain not in ("general",)
            and q_lock.confidence >= 0.28
            and pack_lock.domain not in ("general",)
            and not domains_compatible(q_lock.domain, pack_lock.domain)
        ):
            return False

        # Question clearly in role domain → ground lightly with role (not foreign JD)
        if (
            q_lock.domain != "general"
            and pack_lock.domain != "general"
            and domains_compatible(q_lock.domain, pack_lock.domain)
        ):
            return True

        # Soft/behavioral: user set role → allow role context, not foreign disk JD
        if job and q_lock.domain == "general":
            if job_lock is None or job_lock.domain == "general":
                return True
            if pack_lock.domain == "general" or domains_compatible(
                job_lock.domain, pack_lock.domain
            ):
                return True

        return False
    except Exception:
        return bool(job)


def bootstrap_session_from_jd_resume(
    *,
    force: bool = False,
    role_hint: str = "",
) -> dict[str, Any]:
    """
    Load JD + resume into session_context if empty (or force=True).

    Role is taken from the JD Role: line or role_hint — never a hard-coded title.
    Callers must still gate prompt injection with jd_grounding_applies().
    """
    try:
        from session_context import get_pack, update_pack

        pack = get_pack()
        if not force and not pack.is_empty() and pack.job_description:
            return {"ok": True, "skipped": True, "role": pack.role}

        jd = load_jd_text()
        resume = load_resume_text(3500)
        if not jd and not resume and not role_hint.strip():
            return {"ok": True, "skipped": True, "role": "", "empty_sources": True}

        # Role only from explicit hint — never default from JD Role: line.
        # UI Role / Job context stay clear until the user types them.
        role = role_hint.strip()

        lex = extract_lexicon(jd, resume, max_terms=40)
        kwargs: dict[str, Any] = {
            "job_description": jd[:4000] if jd else "",
            "resume_text": resume[:3500] if resume else "",
            "keywords": lex[:40],
            "interview_type": "technical",
            "depth": "balanced",
        }
        if role:
            kwargs["role"] = role
        update_pack(**kwargs)
        return {
            "ok": True,
            "skipped": False,
            "role": role,
            "jd_chars": len(jd),
            "resume_chars": len(resume),
            "lexicon_n": len(lex),
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def ensure_grounded_job_context(
    job_context: str = "",
    *,
    question: str = "",
) -> str:
    """
    Resolve role for this turn.

    Explicit job_context is the only source. Empty string stays empty —
    never invent pack.role or disk JD (that reintroduced ATTP under BRIM).
    """
    _ = question  # kept for API compat with callers
    return (job_context or "").strip()
