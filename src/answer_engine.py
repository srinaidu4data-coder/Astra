#!/usr/bin/env python3
"""
Interview answer engine — sharp, JD-grounded, low-latency.

Pipeline (live default):
  prepare job/JD pack → strategy (heuristic) → system+user prompts
  → LLM (fast/accuracy model) → normalize → cache

Quality profiles may add RAG, strategy LLM, and regen.

Public API (stable for copilot_api / live_session / tests):
  generate_answer, iter_answer_tokens, to_bullets, looks_like_question,
  warm_llm_connection, score_answer_quality, analyze_question_strategy,
  model constants, _normalize_answer_text, _is_one_word_answer_question, …
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Generator, Optional

from model_resolve import resolve_answer_models
from rag import CLASSIFICATION_MODEL, SCRIPT_MODEL, _get_openai_client, search_context

# ---------------------------------------------------------------------------
# Models / profile
# ---------------------------------------------------------------------------


def _default_chat_models() -> tuple[str, str, str]:
    """(primary, fast, fallback)."""
    try:
        from config import get_llm_provider

        provider = get_llm_provider()
    except Exception:
        provider = (os.environ.get("ASTRA_LLM_PROVIDER") or "").strip().lower()
    if provider == "groq":
        return (
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "llama-3.3-70b-versatile",
        )
    return ("gpt-4o-mini", "gpt-4o-mini", "gpt-4o")


_DEF_PRIMARY, _DEF_FAST, _DEF_FALLBACK = _default_chat_models()

ANSWER_MODEL = (
    os.environ.get("ASTRA_ANSWER_MODEL", "").strip()
    or os.environ.get("OPENAI_ANSWER_MODEL", "").strip()
    or _DEF_PRIMARY
)
FALLBACK_MODEL = (
    os.environ.get("ASTRA_FALLBACK_MODEL", "").strip()
    or os.environ.get("DEFAULT_FALLBACK_MODEL", "").strip()
    or _DEF_FALLBACK
)
STRATEGY_MODEL = (
    os.environ.get("ASTRA_STRATEGY_MODEL", "").strip()
    or CLASSIFICATION_MODEL
    or _DEF_PRIMARY
)
FAST_ANSWER_MODEL = os.environ.get("ASTRA_FAST_MODEL", "").strip() or _DEF_FAST
FAST_FALLBACK_MODEL = (
    os.environ.get("ASTRA_FAST_FALLBACK", "").strip() or _DEF_FALLBACK
)
TECH_ACCURACY_MODEL = (
    os.environ.get("ASTRA_TECH_MODEL", "").strip() or _DEF_PRIMARY
)
ANSWER_PROFILE = (
    os.environ.get("ASTRA_ANSWER_PROFILE", "").strip().lower() or "live"
)

_FORCE_STRATEGY_LLM = os.environ.get("ASTRA_STRATEGY_LLM", "").strip().lower()
_FORCE_QUALITY_REGEN = os.environ.get("ASTRA_QUALITY_REGEN", "").strip().lower()
_FORCE_RAG = os.environ.get("ASTRA_USE_RAG", "").strip().lower()


def _env_flag(raw: str, default: bool) -> bool:
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def _use_strategy_llm() -> bool:
    if _FORCE_STRATEGY_LLM:
        return _env_flag(_FORCE_STRATEGY_LLM, False)
    return ANSWER_PROFILE in ("quality", "full")


def _use_quality_regen() -> bool:
    if _FORCE_QUALITY_REGEN:
        return _env_flag(_FORCE_QUALITY_REGEN, False)
    return ANSWER_PROFILE in ("quality", "full", "balanced")


def _use_rag() -> bool:
    """
    RAG is OFF by default for all profiles.

    Interviews must ground only on Role, Job Context, attached JD, and Resume —
    never on ambient document stores or prior domain packs.
    Opt-in only: ASTRA_USE_RAG=1.
    """
    if _FORCE_RAG:
        return _env_flag(_FORCE_RAG, False)
    return False


def _is_fast_profile() -> bool:
    return ANSWER_PROFILE in ("ultra", "live", "fast")


def _prefer_fast_models() -> bool:
    return _is_fast_profile()


# ---------------------------------------------------------------------------
# System prompts — short, sharp, domain-safe (no free buzz banks)
# ---------------------------------------------------------------------------

_CORE = (
    "You write speakable first-person interview answers.\n"
    "Sharp and decisive (clear claim → mechanism → tradeoff → proof).\n"
    "GROUNDING RULE (strict): Use ONLY the interviewer's question plus THIS interview's "
    "Role, Job Context, attached Job Description, and attached Resume. "
    "Do NOT use RAG, prior interviews, stored domain packs, or other product families.\n"
    "If a term is not in those materials, use plain English — never invent elite buzzwords "
    "or off-role modules (e.g. ATTP when Role is BRIM).\n"
    "PRODUCT-LINE RULE: never invent SAP product modules (ATTP, BRIM, FICO, Vertex) "
    "unless that exact product name appears in Role, Job Context, JD, or Resume. "
    "Industry words alone do NOT license naming a product brand. "
    "Blank materials → answer the question only; do not invent a role or product family.\n"
    "No markdown #. Labels exactly like Hook: (never /Hook:).\n"
    "Ban filler: basically, just, simply, leverage, synergy, excited to, circle back, "
    "going forward, best practice as empty praise, world-class, passionate.\n"
    "ONE-WORD RULE: if the Q wants yes/no or a single term, Hook: is ONLY that "
    "token + period (Hook: Yes. / Hook: EPCIS.). Then explain.\n"
    "COOL LINE (optional last): after Close, one short Cool: line — calm, dry, "
    "affiliative (warmth after competence). 8–18 words. No roasting the interviewer, "
    "no self-sabotage, no slang memes. Example: Cool: That's the short version — "
    "longer war stories on request.\n"
)

FAST_STAR_SYSTEM = (
    _CORE
    + "Labels: Hook: / Situation: / Task: / Action: / Result: / Close: / Cool:\n"
    "Short Qs 100–180 words; multi-part 180–280. Hook is a punchline. "
    "Action = concrete moves only. Address every clause of multi-part questions. "
    "End with one Cool: line (warmth after competence)."
)
FAST_TECH_SYSTEM = (
    _CORE
    + "Labels: Hook: / Approach: / Mechanism: / Tradeoff: / Close: / Cool:\n"
    "Short 120–200 words; multi-part 200–320. Hook = the design choice. "
    "Mechanism = how it works. Tradeoff = what you refuse and why. "
    "End with one Cool: line (calm sign-off)."
)
FAST_SHORTER_SYSTEM = (
    _CORE
    + "Exactly 4 short lines: 1) Punchline 2) Mechanism 3) Tradeoff or metric 4) Close. "
    "Max 70 words."
)
FAST_CODE_SYSTEM = (
    _CORE
    + "Labels: Approach: then Code: (8–15 lines) then Tradeoff:. "
    "Under 90 words outside code. Correct complexity."
)

RICH_STAR_SYSTEM = (
    _CORE
    + "Labels: Hook: / Situation: / Task: / Action: / Result: / Depth: / Close: / Cool:\n"
    "Short ~140–220 words; multi-part ~200–300. Density over length. "
    "Mechanisms over adjectives. One real number only if defensible from context. "
    "End with one Cool: line."
)
RICH_TECHNICAL_SYSTEM = (
    _CORE
    + "Labels: Hook: / Approach: / Mechanism: / Tradeoffs: / Validation: / Close: / Cool:\n"
    "Short ~150–250; multi-part ~220–340. Two real tradeoffs. "
    "Validation = how you prove it (test, audit, partner trial). "
    "End with one Cool: line."
)
RICH_SHORTER_SYSTEM = (
    _CORE
    + "Exactly 6 speakable lines: punchline, mechanism, action, refuse/tradeoff, "
    "proof, close. 70–120 words. At least 3 precise terms from Q/role/context."
)
RICH_CODE_SYSTEM = (
    _CORE
    + "Approach: 2–4 sentences. Code: 12–30 lines. Walkthrough: edge + complexity. "
    "Tradeoff: when to switch."
)

REGEN_STRICT_SUFFIX = (
    "PREVIOUS DRAFT WAS TOO SOFT, LONG, GENERIC, OR OFF-DOMAIN.\n"
    "Regenerate: sharper Hook, fewer words, more real mechanisms, harder tradeoffs, "
    "only terms from Role/question/context. Zero filler. One-word Q → Hook token only first."
)

REGEN_PRODUCT_BLEED_SUFFIX = (
    "PREVIOUS DRAFT INVENTED A PRODUCT LINE NOT IN ROLE OR QUESTION "
    "(often SAP ATTP / track-and-trace / EPCIS / DSCSA bleed).\n"
    "Regenerate from scratch. Use ONLY modules and terms that appear in Role or the question. "
    "If Role is blank, answer the question in plain professional language — "
    "do NOT default to SAP ATTP or any other product family. "
    "Forbidden unless present in Role/Q: ATTP, EPCIS, DSCSA, GTIN, SSCC, BRIM, FICO, Vertex."
)


def _product_bleed(answer: str, question: str = "", job_context: str = "") -> bool:
    """True if answer invents product-line jargon absent from Role/Q/JD/Resume."""
    try:
        from common_sense import has_invented_product_bleed
        from session_context import materials_grounding_blob

        materials = materials_grounding_blob(job_context) or job_context
        return has_invented_product_bleed(
            answer, question=question, job_context=materials
        )
    except Exception:
        try:
            from common_sense import has_invented_product_bleed

            return has_invented_product_bleed(
                answer, question=question, job_context=job_context
            )
        except Exception:
            return False


def _regen_user_for_bleed(
    question: str,
    *,
    job_context: str,
    tone: str,
    mode: str,
    strategy: dict[str, Any],
    context_chunks: list,
    bleed_terms: list[str] | None = None,
) -> str:
    user = _build_user_prompt(
        question,
        job_context=job_context,
        tone=tone,
        mode=mode,
        strategy=strategy,
        context_chunks=context_chunks,
        strict_regen=True,
    )
    ban = ", ".join((bleed_terms or [])[:12]) or "ATTP, EPCIS, DSCSA, track-and-trace"
    return (
        f"{user}\n\n{REGEN_PRODUCT_BLEED_SUFFIX}\n"
        f"Remove these invented terms completely: {ban}."
    )

STRATEGY_SYSTEM = """Given an interview question and role, return ONLY JSON:
{
  "question_type": "behavioral|technical|system_design|troubleshooting|product|leadership|domain|coding|situational|other",
  "domain_tags": [],
  "must_cover": ["3-6 required points"],
  "jargon_bank": ["terms from the question/role only"],
  "seniority_bar": "junior|mid|senior|staff",
  "pitfalls": ["what weak answers do"],
  "evidence_style": "STAR|framework|tradeoff_analysis|walkthrough|code_sketch",
  "depth_target": "high|very_high"
}
jargon_bank must NOT invent off-role domains. Prefer empty over wrong.
"""

SPEAKABLE_STAR_SYSTEM = RICH_STAR_SYSTEM
SPEAKABLE_SHORTER_SYSTEM = RICH_SHORTER_SYSTEM
SPEAKABLE_TECHNICAL_SYSTEM = RICH_TECHNICAL_SYSTEM
SPEAKABLE_CODE_SYSTEM = RICH_CODE_SYSTEM


# ---------------------------------------------------------------------------
# Question heuristics
# ---------------------------------------------------------------------------


def _is_long_or_multipart_question(question: str) -> bool:
    q = (question or "").strip()
    if not q:
        return False
    words = len(q.split())
    if words >= 35:
        return True
    low = q.lower()
    if low.count("?") >= 2:
        return True
    if low.count(",") >= 3 and words >= 22:
        return True
    markers = (
        "walk me through",
        "how would you design",
        "including",
        "as well as",
        "and what",
        "and how",
        "end-to-end",
        "step by step",
        "step-by-step",
        "multi-",
    )
    return words >= 20 and any(p in low for p in markers)


def _is_one_word_answer_question(question: str) -> bool:
    """Precision > recall for atomic first token."""
    q = (question or "").strip()
    if not q:
        return False
    low = re.sub(r"\s+", " ", q.lower()).strip()
    words = low.split()
    if _is_long_or_multipart_question(q) or len(words) > 18:
        return False
    if low.count("?") >= 2:
        return False
    deny = (
        "what is your",
        "what's your",
        "whats your",
        "what are your",
        "what is my",
        "tell me about",
        "describe a",
        "walk me through",
        "difference between",
        " vs ",
        "versus",
        "compare ",
        "and how ",
        "and when ",
        "and why ",
        "and what ",
        "biggest weakness",
        "biggest strength",
        "hardest bug",
        "experience with",
    )
    if any(d in low for d in deny):
        return False
    if any(
        p in low
        for p in (
            "in one word",
            "in a word",
            "one word",
            "single word",
            "one-word",
            "just the term",
            "just the name",
            "yes or no",
            "true or false",
            "true/false",
            "y/n",
        )
    ):
        return True
    if any(
        p in low
        for p in (
            "what do you call",
            "what do we call",
            "what's the term",
            "what is the term",
            "name the term",
            "name the metric",
            "name the formula",
            "stands for",
            "acronym for",
            "abbreviation for",
            "expand ",
        )
    ):
        return True
    m = re.match(
        r"^(?:what(?:'s|s)?|define|definition of|meaning of)\s+(.+?)\??$",
        low,
    )
    if not m:
        return False
    subject = m.group(1).strip()
    if re.match(
        r"^(your|my|our|the best|the hardest|the biggest|a time|an example)\b",
        subject,
    ):
        return False
    sub_words = subject.split()
    if not (1 <= len(sub_words) <= 6):
        return False
    if any(x in subject for x in (" and ", " or when ", " or how ", " if ", " vs ")):
        return False
    return True


def looks_like_question(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t or len(t.split()) < 3:
        return False
    if "?" in t:
        return True
    t2 = re_sub_wrappers(t)
    cues = (
        "tell me",
        "what is",
        "what are",
        "what was",
        "what would",
        "what do",
        "how would",
        "how do",
        "how does",
        "how did",
        "how can",
        "why ",
        "explain",
        "describe",
        "walk me",
        "walk us",
        "can you",
        "could you",
        "would you",
        "give me",
        "talk about",
        "have you",
        "did you",
        "do you",
        "difference between",
        "compare ",
        "define ",
        "when would",
        "when do",
        "which ",
        "where ",
        "who ",
        "design a",
        "architect",
        "debug",
        "troubleshoot",
        "yes or no",
    )
    return any(c in t2 for c in cues)


def re_sub_wrappers(t: str) -> str:
    t = re.sub(r"^(question|q)\s*\d+\s*[,.:\-–]?\s*", "", t)
    t = re.sub(r"^(interviewer|host)\s*[,:]\s*", "", t)
    return t.strip()


# ---------------------------------------------------------------------------
# Strategy
# ---------------------------------------------------------------------------


def _chat_json(system: str, user: str, model: str) -> dict[str, Any]:
    client = _get_openai_client()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=500,
            response_format={"type": "json_object"},
            timeout=30.0,
        )
        text = resp.choices[0].message.content or "{}"
        return json.loads(text)
    except Exception:
        return {}


def analyze_question_strategy(
    question: str,
    *,
    job_context: str = "",
) -> dict[str, Any]:
    q = (question or "").strip()
    if not q:
        return _fallback_strategy("", job_context)
    data = _chat_json(
        STRATEGY_SYSTEM,
        f"Role: {job_context or 'professional'}\n\nQuestion:\n{q}",
        STRATEGY_MODEL,
    )
    if not data:
        return _fallback_strategy(q, job_context)
    data.setdefault("question_type", "other")
    data.setdefault("domain_tags", [])
    data.setdefault("must_cover", [])
    data.setdefault("jargon_bank", [])
    data.setdefault("seniority_bar", "senior")
    data.setdefault("pitfalls", [])
    data.setdefault("evidence_style", "framework")
    data.setdefault("depth_target", "high")
    # Lexicon from question + role only (disk ATTP JD never bleeds into BRIM)
    try:
        from jd_grounding import lexicon_for_turn

        bank = [str(x) for x in (data.get("jargon_bank") or []) if x]
        jd_lex = lexicon_for_turn(q, job_context, max_terms=16)
        seen = {b.lower() for b in bank}
        for t in jd_lex:
            if t.lower() not in seen:
                bank.append(t)
                seen.add(t.lower())
        data["jargon_bank"] = bank[:20]
    except Exception:
        pass
    return data


def _fallback_strategy(question: str, job_context: str) -> dict[str, Any]:
    t = (question or "").lower()
    jtype = "other"
    if any(
        k in t
        for k in (
            "tell me about a time",
            "describe a situation",
            "conflict",
            "leadership",
            "mentored",
            "failed",
            "weakness",
            "strength",
        )
    ):
        jtype = "behavioral"
    elif any(
        k in t
        for k in ("code", "implement", "algorithm", "leetcode", "write a function")
    ):
        jtype = "coding"
    elif any(
        k in t
        for k in ("design", "architect", "scale", "distributed", "system design")
    ):
        jtype = "system_design"
    elif any(
        k in t for k in ("debug", "outage", "incident", "root cause", "troubleshoot")
    ):
        jtype = "troubleshooting"
    elif any(
        k in t
        for k in (
            "how",
            "what is",
            "explain",
            "difference",
            "why",
            "compare",
            "walk me",
            "yes or no",
        )
    ):
        jtype = "technical"

    jargon: list[str] = []
    try:
        from jd_grounding import lexicon_for_turn

        jargon = lexicon_for_turn(question or "", job_context or "", max_terms=18)
    except Exception:
        jargon = []

    return {
        "question_type": jtype,
        "domain_tags": [],
        "must_cover": [
            "answer the question as asked",
            "concrete mechanism or actions (not slogans)",
            "one real tradeoff or validation when relevant",
            "use only role/JD/question terms — never invent off-domain buzz",
        ],
        "jargon_bank": jargon,
        "seniority_bar": "general",
        "pitfalls": [
            "vague adjectives",
            "inventing tools/products/metrics",
            "wrong domain substitution",
            "generic power-English not in the JD",
        ],
        "evidence_style": "STAR" if jtype == "behavioral" else "framework",
        "depth_target": "high",
        "accuracy_domain": "general",
    }


def _needs_accuracy_model(
    strategy: dict[str, Any], question: str, job_context: str
) -> bool:
    if strategy.get("question_type") in (
        "technical",
        "domain",
        "system_design",
        "coding",
        "troubleshooting",
    ):
        return True
    q = (question or "").lower()
    return len(q.split()) >= 28 or q.count("?") >= 2


def _prefer_mode_for_question(
    mode: str, strategy: dict[str, Any], question: str
) -> str:
    mode = (mode or "star").strip().lower()
    if mode in ("technical", "code", "shorter", "star"):
        return mode
    return "star"


# ---------------------------------------------------------------------------
# Normalize / one-word / quality
# ---------------------------------------------------------------------------


def _enforce_one_word_first(text: str, question: str) -> str:
    if not _is_one_word_answer_question(question):
        return text
    t = (text or "").strip()
    if not t:
        return t
    lines = t.splitlines()
    first = lines[0].strip() if lines else ""

    atomic_ok = re.match(
        r"^(?:(?:Hook|Answer|Thesis)\s*:\s*)?"
        r"([A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3})\s*\.\s*$",
        first,
        flags=re.I,
    )
    if atomic_ok:
        tok = re.sub(r"\s+", " ", atomic_ok.group(1).strip())
        rest = "\n".join(lines[1:]).strip()
        head = f"Hook: {tok}."
        return f"{head}\n{rest}".strip() if rest else head

    m = re.match(
        r"^(?:Hook|Answer|Thesis)\s*:\s*"
        r"([A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3})"
        r"\s+(is|are|means|refers to|stands for)\s+(.+)$",
        first,
        flags=re.I,
    )
    if m:
        tok = re.sub(r"\s+", " ", m.group(1).strip())
        rest_line = m.group(3).strip()
        rest = "\n".join([rest_line] + lines[1:]).strip()
        if rest and not re.match(
            r"^(Approach|Mechanism|Situation|Action|Result|Explain)\s*:",
            rest,
            re.I,
        ):
            rest = f"Approach: {rest}"
        return f"Hook: {tok}.\n{rest}".strip()
    return t


def _normalize_answer_text(
    text: str, question: str = "", job_context: str = ""
) -> str:
    t = (text or "").strip()
    if not t:
        return t
    t = re.sub(
        r"(?m)^[ \t]*/+\s*"
        r"(Hook|Situation|Task|Action|Result|Depth|Close|Approach|Mechanism|Tradeoffs?|Validation)\s*:",
        r"\1:",
        t,
    )
    t = re.sub(
        r"[ \t]*/+\s*"
        r"(Hook|Situation|Task|Action|Result|Approach|Mechanism|Tradeoff)\s*:",
        r"\1:",
        t,
    )
    t = re.sub(
        r"([.!?])\s*Hook:\s*"
        r"(?=(Approach|Situation|Task|Action|Result|Mechanism|Tradeoff|Close)\s*:)",
        r"\1 ",
        t,
        flags=re.I,
    )
    t = re.sub(
        r"\bHook:\s*(?=(Approach|Situation|Mechanism|Tradeoff)\s*:)",
        "",
        t,
        flags=re.I,
    )
    t = t.replace("**", "").replace("##", "")
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(
        r"[\s/]*"
        r"(Hook|Situation|Task|Action|Result|Depth|Close|Approach|Mechanism|Tradeoffs?|Validation)\s*:\s*$",
        "",
        t,
        flags=re.I,
    )
    t = t.strip()
    if t and t[-1] not in ".!?":
        m = re.search(r"^(.*[.!?])\s*[^.!?]*$", t, flags=re.S)
        if m and len(m.group(1).split()) >= 40:
            t = m.group(1).strip()
    if question:
        t = _enforce_one_word_first(t, question)
    try:
        from common_sense import sanitize_answer

        t = sanitize_answer(t, question=question, job_context=job_context)
    except Exception:
        pass
    try:
        from jd_grounding import strip_off_domain_filler

        t = strip_off_domain_filler(t, question=question, job_context=job_context)
    except Exception:
        pass
    return t


def score_answer_quality(
    text: str, strategy: dict[str, Any], *, mode: str
) -> dict[str, Any]:
    t = (text or "").strip()
    words = len(t.split())
    low = t.lower()
    score = 0
    reasons: list[str] = []

    min_words = {"shorter": 60, "code": 70, "technical": 120, "star": 120}.get(
        mode, 120
    )
    if words >= min_words:
        score += 25
    elif words >= int(min_words * 0.65):
        score += 12
        reasons.append(f"thin length ({words})")
    else:
        reasons.append(f"too short ({words})")

    labels = (
        "hook:",
        "situation:",
        "task:",
        "action:",
        "result:",
        "approach:",
        "mechanism:",
        "tradeoff",
    )
    label_hits = sum(1 for lab in labels if lab in low)
    if label_hits >= 3:
        score += 25
    elif label_hits >= 2:
        score += 12
    else:
        reasons.append("weak structure")

    jargon = [
        j.lower()
        for j in (strategy.get("jargon_bank") or [])
        if isinstance(j, str) and len(j) > 2
    ]
    jargon_hits = sum(1 for j in jargon[:20] if j and j in low)
    if jargon_hits >= 2:
        score += 25
    elif jargon_hits == 1:
        score += 12
    elif jargon:
        reasons.append("JD jargon unused")

    if re.search(r"\b\d+(\.\d+)?\s*(%|ms|s|x|k|m)?\b", low) or any(
        w in low for w in ("yes", "no", "block", "refuse", "approve")
    ):
        score += 15
    fluff = len(
        re.findall(
            r"\b(basically|synergy|leverage the|very very|world-class|passionate)\b",
            low,
        )
    )
    if fluff == 0:
        score += 10
    else:
        score -= min(20, fluff * 6)
        reasons.append("filler")

    score = max(0, min(100, score))
    return {
        "score": score,
        "words": words,
        "pass": score >= 50,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Prompt build
# ---------------------------------------------------------------------------


def _system_for_mode(mode: str) -> str:
    if _is_fast_profile():
        return {
            "shorter": FAST_SHORTER_SYSTEM,
            "technical": FAST_TECH_SYSTEM,
            "code": FAST_CODE_SYSTEM,
            "star": FAST_STAR_SYSTEM,
        }.get(mode, FAST_STAR_SYSTEM)
    return {
        "shorter": RICH_SHORTER_SYSTEM,
        "technical": RICH_TECHNICAL_SYSTEM,
        "code": RICH_CODE_SYSTEM,
        "star": RICH_STAR_SYSTEM,
    }.get(mode, RICH_STAR_SYSTEM)


def _system_with_domain(
    mode: str, question: str = "", job_context: str = ""
) -> str:
    base = _system_for_mode(mode)
    try:
        from common_sense import lock_for_turn, system_suffix

        job = (job_context or "").strip()
        # Domain from question + this interview's Role only — never session pack / disk JD
        lock = lock_for_turn(question, job, extra_context="")
        suffix = system_suffix(lock)
        if job:
            suffix += (
                f" Interview Role for this user: {job[:120]}. "
                "Answer only with skills for that Role and the question — "
                "never borrow other SAP product lines."
            )
        return base + suffix
    except Exception:
        return base


def _answer_depth() -> str:
    try:
        from session_context import get_depth

        d = get_depth()
        if d in ("fast", "balanced", "deep"):
            return d
    except Exception:
        pass
    raw = os.environ.get("ASTRA_ANSWER_DEPTH", "").strip().lower()
    if raw in ("fast", "balanced", "deep", "quality"):
        return "deep" if raw == "quality" else raw
    return "balanced"


def _max_tokens_for_mode(mode: str, *, question: str = "") -> int:
    long_q = _is_long_or_multipart_question(question)
    depth = _answer_depth()
    if depth == "fast" or ANSWER_PROFILE in ("ultra", "fast"):
        base = {"shorter": 90, "technical": 280, "code": 240, "star": 220}.get(
            mode, 220
        )
        return base + (120 if long_q else 0)
    if depth == "deep":
        base = {"shorter": 320, "technical": 900, "code": 900, "star": 950}.get(
            mode, 900
        )
        return base + (200 if long_q else 0)
    if ANSWER_PROFILE == "live":
        base = {"shorter": 150, "technical": 520, "code": 420, "star": 450}.get(
            mode, 450
        )
        return base + (200 if long_q else 0)
    if ANSWER_PROFILE == "balanced":
        base = {"shorter": 300, "technical": 800, "code": 800, "star": 850}.get(
            mode, 800
        )
        return base + (150 if long_q else 0)
    return {"shorter": 400, "technical": 1000, "code": 1100, "star": 1100}.get(
        mode, 1000
    )


def _prepare_job(job_context: str, question: str = "") -> str:
    try:
        from jd_grounding import ensure_grounded_job_context

        return ensure_grounded_job_context(job_context, question=question)
    except Exception:
        return (job_context or "").strip()


def _build_user_prompt(
    question: str,
    *,
    job_context: str,
    tone: str,
    mode: str,
    strategy: dict[str, Any],
    context_chunks: list,
    strict_regen: bool = False,
) -> str:
    q = (question or "").strip()
    # Per-interview Role/Job only — never disk practice JD or foreign packs
    user_job = (job_context or "").strip()
    job = user_job

    # Materials: Role + attached JD + Resume for THIS session only (no RAG)
    materials_blob = ""
    materials_block = ""
    try:
        from session_context import format_materials_for_prompt, materials_grounding_blob

        materials_blob = materials_grounding_blob(user_job)
        materials_block = format_materials_for_prompt(user_job)
    except Exception:
        materials_blob = user_job
        materials_block = (
            f"Role / Job context: {user_job}" if user_job else ""
        )

    lock = None
    guard = ""
    try:
        from common_sense import (
            filter_context_chunks,
            lock_for_turn,
            prompt_guardrails,
        )

        # Domain from THIS interview materials only (Role/JD/Resume), never pack bleed
        lock = lock_for_turn(
            q,
            user_job or materials_blob[:400],
            extra_context=(materials_blob[:2000] if materials_blob else ""),
        )
        guard = prompt_guardrails(lock, role=user_job or materials_blob[:200])
        # Drop any accidental RAG chunks — interviews are materials-only
        context_chunks = []

    except Exception:
        guard = (
            "Stay on the asked topic and the stated Role / JD / Resume only. "
            "Do not import other product-line skills or prior interviews. "
            "No meta coaching labels."
        )
        context_chunks = []

    pre = materials_block or (
        "INTERVIEW MATERIALS: none set. Answer the question only."
    )

    jargon: list[str] = []
    try:
        from jd_grounding import lexicon_for_turn

        jargon = lexicon_for_turn(
            q,
            user_job,
            job_description=materials_blob[:2500],
            max_terms=14,
        )
    except Exception:
        jargon = [str(j) for j in (strategy.get("jargon_bank") or []) if j][:14]
    must = [str(m) for m in (strategy.get("must_cover") or []) if m][:5]
    long_q = _is_long_or_multipart_question(q)
    depth = _answer_depth()
    one_word = _is_one_word_answer_question(q)
    # Never paint a stored product domain unless materials named a brand
    domain = "interview materials only"
    if lock and lock.confidence >= 0.28 and lock.domain != "general":
        domain = lock.label

    materials_rule = (
        "MATERIALS RULE: Answer ONLY from the question + Role/Job Context + "
        "attached JD + attached Resume above. "
        "No RAG, no prior interviews, no stored domain answers, no other products."
    )

    if _is_fast_profile() and not strict_regen:
        q_budget = 1800 if long_q else 900
        parts = [
            f"Role: {job[:180] if job else '(use only materials / question — do not invent a job title)'}",
            f"Q: {q[:q_budget]}",
            f"Grounding: {domain}",
            f"Depth: {depth}",
        ]
        if pre:
            parts.append(pre)
        if jargon:
            parts.append("Prefer these materials terms when accurate: " + ", ".join(jargon))
        if must:
            parts.append("Must cover: " + "; ".join(must))
        if guard:
            parts.append(guard)
        parts.append(materials_rule)
        if user_job or materials_blob:
            parts.append(
                "ROLE RULE: Answer as THIS Role/materials only. "
                "Never invent product modules not named in materials."
            )
        else:
            parts.append(
                "TOPIC RULE: No Role/JD/Resume set — answer the question only. "
                "Do not invent a job title or product family."
            )
        if long_q:
            parts.append(
                "MULTI-PART: answer every clause in order. Do not stop after the first."
            )
        if one_word:
            parts.append(
                "ATOMIC FIRST: Hook: is ONLY the one word/yes|no + period. "
                "Next lines explain. Example: Hook: Yes."
            )
        else:
            parts.append(
                "Start with Hook: then labeled sections. First lines speakable immediately."
            )
        if depth == "fast":
            parts.append("FAST: 90–140 words. One metric max if real.")
        elif depth == "deep":
            parts.append("DEEP: 220–340 words. Mechanisms + failure modes.")
        parts.append(
            "Accuracy: correct for THIS question and materials only; "
            "no invented APIs/products; finish every section."
        )
        parts.append("Answer now.")
        return "\n".join(parts)

    # RAG deliberately unused — materials only
    _ = context_chunks

    strat_blob = json.dumps(
        {
            "question_type": strategy.get("question_type"),
            "must_cover": strategy.get("must_cover"),
            "jargon_bank": strategy.get("jargon_bank"),
            "pitfalls": strategy.get("pitfalls"),
            "depth_target": strategy.get("depth_target"),
        },
        ensure_ascii=False,
    )
    tone_line = {
        "professional": "clear, senior, technical, zero corporate fog",
        "casual": "plain speech, still precise",
        "confident": "decisive, short sentences, mechanism + proof",
    }.get((tone or "confident").lower(), "decisive, short sentences, mechanism + proof")

    instruct = {
        "shorter": "Write 4–6 high-signal speakable lines now.",
        "technical": "Write the technical answer now.",
        "code": "Write approach + code + walkthrough + tradeoff now.",
        "star": "Write Hook/STAR/Close now.",
    }.get(mode, "Write the interview answer now.")

    parts = [
        f"ROLE: {job or '(answer from materials / question only — do not invent a job title)'}",
        f"TONE: {tone_line}",
        f"STRATEGY: {strat_blob}",
        guard,
        pre,
        materials_rule,
        f"QUESTION:\n{q}",
        instruct,
    ]
    if strict_regen:
        parts.append(REGEN_STRICT_SUFFIX)
    return "\n\n".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# LLM I/O
# ---------------------------------------------------------------------------


def _is_reasoning_model(model: str) -> bool:
    m = (model or "").strip().lower()
    if not m:
        return False
    return (
        m.startswith("o1")
        or m.startswith("o3")
        or m.startswith("o4")
        or "reasoning" in m
    )


def _chat_create_kwargs(
    *,
    model: str,
    messages: list,
    max_tokens: int,
    temperature: float,
    stream: bool,
    timeout: float,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "timeout": timeout,
    }
    if _is_reasoning_model(model):
        # o-series often rejects temperature
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = max_tokens
        kwargs["temperature"] = temperature
    return kwargs


def _map_model(m: str | None) -> str | None:
    if not m:
        return None
    try:
        from config import get_llm_provider, remap_model_for_provider

        m2 = remap_model_for_provider(m) or m
        provider = get_llm_provider()
        low = m2.lower()
        # OpenAI cannot serve Llama IDs
        if provider == "openai" and any(
            x in low for x in ("llama", "mixtral", "gemma", "gpt-oss")
        ):
            return "gpt-4o-mini"
        # Groq cannot serve gpt-4o without remap (remap should handle)
        return m2
    except Exception:
        return m


def _pick_models(
    *,
    accuracy: bool,
    answer_model: str | None,
    fallback_model: str | None,
    user_answer_model: str | None,
    user_fallback_model: str | None,
) -> tuple[str, str]:
    am, fm = answer_model, fallback_model
    uam, ufm = user_answer_model, user_fallback_model
    if _prefer_fast_models():
        if not (uam or am):
            am = TECH_ACCURACY_MODEL if accuracy else FAST_ANSWER_MODEL
        if not (ufm or fm):
            fm = FAST_FALLBACK_MODEL if accuracy else FAST_ANSWER_MODEL
        if _is_reasoning_model(str(uam or am or "")) and not os.environ.get(
            "ASTRA_ALLOW_SLOW_LIVE", ""
        ).strip():
            am = TECH_ACCURACY_MODEL if accuracy else FAST_ANSWER_MODEL
            uam = None
    primary, fallback = resolve_answer_models(
        answer_model=am,
        fallback_model=fm,
        user_answer_model=uam,
        user_fallback_model=ufm,
    )
    if _prefer_fast_models() and _is_reasoning_model(primary):
        primary, fallback = (
            (TECH_ACCURACY_MODEL, FAST_FALLBACK_MODEL)
            if accuracy
            else (FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL)
        )
    if accuracy and (
        "nano" in (primary or "")
        or "instant" in (primary or "")
        or "8b" in (primary or "").lower()
    ):
        primary, fallback = TECH_ACCURACY_MODEL, FAST_FALLBACK_MODEL
    primary = _map_model(primary) or primary
    fallback = _map_model(fallback) or fallback
    return primary, fallback


def _complete_answer(
    *,
    system: str,
    user: str,
    model: str,
    fallback_model: str | None = None,
    max_tokens: int,
    temperature: float = 0.25,
) -> str:
    client = _get_openai_client()
    models_try = [
        _map_model(model),
        _map_model(fallback_model or FALLBACK_MODEL),
        _map_model(SCRIPT_MODEL),
        _map_model(FAST_ANSWER_MODEL),
        _map_model(FAST_FALLBACK_MODEL),
        _map_model("gpt-4o-mini"),
    ]
    if _is_fast_profile():
        models_try = [
            _map_model(model),
            _map_model(fallback_model or FAST_FALLBACK_MODEL),
            _map_model(FAST_ANSWER_MODEL),
            _map_model("gpt-4o-mini"),
        ]
    seen: set[str] = set()
    last_err: Exception | None = None
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    timeout = 10.0 if _is_fast_profile() else 45.0
    for m in models_try:
        if not m or m in seen:
            continue
        seen.add(m)
        try:
            resp = client.chat.completions.create(
                **_chat_create_kwargs(
                    model=m,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=False,
                    timeout=timeout,
                )
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            last_err = e
            print(f"[answer_engine] model={m!r} failed: {type(e).__name__}: {e}")
            continue
    if last_err:
        raise last_err
    return ""


# ---------------------------------------------------------------------------
# Public generate / stream
# ---------------------------------------------------------------------------


def generate_answer(
    question: str,
    *,
    job_context: str = "",
    tone: str = "confident",
    mode: str = "star",
    answer_model: str | None = None,
    fallback_model: str | None = None,
    user_answer_model: str | None = None,
    user_fallback_model: str | None = None,
) -> str:
    mode = (mode or "star").strip().lower()
    if mode not in ("star", "shorter", "technical", "code"):
        mode = "star"
    job_context = _prepare_job(job_context, question=question)
    strategy = _fallback_strategy(question, job_context)
    mode = _prefer_mode_for_question(mode, strategy, question)
    accuracy = _needs_accuracy_model(strategy, question, job_context)

    if _is_fast_profile():
        from fast_answer import cache_lookup, cache_store, instant_answer

        hit = cache_lookup(
            question, mode=mode, job_context=job_context, allow_approx=False
        )
        if hit and not _product_bleed(hit[0], question, job_context):
            generate_answer.last_source = hit[1] if len(hit) > 1 else "cache"  # type: ignore[attr-defined]
            return hit[0]

        primary, fallback = _pick_models(
            accuracy=accuracy,
            answer_model=answer_model,
            fallback_model=fallback_model,
            user_answer_model=user_answer_model,
            user_fallback_model=user_fallback_model,
        )
        system = _system_with_domain(mode, question, job_context)
        user = _build_user_prompt(
            question,
            job_context=job_context,
            tone=tone,
            mode=mode,
            strategy=strategy,
            context_chunks=[],
            strict_regen=False,
        )
        try:
            answer = _complete_answer(
                system=system,
                user=user,
                model=primary,
                fallback_model=fallback,
                max_tokens=_max_tokens_for_mode(mode, question=question),
                temperature=0.15 if accuracy else 0.25,
            )
        except Exception:
            answer = ""
        answer = _normalize_answer_text(answer, question, job_context)
        # Reject ambient ATTP / foreign product bleed — one hard regen
        if answer and _product_bleed(answer, question, job_context):
            try:
                from common_sense import invented_product_hits

                terms = [t for _d, t in invented_product_hits(
                    answer, question=question, job_context=job_context
                )]
            except Exception:
                terms = ["ATTP", "EPCIS", "DSCSA"]
            user_b = _regen_user_for_bleed(
                question,
                job_context=job_context,
                tone=tone,
                mode=mode,
                strategy=strategy,
                context_chunks=[],
                bleed_terms=terms,
            )
            try:
                answer2 = _complete_answer(
                    system=system,
                    user=user_b,
                    model=primary,
                    fallback_model=fallback,
                    max_tokens=_max_tokens_for_mode(mode, question=question),
                    temperature=0.1,
                )
                answer2 = _normalize_answer_text(answer2, question, job_context)
                if answer2 and not _product_bleed(answer2, question, job_context):
                    answer = answer2
                elif answer2:
                    # Still bleeding — keep cleaner of the two by exclusive-hit count
                    answer = answer2
            except Exception:
                pass
        if not answer:
            # Never template-swap hard technical domain answers
            allow_template = (
                not accuracy
                and os.environ.get("ASTRA_TEMPLATE_ON_LLM_FAIL", "1")
                .strip()
                .lower()
                not in ("0", "false", "no", "off")
            )
            if allow_template:
                answer, _, _ = instant_answer(
                    question, job_context=job_context, mode=mode
                )
                answer = _normalize_answer_text(answer, question, job_context)
                if _product_bleed(answer, question, job_context):
                    answer = ""
                else:
                    generate_answer.last_source = "template_fallback"  # type: ignore[attr-defined]
                    return answer
            generate_answer.last_source = "llm_empty"  # type: ignore[attr-defined]
            return ""
        if not _product_bleed(answer, question, job_context):
            cache_store(question, answer, mode=mode, job_context=job_context)
        generate_answer.last_source = "llm"  # type: ignore[attr-defined]
        return answer

    # Quality / balanced
    if _use_strategy_llm():
        strategy = analyze_question_strategy(question, job_context=job_context)
    accuracy = _needs_accuracy_model(strategy, question, job_context)
    primary, fallback = _pick_models(
        accuracy=accuracy,
        answer_model=answer_model,
        fallback_model=fallback_model,
        user_answer_model=user_answer_model,
        user_fallback_model=user_fallback_model,
    )
    chunks: list = []
    if _use_rag():
        try:
            chunks = search_context(question, job_context=job_context) or []
        except Exception:
            chunks = []
        try:
            from common_sense import filter_context_chunks

            chunks = filter_context_chunks(
                chunks, question=question, job_context=job_context
            )
        except Exception:
            pass

    system = _system_with_domain(mode, question, job_context)
    user = _build_user_prompt(
        question,
        job_context=job_context,
        tone=tone,
        mode=mode,
        strategy=strategy,
        context_chunks=chunks,
        strict_regen=False,
    )
    answer = _complete_answer(
        system=system,
        user=user,
        model=primary,
        fallback_model=fallback,
        max_tokens=_max_tokens_for_mode(mode, question=question),
        temperature=0.2 if accuracy else 0.3,
    )
    answer = _normalize_answer_text(answer, question, job_context)
    generate_answer.last_source = "llm" if (answer or "").strip() else "llm_empty"  # type: ignore[attr-defined]

    # Always kill ambient product-line bleed (ATTP when Role is BRIM/blank, etc.)
    if answer and _product_bleed(answer, question, job_context):
        try:
            from common_sense import invented_product_hits

            terms = [
                t
                for _d, t in invented_product_hits(
                    answer, question=question, job_context=job_context
                )
            ]
        except Exception:
            terms = ["ATTP", "EPCIS", "DSCSA"]
        user_b = _regen_user_for_bleed(
            question,
            job_context=job_context,
            tone=tone,
            mode=mode,
            strategy=strategy,
            context_chunks=chunks,
            bleed_terms=terms,
        )
        answer2 = _complete_answer(
            system=system,
            user=user_b,
            model=primary,
            fallback_model=fallback,
            max_tokens=_max_tokens_for_mode(mode, question=question),
            temperature=0.15,
        )
        answer2 = _normalize_answer_text(answer2, question, job_context)
        if answer2 and (
            not _product_bleed(answer2, question, job_context)
            or score_answer_quality(answer2, strategy, mode=mode)["score"]
            >= score_answer_quality(answer, strategy, mode=mode)["score"]
        ):
            answer = answer2
        generate_answer.last_source = "llm_bleed_regen"  # type: ignore[attr-defined]

    if _use_quality_regen() and answer:
        quality = score_answer_quality(answer, strategy, mode=mode)
        regen_floor = 40 if ANSWER_PROFILE == "balanced" else 50
        force_bleed = _product_bleed(answer, question, job_context)
        if quality["score"] < regen_floor or force_bleed:
            if force_bleed:
                try:
                    from common_sense import invented_product_hits

                    terms = [
                        t
                        for _d, t in invented_product_hits(
                            answer, question=question, job_context=job_context
                        )
                    ]
                except Exception:
                    terms = ["ATTP"]
                user2 = _regen_user_for_bleed(
                    question,
                    job_context=job_context,
                    tone=tone,
                    mode=mode,
                    strategy=strategy,
                    context_chunks=chunks,
                    bleed_terms=terms,
                )
            else:
                user2 = _build_user_prompt(
                    question,
                    job_context=job_context,
                    tone=tone,
                    mode=mode,
                    strategy=strategy,
                    context_chunks=chunks,
                    strict_regen=True,
                )
            answer2 = _complete_answer(
                system=system,
                user=user2,
                model=primary,
                fallback_model=fallback,
                max_tokens=_max_tokens_for_mode(mode, question=question),
                temperature=0.2,
            )
            answer2 = _normalize_answer_text(answer2, question, job_context)
            q2 = score_answer_quality(answer2, strategy, mode=mode)
            if force_bleed and answer2 and not _product_bleed(
                answer2, question, job_context
            ):
                answer = answer2
            elif q2["score"] >= quality["score"]:
                answer = answer2
    return (answer or "").strip()


def iter_answer_tokens(
    question: str,
    *,
    job_context: str = "",
    tone: str = "confident",
    mode: str = "star",
    answer_model: str | None = None,
    fallback_model: str | None = None,
    user_answer_model: str | None = None,
    user_fallback_model: str | None = None,
) -> Generator[str, None, None]:
    mode = (mode or "star").strip().lower()
    if mode not in ("star", "shorter", "technical", "code"):
        mode = "star"
    job_context = _prepare_job(job_context, question=question)

    if _use_strategy_llm():
        strategy = analyze_question_strategy(question, job_context=job_context)
    else:
        strategy = _fallback_strategy(question, job_context)
    mode = _prefer_mode_for_question(mode, strategy, question)
    accuracy = _needs_accuracy_model(strategy, question, job_context)

    chunks: list = []
    if _use_rag():
        try:
            chunks = search_context(question, job_context=job_context) or []
        except Exception:
            chunks = []
        try:
            from common_sense import filter_context_chunks

            chunks = filter_context_chunks(
                chunks, question=question, job_context=job_context
            )
        except Exception:
            pass

    primary, fallback = _pick_models(
        accuracy=accuracy,
        answer_model=answer_model,
        fallback_model=fallback_model,
        user_answer_model=user_answer_model,
        user_fallback_model=user_fallback_model,
    )
    system = _system_with_domain(mode, question, job_context)
    user = _build_user_prompt(
        question,
        job_context=job_context,
        tone=tone,
        mode=mode,
        strategy=strategy,
        context_chunks=chunks,
        strict_regen=False,
    )
    if not _is_fast_profile() or accuracy:
        user += (
            "\n\nPrefer correct dense content. Complete every labeled section."
        )

    client = _get_openai_client()
    models_try: list[str] = []
    for m in (
        primary,
        fallback,
        SCRIPT_MODEL,
        FAST_ANSWER_MODEL,
        FAST_FALLBACK_MODEL,
        "gpt-4o-mini",
    ):
        mm = _map_model(m)
        if mm and mm not in models_try:
            models_try.append(mm)

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    max_tok = _max_tokens_for_mode(mode, question=question)
    temp = 0.15 if accuracy else (0.25 if _is_fast_profile() else 0.3)
    stream = None
    last_err: Exception | None = None
    for model in models_try:
        try:
            stream = client.chat.completions.create(
                **_chat_create_kwargs(
                    model=model,
                    messages=messages,
                    max_tokens=max_tok,
                    temperature=temp,
                    stream=True,
                    timeout=14.0 if _is_fast_profile() else 75.0,
                )
            )
            break
        except Exception as e:
            last_err = e
            print(f"[answer_engine] stream model={model!r} failed: {e}")
            continue
    if stream is None:
        if last_err:
            raise last_err
        return

    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def to_bullets(text: str, mode: str = "star") -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    mode = (mode or "star").strip().lower()
    prose = re.sub(r"```[\s\S]*?```", " [code sketch] ", text).strip()
    section_keys = (
        "hook",
        "situation",
        "task",
        "action",
        "result",
        "depth",
        "close",
        "approach",
        "mechanism",
        "tradeoffs",
        "tradeoff",
        "validation",
        "walkthrough",
        "code",
    )
    labeled: list[str] = []
    for raw in prose.splitlines():
        line = raw.strip(" -•\t")
        if not line:
            continue
        low = line.lower()
        mapped = False
        for key in section_keys:
            prefix = key + ":"
            if low.startswith(prefix):
                body = line.split(":", 1)[1].strip()
                title = "Tradeoffs" if key == "tradeoffs" else key.capitalize()
                if key == "close":
                    title = "Close"
                if key == "hook" and re.match(
                    r"^[A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3}\s*\.?\s*$",
                    body,
                ):
                    tok = body.rstrip().rstrip(".")
                    labeled.append(f"Hook: {tok}.")
                else:
                    labeled.append(f"{title} — {body}")
                mapped = True
                break
        if not mapped:
            m = re.match(r"^(\d+)[\).\:\-]\s*(.+)$", line)
            labeled.append(m.group(2).strip() if m else line)
    if len(labeled) >= 2:
        return labeled[:16]
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", prose) if p.strip()]
    if mode == "star" and len(parts) >= 4:
        labels = ["Situation — ", "Task — ", "Action — ", "Result — ", "Depth — "]
        out = []
        for i, p in enumerate(parts[:8]):
            lab = labels[i] if i < len(labels) else "• "
            out.append(lab + (p if p.endswith((".", "!", "?")) else p + "."))
        return out
    return parts[:10] if parts else [text]


def warm_llm_connection() -> None:
    """Pre-open TLS to LLM provider — kills cold Q1 latency."""
    t0 = time.perf_counter()
    try:
        client = _get_openai_client()
        model = _map_model(FAST_ANSWER_MODEL) or FAST_ANSWER_MODEL
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
            temperature=0,
            timeout=6.0,
        )
        try:
            from latency_metrics import get_registry

            get_registry().mark_warm((time.perf_counter() - t0) * 1000)
        except Exception:
            pass
    except Exception:
        pass
