#!/usr/bin/env python3
"""
Interview answer engine — quality-first, not teleprompter-thin.

Pipeline:
  1) Strategy analysis  — what kind of answer is "right" for this question
  2) Depth generation — jargon-rich, structured, role-aware answer
  3) Quality gate     — reject thin answers and regenerate once with stricter bar
  4) Presentation     — normalize into speakable sections / bullets for the UI

Goal: candidates get a substantive, technical, interview-grade answer — not a
generic 40-word filler script.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Generator, Optional

from model_resolve import resolve_answer_models
from rag import CLASSIFICATION_MODEL, SCRIPT_MODEL, _get_openai_client, search_context

# Prefer a stronger model for final answers when available (override via env).
ANSWER_MODEL = (
    os.environ.get("ASTRA_ANSWER_MODEL", "").strip()
    or os.environ.get("OPENAI_ANSWER_MODEL", "").strip()
    or "gpt-4o"
)
FALLBACK_MODEL = (
    os.environ.get("ASTRA_FALLBACK_MODEL", "").strip()
    or os.environ.get("DEFAULT_FALLBACK_MODEL", "").strip()
    or "gpt-4o-mini"
)
STRATEGY_MODEL = os.environ.get("ASTRA_STRATEGY_MODEL", "").strip() or CLASSIFICATION_MODEL or "gpt-4o-mini"

# Sub-1s target: default to the fastest solid Chat Completions models.
# Admin can still assign slower models; ultra/live remaps when unset.
FAST_ANSWER_MODEL = (
    os.environ.get("ASTRA_FAST_MODEL", "").strip() or "gpt-4.1-nano"
)
FAST_FALLBACK_MODEL = (
    os.environ.get("ASTRA_FAST_FALLBACK", "").strip() or "gpt-4o-mini"
)

# ultra = sub-1s target (default) | live | balanced | quality
ANSWER_PROFILE = (
    os.environ.get("ASTRA_ANSWER_PROFILE", "").strip().lower() or "ultra"
)
# Explicit overrides (1/0) beat profile when set
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
    if _FORCE_RAG:
        return _env_flag(_FORCE_RAG, True)
    # live/ultra skips RAG — embedding call costs ~200–800ms
    return ANSWER_PROFILE in ("quality", "full", "balanced")


def _is_fast_profile() -> bool:
    return ANSWER_PROFILE in ("ultra", "live", "fast")


def _prefer_fast_models() -> bool:
    """When True, unset user models resolve to nano/mini for sub-1s."""
    return _is_fast_profile()


# Compact prompts for ultra/live — less prefill = faster first token
FAST_STAR_SYSTEM = (
    "Senior interview coach. Speakable first-person answer. Labels required:\n"
    "Hook: / Situation: / Task: / Action: / Result: / Close:\n"
    "Rules: 80-120 words, 1 metric, precise jargon, no fluff, no markdown."
)
FAST_TECH_SYSTEM = (
    "Staff engineer interview coach. Speakable answer. Labels:\n"
    "Hook: / Approach: / Mechanism: / Tradeoff: / Close:\n"
    "Rules: 70-110 words, technical, 1 tradeoff, no fluff."
)
FAST_SHORTER_SYSTEM = (
    "Interview coach. Exactly 4 short speakable lines:\n"
    "1) Thesis 2) Mechanism 3) Metric/tradeoff 4) Close.\n"
    "Max 60 words. Dense, first person."
)
FAST_CODE_SYSTEM = (
    "Coding interview coach. Labels: Approach: then Code: (8-15 lines) then Tradeoff:.\n"
    "Keep under 90 words outside code. First person."
)

# ---------------------------------------------------------------------------
# System prompts — depth + jargon by mode
# ---------------------------------------------------------------------------

STRATEGY_SYSTEM = """You are a senior interview coach and hiring-panel simulator.
Given an interview question and role, decide the CORRECT answer strategy.

Return ONLY valid JSON (no markdown):
{
  "question_type": "behavioral|technical|system_design|troubleshooting|product|leadership|domain|coding|situational|other",
  "domain_tags": ["string"],
  "must_cover": ["3-6 required technical or narrative points"],
  "jargon_bank": ["precise terms the candidate should use"],
  "seniority_bar": "junior|mid|senior|staff",
  "pitfalls": ["what weak answers do wrong"],
  "evidence_style": "STAR|framework|tradeoff_analysis|walkthrough|code_sketch",
  "depth_target": "high|very_high"
}

Rules:
- Prefer high depth for technical, system design, domain, troubleshooting.
- jargon_bank must be specific (APIs, protocols, metrics, patterns) not vague soft words.
- must_cover must force a complete answer, not a slogan.
"""

RICH_STAR_SYSTEM = """You are a principal-level interview coach writing a HIGH-QUALITY spoken answer
the candidate can deliver in a real senior interview.

You do NOT write thin teleprompter fluff. You write a substantive, technical, first-person answer
that demonstrates mastery.

## Output format (labels required, multi-sentence allowed per section):
Hook: 1–2 sentences that reframe the question with senior judgment.
Situation: context, scale, constraints (systems, team, stakeholders).
Task: what success meant — SLOs, correctness, cost, latency, risk, ownership.
Action: 4–7 sentences of concrete technical/process actions. Name tools, patterns, tradeoffs.
Result: measurable outcomes + secondary effects (reliability, cost, velocity, learning).
Depth: 3–5 sentences of technical expansion — architecture, edge cases, monitoring, alternatives.
Close: 1 confident closing line the candidate can end on.

## Hard quality rules:
- Minimum ~220 words (except when mode is shorter — then follow shorter rules).
- Use precise industry jargon from the strategy jargon_bank when provided.
- Prefer mechanisms over adjectives (say "idempotent retries with exponential backoff + jitter"
  not "we made it reliable").
- Include at least 2 numbers OR clear quantitative language (%, latency, QPS, headcount, $).
- First person ("I", "we") as a strong IC / tech lead voice.
- No markdown headings with #, no bullet symbols in the body (labels only as shown).
- Do NOT invent fake company names; generic "at my last role / in a prior system" is fine.
- If candidate context is provided, weave it in when relevant — do not ignore it.
- Never produce a one-paragraph shrug. If uncertain, still give a rigorous framework answer.
"""

RICH_TECHNICAL_SYSTEM = """You are a staff/principal engineer coaching a candidate through a technical interview.

Write a speakable, jargon-rich, correct answer — the kind that survives follow-ups.

## Output format:
Hook: restate the problem with engineering precision.
Approach: primary design / algorithm / system approach.
Mechanism: how it works (data path, control plane, invariants, failure modes).
Tradeoffs: at least 2 real tradeoffs with when you'd pick each side.
Validation: how you'd measure, test, or prove it (metrics, experiments, SLOs).
Depth: advanced nuance — consistency, scaling limit, ops, security, cost, or edge cases.
Close: crisp closing line.

## Quality bar:
- ~200–350 words
- Dense technical vocabulary (protocols, patterns, data structures, observability)
- No filler ("basically", "just", "simply") as a substitute for substance
- First person, confident, interview-ready prose (not a textbook dump with zero ownership)
"""

RICH_SHORTER_SYSTEM = """You are a senior interview coach. Write a CONCISE but HIGH-SIGNAL answer —
short form, not low quality.

## Format (exactly 6 lines, each a full speakable sentence):
1) Thesis / punchline
2) Core mechanism or STAR action
3) Technical detail or jargon-backed point
4) Tradeoff or constraint
5) Metric / outcome
6) Close / follow-up readiness

## Rules:
- 90–140 words total
- No empty cheerleading
- At least 3 precise technical or domain terms
- First person
"""

RICH_CODE_SYSTEM = """You are a staff engineer coaching coding interviews.

## Format:
Approach: 3–5 spoken sentences — problem framing, algorithm choice, complexity target.
Code:
```language
// clean, idiomatic sketch, 15–35 lines max
```
Walkthrough: 3–5 sentences walking through the code, edge cases, complexity.
Tradeoff: 2 sentences on alternatives and when you'd switch.

## Quality:
- Correctness first, then clarity
- Name time/space complexity
- Mention at least one edge case
"""

REGEN_STRICT_SUFFIX = """
PREVIOUS DRAFT WAS REJECTED AS TOO THIN OR GENERIC.
Regenerate a MUCH stronger answer:
- Double the technical specificity
- Use more precise jargon from the strategy
- Expand Action/Mechanism/Depth
- Include concrete metrics and failure modes
- Meet the full section format exactly
"""


# ---------------------------------------------------------------------------
# Strategy + quality helpers
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
            temperature=0.25,
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
    """Decide what a *right* answer must contain for this question."""
    q = (question or "").strip()
    if not q:
        return _fallback_strategy("", job_context)

    data = _chat_json(
        STRATEGY_SYSTEM,
        f"Role / job context: {job_context or 'general professional'}\n\nQuestion:\n{q}",
        STRATEGY_MODEL,
    )
    if not data:
        return _fallback_strategy(q, job_context)

    # Normalize
    data.setdefault("question_type", "other")
    data.setdefault("domain_tags", [])
    data.setdefault("must_cover", [])
    data.setdefault("jargon_bank", [])
    data.setdefault("seniority_bar", "senior")
    data.setdefault("pitfalls", [])
    data.setdefault("evidence_style", "framework")
    data.setdefault("depth_target", "high")
    return data


def _fallback_strategy(question: str, job_context: str) -> dict[str, Any]:
    t = (question or "").lower()
    job = (job_context or "").lower()
    tags: list[str] = []
    jtype = "other"
    if any(k in t for k in ("design", "architect", "scale", "system", "distributed")):
        jtype = "system_design"
        tags = ["scalability", "consistency", "latency", "availability", "observability"]
    elif any(k in t for k in ("code", "implement", "algorithm", "complexity", "leetcode")):
        jtype = "coding"
        tags = ["time complexity", "space complexity", "edge cases"]
    elif any(k in t for k in ("tell me about a time", "conflict", "leadership", " mentored", "failed")):
        jtype = "behavioral"
        tags = ["ownership", "stakeholder management", "metrics"]
    elif any(k in t for k in ("debug", "outage", "incident", "root cause", "latency spike")):
        jtype = "troubleshooting"
        tags = ["observability", "SLOs", "rollback", "blast radius"]
    elif any(k in t + job for k in ("sap", "fico", "vertex", "tax", "erp")):
        jtype = "domain"
        tags = ["SAP FICO", "tax determination", "reconciliation", "controls"]
    elif any(k in t for k in ("how", "what is", "explain", "difference", "why")):
        jtype = "technical"
        tags = ["tradeoffs", "fundamentals", "production"]

    return {
        "question_type": jtype,
        "domain_tags": tags,
        "must_cover": [
            "clear problem framing",
            "concrete mechanism or actions",
            "at least one tradeoff",
            "measurable outcome or validation plan",
        ],
        "jargon_bank": tags,
        "seniority_bar": "senior",
        "pitfalls": ["vague adjectives", "no metrics", "no failure modes"],
        "evidence_style": "STAR" if jtype == "behavioral" else "tradeoff_analysis",
        "depth_target": "very_high" if jtype in ("system_design", "technical", "domain") else "high",
    }


def score_answer_quality(text: str, strategy: dict[str, Any], *, mode: str) -> dict[str, Any]:
    """
    Heuristic quality score 0–100. Used to reject thin answers before they hit the UI.
    """
    t = (text or "").strip()
    words = len(t.split())
    low = t.lower()
    score = 0
    reasons: list[str] = []

    # Length bar by mode
    min_words = {"shorter": 70, "code": 80, "technical": 160, "star": 160}.get(mode, 150)
    if words >= min_words:
        score += 25
    elif words >= int(min_words * 0.65):
        score += 12
        reasons.append(f"thin length ({words} words)")
    else:
        reasons.append(f"too short ({words} words, need ~{min_words}+)")

    # Structure labels
    labels = ("hook:", "situation:", "task:", "action:", "result:", "depth:", "approach:", "mechanism:", "tradeoff")
    label_hits = sum(1 for lab in labels if lab in low)
    if label_hits >= 4:
        score += 20
    elif label_hits >= 2:
        score += 10
        reasons.append("weak structure")
    else:
        reasons.append("missing structured sections")

    # Jargon from strategy
    jargon = [j.lower() for j in (strategy.get("jargon_bank") or []) if isinstance(j, str)]
    jargon_hits = sum(1 for j in jargon if j and j in low)
    if jargon_hits >= 2:
        score += 20
    elif jargon_hits == 1:
        score += 10
        reasons.append("little domain jargon")
    elif jargon:
        reasons.append("jargon bank unused")

    # Metrics / numbers
    if re.search(r"\b\d+(\.\d+)?\s*(%|ms|s|x|k|m|qps|rps|gb|tb)?\b", low):
        score += 15
    else:
        reasons.append("no metrics/numbers")

    # Anti-filler (penalize empty intensity)
    fluff = len(re.findall(r"\b(basically|just simply|very very|really good|synergy|leverage the opportunity)\b", low))
    if fluff == 0:
        score += 10
    else:
        score -= min(15, fluff * 5)
        reasons.append("filler language")

    # Must-cover soft check
    must = [m.lower() for m in (strategy.get("must_cover") or []) if isinstance(m, str)]
    cover_hits = 0
    for m in must:
        tokens = [w for w in re.split(r"\W+", m) if len(w) > 3][:3]
        if tokens and all(tok in low for tok in tokens[:1]):
            cover_hits += 1
    if must and cover_hits >= min(2, len(must)):
        score += 10
    elif must:
        reasons.append("must-cover points weak")

    score = max(0, min(100, score))
    return {
        "score": score,
        "words": words,
        "pass": score >= 55,
        "reasons": reasons,
    }


def _system_for_mode(mode: str) -> str:
    if _is_fast_profile():
        if mode == "shorter":
            return FAST_SHORTER_SYSTEM
        if mode == "technical":
            return FAST_TECH_SYSTEM
        if mode == "code":
            return FAST_CODE_SYSTEM
        return FAST_STAR_SYSTEM
    if mode == "shorter":
        return RICH_SHORTER_SYSTEM
    if mode == "technical":
        return RICH_TECHNICAL_SYSTEM
    if mode == "code":
        return RICH_CODE_SYSTEM
    return RICH_STAR_SYSTEM


def _max_tokens_for_mode(mode: str) -> int:
    # ultra: tiny completions for sub-second TTFT on nano/mini
    if ANSWER_PROFILE in ("ultra", "fast"):
        return {
            "shorter": 70,
            "technical": 110,
            "code": 130,
            "star": 100,
        }.get(mode, 100)
    if ANSWER_PROFILE == "live":
        return {
            "shorter": 120,
            "technical": 200,
            "code": 220,
            "star": 180,
        }.get(mode, 180)
    if ANSWER_PROFILE == "balanced":
        return {
            "shorter": 340,
            "technical": 850,
            "code": 900,
            "star": 850,
        }.get(mode, 800)
    return {
        "shorter": 420,
        "technical": 1100,
        "code": 1200,
        "star": 1200,
    }.get(mode, 1100)


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
    job = (job_context or "Senior professional").strip()

    # Ultra/live: minimal prompt → less prefill latency
    if _is_fast_profile() and not strict_regen:
        tags = strategy.get("domain_tags") or []
        tag_s = ", ".join(str(t) for t in tags[:4] if t)
        parts = [
            f"Role: {job[:80]}",
            f"Q: {q[:400]}",
        ]
        if tag_s:
            parts.append(f"Topics: {tag_s}")
        parts.append("Answer now.")
        return "\n".join(parts)

    ctx = ""
    if context_chunks:
        bits = [c.get("text", "")[:450] for c in context_chunks[:4] if c.get("text")]
        if bits:
            ctx = "CANDIDATE KNOWLEDGE / RESUME CONTEXT (use when relevant):\n- " + "\n- ".join(bits)

    strat_blob = json.dumps(
        {
            "question_type": strategy.get("question_type"),
            "domain_tags": strategy.get("domain_tags"),
            "must_cover": strategy.get("must_cover"),
            "jargon_bank": strategy.get("jargon_bank"),
            "seniority_bar": strategy.get("seniority_bar"),
            "pitfalls_to_avoid": strategy.get("pitfalls"),
            "evidence_style": strategy.get("evidence_style"),
            "depth_target": strategy.get("depth_target"),
        },
        ensure_ascii=False,
        indent=2,
    )

    tone_map = {
        "professional": "polished executive presence, still technical",
        "casual": "conversational but never sloppy — keep rigor",
        "confident": "assertive staff/principal voice, decisive tradeoffs",
    }
    tone_line = tone_map.get((tone or "confident").lower(), tone_map["confident"])

    instruct = {
        "shorter": "Write the 6 high-signal speakable lines now.",
        "technical": "Write the full technical interview answer now.",
        "code": "Write approach + code + walkthrough + tradeoff now.",
        "star": "Write the full Hook/STAR/Depth/Close answer now.",
    }.get(mode, "Write the full interview-grade answer now.")

    parts = [
        f"ROLE / JOB CONTEXT: {job}",
        f"DELIVERY TONE: {tone_line}",
        "ANSWER STRATEGY (follow this — this defines the RIGHT answer):\n" + strat_blob,
        ctx,
        "INTERVIEW QUESTION:\n" + q,
        instruct,
    ]
    if strict_regen:
        parts.append(REGEN_STRICT_SUFFIX)
    return "\n\n".join(p for p in parts if p)


def _is_reasoning_model(model: str) -> bool:
    """o-series / pro / Sol-style models often reject temperature or max_tokens."""
    m = (model or "").strip().lower()
    if not m:
        return False
    return (
        m.startswith("o1")
        or m.startswith("o3")
        or m.startswith("o4")
        or m.endswith("-pro")
        or m in ("gpt-5.6-sol", "gpt-5-pro")
        or m.endswith("-sol")
    )


def _chat_create_kwargs(
    *,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    stream: bool,
    timeout: float = 75.0,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "timeout": timeout,
    }
    if _is_reasoning_model(model):
        # Prefer modern token param; omit temperature (often unsupported)
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["temperature"] = temperature
        kwargs["max_tokens"] = max_tokens
    return kwargs


def _complete_answer(
    *,
    system: str,
    user: str,
    model: str,
    fallback_model: str | None = None,
    max_tokens: int,
    temperature: float = 0.45,
) -> str:
    client = _get_openai_client()
    # Primary → configured fallback → SCRIPT_MODEL mini
    models_try = [model, fallback_model or FALLBACK_MODEL, SCRIPT_MODEL, "gpt-4o-mini"]
    seen: set[str] = set()
    last_err: Exception | None = None
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    # Fast path: one model, short timeout — do not cascade-wait 4 models
    timeout = 6.0 if _is_fast_profile() else 75.0
    if _is_fast_profile():
        models_try = [model, fallback_model or FAST_FALLBACK_MODEL]
    for m in models_try:
        if not m or m in seen:
            continue
        seen.add(m)
        kwargs = _chat_create_kwargs(
            model=m,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=False,
            timeout=timeout,
        )
        try:
            resp = client.chat.completions.create(**kwargs)
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    return ""


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
    """
    Interview answer generation.

    Fast profiles (ultra/live):
      cache → template/LLM cascade via fast_answer (sub-ms first paint when cached)
    Quality profile: multi-pass strategy + optional regen.
    """
    mode = (mode or "star").strip().lower()
    if mode not in ("star", "shorter", "technical", "code"):
        mode = "star"

    # ---- Ultra/live: research cascade (cache + template + optional nano) ----
    if _is_fast_profile():
        from fast_answer import cache_lookup, cache_store, instant_answer

        hit = cache_lookup(question, mode=mode, job_context=job_context)
        if hit:
            return hit[0]

        # Prefer single-shot nano; fall back to instant template if LLM fails/slow
        am = answer_model
        fm = fallback_model
        uam = user_answer_model
        ufm = user_fallback_model
        if _prefer_fast_models():
            if not (uam or am):
                am = FAST_ANSWER_MODEL
            if not (ufm or fm):
                fm = FAST_FALLBACK_MODEL
            if _is_reasoning_model(str(uam or am or "")) and not os.environ.get(
                "ASTRA_ALLOW_SLOW_LIVE", ""
            ).strip():
                am = FAST_ANSWER_MODEL
                uam = None

        primary, fallback = resolve_answer_models(
            answer_model=am,
            fallback_model=fm,
            user_answer_model=uam,
            user_fallback_model=ufm,
        )
        if _prefer_fast_models() and _is_reasoning_model(primary):
            primary, fallback = FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL

        strategy = _fallback_strategy(question, job_context)
        system = _system_for_mode(mode)
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
                max_tokens=_max_tokens_for_mode(mode),
                temperature=0.3,
            )
        except Exception:
            answer = ""
        if not (answer or "").strip():
            answer, _, _ = instant_answer(
                question, job_context=job_context, mode=mode
            )
        answer = (answer or "").strip()
        if answer:
            cache_store(question, answer, mode=mode, job_context=job_context)
        return answer

    # ---- Quality / balanced path ----
    am = answer_model
    fm = fallback_model
    uam = user_answer_model
    ufm = user_fallback_model

    primary, fallback = resolve_answer_models(
        answer_model=am,
        fallback_model=fm,
        user_answer_model=uam,
        user_fallback_model=ufm,
    )

    chunks: list = []
    if _use_rag():
        try:
            chunks = search_context(question) or []
        except Exception:
            chunks = []

    if _use_strategy_llm():
        strategy = analyze_question_strategy(question, job_context=job_context)
    else:
        strategy = _fallback_strategy(question, job_context)

    system = _system_for_mode(mode)
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
        max_tokens=_max_tokens_for_mode(mode),
        temperature=0.42,
    )

    if _use_quality_regen() and answer:
        quality = score_answer_quality(answer, strategy, mode=mode)
        regen_floor = 40 if ANSWER_PROFILE == "balanced" else 55
        if quality["score"] < regen_floor:
            user2 = _build_user_prompt(
                question,
                job_context=job_context,
                tone=tone,
                mode=mode,
                strategy=strategy,
                context_chunks=chunks,
                strict_regen=True,
            )
            user2 += (
                "\n\nQUALITY FAILURE REASONS FROM GATE:\n- "
                + "\n- ".join(quality.get("reasons") or ["insufficient depth"])
            )
            answer2 = _complete_answer(
                system=system,
                user=user2,
                model=primary,
                fallback_model=fallback,
                max_tokens=_max_tokens_for_mode(mode) + 120,
                temperature=0.35,
            )
            q2 = score_answer_quality(answer2, strategy, mode=mode)
            if q2["score"] >= quality["score"]:
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
    """
    Streaming path: same profile knobs as generate_answer (live skips strategy LLM).
    """
    mode = (mode or "star").strip().lower()
    if mode not in ("star", "shorter", "technical", "code"):
        mode = "star"

    chunks: list = []
    if _use_rag():
        try:
            chunks = search_context(question) or []
        except Exception:
            chunks = []

    am = answer_model
    fm = fallback_model
    uam = user_answer_model
    ufm = user_fallback_model
    if _prefer_fast_models():
        if not (uam or am):
            am = FAST_ANSWER_MODEL
        if not (ufm or fm):
            fm = FAST_FALLBACK_MODEL
        if _is_reasoning_model(str(uam or am or "")) and not os.environ.get(
            "ASTRA_ALLOW_SLOW_LIVE", ""
        ).strip():
            am = FAST_ANSWER_MODEL
            uam = None

    primary, fallback = resolve_answer_models(
        answer_model=am,
        fallback_model=fm,
        user_answer_model=uam,
        user_fallback_model=ufm,
    )
    if _prefer_fast_models() and _is_reasoning_model(primary):
        primary, fallback = FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL

    if _use_strategy_llm():
        strategy = analyze_question_strategy(question, job_context=job_context)
    else:
        strategy = _fallback_strategy(question, job_context)
    system = _system_for_mode(mode)
    user = _build_user_prompt(
        question,
        job_context=job_context,
        tone=tone,
        mode=mode,
        strategy=strategy,
        context_chunks=chunks,
        strict_regen=False,
    )
    if not _is_fast_profile():
        user += (
            "\n\nSTREAMING QUALITY RULE: Prefer longer, denser technical content over brevity. "
            "Do not stop early. Complete every section."
        )

    client = _get_openai_client()
    models_try = [primary, fallback, SCRIPT_MODEL, "gpt-4o-mini"]
    stream = None
    last_err: Exception | None = None
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    max_tok = _max_tokens_for_mode(mode)
    temp = 0.35 if _is_fast_profile() else 0.42
    for model in models_try:
        if not model:
            continue
        try:
            stream = client.chat.completions.create(
                **_chat_create_kwargs(
                    model=model,
                    messages=messages,
                    max_tokens=max_tok,
                    temperature=temp,
                    stream=True,
                    timeout=12.0 if _is_fast_profile() else 75.0,
                )
            )
            break
        except Exception as e:
            last_err = e
            try:
                stream = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    stream=True,
                    max_tokens=max_tok,
                )
                break
            except Exception as e2:
                last_err = e2
                continue
    if stream is None:
        if last_err:
            raise last_err
        return

    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def to_bullets(text: str, mode: str = "star") -> list[str]:
    """Turn a rich answer into UI-friendly labeled bullets (keeps depth)."""
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
                title = key.capitalize() if key != "tradeoffs" else "Tradeoffs"
                if key == "close":
                    title = "Close"
                labeled.append(f"{title} — {body}")
                mapped = True
                break
        if not mapped:
            # Numbered shorter-mode lines
            m = re.match(r"^(\d+)[\).\:\-]\s*(.+)$", line)
            if m:
                labeled.append(m.group(2).strip())
            else:
                labeled.append(line)

    if len(labeled) >= 2:
        return labeled[:16]

    # Fallback: sentence chunks
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", prose) if p.strip()]
    if mode == "star" and len(parts) >= 4:
        labels = ["Situation — ", "Task — ", "Action — ", "Result — ", "Depth — "]
        out = []
        for i, p in enumerate(parts[:8]):
            lab = labels[i] if i < len(labels) else "• "
            out.append(lab + (p if p.endswith((".", "!", "?")) else p + "."))
        return out
    return parts[:10] if parts else [text]


def looks_like_question(text: str) -> bool:
    """Broader than startswith — handles 'Question one, tell me…'."""
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
    )
    return any(c in t2 for c in cues)


def re_sub_wrappers(t: str) -> str:
    t = re.sub(r"^(question|q)\s*\d+\s*[,.:\-–]?\s*", "", t)
    t = re.sub(r"^(interviewer|host)\s*[,:]\s*", "", t)
    return t.strip()


# Back-compat names (if anything imported old constants)
SPEAKABLE_STAR_SYSTEM = RICH_STAR_SYSTEM
SPEAKABLE_SHORTER_SYSTEM = RICH_SHORTER_SYSTEM
SPEAKABLE_TECHNICAL_SYSTEM = RICH_TECHNICAL_SYSTEM
SPEAKABLE_CODE_SYSTEM = RICH_CODE_SYSTEM
