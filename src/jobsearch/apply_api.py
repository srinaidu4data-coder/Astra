"""AI Apply Studio API routes — human-in-the-loop only."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION, _clean_profile
from jobsearch.apply_engine import (
    PRODUCT_APPLY_VERSION,
    batch_prepare,
    build_apply_packet,
    build_apply_queue,
)
from jobsearch.auto_apply import (
    AUTO_APPLY_VERSION,
    build_auto_apply_campaign,
    log_auto_apply_step,
)
from jobsearch.browser_apply import BROWSER_APPLY_VERSION, apply_one, _playwright_available
from jobsearch.form_pack import (
    FORM_PACK_VERSION,
    build_base_extension_store,
    build_form_pack,
    pack_to_extension_json,
)
from jobsearch.one_click_apply import ONE_CLICK_VERSION, one_click_auto_apply
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id, rate_limiter

# Reuse lab gate from main api
from jobsearch.api import _client_key, _lab_enabled, _require_lab, _request_id

router = APIRouter(prefix="/api/jobsearch/apply", tags=["jobsearch-apply"])


class ProfileIn(BaseModel):
    name: Optional[str] = None
    target_title: Optional[str] = "Software Engineer"
    summary: Optional[str] = ""
    skills: list[str] = Field(default_factory=list)
    resume_text: Optional[str] = None
    has_resume: bool = False
    resume_filename: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    location: Optional[str] = None
    years_experience: Optional[str] = None
    work_authorization: Optional[str] = None


class JobIn(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None
    url: Optional[str] = None
    apply_url: Optional[str] = None
    indeed_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    text: Optional[str] = None
    scores: Optional[dict[str, Any]] = None
    is_synthetic: bool = False
    product_label: Optional[str] = None
    title_hits: Optional[int] = None
    gap_skills: list[str] = Field(default_factory=list)


class QueueRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    budget: int = Field(default=8, ge=1, le=25)
    source_stats: Optional[dict[str, dict[str, int]]] = None


class PrepareRequest(BaseModel):
    profile: ProfileIn
    job: JobIn


class BatchRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    job_ids: Optional[list[str]] = None
    budget: int = Field(default=8, ge=1, le=25)


class ConfirmRequest(BaseModel):
    job_id: str
    status: str = "applied"  # applied | skipped | shortlisted
    note: Optional[str] = None


class AutoApplyRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    budget: int = Field(default=10, ge=1, le=25)
    delay_ms: int = Field(default=2500, ge=800, le=15000)
    include_prepare: bool = True
    forge: bool = True


class AutoApplyStepRequest(BaseModel):
    campaign_id: str
    job_id: str
    status: str = "applied"
    note: Optional[str] = None


class OneClickRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    min_score: float = Field(default=0.0, ge=0, le=100)
    min_grade: str = "F"
    budget: int = Field(default=4, ge=1, le=15)
    submit: bool = True  # True = real auto-apply click Submit
    headless: bool = True
    # Match one_click_auto_apply / Tailor RT path (inject-aligned cover + forged resume)
    forge: bool = True
    delay_sec: float = Field(default=0.6, ge=0.0, le=10)
    # Soft by default: apply user's shortlist; strict = career-ops grade gate
    strict_gate: bool = False
    # Spend budget on public forms first (not LinkedIn Easy Apply theater)
    prefer_auto_forms: bool = True
    # Multi-pack Apply Kit (extension-store). When omitted and use_form_store,
    # server synthesizes packs from Tailor RT steps (no second forge).
    form_store: Optional[dict[str, Any]] = None
    use_form_store: bool = True
    # Kit ranking: True (default) demotes soft same-board packs below cold ATS
    # so sibling materials do not steal budget. False = soft before cold.
    strict_soft: bool = True


class BrowserApplyOneRequest(BaseModel):
    profile: ProfileIn
    url: str
    submit: bool = True
    headless: bool = True
    cover_note: Optional[str] = ""
    # Multi-pack Apply Kit — URL-matched fill (same select_job_pack_for_page as extension)
    form_store: Optional[dict[str, Any]] = None
    # Join keys for metrics/audit (sequential UI path used to omit these)
    job_id: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None


def _profile_dict(p: ProfileIn) -> dict[str, Any]:
    d = p.model_dump()
    return _clean_profile(d)


def _job_dict(j: JobIn) -> dict[str, Any]:
    d = j.model_dump()
    if not d.get("id"):
        d["id"] = f"job-{(d.get('title') or 'x')[:20]}-{(d.get('company') or '')[:12]}"
    return d


@router.get("/health")
def apply_health(request: Request, response: Response) -> dict[str, Any]:
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    pw = _playwright_available()
    return {
        "ok": True,
        "feature": "ai_apply_studio",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "apply_version": PRODUCT_APPLY_VERSION,
        "auto_apply_version": AUTO_APPLY_VERSION,
        "browser_apply_version": BROWSER_APPLY_VERSION,
        "one_click_version": ONE_CLICK_VERSION,
        "form_pack_version": FORM_PACK_VERSION,
        "grade": PRODUCT_GRADE,
        "mode": "one_click_browser_auto_apply",
        "playwright": pw,
        "extension": "astra-apply-kit",
        "auto_open_urls": True,
        "auto_submit_ats": pw,  # real form submit when Playwright installed
        "auto_submit": pw,
        "honesty": (
            "One-click AI Auto Apply uses Playwright to fill ATS forms and can click Submit. "
            "CAPTCHA/login walls may still need you. Localhost lab only."
        ),
        "math_stack": [
            "MMR",
            "secretary_threshold",
            "EV",
            "softmax",
            "Thompson",
            "Bayesian readiness",
            "ATS coverage",
            "knapsack",
            "resume_forge",
            "playwright_form_fill",
        ],
        "request_id": rid,
        "lab_enabled": _lab_enabled(request),
    }


@router.post("/one-click")
def apply_one_click(
    body: OneClickRequest, request: Request, response: Response
) -> dict[str, Any]:
    """
    Single-click AI Auto Apply: gate → tailor → browser fill → optional Submit.
    """
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    if not body.jobs:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "jobs_required",
                    "message": "Search first, then one-click apply.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in body.jobs]
    try:
        result = one_click_auto_apply(
            profile,
            jobs,
            min_score=body.min_score,
            min_grade=body.min_grade,
            budget=body.budget,
            submit=body.submit,
            headless=body.headless,
            forge=body.forge,
            delay_sec=body.delay_sec,
            strict_gate=bool(body.strict_gate),
            prefer_auto_forms=bool(body.prefer_auto_forms),
            form_store=body.form_store if isinstance(body.form_store, dict) else None,
            use_form_store=bool(body.use_form_store),
            strict_soft=bool(body.strict_soft),
        )
    except Exception as e:
        ent_metrics().incr("one_click.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "one_click_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
        ) from e
    result["request_id"] = rid
    # Lab KPI: record ATS outcomes for metrics dashboard
    try:
        from jobsearch.apply_metrics import record_batch

        br = (result.get("browser") or {}).get("results") or []
        if br:
            result["metrics"] = record_batch(br)
    except Exception as e:
        # Fail loud in payload (lab truth plane) — do not hide KPI write failures
        result["metrics_error"] = str(e)[:200]
    return result


@router.get("/metrics")
def apply_metrics_snapshot(request: Request, response: Response) -> dict[str, Any]:
    """Lab ATS success metrics (JSON KPI dashboard)."""
    from jobsearch.apply_metrics import snapshot

    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    out = snapshot()
    out["request_id"] = rid
    return out


@router.post("/metrics/reset")
def apply_metrics_reset(request: Request, response: Response) -> dict[str, Any]:
    from jobsearch.apply_metrics import reset_metrics

    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    out = reset_metrics()
    out["request_id"] = rid
    return out


@router.post("/browser")
def apply_browser_one(
    body: BrowserApplyOneRequest, request: Request, response: Response
) -> dict[str, Any]:
    """Apply to a single URL via Playwright (optional multi-pack form_store)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    profile = _profile_dict(body.profile)
    if body.cover_note:
        profile["cover_note"] = body.cover_note
    store = body.form_store if isinstance(body.form_store, dict) else None
    out = apply_one(
        body.url,
        profile,
        submit=body.submit,
        headless=body.headless,
        cover_note=body.cover_note or "",
        form_store=store,
        job_id=body.job_id,
        title=body.title,
        company=body.company,
    )
    out["request_id"] = rid
    # Prefer request identity if engine omitted
    if body.job_id and not out.get("job_id"):
        out["job_id"] = body.job_id
    if body.title and not out.get("title"):
        out["title"] = body.title
    if body.company and not out.get("company"):
        out["company"] = body.company
    if store is not None:
        out["form_store_used"] = True
        out["form_store_packs"] = len(store.get("job_packs") or [])
    try:
        from jobsearch.apply_metrics import record_attempt

        fpm = out.get("form_pack_match") if isinstance(out.get("form_pack_match"), dict) else {}
        pack_id = str(fpm.get("job_id") or fpm.get("pack_id") or out.get("job_id") or "")[:80]
        sc = out.get("submit_click")
        metrics = record_attempt(
            status=str(out.get("status") or ""),
            submitted=bool(out.get("submitted")),
            filled_fields=out.get("filled_fields")
            if isinstance(out.get("filled_fields"), list)
            else None,
            ats=out.get("ats"),
            job_title=out.get("title") or body.title,
            company=out.get("company") or body.company,
            url=body.url,
            reason=out.get("error") or out.get("message"),
            pack_id=pack_id or None,
            latency_ms=out.get("elapsed_ms"),
            resume_uploaded=bool(out.get("resume_uploaded")),
            submit_click=bool(sc) if sc is not None else None,
        )
        out["metrics"] = metrics
        # Surface ledger demotion (e.g. duplicate) so UI does not claim submitted
        if metrics.get("deduped") or (
            metrics.get("bucket") == "skipped" and out.get("submitted")
        ):
            out["ledger_status"] = metrics.get("raw_status") or metrics.get("bucket")
            out["ledger_bucket"] = metrics.get("bucket")
            if metrics.get("deduped"):
                out["submitted"] = False
                out["status"] = "duplicate"
                out["error"] = (
                    (out.get("error") or "")
                    + " Duplicate URL within window — not counted as submitted."
                ).strip()
    except Exception as e:
        out["metrics_error"] = str(e)[:200]
    return out


@router.post("/auto")
def apply_auto_campaign(
    body: AutoApplyRequest, request: Request, response: Response
) -> dict[str, Any]:
    """Plan a full auto-apply campaign (client runner opens URLs)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    if not body.jobs:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "jobs_required",
                    "message": "Pass ranked_jobs from a search run.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in body.jobs]
    try:
        plan = build_auto_apply_campaign(
            profile,
            jobs,
            budget=body.budget,
            has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
            delay_ms=body.delay_ms,
            include_prepare=body.include_prepare,
            forge=body.forge,
        )
    except Exception as e:
        ent_metrics().incr("auto_apply.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "auto_apply_failed",
                    "message": str(e)[:200],
                    "request_id": rid,
                }
            },
        ) from e
    plan["request_id"] = rid
    plan["campaign_id"] = rid
    ent_metrics().incr("auto_apply.ok")
    return plan


@router.post("/auto/step")
def apply_auto_step(
    body: AutoApplyStepRequest, request: Request, response: Response
) -> dict[str, Any]:
    """Log one auto-apply step (opened / applied / skipped)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    out = log_auto_apply_step(
        campaign_id=body.campaign_id,
        job_id=body.job_id,
        status=body.status,
        note=body.note or "",
    )
    out["request_id"] = rid
    return out


@router.post("/queue")
def apply_queue(body: QueueRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(status_code=429, detail={"error": {"code": "rate_limited", "request_id": rid}})
    if not body.jobs:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "jobs_required",
                    "message": "Pass ranked_jobs from a search run.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in body.jobs]
    try:
        result = build_apply_queue(
            profile,
            jobs,
            budget=body.budget,
            has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
            source_stats=body.source_stats,
        )
    except Exception as e:
        ent_metrics().incr("apply.queue.error")
        raise HTTPException(
            status_code=500,
            detail={"error": {"code": "apply_queue_failed", "message": str(e)[:200], "request_id": rid}},
        ) from e
    result["request_id"] = rid
    ent_metrics().incr("apply.queue.ok")
    return result


@router.post("/prepare")
def apply_prepare(body: PrepareRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    profile = _profile_dict(body.profile)
    job = _job_dict(body.job)
    packet = build_apply_packet(
        profile,
        job,
        has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
    )
    ent_metrics().incr("apply.prepare.ok")
    return {
        "ok": True,
        "request_id": rid,
        "version": PRODUCT_APPLY_VERSION,
        "packet": packet,
    }


@router.post("/batch")
def apply_batch(body: BatchRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(status_code=429, detail={"error": {"code": "rate_limited", "request_id": rid}})
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in body.jobs]
    result = batch_prepare(
        profile,
        jobs,
        job_ids=body.job_ids,
        has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
        budget=body.budget,
    )
    result["request_id"] = rid
    return result


@router.post("/confirm")
def apply_confirm(body: ConfirmRequest, request: Request, response: Response) -> dict[str, Any]:
    """
    Record user confirmation only — no remote submission.
    Client also writes localStorage tracker; this endpoint is for metrics/audit.
    """
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    status = (body.status or "applied").lower().strip()
    if status not in ("applied", "skipped", "shortlisted", "interview", "offer", "rejected"):
        status = "applied"
    ent_metrics().incr(f"apply.confirm.{status}")
    return {
        "ok": True,
        "request_id": rid,
        "job_id": body.job_id,
        "status": status,
        "note": (body.note or "")[:500],
        "message": "Logged locally. No form was submitted to any employer.",
        "auto_submit": False,
    }


class FormPackRequest(BaseModel):
    profile: ProfileIn
    job: Optional[JobIn] = None
    forge: bool = True
    inject_budget: int = Field(default=8, ge=0, le=20)
    use_tailor_rt: bool = True
    max_rt_rounds: int = Field(default=3, ge=1, le=5)


class TailorRTRequest(BaseModel):
    profile: ProfileIn
    job: JobIn
    max_rounds: int = Field(default=3, ge=1, le=5)
    inject_budget: int = Field(default=8, ge=0, le=20)
    min_ats: float = Field(default=0.35, ge=0.0, le=1.0)
    min_overall: float = Field(default=0.62, ge=0.0, le=1.0)


class TailorRTBatchRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=12)
    max_rounds: int = Field(default=2, ge=1, le=5)
    inject_budget: int = Field(default=8, ge=0, le=20)


class ExtensionStoreRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    forge_top: int = Field(default=3, ge=0, le=10)


@router.post("/form-pack")
def apply_form_pack(
    body: FormPackRequest, request: Request, response: Response
) -> dict[str, Any]:
    """
    AI-tailored resume + complete ATS answer kit for one job.
    Used by Playwright apply and the Astra Apply Kit Chrome extension.
    """
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    profile = _profile_dict(body.profile)
    job = _job_dict(body.job) if body.job else {}
    try:
        pack = build_form_pack(
            profile,
            job or None,
            forge=bool(body.forge),
            inject_budget=int(body.inject_budget or 8),
            use_tailor_rt=bool(body.use_tailor_rt),
            max_rt_rounds=int(body.max_rt_rounds or 3),
        )
    except Exception as e:
        ent_metrics().incr("form_pack.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "form_pack_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
        ) from e
    pack["request_id"] = rid
    ent_metrics().incr("form_pack.ok")
    return pack


@router.post("/extension-store")
def apply_extension_store(
    body: ExtensionStoreRequest, request: Request, response: Response
) -> dict[str, Any]:
    """
    Bundle for Chrome extension: base profile + tailored packs for top jobs.
    Extension calls this on localhost (or user pastes JSON).
    """
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    # CORS-friendly for extension content scripts hitting localhost
    response.headers["Access-Control-Allow-Origin"] = "*"
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in (body.jobs or [])]
    store = build_base_extension_store(
        profile, jobs, forge_top=int(body.forge_top or 3)
    )
    store["request_id"] = rid
    store["export_json"] = pack_to_extension_json(store)
    ent_metrics().incr("extension_store.ok")
    return store


@router.post("/tailor-rt")
def apply_tailor_rt(
    body: TailorRTRequest, request: Request, response: Response
) -> dict[str, Any]:
    """
    Multi-agent resume tailoring with validation loop (Tailor RT).

    Agents: JD Analyst → Evidence → Tailor → Validator (retry until pass / max rounds).
    Inspired by GARY / ApplyPilot / Tailr patterns; deterministic + authenticity-safe.
    """
    from jobsearch.tailor_rt import run_tailor_rt

    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    profile = _profile_dict(body.profile)
    job = _job_dict(body.job)
    if not (job.get("title") or job.get("text")):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "job_required",
                    "message": "Pass a job with title and/or text (JD).",
                    "request_id": rid,
                }
            },
        )
    try:
        result = run_tailor_rt(
            profile,
            job,
            max_rounds=int(body.max_rounds or 3),
            inject_budget=int(body.inject_budget or 8),
            min_ats=float(body.min_ats),
            min_overall=float(body.min_overall),
        )
    except Exception as e:
        ent_metrics().incr("tailor_rt.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "tailor_rt_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
        ) from e
    result["request_id"] = rid
    ent_metrics().incr("tailor_rt.ok" if result.get("passed") else "tailor_rt.fail")
    return result


@router.post("/tailor-rt/batch")
def apply_tailor_rt_batch(
    body: TailorRTBatchRequest, request: Request, response: Response
) -> dict[str, Any]:
    """Batch Tailor RT for top shortlist jobs (validator scores each variant)."""
    from jobsearch.tailor_rt import tailor_rt_batch

    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    if not body.jobs:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "jobs_required",
                    "message": "Pass ranked jobs from Search.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile_dict(body.profile)
    jobs = [_job_dict(j) for j in body.jobs]
    result = tailor_rt_batch(
        profile,
        jobs,
        limit=int(body.limit or 5),
        max_rounds=int(body.max_rounds or 2),
        inject_budget=int(body.inject_budget or 8),
    )
    result["request_id"] = rid
    ent_metrics().incr("tailor_rt.batch")
    return result


@router.options("/extension-store")
@router.options("/form-pack")
@router.options("/tailor-rt")
@router.options("/tailor-rt/batch")
def apply_extension_cors(response: Response) -> dict[str, Any]:
    """Preflight for browser extension → localhost API."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Request-Id"
    return {"ok": True}
