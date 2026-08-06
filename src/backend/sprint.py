"""Company Twin Interview Sprint API — opportunities, diagnostic, dossier, stories, debrief."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session
from backend.entitlements import (
    can_use_feature,
    count_user_opportunities,
    entitlement_summary,
    max_opportunities_allowed,
    require_paid_access,
    user_has_paid_access,
)
from backend.jwt_auth import get_current_user
from backend.models import (
    AnalyticsEvent,
    JobOpportunity,
    SprintSession,
    StoryBankItem,
    User,
)

logger = logging.getLogger("astra.sprint")

router = APIRouter(prefix="/v1/sprint", tags=["sprint"])

InterviewStage = Literal[
    "recruiter",
    "hiring_manager",
    "technical",
    "behavioral",
    "case_study",
    "panel",
    "executive",
    "final",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _track(session: Session, user_id: int | None, event: str, **meta: Any) -> None:
    try:
        # Strip any accidental PII-ish keys
        safe = {
            k: v
            for k, v in meta.items()
            if k
            not in (
                "resume",
                "resume_text",
                "job_description",
                "transcript",
                "answer",
                "email",
            )
        }
        session.add(
            AnalyticsEvent(
                user_id=user_id,
                event_name=event,
                source=str(safe.pop("source", "") or "") or None,
                role_category=str(safe.pop("role_category", "") or "") or None,
                meta_json=json.dumps(safe) if safe else None,
            )
        )
        session.commit()
    except Exception:
        logger.exception("analytics track failed: %s", event)
        session.rollback()


def _opp_owned(session: Session, user: User, opp_id: int) -> JobOpportunity:
    opp = session.get(JobOpportunity, opp_id)
    if not opp or opp.user_id != user.id:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp


def _tokenize(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z0-9+.#-]{2,}", text or "")}


def _skill_candidates(jd: str) -> list[str]:
    """Extract skill-like tokens from JD without inventing domains."""
    stop = {
        "with",
        "from",
        "that",
        "this",
        "have",
        "will",
        "your",
        "about",
        "work",
        "team",
        "years",
        "experience",
        "using",
        "ability",
        "strong",
        "preferred",
        "required",
        "including",
        "across",
        "other",
        "into",
        "must",
        "should",
        "their",
        "they",
        "them",
        "been",
        "were",
        "also",
        "such",
        "role",
        "company",
        "position",
    }
    words = [
        w
        for w in re.findall(r"[A-Za-z][A-Za-z0-9+.#/-]{2,}", jd or "")
        if w.lower() not in stop and not w.isdigit()
    ]
    # Prefer capitalized / tech-looking
    scored: dict[str, int] = {}
    for w in words:
        key = w if any(c.isupper() for c in w[1:]) or any(c in w for c in "+#./") else w.lower()
        if len(key) < 3:
            continue
        scored[key] = scored.get(key, 0) + 1
    ranked = sorted(scored.items(), key=lambda x: (-x[1], x[0].lower()))
    out: list[str] = []
    seen: set[str] = set()
    for k, _ in ranked:
        lk = k.lower()
        if lk in seen:
            continue
        seen.add(lk)
        out.append(k)
        if len(out) >= 24:
            break
    return out


def _build_diagnostic(
    *,
    company: str,
    role: str,
    jd: str,
    resume: str,
    stage: str,
) -> dict[str, Any]:
    """Useful free preview without dumping full paid dossier."""
    jd_skills = _skill_candidates(jd)
    resume_toks = _tokenize(resume)
    jd_toks = _tokenize(jd)

    supported: list[str] = []
    gaps: list[str] = []
    for sk in jd_skills[:16]:
        if sk.lower() in resume_toks or any(
            sk.lower() in r or r in sk.lower() for r in resume_toks if len(r) > 3
        ):
            supported.append(sk)
        else:
            gaps.append(sk)

    overlap = len(jd_toks & resume_toks)
    union = max(1, len(jd_toks | resume_toks))
    base = int(100 * (overlap / union))
    # Blend with skill hit rate
    skill_hit = int(100 * (len(supported) / max(1, len(supported) + len(gaps[:8]))))
    match = max(12, min(94, int(0.45 * base + 0.55 * skill_hit)))
    if not jd.strip():
        match = min(match, 40)
    if not resume.strip():
        match = min(match, 35)

    stage_q = {
        "recruiter": [
            f"Why {company or 'this company'} and this {role or 'role'} now?",
            "Walk me through your background in two minutes.",
            "What are you looking for in your next role?",
            "Tell me about a time you handled ambiguity.",
            "What questions do you have for us?",
        ],
        "technical": [
            f"How would you design the core technical approach for this {role or 'role'}?",
            "Describe a complex system you owned end-to-end.",
            "How do you debug production issues under time pressure?",
            "What metrics prove your last technical win?",
            "Where are you weakest relative to this JD?",
        ],
        "behavioral": [
            "Tell me about a conflict with a stakeholder and the outcome.",
            "Describe a failure and what you changed afterward.",
            "When did you influence without authority?",
            "How do you prioritize when everything is urgent?",
            "Give an example of mentoring or raising team quality.",
        ],
        "panel": [
            f"How would each of us see your impact in the first 90 days as {role or 'this role'}?",
            "Defend a trade-off you made that others disagreed with.",
            "How do you communicate risk to non-technical leaders?",
            "What would you need from this team to succeed?",
            "Challenge a requirement in this JD constructively.",
        ],
    }
    questions = stage_q.get(stage, stage_q["recruiter"])
    # Role/company personalization (no invented facts)
    if company and questions:
        questions = [
            q if company.lower() in q.lower() else q.replace("this company", company)
            for q in questions
        ]

    # One preview answer skeleton — not full coaching
    top_story_hint = supported[0] if supported else (role or "your strongest project")
    preview = (
        f"Hook: For the {role or 'target role'} at {company or 'this company'}, "
        f"I lead with evidence around {top_story_hint}. "
        f"Proof: I would cite a concrete project from my resume with scope, action, and metric. "
        f"Close: That maps directly to what your JD emphasizes."
    )
    if not resume.strip():
        preview = (
            "Upload a resume to personalize this preview. "
            "Paid Sprint unlocks verified Story Bank hooks grounded only in your materials."
        )

    hours = 4 + (2 if stage in ("technical", "panel", "final") else 0)
    if match < 50:
        hours += 3

    return {
        "match_score": match,
        "likely_questions": questions[:5],
        "gaps": (gaps[:3] if gaps else ["Add measurable outcomes to resume bullets"]),
        "supported_highlights": supported[:5],
        "answer_preview": preview,
        "estimated_prep_hours": hours,
        "stage": stage,
        "paid_unlocks": [
            "Full Company Twin research dossier with sources and confidence labels",
            "10–20 probability-ranked adaptive mock questions with follow-ups",
            "Verified Story Bank (never fabricates experience)",
            "Live Sprint mode wired to this opportunity",
            "Post-interview debrief + editable follow-up email draft",
        ],
        "disclaimer": (
            "Diagnostic uses only the company, role, JD, and resume you provided. "
            "We do not invent employer facts or your experience."
        ),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _build_dossier(opp: JobOpportunity) -> dict[str, Any]:
    """Paid dossier: structured, non-fabricating analysis of supplied materials."""
    jd = opp.job_description or ""
    resume = opp.resume_text or ""
    skills = _skill_candidates(jd)
    resume_l = resume.lower()
    evidence = []
    unsupported = []
    for sk in skills:
        # Find a short resume snippet containing the skill
        idx = resume_l.find(sk.lower())
        if idx >= 0:
            start = max(0, idx - 40)
            end = min(len(resume), idx + len(sk) + 80)
            snippet = resume[start:end].replace("\n", " ").strip()
            evidence.append(
                {
                    "requirement": sk,
                    "resume_evidence": snippet,
                    "confidence": "candidate_provided",
                    "label": "supported",
                }
            )
        else:
            unsupported.append(
                {
                    "requirement": sk,
                    "resume_evidence": None,
                    "confidence": "inferred_from_jd",
                    "label": "unsupported_do_not_fabricate",
                    "guidance": "Do not claim this in live answers unless you can verify it.",
                }
            )

    themes = [
        "Role mission and first-90-day impact",
        "Evidence of skills named in the JD",
        "Collaboration / stakeholder management",
        "Delivery under constraints",
        f"Stage focus: {opp.interview_stage}",
    ]

    stage_probs = {
        "recruiter": [
            {"theme": "Motivation & fit", "probability": 0.85},
            {"theme": "Background narrative", "probability": 0.8},
            {"theme": "Compensation / logistics", "probability": 0.55},
        ],
        "technical": [
            {"theme": "System design / architecture", "probability": 0.8},
            {"theme": "Debugging & production ownership", "probability": 0.75},
            {"theme": "Metrics & trade-offs", "probability": 0.7},
        ],
        "behavioral": [
            {"theme": "Conflict & influence", "probability": 0.8},
            {"theme": "Failure & learning", "probability": 0.75},
            {"theme": "Prioritization", "probability": 0.7},
        ],
        "hiring_manager": [
            {"theme": "Impact stories", "probability": 0.85},
            {"theme": "Team fit", "probability": 0.7},
            {"theme": "Role-specific scenarios", "probability": 0.75},
        ],
    }
    probs = stage_probs.get(opp.interview_stage, stage_probs["hiring_manager"])

    interviewers = []
    if opp.interviewer_json:
        try:
            raw = json.loads(opp.interviewer_json)
            for row in raw if isinstance(raw, list) else []:
                interviewers.append(
                    {
                        "name": row.get("name"),
                        "title": row.get("title"),
                        "profile_url": row.get("url") or row.get("profile_url"),
                        "priorities_inference": (
                            "Based only on title/profile URL you supplied — not external scraping."
                            if (row.get("title") or row.get("url"))
                            else "No public profile supplied; no interviewer-specific claims."
                        ),
                        "confidence": "user_supplied" if row.get("name") else "none",
                    }
                )
        except json.JSONDecodeError:
            pass

    return {
        "company_overview": {
            "text": (
                f"Target employer as provided: {opp.company or '(not specified)'}. "
                "No external company facts invented."
            ),
            "confidence": "user_supplied",
            "sources": [],
        },
        "role_requirements": {
            "explicit_skills": skills[:20],
            "implied_skills": [
                s
                for s in skills
                if s.lower()
                in {"leadership", "communication", "stakeholder", "ownership", "roadmap"}
            ][:8],
            "confidence": "inferred_from_jd",
        },
        "resume_mapping": {
            "supported": evidence[:20],
            "unsupported": unsupported[:20],
        },
        "likely_themes": themes,
        "stage_question_probabilities": probs,
        "interviewer_notes": interviewers,
        "business_priorities_from_jd": _skill_candidates(jd)[:8],
        "terminology_from_jd": skills[:12],
        "research_timestamp": datetime.utcnow().isoformat() + "Z",
        "sources": [
            {
                "type": "user_jd",
                "note": "Job description text provided by candidate",
            },
            {
                "type": "user_resume",
                "note": "Resume text provided by candidate",
            },
        ],
        "policy": {
            "no_fabrication": True,
            "unsupported_must_not_be_claimed": True,
        },
    }


def _extract_stories(resume: str, opportunity_id: int | None, user_id: int) -> list[StoryBankItem]:
    """Heuristic STAR chunking — marked draft until user verifies."""
    if not resume.strip():
        return []
    # Split by blank lines / bullets
    chunks = re.split(r"\n\s*\n|•|\n-\s+", resume)
    items: list[StoryBankItem] = []
    for i, ch in enumerate(chunks):
        text = re.sub(r"\s+", " ", ch).strip()
        if len(text) < 80:
            continue
        # crude metric detection
        has_metric = bool(re.search(r"\d+%|\$\d+|\d+\s*(x|X)|million|billion", text))
        title = text[:72] + ("…" if len(text) > 72 else "")
        items.append(
            StoryBankItem(
                user_id=user_id,
                opportunity_id=opportunity_id,
                title=title,
                situation=text[:400],
                task="(complete) What was your responsibility?",
                actions=text[:500],
                result="(complete) What measurable outcome did you drive?"
                if not has_metric
                else text[-200:],
                technologies_json=json.dumps(_skill_candidates(text)[:8]),
                metrics="" if not has_metric else "Metrics mentioned in resume snippet — verify.",
                answers_questions_json=json.dumps(
                    ["Tell me about a relevant project", "Walk me through impact"]
                ),
                confidence=55 if has_metric else 35,
                missing_details=""
                if has_metric
                else "Add quantifiable result and your specific actions.",
                status="pending_review",
                source="resume",
            )
        )
        if len(items) >= 8:
            break
    return items


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class OpportunityIn(BaseModel):
    company: str = ""
    role: str = ""
    job_description: str = ""
    resume_text: str = ""
    interview_stage: InterviewStage = "hiring_manager"
    interview_at: Optional[str] = None
    timezone: str = "UTC"
    duration_minutes: Optional[int] = None
    interviewers: list[dict[str, str]] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    answer_tone: str = "professional"
    answer_length: str = "medium"


class OpportunityOut(BaseModel):
    id: int
    company: str
    role: str
    job_description: str
    resume_text: str
    interview_stage: str
    interview_at: Optional[str] = None
    timezone: str
    duration_minutes: Optional[int] = None
    interviewers: list[dict[str, Any]] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    answer_tone: str
    answer_length: str
    status: str
    readiness_score: Optional[int] = None
    has_diagnostic: bool = False
    has_dossier: bool = False
    created_at: Optional[str] = None


class DiagnosticRequest(BaseModel):
    opportunity_id: Optional[int] = None
    # Minimal path: role + JD only
    company: str = ""
    role: str = ""
    job_description: str = ""
    resume_text: str = ""
    interview_stage: InterviewStage = "hiring_manager"
    source: str = ""


class StoryUpdate(BaseModel):
    title: Optional[str] = None
    situation: Optional[str] = None
    task: Optional[str] = None
    actions: Optional[str] = None
    result: Optional[str] = None
    metrics: Optional[str] = None
    missing_details: Optional[str] = None
    status: Optional[str] = None  # verified | rejected | pending_review


class DebriefIn(BaseModel):
    opportunity_id: int
    kind: Literal["mock", "live"] = "mock"
    turns: list[dict[str, Any]] = Field(default_factory=list)
    readiness_before: Optional[int] = None


class LiveContextOut(BaseModel):
    opportunity_id: int
    role: str
    company: str
    job_description: str
    resume_text: str
    answer_tone: str
    answer_length: str
    verified_stories: list[dict[str, Any]]
    live_minutes_remaining: int


def _serialize_opp(o: JobOpportunity) -> OpportunityOut:
    interviewers = []
    concerns = []
    try:
        interviewers = json.loads(o.interviewer_json or "[]")
    except json.JSONDecodeError:
        pass
    try:
        concerns = json.loads(o.concerns_json or "[]")
    except json.JSONDecodeError:
        pass
    return OpportunityOut(
        id=int(o.id),
        company=o.company or "",
        role=o.role or "",
        job_description=o.job_description or "",
        resume_text=o.resume_text or "",
        interview_stage=o.interview_stage or "hiring_manager",
        interview_at=o.interview_at.isoformat() if o.interview_at else None,
        timezone=o.timezone or "UTC",
        duration_minutes=o.duration_minutes,
        interviewers=interviewers if isinstance(interviewers, list) else [],
        concerns=concerns if isinstance(concerns, list) else [],
        answer_tone=o.answer_tone or "professional",
        answer_length=o.answer_length or "medium",
        status=o.status or "draft",
        readiness_score=o.readiness_score,
        has_diagnostic=bool(o.diagnostic_json),
        has_dossier=bool(o.dossier_json),
        created_at=o.created_at.isoformat() if o.created_at else None,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/entitlements")
async def get_entitlements(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return entitlement_summary(session, user)


@router.get("/opportunities", response_model=list[OpportunityOut])
async def list_opportunities(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[OpportunityOut]:
    rows = list(
        session.exec(select(JobOpportunity).where(JobOpportunity.user_id == user.id)).all()
    )
    rows.sort(key=lambda r: r.updated_at or r.created_at or datetime.min, reverse=True)
    return [_serialize_opp(r) for r in rows]


@router.post("/opportunities", response_model=OpportunityOut)
async def create_opportunity(
    body: OpportunityIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OpportunityOut:
    limit = max_opportunities_allowed(session, user)
    # Free users: allow up to 1 draft for diagnostic
    current = count_user_opportunities(session, int(user.id or 0))
    if current >= max(limit, 1):
        if not user_has_paid_access(session, user) and current >= 1:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": {
                        "code": "opportunity_limit",
                        "message": "Free plan allows one opportunity draft. Purchase a Pass to continue.",
                    }
                },
            )
        if user_has_paid_access(session, user) and current >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": {
                        "code": "opportunity_limit",
                        "message": f"Plan allows {limit} active opportunity(ies). Archive one or upgrade.",
                    }
                },
            )

    interview_at = None
    if body.interview_at:
        try:
            interview_at = datetime.fromisoformat(body.interview_at.replace("Z", ""))
        except ValueError:
            interview_at = None

    opp = JobOpportunity(
        user_id=int(user.id),
        company=(body.company or "").strip()[:200],
        role=(body.role or "").strip()[:200],
        job_description=(body.job_description or "")[:50000],
        resume_text=(body.resume_text or "")[:50000],
        interview_stage=body.interview_stage,
        interview_at=interview_at,
        timezone=(body.timezone or "UTC")[:64],
        duration_minutes=body.duration_minutes,
        interviewer_json=json.dumps(body.interviewers[:10]),
        concerns_json=json.dumps([c[:200] for c in (body.concerns or [])[:5]]),
        answer_tone=(body.answer_tone or "professional")[:40],
        answer_length=(body.answer_length or "medium")[:20],
        status="draft",
    )
    session.add(opp)
    session.commit()
    session.refresh(opp)
    _track(
        session,
        user.id,
        "opportunity_created",
        role_category=(body.role or "")[:40],
        stage=body.interview_stage,
    )
    return _serialize_opp(opp)


@router.get("/opportunities/{opp_id}", response_model=OpportunityOut)
async def get_opportunity(
    opp_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OpportunityOut:
    return _serialize_opp(_opp_owned(session, user, opp_id))


@router.patch("/opportunities/{opp_id}", response_model=OpportunityOut)
async def update_opportunity(
    opp_id: int,
    body: OpportunityIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OpportunityOut:
    opp = _opp_owned(session, user, opp_id)
    opp.company = (body.company or opp.company or "")[:200]
    opp.role = (body.role or opp.role or "")[:200]
    if body.job_description is not None:
        opp.job_description = body.job_description[:50000]
    if body.resume_text is not None:
        opp.resume_text = body.resume_text[:50000]
    opp.interview_stage = body.interview_stage or opp.interview_stage
    opp.timezone = body.timezone or opp.timezone
    opp.duration_minutes = body.duration_minutes
    opp.interviewer_json = json.dumps(body.interviewers[:10])
    opp.concerns_json = json.dumps([c[:200] for c in (body.concerns or [])[:5]])
    opp.answer_tone = body.answer_tone or opp.answer_tone
    opp.answer_length = body.answer_length or opp.answer_length
    opp.updated_at = datetime.utcnow()
    if body.interview_at:
        try:
            opp.interview_at = datetime.fromisoformat(body.interview_at.replace("Z", ""))
        except ValueError:
            pass
    session.add(opp)
    session.commit()
    session.refresh(opp)
    return _serialize_opp(opp)


@router.post("/diagnostic")
async def run_diagnostic(
    body: DiagnosticRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Free diagnostic — real value, not full paid dossier."""
    _track(session, user.id, "diagnostic_started", source=body.source or "")
    company = body.company
    role = body.role
    jd = body.job_description
    resume = body.resume_text
    stage = body.interview_stage
    opp_id = body.opportunity_id

    if body.opportunity_id:
        opp = _opp_owned(session, user, body.opportunity_id)
        company = company or opp.company
        role = role or opp.role
        jd = jd or opp.job_description
        resume = resume or opp.resume_text
        stage = stage or opp.interview_stage  # type: ignore[assignment]
        opp_id = int(opp.id)

    if not (role or "").strip() and not (jd or "").strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "role_or_jd_required",
                    "message": "Enter a target role or paste a job description to run the diagnostic.",
                }
            },
        )

    if (jd or "").strip():
        _track(session, user.id, "jd_supplied")
    if (resume or "").strip():
        _track(session, user.id, "resume_supplied")

    result = _build_diagnostic(
        company=company or "",
        role=role or "",
        jd=jd or "",
        resume=resume or "",
        stage=stage or "hiring_manager",
    )

    # Persist on opportunity if present
    if opp_id:
        opp = _opp_owned(session, user, opp_id)
        opp.diagnostic_json = json.dumps(result)
        opp.readiness_score = result.get("match_score")
        opp.updated_at = datetime.utcnow()
        session.add(opp)
        session.commit()

    _track(
        session,
        user.id,
        "diagnostic_completed",
        match_score=result.get("match_score"),
        role_category=(role or "")[:40],
    )
    return {
        "opportunity_id": opp_id,
        "diagnostic": result,
        "entitlements": entitlement_summary(session, user),
    }


@router.post("/opportunities/{opp_id}/dossier")
async def generate_dossier(
    opp_id: int,
    user: User = Depends(require_paid_access),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if not can_use_feature(session, user, "dossier"):
        raise HTTPException(status_code=402, detail="Payment required for Company Twin dossier")
    opp = _opp_owned(session, user, opp_id)
    dossier = _build_dossier(opp)
    opp.dossier_json = json.dumps(dossier)
    opp.status = "active"
    opp.updated_at = datetime.utcnow()
    session.add(opp)
    session.commit()

    # Auto-extract draft stories if none
    existing = session.exec(
        select(StoryBankItem).where(
            StoryBankItem.user_id == user.id,
            StoryBankItem.opportunity_id == opp_id,
        )
    ).all()
    if not existing and opp.resume_text:
        for st in _extract_stories(opp.resume_text, opp_id, int(user.id)):
            session.add(st)
        session.commit()

    return {"opportunity_id": opp_id, "dossier": dossier}


@router.get("/opportunities/{opp_id}/stories")
async def list_stories(
    opp_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    _opp_owned(session, user, opp_id)
    rows = session.exec(
        select(StoryBankItem).where(
            StoryBankItem.user_id == user.id,
            StoryBankItem.opportunity_id == opp_id,
        )
    ).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "situation": r.situation,
            "task": r.task,
            "actions": r.actions,
            "result": r.result,
            "technologies": json.loads(r.technologies_json or "[]"),
            "metrics": r.metrics,
            "answers_questions": json.loads(r.answers_questions_json or "[]"),
            "confidence": r.confidence,
            "missing_details": r.missing_details,
            "status": r.status,
            "source": r.source,
        }
        for r in rows
    ]


@router.patch("/stories/{story_id}")
async def update_story(
    story_id: int,
    body: StoryUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    st = session.get(StoryBankItem, story_id)
    if not st or st.user_id != user.id:
        raise HTTPException(status_code=404, detail="Story not found")
    for field in ("title", "situation", "task", "actions", "result", "metrics", "missing_details"):
        val = getattr(body, field)
        if val is not None:
            setattr(st, field, val)
    if body.status in ("verified", "rejected", "pending_review", "draft"):
        # Never auto-verify AI extraction without explicit status
        st.status = body.status
    st.updated_at = datetime.utcnow()
    session.add(st)
    session.commit()
    return {"id": st.id, "status": st.status}


@router.post("/opportunities/{opp_id}/mock-plan")
async def mock_plan(
    opp_id: int,
    user: User = Depends(require_paid_access),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Probability-ranked questions for adaptive Company Twin mock."""
    opp = _opp_owned(session, user, opp_id)
    diag = {}
    if opp.diagnostic_json:
        try:
            diag = json.loads(opp.diagnostic_json)
        except json.JSONDecodeError:
            pass
    base = diag.get("likely_questions") or []
    # Expand to 12–15 ranked questions (no fabrication of company secrets)
    extras = [
        f"What would good look like in your first 90 days as {opp.role or 'this role'}?",
        "Walk me through a project where you had incomplete requirements.",
        "How do you decide what not to build?",
        "Tell me about a metric you moved and how you measured it.",
        "Where does your experience not match this JD, and how will you close the gap?",
        "Describe a disagreement with engineering or product and the outcome.",
        "How do you handle production incidents?",
        "What would you ask our team in reverse?",
        f"Why {opp.company or 'us'} versus a similar company?",
        "Explain a technical concept from your resume to a non-expert.",
    ]
    ranked = []
    for i, q in enumerate(list(base) + extras):
        ranked.append(
            {
                "id": f"twin_q_{i+1}",
                "text": q,
                "probability": max(0.35, 0.9 - i * 0.04),
                "category": opp.interview_stage,
                "spoken_text": q,
            }
        )
        if len(ranked) >= 15:
            break
    return {
        "opportunity_id": opp_id,
        "persona": "strict-tech-lead"
        if opp.interview_stage in ("technical", "panel")
        else "behavioral-hr",
        "difficulty": "hard",
        "focus": "mixed",
        "questions": ranked,
        "job_title": f"{opp.role} @ {opp.company}".strip(" @"),
        "intro_script": (
            f"This is your Company Twin mock for {opp.role or 'the role'} "
            f"at {opp.company or 'your target company'}. "
            f"Stage: {opp.interview_stage}. Answer with evidence only from your experience."
        ),
        "closing_script": "Mock complete. Review coaching notes and verify any Story Bank drafts before live.",
    }


@router.get("/opportunities/{opp_id}/live-context", response_model=LiveContextOut)
async def live_context(
    opp_id: int,
    user: User = Depends(require_paid_access),
    session: Session = Depends(get_session),
) -> LiveContextOut:
    from backend.entitlements import live_minutes_remaining

    opp = _opp_owned(session, user, opp_id)
    stories = session.exec(
        select(StoryBankItem).where(
            StoryBankItem.user_id == user.id,
            StoryBankItem.opportunity_id == opp_id,
            StoryBankItem.status == "verified",
        )
    ).all()
    return LiveContextOut(
        opportunity_id=opp_id,
        role=opp.role or "",
        company=opp.company or "",
        job_description=opp.job_description or "",
        resume_text=opp.resume_text or "",
        answer_tone=opp.answer_tone or "professional",
        answer_length=opp.answer_length or "medium",
        verified_stories=[
            {
                "id": s.id,
                "title": s.title,
                "situation": s.situation,
                "task": s.task,
                "actions": s.actions,
                "result": s.result,
                "metrics": s.metrics,
                "confidence": s.confidence,
            }
            for s in stories
        ],
        live_minutes_remaining=live_minutes_remaining(session, user),
    )


@router.post("/debrief")
async def create_debrief(
    body: DebriefIn,
    user: User = Depends(require_paid_access),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    opp = _opp_owned(session, user, body.opportunity_id)
    # Summarize without storing full private transcripts if huge
    turns_safe = []
    strong = []
    weak = []
    for t in (body.turns or [])[:40]:
        q = str(t.get("question") or "")[:500]
        a = str(t.get("answer") or "")[:800]
        scores = t.get("scores") or {}
        overall = int(scores.get("overall") or 0)
        turns_safe.append(
            {
                "question": q,
                "answer_summary": a[:280] + ("…" if len(a) > 280 else ""),
                "overall": overall,
            }
        )
        if overall >= 75:
            strong.append(q)
        elif overall and overall < 55:
            weak.append(q)

    readiness_after = None
    if turns_safe:
        readiness_after = int(
            sum(t["overall"] for t in turns_safe) / max(1, len(turns_safe))
        )
        opp.readiness_score = readiness_after
        opp.updated_at = datetime.utcnow()
        session.add(opp)

    follow_up = (
        f"Subject: Thank you — {opp.role or 'interview'} conversation\n\n"
        f"Dear Hiring Team,\n\n"
        f"Thank you for the conversation about the {opp.role or 'role'} "
        f"at {opp.company or 'your company'}. "
        f"I especially appreciated discussing how my experience maps to your priorities.\n\n"
        f"I am happy to share additional detail on any topic from our discussion.\n\n"
        f"Best regards"
    )

    debrief = {
        "questions_asked": [t["question"] for t in turns_safe],
        "response_summaries": turns_safe,
        "strongest_answers": strong[:5],
        "missed_opportunities": weak[:5],
        "claims_to_verify": [
            "Any metric mentioned verbally but missing from verified Story Bank"
        ],
        "topics_to_review": weak[:3] or ["Revisit JD-critical skills with evidence"],
        "follow_up_email_draft": follow_up,
        "next_round_prep": [
            "Verify Story Bank items marked pending_review",
            "Rehearse top 5 probability-ranked questions",
            "Prepare reverse questions for the panel",
        ],
        "readiness_before": body.readiness_before,
        "readiness_after": readiness_after,
        "readiness_delta": (
            (readiness_after - body.readiness_before)
            if readiness_after is not None and body.readiness_before is not None
            else None
        ),
    }

    sess = SprintSession(
        user_id=int(user.id),
        opportunity_id=int(opp.id),
        kind=body.kind,
        ended_at=datetime.utcnow(),
        readiness_before=body.readiness_before,
        readiness_after=readiness_after,
        debrief_json=json.dumps(debrief),
        turns_json=json.dumps(turns_safe),
    )
    session.add(sess)
    session.commit()
    _track(session, user.id, "debrief_viewed", kind=body.kind)
    return {"session_id": sess.id, "debrief": debrief}


@router.post("/events")
async def track_event(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    name = str(body.get("event") or body.get("event_name") or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=400, detail="Invalid event")
    # Allowlist funnel events
    allowed = {
        "landing_viewed",
        "diagnostic_started",
        "jd_supplied",
        "resume_supplied",
        "diagnostic_completed",
        "paywall_viewed",
        "checkout_started",
        "purchase_completed",
        "first_mock_completed",
        "first_live_started",
        "debrief_viewed",
        "referral_shared",
        "subscription_renewed",
        "subscription_canceled",
    }
    if name not in allowed:
        raise HTTPException(status_code=400, detail="Event not allowed")
    _track(
        session,
        user.id,
        name,
        source=str(body.get("source") or "")[:40],
        role_category=str(body.get("role_category") or "")[:40],
    )
    return {"ok": "true"}


class ConsumeMinutesIn(BaseModel):
    minutes: int = Field(default=1, ge=1, le=60)
    opportunity_id: Optional[int] = None


@router.post("/live-minutes/consume")
async def consume_minutes(
    body: ConsumeMinutesIn,
    user: User = Depends(require_paid_access),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Server-side live minute meter (call when a live session starts / every N minutes)."""
    from backend.entitlements import consume_live_minutes

    if body.opportunity_id:
        _opp_owned(session, user, body.opportunity_id)
    return consume_live_minutes(
        session,
        user,
        body.minutes,
        opportunity_id=body.opportunity_id,
    )


@router.get("/readiness-report")
async def readiness_report(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Privacy-safe shareable readiness summary (no JD/resume/transcripts)."""
    import secrets

    if not user.referral_code:
        user.referral_code = secrets.token_urlsafe(8)[:12]
        session.add(user)
        session.commit()
        session.refresh(user)

    opps = session.exec(
        select(JobOpportunity).where(JobOpportunity.user_id == user.id)
    ).all()
    sessions = session.exec(
        select(SprintSession).where(SprintSession.user_id == user.id)
    ).all()
    scores = [o.readiness_score for o in opps if o.readiness_score is not None]
    overall = int(sum(scores) / len(scores)) if scores else 0
    first = min((s.readiness_before or 0) for s in sessions) if sessions else 0
    last = max((s.readiness_after or 0) for s in sessions) if sessions else overall
    improvement = max(0, last - first) if sessions else 0

    return {
        "overall_readiness": overall,
        "improvement_points": improvement,
        "completed_practice_sessions": len(sessions),
        "skill_categories": ["Communication", "Evidence", "Role fit", "Technical depth"],
        "anonymous_badge": f"Readiness {overall}/100 · {len(sessions)} sessions",
        "referral_code": user.referral_code,
        "referral_link": f"{settings.FRONTEND_URL.rstrip('/')}/#/sprint?ref={user.referral_code}",
        "policy": "No resume, transcripts, company names, or answers included.",
    }


class ReferralClaimIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)


@router.post("/referral/claim")
async def claim_referral(
    body: ReferralClaimIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Attribute referral + grant configurable free practice minutes to both users."""
    import os

    from backend.entitlements import grant_entitlement
    from backend.products import ProductDef

    code = (body.code or "").strip()
    if not code or code == (user.referral_code or ""):
        raise HTTPException(status_code=400, detail="Invalid referral code")
    if user.referred_by_user_id:
        raise HTTPException(status_code=400, detail="Referral already claimed")

    referrer = session.exec(select(User).where(User.referral_code == code)).first()
    if not referrer or referrer.id == user.id:
        raise HTTPException(status_code=404, detail="Referral code not found")

    user.referred_by_user_id = referrer.id
    session.add(user)
    session.commit()

    minutes = int(os.environ.get("REFERRAL_BONUS_MINUTES", "30") or "30")
    # Synthetic free product for bonus minutes (not in public catalog)
    bonus = ProductDef(
        code="referral_bonus",
        name="Referral bonus",
        description="Referral practice minutes",
        price_cents=0,
        currency="usd",
        billing_mode="free",
        stripe_price_id="",
        duration_hours=24 * 30,
        live_minutes=minutes,
        max_opportunities=0,
        unlimited_mocks=True,
        features=["referral"],
        sort_order=99,
        active=False,
    )
    grant_entitlement(session, user, bonus)
    grant_entitlement(session, referrer, bonus)
    _track(session, user.id, "referral_shared", source="claim")
    return {"ok": True, "bonus_live_minutes": minutes}


@router.get("/account/export")
async def export_account(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """GDPR-style export of account Sprint data (user-owned only)."""
    opps = session.exec(
        select(JobOpportunity).where(JobOpportunity.user_id == user.id)
    ).all()
    stories = session.exec(
        select(StoryBankItem).where(StoryBankItem.user_id == user.id)
    ).all()
    return {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "plan_code": user.plan_code,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "opportunities": [
            {
                "id": o.id,
                "company": o.company,
                "role": o.role,
                "interview_stage": o.interview_stage,
                "status": o.status,
                "readiness_score": o.readiness_score,
                # Full materials included because this is the owner's export
                "job_description": o.job_description,
                "resume_text": o.resume_text,
            }
            for o in opps
        ],
        "stories": [
            {
                "id": s.id,
                "title": s.title,
                "situation": s.situation,
                "task": s.task,
                "actions": s.actions,
                "result": s.result,
                "status": s.status,
            }
            for s in stories
        ],
    }


@router.delete("/account/data")
async def delete_account_sprint_data(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Delete Sprint opportunities, stories, sessions for this user (not the account row)."""
    uid = int(user.id or 0)
    n_s = 0
    for s in session.exec(select(StoryBankItem).where(StoryBankItem.user_id == uid)).all():
        session.delete(s)
        n_s += 1
    n_sess = 0
    for s in session.exec(select(SprintSession).where(SprintSession.user_id == uid)).all():
        session.delete(s)
        n_sess += 1
    n_o = 0
    for o in session.exec(select(JobOpportunity).where(JobOpportunity.user_id == uid)).all():
        session.delete(o)
        n_o += 1
    session.commit()
    return {
        "ok": True,
        "deleted": {"stories": n_s, "sessions": n_sess, "opportunities": n_o},
    }
