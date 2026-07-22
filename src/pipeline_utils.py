#!/usr/bin/env python3
"""
Pure helpers for the interview pipeline — intentionally free of Qt / Whisper / OpenAI.

These functions are unit-tested heavily (latency budget, classification heuristics,
audio window sizing, error mapping, RRF score repair).
"""

from __future__ import annotations

import re
from typing import Any


# ---------------------------------------------------------------------------
# Audio window sizing
# ---------------------------------------------------------------------------

def speech_window_seconds(
    speech_duration: float,
    *,
    min_seconds: float = 3.0,
    max_seconds: float = 12.0,
    pad_seconds: float = 0.75,
) -> float:
    """
    Map measured speech length to Whisper clip length.

    Extreme cases:
    - speech_duration <= 0  → min_seconds
    - huge speech_duration  → max_seconds
    - NaN / negative        → min_seconds
    """
    try:
        s = float(speech_duration)
    except (TypeError, ValueError):
        return min_seconds
    if s != s or s < 0:  # NaN or negative
        return min_seconds
    return min(max_seconds, max(min_seconds, s + pad_seconds))


# ---------------------------------------------------------------------------
# Latency budget (product metric: sub-3s silence → first answer token)
# ---------------------------------------------------------------------------

DEFAULT_BUDGET = {
    "silence_s": 0.8,
    "stt_s": 0.5,
    "classify_s": 0.0,  # heuristic path
    "rag_s": 0.3,
    "ttft_s": 0.6,
}


def estimate_pipeline_latency_s(
    silence_s: float,
    stt_s: float,
    classify_s: float,
    rag_s: float,
    ttft_s: float,
) -> float:
    """Sum serial stages before first answer token is painted."""
    parts = [silence_s, stt_s, classify_s, rag_s, ttft_s]
    total = 0.0
    for p in parts:
        try:
            v = float(p)
        except (TypeError, ValueError):
            v = 0.0
        if v != v or v < 0:
            v = 0.0
        total += v
    return total


def meets_sub3s_budget(
    silence_s: float = 0.8,
    stt_s: float = 0.5,
    classify_s: float = 0.0,
    rag_s: float = 0.3,
    ttft_s: float = 0.6,
    target_s: float = 3.0,
) -> bool:
    return estimate_pipeline_latency_s(silence_s, stt_s, classify_s, rag_s, ttft_s) <= target_s


# ---------------------------------------------------------------------------
# Hybrid / RRF score repair
# ---------------------------------------------------------------------------

RRF_K_DEFAULT = 60


def normalize_hybrid_similarity(
    rrf_score: float | None = None,
    dense_score: float | None = None,
    *,
    rrf_k: int = RRF_K_DEFAULT,
) -> float:
    """
    Convert hybrid retrieval scores into a cosine-like [0, 1] similarity.

    Dense cosine wins when present and > 0.
    Raw RRF is ~weight/(k+rank) (max ~0.016) — scale up for thresholds.
    """
    if dense_score is not None:
        try:
            d = float(dense_score)
            if d == d and d > 0:
                return min(1.0, max(0.0, d))
        except (TypeError, ValueError):
            pass
    if rrf_score is None:
        return 0.0
    try:
        r = float(rrf_score)
    except (TypeError, ValueError):
        return 0.0
    if r != r or r <= 0:
        return 0.0
    # Map typical RRF range into ~0-1
    return min(1.0, r * (rrf_k + 1))


def context_is_relevant(context_chunks: list[dict], min_score: float = 0.2) -> bool:
    """Whether retrieved chunks should personalize the answer."""
    if not context_chunks:
        return False
    for chunk in context_chunks:
        dense = chunk.get("dense_score")
        if dense is not None:
            try:
                if float(dense) > min_score:
                    return True
            except (TypeError, ValueError):
                pass
        sim = chunk.get("similarity_score", 0)
        try:
            if float(sim) > min_score:
                return True
        except (TypeError, ValueError):
            pass
    # Top-k hybrid with only tiny RRF scores still useful
    return True


# ---------------------------------------------------------------------------
# Fast-path question classification (skip LLM for obvious cases)
# ---------------------------------------------------------------------------

_QUESTION_STARTERS = (
    r"tell me about",
    r"tell us about",
    r"describe (a|the|your)",
    r"how (would|do|did|can|have) you",
    r"what('s| is| are| was| were| would| do| did| have| has) ",
    r"why (do|did|would|are|is) you",
    r"walk me through",
    r"give me an example",
    r"can you (explain|describe|walk|tell|share)",
    r"could you (explain|describe|walk|tell|share)",
    r"what are your (strengths|weaknesses)",
    r"why (do you want|should we hire|this (job|role|company))",
    r"where do you see yourself",
    r"are you (available|comfortable|willing|familiar)",
    r"have you (ever|worked|used|built|led)",
    r"explain (how|what|why)",
    r"what's your experience",
    r"what is your experience",
)

_IGNORE_PHRASES = (
    r"can you hear me",
    r"thanks for (that|your answer|sharing)",
    r"thank you for (that|your answer|sharing)",
    r"let me tell you",
    r"let's move on",
    r"that's great",
    r"interesting[,.]?$",
    r"ok(ay)?[,.]?$",
    r"mm-?hmm",
    r"got it[,.]?$",
)

_STARTER_RE = re.compile("|".join(f"(?:{p})" for p in _QUESTION_STARTERS), re.I)
_IGNORE_RE = re.compile("|".join(f"(?:{p})" for p in _IGNORE_PHRASES), re.I)
_ENDS_Q = re.compile(r"\?\s*$")


def heuristic_classify(text: str, min_words: int = 3) -> dict[str, Any] | None:
    """
    Return a classification dict if confident enough to skip the LLM.
    Return None if the utterance is ambiguous (caller should hit LLM).

    Dict shape matches classify_utterance().
    """
    if text is None:
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 1.0,
            "cleaned_question": "",
            "source": "heuristic",
        }

    cleaned = " ".join(str(text).strip().split())
    if not cleaned:
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 1.0,
            "cleaned_question": "",
            "source": "heuristic",
        }

    words = cleaned.split()
    if len(words) < min_words:
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 1.0,
            "cleaned_question": cleaned,
            "source": "heuristic",
        }

    lower = cleaned.lower()

    if _IGNORE_RE.search(lower) and not _STARTER_RE.search(lower) and not _ENDS_Q.search(cleaned):
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 0.95,
            "cleaned_question": cleaned,
            "source": "heuristic",
        }

    # Strong question patterns
    if _STARTER_RE.search(lower) or _ENDS_Q.search(cleaned):
        qtype = "behavioral"
        if re.search(r"\b(how does|explain|implement|design|difference between|algorithm)\b", lower):
            qtype = "technical"
        elif re.search(r"\b(how would you handle|what would you do|situation)\b", lower):
            qtype = "situational"
        return {
            "is_interview_question": True,
            "question_type": qtype,
            "confidence": 0.9,
            "cleaned_question": cleaned.rstrip("?") + ("?" if "?" not in cleaned else ""),
            "source": "heuristic",
        }

    # Ambiguous — need LLM
    return None


# ---------------------------------------------------------------------------
# Plain-English errors
# ---------------------------------------------------------------------------

_ERROR_HINTS = (
    ("license", "AI is not configured. Set OPENAI_API_KEY in .env (or re-enable licensing later)."),
    ("wasapi", "We can't hear computer sound. Use speakers/headphones on this PC."),
    ("loopback", "We can't hear computer sound. Pick another audio device under Advanced."),
    ("no speech", "We didn't hear anyone talking. Make sure the interviewer's voice plays on this computer."),
    ("no audio", "No audio captured. Click Start Listening and play a short YouTube clip to test."),
    ("connection", "Can't reach Astra servers. Check Wi‑Fi and try again."),
    ("timeout", "That took too long. Check Wi‑Fi and try again."),
    ("429", "Too many requests — wait a few seconds and try again."),
    ("rate", "Too many requests — wait a few seconds and try again."),
    ("chromadb", "Your notes database had a problem. Try re-adding your resume."),
    ("openai", "AI service error. Check your API key and internet, then try again."),
)


def friendly_error(message: str | None) -> str:
    lower = (message or "").lower()
    for needle, hint in _ERROR_HINTS:
        if needle in lower:
            return hint
    return message or "Something went wrong. Try again."


# ---------------------------------------------------------------------------
# Dedup / fingerprint for re-answer prevention
# ---------------------------------------------------------------------------

def question_fingerprint(text: str) -> str:
    """Normalize text for near-duplicate detection."""
    if not text:
        return ""
    t = re.sub(r"[^\w\s]", " ", text.lower())
    t = re.sub(r"\s+", " ", t).strip()
    return t


def is_near_duplicate(a: str, b: str, *, min_overlap: float = 0.85) -> bool:
    """True if two questions are essentially the same (Jaccard on words)."""
    fa, fb = question_fingerprint(a), question_fingerprint(b)
    if not fa or not fb:
        return False
    if fa == fb:
        return True
    wa, wb = set(fa.split()), set(fb.split())
    if not wa or not wb:
        return False
    inter = len(wa & wb)
    union = len(wa | wb)
    return (inter / union) >= min_overlap
