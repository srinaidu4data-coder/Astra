#!/usr/bin/env python3
"""Shared answer generation — no FastAPI, no circular imports."""

from __future__ import annotations

from typing import Optional

from rag import SCRIPT_MODEL, _get_openai_client, search_context

SPEAKABLE_STAR_SYSTEM = """You are an interview teleprompter. Write a short answer the candidate can read aloud slowly.

Format EXACTLY with these four labels (one short sentence each):
Situation: ...
Task: ...
Action: ...
Result: ...

Rules:
- Total under 85 words
- First person, natural speech
- No bullet symbols, no markdown, no preamble
- Prefer concrete detail over buzzwords
- Result must include a number or clear outcome when possible
"""

SPEAKABLE_SHORTER_SYSTEM = """You are an interview teleprompter. Give a brief speakable answer.

Rules:
- Exactly 3 short lines the candidate can say aloud
- Each line under 18 words
- No STAR labels, no markdown, no preamble
- First person, confident, plain language
"""

SPEAKABLE_TECHNICAL_SYSTEM = """You are an interview teleprompter for technical depth.

Rules:
- 4 short lines the candidate can speak
- Cover: approach, key mechanism, tradeoff, how you'd validate
- No STAR labels unless natural
- Prefer precise terms over fluff
- Under 100 words total
"""

SPEAKABLE_CODE_SYSTEM = """You are an interview teleprompter for coding questions.

Rules:
- Start with 2 short spoken sentences (approach)
- Then a small code sketch in a fenced block (```language ... ```)
- Keep code under 18 lines
- End with one spoken line on complexity/tradeoff
"""


def generate_answer(
    question: str,
    *,
    job_context: str = "",
    tone: str = "confident",
    mode: str = "star",
) -> str:
    """Blocking full answer (no stream) — reliable for live session."""
    mode = (mode or "star").strip().lower()
    chunks: list = []
    try:
        chunks = search_context(question) or []
    except Exception:
        chunks = []

    ctx = ""
    if chunks:
        bits = [c.get("text", "")[:280] for c in chunks[:3] if c.get("text")]
        if bits:
            ctx = "Use this candidate context when relevant:\n" + "\n".join(bits)

    job = f"Role focus: {job_context}" if job_context else ""
    tone_note = f"Tone: {tone}." if tone else ""

    if mode == "shorter":
        system = SPEAKABLE_SHORTER_SYSTEM
        instruct = "Write the 3 short speakable lines now."
        max_tokens = 140
    elif mode == "technical":
        system = SPEAKABLE_TECHNICAL_SYSTEM
        instruct = "Write the technical speakable answer now."
        max_tokens = 220
    elif mode == "code":
        system = SPEAKABLE_CODE_SYSTEM
        instruct = "Write the spoken approach + code sketch now."
        max_tokens = 320
    else:
        mode = "star"
        system = SPEAKABLE_STAR_SYSTEM
        instruct = "Write the four-line Situation/Task/Action/Result answer now."
        max_tokens = 220

    user = f"""{job}
{tone_note}
{ctx}

Interview question:
{question}

{instruct}"""

    client = _get_openai_client()
    resp = client.chat.completions.create(
        model=SCRIPT_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        stream=False,
        temperature=0.55,
        max_tokens=max_tokens,
        timeout=45.0,
    )
    return (resp.choices[0].message.content or "").strip()


def to_bullets(text: str, mode: str = "star") -> list[str]:
    import re

    text = (text or "").strip()
    if not text:
        return []

    mode = (mode or "star").strip().lower()
    prose = re.sub(r"```[\s\S]*?```", "", text).strip() if mode == "code" else text

    labeled: list[str] = []
    for raw in prose.splitlines():
        line = raw.strip(" -•\t")
        if not line:
            continue
        low = line.lower()
        if mode == "star":
            mapped = False
            for key, prefix in (
                ("situation:", "Situation — "),
                ("task:", "Task — "),
                ("action:", "Action — "),
                ("result:", "Result — "),
            ):
                if low.startswith(key):
                    labeled.append(prefix + line.split(":", 1)[1].strip())
                    mapped = True
                    break
            if not mapped:
                labeled.append(line)
        else:
            labeled.append(line)

    if len(labeled) >= 2:
        return labeled[:8]

    parts = [p.strip() for p in prose.replace("\n", " ").split(". ") if p.strip()]
    if mode == "star" and len(parts) >= 4:
        labels = ["Situation — ", "Task — ", "Action — ", "Result — "]
        return [
            labels[i] + (p if p.endswith(".") else p + ".")
            for i, p in enumerate(parts[:4])
        ]
    return parts[:6] if parts else [text]


def looks_like_question(text: str) -> bool:
    """Broader than startswith — handles 'Question one, tell me…'."""
    t = (text or "").strip().lower()
    if not t or len(t.split()) < 3:
        return False
    if "?" in t:
        return True
    # Strip common wrappers: "question 1,", "q1.", "interviewer:"
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
    )
    return any(c in t2 for c in cues)


def re_sub_wrappers(t: str) -> str:
    import re

    t = re.sub(r"^(question|q)\s*\d+\s*[,.:\-–]?\s*", "", t)
    t = re.sub(r"^(interviewer|host)\s*[,:]\s*", "", t)
    return t.strip()
