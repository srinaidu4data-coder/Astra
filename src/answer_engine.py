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

def _default_chat_models() -> tuple[str, str, str]:
    """
    (primary, fast, fallback) — Groq Llama when ASTRA_LLM_PROVIDER=groq.
    """
    try:
        from config import get_llm_provider

        provider = get_llm_provider()
    except Exception:
        provider = (os.environ.get("ASTRA_LLM_PROVIDER") or "").strip().lower()
    if provider == "groq":
        # Fast + capable Groq models (OpenAI-compatible IDs)
        return (
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "llama-3.3-70b-versatile",
        )
    return ("gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.1-mini")


_DEF_PRIMARY, _DEF_FAST, _DEF_FALLBACK = _default_chat_models()

# Prefer 4.1-mini over 4o; Groq defaults override when provider=groq.
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

# Live path: fast model first; stronger fallback for quality.
FAST_ANSWER_MODEL = (
    os.environ.get("ASTRA_FAST_MODEL", "").strip() or _DEF_FAST
)
FAST_FALLBACK_MODEL = (
    os.environ.get("ASTRA_FAST_FALLBACK", "").strip() or _DEF_FALLBACK
)

# ultra = sub-1s target | live (default) | balanced | quality
# live is the production default: fast first paint + solid LLM refine quality.
ANSWER_PROFILE = (
    os.environ.get("ASTRA_ANSWER_PROFILE", "").strip().lower() or "live"
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


# Compact prompts for ultra/live — still require technical correctness
FAST_STAR_SYSTEM = (
    "Senior interview coach. Speakable first-person answer. Labels required:\n"
    "Hook: / Situation: / Task: / Action: / Result: / Close:\n"
    "Rules: 120-200 words for short Qs; for multi-part/long Qs 200-320 words and "
    "address EVERY clause (do not skip later parts). Correct domain facts only, "
    "1 metric if real, precise jargon, no fluff, no markdown, never invent modules. "
    "Labels start with Hook: not /Hook:."
)
FAST_TECH_SYSTEM = (
    "Staff/principal engineer interview coach. Speakable, FACTUALLY CORRECT answer.\n"
    "Labels: Hook: / Approach: / Mechanism: / Tradeoff: / Close:\n"
    "Rules: 140-220 words for short Qs; multi-part/long Qs 220-360 words covering "
    "each asked bullet (design + controls + metrics + failure modes as requested). "
    "If SAP: real FICO terms (FI, CO, tax procedure, condition records, New GL, "
    "document splitting, company code). If ML: real ML terms (loss, gradient, "
    "bias/variance, precision/recall, attention QKV, NDCG, leakage, p99). "
    "No invented APIs. No markdown. Labels like Hook: not /Hook:."
)

def _is_long_or_multipart_question(question: str) -> bool:
    q = (question or "").strip()
    if not q:
        return False
    words = len(q.split())
    if words >= 35:
        return True
    low = q.lower()
    # Multi-clause markers
    if low.count("?") >= 2:
        return True
    if low.count(",") >= 3 and words >= 22:
        return True
    if any(
        p in low
        for p in (
            "walk me through",
            "how would you design",
            "including",
            "as well as",
            "and what",
            "and how",
            "from ",
            "through ",
            "to online",
            "multi-",
            "end-to-end",
            "step by step",
            "step-by-step",
        )
    ) and words >= 20:
        return True
    return False
FAST_SHORTER_SYSTEM = (
    "Interview coach. Exactly 4 short speakable lines:\n"
    "1) Thesis 2) Mechanism 3) Metric/tradeoff 4) Close.\n"
    "Max 80 words. Dense, first person, factually correct for the domain."
)
FAST_CODE_SYSTEM = (
    "Coding interview coach. Labels: Approach: then Code: (8-15 lines) then Tradeoff:.\n"
    "Keep under 100 words outside code. First person. Correct complexity claims."
)

# Prefer stronger model for domain-hard questions (SAP / ML) even in live profile
TECH_ACCURACY_MODEL = (
    os.environ.get("ASTRA_TECH_MODEL", "").strip() or _DEF_PRIMARY
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


def _is_sap_domain(text: str, job: str) -> bool:
    blob = f"{text} {job}".lower()
    return any(
        k in blob
        for k in (
            "sap",
            "fico",
            "fi/co",
            "s/4",
            "s4hana",
            "vertex",
            "new gl",
            "document splitting",
            "condition record",
            "tax procedure",
            "controlling area",
            "company code",
            "obyc",
            "fb50",
            "f-02",
            "ptp",
            "p2p",
            "procure to pay",
            "procure-to-pay",
            "purchase order",
            "goods receipt",
            "invoice receipt",
            "miro",
            "migo",
            "me21n",
        )
    )


def _is_ml_domain(text: str, job: str) -> bool:
    blob = f"{text} {job}".lower()
    return any(
        k in blob
        for k in (
            "machine learning",
            "deep learning",
            "neural",
            "transformer",
            "llm",
            "gradient",
            "embedding",
            "inference",
            "training set",
            "overfitting",
            "bias-variance",
            "bias variance",
            "precision and recall",
            "precision vs recall",
            "attention",
            "backprop",
            "pytorch",
            "tensorflow",
            "feature store",
            "mlops",
            "ai/ml",
            "ai ml",
            "ml engineer",
            "data scientist",
        )
    ) or (
        any(k in job for k in ("ml ", " ml", "ai/", "ai ", "machine learning", "deep learning"))
        and any(
            k in text
            for k in (
                "model",
                "train",
                "loss",
                "accuracy",
                "dataset",
                "feature",
                "predict",
                "classif",
                "regress",
                "learning rate",
                "epoch",
            )
        )
    )


def _sap_strategy(question: str) -> dict[str, Any]:
    t = (question or "").lower()
    # Question-specific must-cover so we don't spray "tax" on every SAP Q
    if "fi" in t and "co" in t and ("difference" in t or "vs" in t or "versus" in t):
        must = [
            "FI = external statutory/legal reporting (company code, BS/P&L)",
            "CO = internal management accounting (cost centers, profit centers, internal orders)",
            "Integration: primary postings in FI often create CO documents",
            "Example objects: G/L accounts vs cost elements / cost centers",
        ]
        jargon = [
            "FI",
            "CO",
            "company code",
            "cost center",
            "profit center",
            "primary cost element",
            "reconciliation",
        ]
    elif "tax" in t or "condition" in t or "vertex" in t:
        must = [
            "Tax procedure + condition types drive calculation",
            "Access sequence finds condition records (country/region/tax code/material/customer)",
            "Tax code on line items; jurisdiction where relevant",
            "Posting to tax G/L; reconciliation / reporting implications",
        ]
        jargon = [
            "tax procedure",
            "condition type",
            "access sequence",
            "condition record",
            "tax code",
            "FTXP",
            "jurisdiction",
        ]
    elif "split" in t or "new gl" in t or "new g/l" in t or "document splitting" in t:
        must = [
            "New GL document splitting derives account assignments for zero-balance entities",
            "Splitting characteristics e.g. profit center / segment",
            "Active splitting method + item categories / business transaction variants",
            "Enables segment reporting and balanced financial statements by dimension",
        ]
        jargon = [
            "New GL",
            "document splitting",
            "profit center",
            "segment",
            "zero-balance",
            "item category",
            "passive vs active splitting",
        ]
    elif any(
        k in t
        for k in (
            "ptp",
            "p2p",
            "procure",
            "purchase order",
            "goods receipt",
            "invoice receipt",
            "miro",
            "migo",
            "accounting entr",
        )
    ):
        must = [
            "PO creation is logistics (usually no FI posting yet)",
            "Goods receipt (MIGO): Dr Inventory/GR-IR relevant, Cr GR/IR clearing",
            "Invoice receipt (MIRO): Dr GR/IR, Cr Vendor; price variance if needed",
            "Payment: Dr Vendor, Cr Bank; OBYC/account determination links MM-FI",
        ]
        jargon = [
            "procure-to-pay",
            "purchase order",
            "goods receipt",
            "GR/IR",
            "invoice receipt",
            "MIRO",
            "MIGO",
            "vendor",
            "OBYC",
            "BSX",
            "WRX",
        ]
    else:
        must = [
            "Name the real SAP objects (company code, cost center, document type, posting keys)",
            "Describe the posting/document flow, not vague ERP slogans",
            "Mention integration touchpoint (MM/SD/FI or FI-CO) when relevant",
            "Call out control/reconciliation or config vs master data",
        ]
        jargon = ["SAP FICO", "S/4HANA", "company code", "document type", "posting key", "G/L"]
    return {
        "question_type": "domain",
        "domain_tags": ["sap", "fico"],
        "must_cover": must,
        "jargon_bank": jargon,
        "seniority_bar": "senior",
        "pitfalls": [
            "generic software engineering answer with no SAP objects",
            "confusing FI external reporting with CO internal controlling",
            "inventing non-existent T-codes or modules",
            "pasting tax determination into unrelated SAP questions",
        ],
        "evidence_style": "walkthrough",
        "depth_target": "very_high",
        "accuracy_domain": "sap",
    }


def _ml_strategy(question: str) -> dict[str, Any]:
    t = (question or "").lower()
    if "bias" in t and "variance" in t:
        must = [
            "Bias = error from wrong assumptions (underfit); variance = sensitivity to training noise (overfit)",
            "Total error ≈ bias² + variance + irreducible noise",
            "More complex models lower bias / raise variance; regularization / more data reduce variance",
            "Validate with train vs val curves or cross-validation",
        ]
        jargon = ["bias", "variance", "underfitting", "overfitting", "regularization", "cross-validation"]
    elif "precision" in t and "recall" in t:
        must = [
            "Precision = TP/(TP+FP); recall = TP/(TP+FN)",
            "High precision → few false alarms; high recall → few misses",
            "Tradeoff controlled by threshold; F1 when balance needed",
            "Choose metric from business cost of FP vs FN",
        ]
        jargon = ["precision", "recall", "true positive", "false positive", "threshold", "F1"]
    elif "attention" in t or "transformer" in t:
        must = [
            "Q, K, V projections; scores = QK^T / sqrt(d_k); softmax → weights; weighted sum of V",
            "Self-attention mixes all positions; multi-head captures different relations",
            "Complexity O(n²) in sequence length; residual + layer norm in blocks",
        ]
        jargon = ["query", "key", "value", "scaled dot-product", "softmax", "multi-head attention"]
    elif "gradient" in t or "learning rate" in t:
        must = [
            "Gradient descent updates params opposite the loss gradient",
            "Learning rate = step size; too high diverges, too low slow/stuck",
            "Mini-batch SGD / Adam; schedules and gradient clipping in practice",
        ]
        jargon = ["loss", "gradient", "learning rate", "SGD", "Adam", "local minimum"]
    else:
        must = [
            "State the ML concept correctly (math or algorithmic definition)",
            "Give train/serve implication (overfit, latency, data leakage, metrics)",
            "One real tradeoff",
            "How you'd validate in production or offline eval",
        ]
        jargon = ["training", "validation", "generalization", "feature", "metric", "inference"]
    return {
        "question_type": "technical",
        "domain_tags": ["ml", "ai"],
        "must_cover": must,
        "jargon_bank": jargon,
        "seniority_bar": "senior",
        "pitfalls": [
            "buzzwords without definitions",
            "wrong formulas for precision/recall or attention",
            "claiming accuracy is always the right metric",
            "confusing training-time and inference-time concerns",
        ],
        "evidence_style": "framework",
        "depth_target": "very_high",
        "accuracy_domain": "ml",
    }


def _fallback_strategy(question: str, job_context: str) -> dict[str, Any]:
    t = (question or "").lower()
    job = (job_context or "").lower()

    # Domain packs first — accuracy-critical interviews
    if _is_sap_domain(t, job):
        return _sap_strategy(t)
    if _is_ml_domain(t, job):
        return _ml_strategy(t)

    tags: list[str] = []
    jtype = "other"
    if any(k in t for k in ("design", "architect", "scale", "system", "distributed")):
        jtype = "system_design"
        tags = ["scalability", "consistency", "latency", "availability", "observability"]
    elif any(k in t for k in ("code", "implement", "algorithm", "complexity", "leetcode")):
        jtype = "coding"
        tags = ["time complexity", "space complexity", "edge cases"]
    elif any(k in t for k in ("tell me about a time", "conflict", "leadership", "mentored", "failed")):
        jtype = "behavioral"
        tags = ["ownership", "stakeholder management", "metrics"]
    elif any(k in t for k in ("debug", "outage", "incident", "root cause", "latency spike")):
        jtype = "troubleshooting"
        tags = ["observability", "SLOs", "rollback", "blast radius"]
    elif any(k in t for k in ("how", "what is", "explain", "difference", "why", "compare")):
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
        "pitfalls": ["vague adjectives", "no metrics", "no failure modes", "incorrect technical claims"],
        "evidence_style": "STAR" if jtype == "behavioral" else "tradeoff_analysis",
        "depth_target": "very_high" if jtype in ("system_design", "technical", "domain") else "high",
        "accuracy_domain": "general",
    }


def _needs_accuracy_model(strategy: dict[str, Any], question: str, job_context: str) -> bool:
    """True for SAP / ML / hard technical — use mini not nano."""
    dom = (strategy.get("accuracy_domain") or "").lower()
    if dom in ("sap", "ml"):
        return True
    if strategy.get("question_type") in ("technical", "domain", "system_design", "coding"):
        return True
    return _is_sap_domain(question, job_context) or _is_ml_domain(question, job_context)


def _prefer_mode_for_question(mode: str, strategy: dict[str, Any], question: str) -> str:
    """Auto-use technical mode for domain/tech Qs when UI still sends star."""
    mode = (mode or "star").strip().lower()
    if mode in ("technical", "code", "shorter"):
        return mode
    jtype = strategy.get("question_type") or ""
    if jtype in ("technical", "domain", "system_design", "coding", "troubleshooting"):
        # Keep STAR for pure behavioral-sounding domain stories
        q = (question or "").lower()
        if any(p in q for p in ("tell me about a time", "describe a situation", "conflict")):
            return "star"
        return "technical"
    return mode


def _normalize_answer_text(text: str) -> str:
    """Fix common model label glitches (/Hook:, markdown) for speakable UI."""
    t = (text or "").strip()
    if not t:
        return t
    # Remove accidental leading slashes on labels: /Hook: -> Hook:
    t = re.sub(
        r"(?m)^[ \t]*/+\s*(Hook|Situation|Task|Action|Result|Depth|Close|Approach|Mechanism|Tradeoffs?|Validation)\s*:",
        r"\1:",
        t,
    )
    t = re.sub(
        r"[ \t]*/+\s*(Hook|Situation|Task|Action|Result|Approach|Mechanism|Tradeoff)\s*:",
        r"\1:",
        t,
    )
    # Models sometimes restart labels mid-line: "...taxes.Hook:  Approach:" -> "...taxes. Approach:"
    t = re.sub(
        r"([.!?])\s*Hook:\s*(?=(Approach|Situation|Task|Action|Result|Mechanism|Tradeoff|Close)\s*:)",
        r"\1 ",
        t,
        flags=re.I,
    )
    t = re.sub(r"\bHook:\s*(?=(Approach|Situation|Mechanism|Tradeoff)\s*:)", "", t, flags=re.I)
    t = t.replace("**", "").replace("##", "")
    # Collapse runaway whitespace
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    # Models often append a dangling empty label at the end: "...reporting.Hook:"
    t = re.sub(
        r"[\s/]*(Hook|Situation|Task|Action|Result|Depth|Close|Approach|Mechanism|Tradeoffs?|Validation)\s*:\s*$",
        "",
        t,
        flags=re.I,
    )
    t = t.strip()
    # If it still ends mid-label residue, trim to last sentence end
    if t and t[-1] not in ".!?":
        m = re.search(r"^(.*[.!?])\s*[^.!?]*$", t, flags=re.S)
        if m and len(m.group(1).split()) >= 40:
            t = m.group(1).strip()
    return t


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


def _max_tokens_for_mode(mode: str, *, question: str = "") -> int:
    # Enough room to finish technical + multi-part answers
    long_q = _is_long_or_multipart_question(question)
    if ANSWER_PROFILE in ("ultra", "fast"):
        base = {
            "shorter": 100,
            "technical": 280,
            "code": 240,
            "star": 220,
        }.get(mode, 220)
        return base + (120 if long_q else 0)
    if ANSWER_PROFILE == "live":
        base = {
            "shorter": 160,
            "technical": 480,
            "code": 400,
            "star": 420,
        }.get(mode, 420)
        return base + (180 if long_q else 0)  # multi-part needs headroom
    if ANSWER_PROFILE == "balanced":
        base = {
            "shorter": 340,
            "technical": 900,
            "code": 900,
            "star": 900,
        }.get(mode, 900)
        return base + (150 if long_q else 0)
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

    # Live/ultra: compact but accuracy-aware (domain packs prevent wrong SAP/ML answers)
    if _is_fast_profile() and not strict_regen:
        tags = strategy.get("domain_tags") or []
        jargon = strategy.get("jargon_bank") or tags
        must = strategy.get("must_cover") or []
        pitfalls = strategy.get("pitfalls") or []
        tag_s = ", ".join(str(t) for t in tags[:8] if t)
        jar_s = ", ".join(str(j) for j in jargon[:10] if j)
        must_s = "; ".join(str(m) for m in must[:6] if m)
        pit_s = "; ".join(str(p) for p in pitfalls[:4] if p)
        domain = strategy.get("accuracy_domain") or "general"
        long_q = _is_long_or_multipart_question(q)
        # Keep full multi-part questions — truncating to 500 chars caused wrong answers
        q_budget = 1800 if long_q else 900
        parts = [
            f"Role: {job[:160]}",
            f"Q: {q[:q_budget]}",
            f"Domain: {domain}",
        ]
        if tag_s:
            parts.append(f"Topics: {tag_s}")
        if jar_s:
            parts.append(f"Use terms correctly: {jar_s}")
        if must_s:
            parts.append(f"Must cover: {must_s}")
        if pit_s:
            parts.append(f"Avoid: {pit_s}")
        if long_q:
            parts.append(
                "LONG/MULTI-PART QUESTION: Answer every clause in order "
                "(design, constraints, controls, metrics, failure modes, etc.). "
                "Do not stop after only the first sub-question. 220-360 words."
            )
        parts.append(
            "Accuracy rules: state correct definitions/mechanisms for this domain; "
            "do not invent SAP T-codes/modules or ML formulas; finish every labeled section; "
            "labels exactly like Hook: (never /Hook:)."
        )
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
    from config import get_llm_provider, remap_model_for_provider

    client = _get_openai_client()
    provider = get_llm_provider()

    def _map(m: str | None) -> str | None:
        return remap_model_for_provider(m) if m else m

    # Primary → fallback only (no OpenAI ghost models on Groq)
    models_try = [
        _map(model),
        _map(fallback_model or FALLBACK_MODEL),
        _map(SCRIPT_MODEL),
        _map(FAST_ANSWER_MODEL),
        _map(FAST_FALLBACK_MODEL),
    ]
    if provider != "groq":
        models_try.extend(["gpt-4.1-nano", "gpt-4o-mini"])
    seen: set[str] = set()
    last_err: Exception | None = None
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    # Fail fast on wrong model IDs — was 6s×2 ≈ 12s when admin still had gpt-4o
    timeout = 8.0 if _is_fast_profile() else 45.0
    if _is_fast_profile():
        models_try = [
            _map(model),
            _map(fallback_model or FAST_FALLBACK_MODEL),
            _map(FAST_ANSWER_MODEL),
        ]
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
            err_s = str(e).lower()
            # model_not_found / 404 → try next immediately (no long hang)
            if "model" in err_s and (
                "not found" in err_s
                or "does not exist" in err_s
                or "404" in err_s
                or "invalid" in err_s
            ):
                continue
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

    strategy = _fallback_strategy(question, job_context)
    mode = _prefer_mode_for_question(mode, strategy, question)

    # ---- Ultra/live: research cascade (cache + template + optional nano) ----
    if _is_fast_profile():
        from fast_answer import cache_lookup, cache_store, instant_answer

        # Exact match only — approx cache reuses earlier Q answers mid-interview
        hit = cache_lookup(
            question, mode=mode, job_context=job_context, allow_approx=False
        )
        if hit:
            generate_answer.last_source = hit[1] if len(hit) > 1 else "cache"  # type: ignore[attr-defined]
            return hit[0]

        # Nano for speed on soft Qs; mini for SAP/ML/technical correctness
        am = answer_model
        fm = fallback_model
        uam = user_answer_model
        ufm = user_fallback_model
        accuracy = _needs_accuracy_model(strategy, question, job_context)
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
        # Ensure accuracy path prefers mini even if admin left defaults empty
        if accuracy and primary == FAST_ANSWER_MODEL and (
            "nano" in primary or "instant" in primary or "8b" in primary.lower()
        ):
            primary, fallback = TECH_ACCURACY_MODEL, FAST_FALLBACK_MODEL
        # Remap gpt-4o etc. → Groq Llama (prevents 10s multi-timeout cascade)
        try:
            from config import remap_model_for_provider

            primary = remap_model_for_provider(primary) or primary
            fallback = remap_model_for_provider(fallback) or fallback
        except Exception:
            pass

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
                max_tokens=_max_tokens_for_mode(mode, question=question),
                temperature=0.2 if accuracy else 0.3,
            )
        except Exception:
            answer = ""
        answer = _normalize_answer_text(answer)
        # Domain answers: never substitute generic SWE templates (wrong for SAP/ML)
        if not answer:
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
                answer = _normalize_answer_text(answer)
                generate_answer.last_source = "template_fallback"  # type: ignore[attr-defined]
                return answer
            generate_answer.last_source = "llm_empty"  # type: ignore[attr-defined]
            return ""
        cache_store(question, answer, mode=mode, job_context=job_context)
        generate_answer.last_source = "llm"  # type: ignore[attr-defined]
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

    accuracy = _needs_accuracy_model(strategy, question, job_context)
    if accuracy and (not am and not uam) and "nano" in (primary or ""):
        primary, fallback = TECH_ACCURACY_MODEL, FAST_FALLBACK_MODEL

    answer = _complete_answer(
        system=system,
        user=user,
        model=primary,
        fallback_model=fallback,
        max_tokens=_max_tokens_for_mode(mode, question=question),
        temperature=0.25 if accuracy else 0.42,
    )
    answer = _normalize_answer_text(answer)
    generate_answer.last_source = "llm" if (answer or "").strip() else "llm_empty"  # type: ignore[attr-defined]

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
                max_tokens=_max_tokens_for_mode(mode, question=question) + 120,
                temperature=0.3,
            )
            answer2 = _normalize_answer_text(answer2)
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

    if _use_strategy_llm():
        strategy = analyze_question_strategy(question, job_context=job_context)
    else:
        strategy = _fallback_strategy(question, job_context)
    mode = _prefer_mode_for_question(mode, strategy, question)
    accuracy = _needs_accuracy_model(strategy, question, job_context)

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
    if accuracy and primary == FAST_ANSWER_MODEL and (
        "nano" in primary or "instant" in primary or "8b" in primary.lower()
    ):
        primary, fallback = TECH_ACCURACY_MODEL, FAST_FALLBACK_MODEL
    try:
        from config import remap_model_for_provider

        primary = remap_model_for_provider(primary) or primary
        fallback = remap_model_for_provider(fallback) or fallback
    except Exception:
        pass

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
    if not _is_fast_profile() or accuracy:
        user += (
            "\n\nSTREAMING QUALITY RULE: Prefer correct, dense technical content. "
            "Do not stop early. Complete every section with accurate domain facts."
        )

    client = _get_openai_client()
    models_try = [primary, fallback, SCRIPT_MODEL, FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL]
    stream = None
    last_err: Exception | None = None
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    max_tok = _max_tokens_for_mode(mode, question=question)
    temp = 0.2 if accuracy else (0.35 if _is_fast_profile() else 0.42)
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
