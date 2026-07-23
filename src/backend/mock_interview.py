"""AI Mock Interview — generate questions, score answers, produce reports.

Works with OpenAI when available; falls back to deterministic offline scoring
so Practice mode is never dead without a key.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.config import settings

logger = logging.getLogger("astra.mock")

router = APIRouter(prefix="/v1/mock", tags=["mock-interview"])

Persona = Literal[
    "strict-tech-lead",
    "behavioral-hr",
    "system-design",
    "friendly-recruiter",
]
Difficulty = Literal["easy", "medium", "hard"]
Focus = Literal["mixed", "behavioral", "technical", "system-design"]

PERSONA_BLURBS = {
    "strict-tech-lead": "Senior engineering interviewer who probes depth, tradeoffs, and ownership.",
    "behavioral-hr": "Behavioral interviewer focused on STAR stories, conflict, and leadership.",
    "system-design": "Staff-level system design interviewer who drills scale, consistency, and failure modes.",
    "friendly-recruiter": "Warm recruiter screen — motivation, communication, high-level fit.",
}

BANK: dict[str, list[str]] = {
    "behavioral": [
        "Tell me about a time you disagreed with a teammate and how you resolved it.",
        "Describe a project that failed. What did you learn?",
        "Walk me through a time you influenced without authority.",
        "Tell me about a high-pressure deadline and how you delivered.",
        "Give an example of mentoring someone junior.",
        "Describe a time you received hard feedback and changed.",
    ],
    "technical": [
        "How would you design a real-time transcription pipeline with sub-second latency?",
        "Explain how you would debug intermittent production latency spikes.",
        "How do you evaluate quality for a RAG system used in interview answers?",
        "Walk me through rate limiting and backpressure for an LLM proxy.",
        "How would you secure API keys for a desktop interview copilot?",
        "Describe your approach to testing flaky voice-to-text pipelines.",
    ],
    "system-design": [
        "Design a multi-tenant interview coaching SaaS that streams answers under 1s.",
        "How would you build durable session history and analytics at scale?",
        "Design an audio capture service that works across Windows devices.",
        "Architect a webhook + billing system that never double-charges.",
        "How would you store and rank STAR memories for personalization?",
        "Design a real-time WebSocket interview session with reconnect safety.",
    ],
    "mixed": [],
}
BANK["mixed"] = BANK["behavioral"][:2] + BANK["technical"][:2] + BANK["system-design"][:2]


class StartRequest(BaseModel):
    job_title: str = "Software Engineer"
    job_description: str = ""
    persona: Persona = "strict-tech-lead"
    difficulty: Difficulty = "medium"
    focus: Focus = "mixed"
    question_count: int = Field(default=5, ge=3, le=12)
    resume_snippets: str = ""
    company: str = ""


class StartResponse(BaseModel):
    session_id: str
    questions: list[dict[str, Any]]
    persona: str
    difficulty: str
    focus: str
    job_title: str
    tips: list[str]
    source: str  # openai | offline


class ScoreRequest(BaseModel):
    session_id: str = ""
    question: str
    answer: str
    persona: Persona = "strict-tech-lead"
    difficulty: Difficulty = "medium"
    job_title: str = "Software Engineer"
    job_description: str = ""
    elapsed_sec: int = 0


class ScoreResponse(BaseModel):
    overall: int
    star_coverage: int
    technical_depth: int
    communication: int
    confidence: int
    filler_count: int
    strengths: list[str]
    improvements: list[str]
    follow_up: str | None
    model_answer_bullets: list[str]
    coach_note: str
    source: str


class ReportRequest(BaseModel):
    session_id: str = ""
    job_title: str = "Software Engineer"
    persona: Persona = "strict-tech-lead"
    difficulty: Difficulty = "medium"
    turns: list[dict[str, Any]] = Field(default_factory=list)
    # each turn: {question, answer, scores?}


class ReportResponse(BaseModel):
    overall: int
    star_coverage: int
    technical_depth: int
    communication: int
    confidence: int
    filler_count: int
    grade: str
    summary: str
    top_strengths: list[str]
    top_improvements: list[str]
    practice_plan: list[str]
    highlight_quotes: list[str]
    source: str


FILLERS = re.compile(
    r"\b(um+|uh+|like|you know|sort of|kind of|basically|actually|literally|right\?|i mean)\b",
    re.I,
)


def _openai_client():
    key = (settings.OPENAI_API_KEY or "").strip()
    if not key:
        return None
    try:
        from openai import OpenAI

        return OpenAI(api_key=key)
    except Exception:
        return None


def _chat_json(system: str, user: str, model: str = "gpt-4o-mini") -> dict | None:
    client = _openai_client()
    if client is None:
        return None
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.4,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        text = resp.choices[0].message.content or "{}"
        return json.loads(text)
    except Exception:
        logger.exception("OpenAI mock call failed")
        return None


def _offline_questions(req: StartRequest) -> list[dict[str, Any]]:
    focus = req.focus
    pool = list(BANK.get(focus) or BANK["mixed"])
    # inject job title into first Q when possible
    if req.job_title:
        pool = [
            f"As a {req.job_title}, {q[0].lower() + q[1:]}" if i == 0 and q else q
            for i, q in enumerate(pool)
        ]
    if req.difficulty == "hard":
        pool = pool[::-1]  # prefer harder bank order
    n = min(req.question_count, len(pool))
    # cycle if needed
    qs = []
    for i in range(req.question_count):
        q = pool[i % max(1, len(pool))]
        qs.append(
            {
                "id": f"q_{i+1}",
                "text": q,
                "category": focus if focus != "mixed" else ("behavioral" if i % 3 == 0 else "technical"),
                "hint": "Use STAR and one metric." if "time" in q.lower() or "tell me" in q.lower() else "Be specific about tradeoffs.",
            }
        )
    return qs[: req.question_count]


def _count_fillers(text: str) -> int:
    return len(FILLERS.findall(text or ""))


def _star_score(text: str) -> int:
    t = (text or "").lower()
    hits = 0
    for kw in (
        "situation",
        "when i",
        "at my",
        "task",
        "goal",
        "action",
        "i built",
        "i led",
        "i implemented",
        "result",
        "outcome",
        "%",
        "reduced",
        "improved",
        "increased",
    ):
        if kw in t:
            hits += 1
    # length bonus
    words = len((text or "").split())
    base = min(95, 25 + hits * 8 + min(30, words // 3))
    return int(base)


def _offline_score(req: ScoreRequest) -> ScoreResponse:
    text = (req.answer or "").strip()
    words = len(text.split())
    fillers = _count_fillers(text)
    star = _star_score(text)
    tech = 40
    if any(k in text.lower() for k in ("api", "latency", "scale", "database", "cache", "tradeoff", "design", "model")):
        tech = 72
    if req.persona in ("strict-tech-lead", "system-design"):
        tech = min(95, tech + 8)
    if words < 25:
        star = min(star, 45)
        tech = min(tech, 40)
    comm = max(20, min(95, 55 + min(30, words // 5) - fillers * 6))
    conf = max(20, min(95, (star + comm) // 2 + (5 if words > 60 else 0)))
    overall = int(round(0.35 * star + 0.25 * tech + 0.25 * comm + 0.15 * conf))

    strengths = []
    improvements = []
    if star >= 70:
        strengths.append("Clear narrative structure with concrete detail")
    else:
        improvements.append("Frame the story with Situation → Action → measurable Result")
    if tech >= 70:
        strengths.append("Solid technical vocabulary and specifics")
    else:
        improvements.append("Name tools, metrics, and tradeoffs explicitly")
    if fillers > 3:
        improvements.append(f"Reduce filler words (detected ~{fillers})")
    else:
        strengths.append("Clean delivery with few fillers")
    if words < 40:
        improvements.append("Expand the answer — aim for ~60–90 seconds spoken")
    if not strengths:
        strengths.append("You engaged with the question")
    if not improvements:
        improvements.append("Add one sharper metric in the Result")

    follow = None
    if overall < 75:
        follow = "Can you quantify the impact of that decision with a specific metric?"
    elif req.persona == "system-design":
        follow = "What fails first at 10× traffic, and how do you detect it?"
    else:
        follow = "What would you do differently next time?"

    bullets = [
        "Situation: one sentence of context",
        "Action: 2 concrete steps you owned",
        f"Result: metric tied to {req.job_title or 'the role'}",
    ]
    return ScoreResponse(
        overall=overall,
        star_coverage=star,
        technical_depth=tech,
        communication=comm,
        confidence=conf,
        filler_count=fillers,
        strengths=strengths[:3],
        improvements=improvements[:3],
        follow_up=follow,
        model_answer_bullets=bullets,
        coach_note="Offline coach active — connect OPENAI_API_KEY for richer scoring.",
        source="offline",
    )


@router.post("/start", response_model=StartResponse)
def start_mock(req: StartRequest) -> StartResponse:
    sid = f"mock_{uuid.uuid4().hex[:12]}"
    tips = [
        f"Persona: {PERSONA_BLURBS.get(req.persona, req.persona)}",
        "Speak out loud — aim for 60–90s per answer",
        "Lead with the punchline metric when you have one",
        "If stuck, outline Situation / Action / Result out loud",
    ]
    if req.company:
        tips.insert(0, f"Frame answers for {req.company} culture and bar")

    data = _chat_json(
        system=(
            "You are an expert interview designer. Return JSON with key questions: "
            "array of {id, text, category, hint}. Categories: behavioral|technical|system-design. "
            f"Create exactly {req.question_count} realistic questions. "
            f"Difficulty={req.difficulty}. Persona={req.persona}."
        ),
        user=(
            f"Job title: {req.job_title}\nCompany: {req.company}\n"
            f"Focus: {req.focus}\nJD:\n{req.job_description[:4000]}\n"
            f"Resume notes:\n{req.resume_snippets[:2000]}"
        ),
    )
    source = "offline"
    questions: list[dict[str, Any]]
    if data and isinstance(data.get("questions"), list) and data["questions"]:
        questions = []
        for i, q in enumerate(data["questions"][: req.question_count]):
            if isinstance(q, str):
                questions.append(
                    {"id": f"q_{i+1}", "text": q, "category": req.focus, "hint": "Be specific."}
                )
            elif isinstance(q, dict):
                questions.append(
                    {
                        "id": q.get("id") or f"q_{i+1}",
                        "text": q.get("text") or q.get("question") or "Tell me about yourself.",
                        "category": q.get("category") or req.focus,
                        "hint": q.get("hint") or "Use concrete examples.",
                    }
                )
        source = "openai"
        if len(questions) < req.question_count:
            # pad offline
            extra = _offline_questions(req)
            questions.extend(extra[len(questions) : req.question_count])
    else:
        questions = _offline_questions(req)

    return StartResponse(
        session_id=sid,
        questions=questions,
        persona=req.persona,
        difficulty=req.difficulty,
        focus=req.focus,
        job_title=req.job_title,
        tips=tips,
        source=source,
    )


@router.post("/score", response_model=ScoreResponse)
def score_answer(req: ScoreRequest) -> ScoreResponse:
    if not (req.answer or "").strip():
        raise HTTPException(400, detail="answer required")

    data = _chat_json(
        system=(
            "You are a tough but fair interview coach. Score the candidate answer. "
            "Return JSON keys: overall, star_coverage, technical_depth, communication, "
            "confidence (0-100 ints), filler_count (int), strengths (string[]), "
            "improvements (string[]), follow_up (string|null), model_answer_bullets (string[3]), "
            "coach_note (string). Be specific and actionable."
        ),
        user=(
            f"Persona: {req.persona}\nDifficulty: {req.difficulty}\nRole: {req.job_title}\n"
            f"JD snippet: {req.job_description[:1500]}\n"
            f"Question: {req.question}\n"
            f"Answer ({req.elapsed_sec}s):\n{req.answer[:5000]}"
        ),
    )
    if not data:
        return _offline_score(req)

    def _i(key: str, default: int = 50) -> int:
        try:
            return max(0, min(100, int(data.get(key, default))))
        except Exception:
            return default

    fillers = data.get("filler_count")
    if fillers is None:
        fillers = _count_fillers(req.answer)
    try:
        fillers = int(fillers)
    except Exception:
        fillers = _count_fillers(req.answer)

    return ScoreResponse(
        overall=_i("overall", 60),
        star_coverage=_i("star_coverage", 60),
        technical_depth=_i("technical_depth", 60),
        communication=_i("communication", 60),
        confidence=_i("confidence", 60),
        filler_count=max(0, fillers),
        strengths=list(data.get("strengths") or [])[:4] or ["Solid attempt"],
        improvements=list(data.get("improvements") or [])[:4] or ["Add a clearer Result metric"],
        follow_up=data.get("follow_up"),
        model_answer_bullets=list(data.get("model_answer_bullets") or [])[:5]
        or ["Situation", "Action", "Result with metric"],
        coach_note=str(data.get("coach_note") or "Keep iterating — specificity wins."),
        source="openai",
    )


@router.post("/report", response_model=ReportResponse)
def session_report(req: ReportRequest) -> ReportResponse:
    turns = req.turns or []
    if not turns:
        return ReportResponse(
            overall=0,
            star_coverage=0,
            technical_depth=0,
            communication=0,
            confidence=0,
            filler_count=0,
            grade="N/A",
            summary="No answers recorded.",
            top_strengths=[],
            top_improvements=["Complete at least one answer to get a report."],
            practice_plan=["Start a 5-question mock and answer out loud."],
            highlight_quotes=[],
            source="offline",
        )

    # Aggregate any embedded scores; else re-score lightly offline
    scores = []
    fillers = 0
    for t in turns:
        s = t.get("scores") or {}
        if s:
            scores.append(s)
            fillers += int(s.get("filler_count") or 0)
        else:
            off = _offline_score(
                ScoreRequest(
                    question=str(t.get("question") or ""),
                    answer=str(t.get("answer") or ""),
                    persona=req.persona,
                    difficulty=req.difficulty,
                    job_title=req.job_title,
                )
            )
            scores.append(off.model_dump())
            fillers += off.filler_count

    def avg(key: str) -> int:
        vals = [int(s.get(key) or 0) for s in scores]
        return int(round(sum(vals) / max(1, len(vals))))

    overall = avg("overall")
    grade = (
        "A"
        if overall >= 90
        else "B"
        if overall >= 80
        else "C"
        if overall >= 70
        else "D"
        if overall >= 60
        else "F"
    )

    data = _chat_json(
        system=(
            "You write concise interview debriefs. Return JSON: summary, top_strengths[], "
            "top_improvements[], practice_plan[] (3-5 items), highlight_quotes[] (short)."
        ),
        user=json.dumps(
            {
                "job_title": req.job_title,
                "persona": req.persona,
                "difficulty": req.difficulty,
                "overall": overall,
                "turns": [
                    {
                        "q": t.get("question"),
                        "a": (t.get("answer") or "")[:800],
                        "score": (t.get("scores") or {}).get("overall"),
                    }
                    for t in turns
                ],
            }
        )[:12000],
    )
    source = "openai" if data else "offline"
    if not data:
        data = {
            "summary": f"You completed {len(turns)} answers with an average score of {overall}/100 ({grade}).",
            "top_strengths": ["Showed up and answered under time pressure"],
            "top_improvements": ["Tighten STAR structure", "Add metrics to Results"],
            "practice_plan": [
                "Re-run the same persona at one difficulty higher",
                "Record yourself and cut filler words",
                "Prepare 3 signature stories with numbers",
            ],
            "highlight_quotes": [],
        }

    return ReportResponse(
        overall=overall,
        star_coverage=avg("star_coverage"),
        technical_depth=avg("technical_depth"),
        communication=avg("communication"),
        confidence=avg("confidence"),
        filler_count=fillers,
        grade=grade,
        summary=str(data.get("summary") or ""),
        top_strengths=list(data.get("top_strengths") or [])[:5],
        top_improvements=list(data.get("top_improvements") or [])[:5],
        practice_plan=list(data.get("practice_plan") or [])[:6],
        highlight_quotes=list(data.get("highlight_quotes") or [])[:4],
        source=source,
    )


@router.get("/personas")
def list_personas() -> dict:
    return {
        "personas": [
            {"id": k, "label": k.replace("-", " ").title(), "blurb": v}
            for k, v in PERSONA_BLURBS.items()
        ],
        "difficulties": ["easy", "medium", "hard"],
        "focuses": ["mixed", "behavioral", "technical", "system-design"],
    }
