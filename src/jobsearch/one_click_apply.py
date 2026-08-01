"""
One-Click Auto Apply — Karpathy loop.

Measure: submitted + filled forms. Opening LinkedIn is not "applying".

Pipeline:
  enrich → rank by form-fillability → tailor cover → Playwright fill+submit
"""

from __future__ import annotations

import time
from typing import Any

from jobsearch.autofill import build_autofill_profile
from jobsearch.browser_apply import (
    HARD_LOGIN_ATS,
    _playwright_available,
    detect_ats,
    execute_auto_apply_batch,
    is_fillable_ats,
    is_high_confidence_ats,
)
from jobsearch.contracts import err_result
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id
from jobsearch.form_pack import (
    _pack_apply_url,
    form_store_from_apply_steps,
    has_url_id_token_match,
    select_job_pack_for_page,
)
from jobsearch.job_model import is_synthetic_job
from jobsearch.nexus_pipeline import (
    stage_enrich,
    stage_score,
    stage_tailor_and_cover,
)

ONE_CLICK_VERSION = "2.3.3-karpathy"

# Strong kit tier (id/path token). Fill still uses select_job_pack min=50.
# Soft same-board host+slug (~50) is a separate lower tier so it cannot outrank
# true id matches for sequential budget, even if soft threshold is used.
KIT_RANK_MIN_URL_SCORE = 70
KIT_SOFT_MIN_URL_SCORE = 50
# kit_match_tier: 0=id/strong, 1=soft, 2=none
KIT_TIER_ID = 0
KIT_TIER_SOFT = 1
KIT_TIER_NONE = 2


def kit_sort_tier(tier: int, *, strict_soft: bool = True) -> int:
    """
    Map kit_match_tier → sort key.
    Default strict_soft: id (0) → none/cold (1) → soft (2).
    Soft sibling packs often mis-fill; prefer clean cold ATS over wrong kit materials.
    Non-strict: id (0) → soft (1) → none (2).
    """
    t = int(tier)
    if not strict_soft:
        return t
    if t == KIT_TIER_ID:
        return 0
    if t == KIT_TIER_NONE:
        return 1
    if t == KIT_TIER_SOFT:
        return 2
    return t


def count_kit_tiers_for_jobs(
    form_store: dict[str, Any] | None,
    jobs: list[dict[str, Any]] | None,
    *,
    min_strong: int = KIT_RANK_MIN_URL_SCORE,
    min_soft: int = KIT_SOFT_MIN_URL_SCORE,
) -> dict[str, int]:
    """
    Count Apply Kit id/soft matches among shortlist (or step) jobs.
    Returns kit_id, kit_soft, kit_matched (= id+soft). O(jobs * packs).
    """
    id_n = 0
    soft_n = 0
    if not isinstance(form_store, dict) or not (form_store.get("job_packs") or []):
        return {"kit_id": 0, "kit_soft": 0, "kit_matched": 0}
    for j in jobs or []:
        if not isinstance(j, dict):
            continue
        u = _job_apply_url(j)
        if not u.startswith("http"):
            continue
        tier = kit_match_tier(
            form_store, u, min_strong=min_strong, min_soft=min_soft
        )
        if tier == KIT_TIER_ID:
            id_n += 1
        elif tier == KIT_TIER_SOFT:
            soft_n += 1
    return {
        "kit_id": id_n,
        "kit_soft": soft_n,
        "kit_matched": id_n + soft_n,
    }


def count_kit_tiers_from_batch(batch: dict[str, Any] | None) -> dict[str, int] | None:
    """
    Count id/soft from Playwright result form_pack_match (fill-time truth).
    Returns None when no results expose match meta (caller keeps shortlist counts).
    """
    if not isinstance(batch, dict):
        return None
    results = batch.get("results") or []
    if not results:
        return None
    id_n = 0
    soft_n = 0
    saw = False
    for r in results:
        if not isinstance(r, dict):
            continue
        m = r.get("form_pack_match")
        if not isinstance(m, dict):
            continue
        saw = True
        kind = str(m.get("match_kind") or "").lower()
        score = int(m.get("score") or 0)
        if kind == "id" or m.get("id_token") is True:
            id_n += 1
        elif kind == "soft" or m.get("id_token") is False:
            soft_n += 1
        elif score >= KIT_RANK_MIN_URL_SCORE:
            id_n += 1
        elif score >= KIT_SOFT_MIN_URL_SCORE and str(m.get("reason") or "") == "url":
            soft_n += 1
    if not saw:
        return None
    return {
        "kit_id": id_n,
        "kit_soft": soft_n,
        "kit_matched": id_n + soft_n,
    }


def _ats_priority(url: str) -> int:
    ats = detect_ats(url)
    if ats in ("greenhouse", "lever", "ashby", "freshteam"):
        return 0
    if ats in ("workable", "bamboohr", "generic", "smartrecruiters"):
        return 1
    if ats in HARD_LOGIN_ATS:
        return 90
    if ats in ("workday", "icims", "oracle"):
        return 6
    return 4


def _job_apply_url(job: dict[str, Any]) -> str:
    return str(job.get("apply_url") or job.get("url") or "").strip()


def job_has_form_store_url_match(
    form_store: dict[str, Any] | None,
    page_url: str | None,
    *,
    min_url_score: int = 50,
) -> bool:
    """True when Apply Kit has a job_pack URL-matched to page_url (reason=url)."""
    if not isinstance(form_store, dict) or not str(page_url or "").strip():
        return False
    if not (form_store.get("job_packs") or []):
        return False
    _pack, reason, score = select_job_pack_for_page(
        form_store, page_url, min_url_score=min_url_score
    )
    return reason == "url" and int(score or 0) >= min_url_score


def kit_match_tier(
    form_store: dict[str, Any] | None,
    page_url: str | None,
    *,
    min_strong: int = KIT_RANK_MIN_URL_SCORE,
    min_soft: int = KIT_SOFT_MIN_URL_SCORE,
) -> int:
    """
    Apply Kit match strength for ranking.
    0 = id/path strong match, 1 = soft same-board only, 2 = none.
    Soft never ranks above strong id matches (budget protection).
    """
    if not isinstance(form_store, dict) or not str(page_url or "").strip():
        return KIT_TIER_NONE
    if not (form_store.get("job_packs") or []):
        return KIT_TIER_NONE
    soft_floor = min(int(min_soft), int(min_strong))
    # Never classify soft host+slug (~50) as strong just because caller lowered min_strong
    strong_floor = max(int(min_strong), KIT_RANK_MIN_URL_SCORE)
    pack, reason, score = select_job_pack_for_page(
        form_store, page_url, min_url_score=soft_floor
    )
    if reason != "url" or pack is None or int(score or 0) < soft_floor:
        return KIT_TIER_NONE
    jid = str(
        pack.get("job_id")
        or (
            (pack.get("job") or {}).get("id")
            if isinstance(pack.get("job"), dict)
            else ""
        )
        or ""
    ).strip()
    pack_url = _pack_apply_url(pack)
    sc = int(score or 0)
    strong = has_url_id_token_match(page_url, pack_url, jid or None) or sc >= strong_floor
    return KIT_TIER_ID if strong else KIT_TIER_SOFT


def rank_jobs_for_apply(
    jobs: list[dict[str, Any]],
    *,
    form_store: dict[str, Any] | None = None,
    min_url_score: int = KIT_RANK_MIN_URL_SCORE,
    min_soft_score: int = KIT_SOFT_MIN_URL_SCORE,
    strict_soft: bool = True,
) -> list[dict[str, Any]]:
    """
    Order jobs for auto-apply shortlist.

    When form_store has job_packs (mirrors UI rankJobsForApply):
      - strong URL id/path matches first
      - strict_soft=True (default): cold/no-match before soft same-board
        (soft packs often mis-fill sibling listings)
      - strict_soft=False: soft same-board before cold
    Soft never outranks id matches. Within a sort tier: ATS priority, then
    -ensemble. Without a kit: pure ATS + ensemble.
    """
    list_in = [j for j in (jobs or []) if isinstance(j, dict)]
    if not list_in:
        return []
    use_kit = bool(
        isinstance(form_store, dict) and (form_store.get("job_packs") or [])
    )
    # Cache URL → kit tier so multi-key sorts stay O(jobs * packs) once
    tier_cache: dict[str, int] = {}

    def _kit_tier(j: dict[str, Any]) -> int:
        if not use_kit:
            return KIT_TIER_NONE
        u = _job_apply_url(j)
        if not u.startswith("http"):
            return KIT_TIER_NONE
        if u not in tier_cache:
            tier_cache[u] = kit_match_tier(
                form_store,
                u,
                min_strong=min_url_score,
                min_soft=min_soft_score,
            )
        return tier_cache[u]

    def _key(j: dict[str, Any]) -> tuple[int, int, float]:
        u = _job_apply_url(j)
        score = float(
            (j.get("scores") or {}).get("ensemble")
            or j.get("nexus_score")
            or 0
        )
        return (
            kit_sort_tier(_kit_tier(j), strict_soft=strict_soft),
            _ats_priority(u),
            -score,
        )

    return sorted(list_in, key=_key)


def one_click_auto_apply(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    min_score: float = 0.0,
    min_grade: str = "F",
    budget: int = 8,
    submit: bool = True,
    headless: bool = True,
    forge: bool = True,
    delay_sec: float = 0.6,
    strict_gate: bool = False,
    prefer_auto_forms: bool = True,
    form_store: dict[str, Any] | None = None,
    use_form_store: bool = True,
    strict_soft: bool = True,
) -> dict[str, Any]:
    """
    Autonomous apply entrypoint.

    prefer_auto_forms=True (default): spend budget on public forms first;
    LinkedIn/Indeed only if nothing else is left (and never claimed as submitted).

    forge=True (default): stage_tailor_and_cover uses Tailor RT via tailor_materials
    so cover_note / star_bullets / forged_resume share inject-aligned keywords with
    auto_apply and nexus (resolve_cover_and_injects).

    form_store / use_form_store: pass a multi-pack Apply Kit into Playwright batch
    so fill uses select_job_pack_for_page (URL match). When use_form_store and no
    store is given, synthesize one from prepared steps (no second Tailor RT pass).

    When caller form_store has job_packs, shortlist ranking prefers strong
    URL-matched kit jobs first (same policy as UI rankJobsForApply). Soft
    same-board matches are demoted below cold ATS when strict_soft=True (default)
    so sibling pack materials do not steal budget.
    """
    t0 = time.perf_counter()
    rid = new_request_id()
    budget = max(1, min(int(budget or 8), 12))
    # Product default: actually try to submit
    submit = bool(submit)

    if not jobs:
        return err_result(
            "jobs_required",
            "Search for live jobs first, then run Auto Apply.",
            request_id=rid,
            version=ONE_CLICK_VERSION,
        )

    profile = dict(profile or {})
    if not profile.get("email"):
        return err_result(
            "email_required",
            "Add your email before auto-apply (forms need it).",
            request_id=rid,
            version=ONE_CLICK_VERSION,
        )

    # Default resume text so file upload always has content
    if not profile.get("resume_text"):
        skills = profile.get("skills") or []
        if isinstance(skills, list):
            sk = ", ".join(str(s) for s in skills[:12])
        else:
            sk = str(skills)
        profile["resume_text"] = (
            f"{profile.get('name') or 'Candidate'}\n"
            f"{profile.get('target_title') or 'Software Engineer'}\n"
            f"Email: {profile.get('email')}\n"
            f"Phone: {profile.get('phone') or ''}\n"
            f"Skills: {sk}\n"
            f"{profile.get('summary') or 'Experienced engineer seeking new opportunities.'}\n"
        )

    live_in = [j for j in jobs if not is_synthetic_job(j)]
    if not live_in:
        return err_result(
            "no_live_jobs",
            "Only practice jobs found. Run Search with live boards.",
            request_id=rid,
            version=ONE_CLICK_VERSION,
        )

    enriched = stage_enrich(live_in)

    if strict_gate:
        passed, skipped = stage_score(
            enriched, min_score=float(min_score or 0), min_grade=min_grade or "D"
        )
    else:
        passed, skipped = [], []
        for j in enriched:
            if j.get("url_ok"):
                ens = float((j.get("scores") or {}).get("ensemble") or 0)
                passed.append({**j, "nexus_score": ens, "skip_reasons": []})
            else:
                skipped.append({**j, "skip_reasons": ["missing_or_bad_apply_url"]})

    # Caller Apply Kit only — synthesized apply_steps store does not exist until
    # after shortlist/tailor; kit-first ranking needs packs up front.
    rank_store: dict[str, Any] | None = None
    if use_form_store and isinstance(form_store, dict) and form_store.get("job_packs"):
        rank_store = form_store

    # Strong kit URL matches first (when rank_store); soft demoted when strict_soft
    passed = rank_jobs_for_apply(
        passed,
        form_store=rank_store,
        min_url_score=KIT_RANK_MIN_URL_SCORE,
        strict_soft=bool(strict_soft),
    )

    if prefer_auto_forms:
        # Fillable public forms first (never LinkedIn Easy Apply theater first).
        # Within fillable, order already kit-then-ATS from rank_jobs_for_apply.
        fillable = [
            j
            for j in passed
            if is_fillable_ats(_job_apply_url(j))
            and detect_ats(_job_apply_url(j)) not in HARD_LOGIN_ATS
        ]
        login_only = [
            j
            for j in passed
            if detect_ats(_job_apply_url(j)) in HARD_LOGIN_ATS
        ]
        shortlist = fillable[:budget]
        if not shortlist:
            shortlist = login_only[:budget]
    else:
        shortlist = passed[:budget]

    kit_matched_shortlist = sum(
        1
        for j in shortlist
        if job_has_form_store_url_match(
            rank_store,
            _job_apply_url(j),
            min_url_score=KIT_RANK_MIN_URL_SCORE,
        )
    )
    # id vs soft split for UI (summary.kit_id / kit_soft); strong-only stays above
    shortlist_kit = count_kit_tiers_for_jobs(rank_store, shortlist)

    if not shortlist:
        return {
            "ok": False,
            "request_id": rid,
            "version": ONE_CLICK_VERSION,
            "error": "no_eligible_jobs",
            "message": "No jobs with apply URLs. Re-run Search.",
            "skipped": [
                {
                    "job_id": s.get("id"),
                    "title": s.get("title"),
                    "skip_reasons": s.get("skip_reasons"),
                }
                for s in skipped[:20]
            ],
            "playwright": _playwright_available(),
        }

    has_resume = bool(profile.get("has_resume") or profile.get("resume_text"))
    materials = stage_tailor_and_cover(
        profile, shortlist, has_resume=has_resume, forge=forge
    )

    steps = []
    for m in materials:
        url = m.get("apply_url")
        if not url:
            src = next(
                (x for x in shortlist if str(x.get("id")) == str(m.get("job_id"))),
                {},
            )
            url = src.get("apply_url") or src.get("url")
        steps.append(
            {
                "job_id": m.get("job_id"),
                "title": m.get("title"),
                "company": m.get("company"),
                "apply_url": url,
                "cover_note": m.get("cover_note"),
                "forged_resume": m.get("forged_resume") or profile.get("resume_text"),
                "star_bullets": m.get("star_bullets") or [],
                "keyword_inject": m.get("keyword_inject") or [],
                "qa_bank": m.get("qa_bank") or [],
                "tailor_rt_passed": m.get("tailor_rt_passed"),
                "tailor_rt_grade": m.get("tailor_rt_grade"),
                "ensemble_fit": m.get("nexus_score")
                or m.get("ensemble_fit")
                or 0,
            }
        )

    steps = [s for s in steps if str(s.get("apply_url") or "").startswith("http")]
    if not steps:
        return {
            "ok": False,
            "request_id": rid,
            "version": ONE_CLICK_VERSION,
            "error": "no_apply_urls",
            "message": "No http apply URLs on shortlist.",
        }

    # Multi-pack store for URL-matched fill (extension parity). Prefer caller store
    # (e.g. exported Apply Kit); else synthesize from steps without re-forging.
    resolved_store: dict[str, Any] | None = None
    form_store_source: str | None = None
    if use_form_store:
        if isinstance(form_store, dict) and (
            form_store.get("job_packs") or form_store.get("base") or form_store.get("fields")
        ):
            resolved_store = form_store
            form_store_source = str(form_store.get("source") or "caller")
        else:
            resolved_store = form_store_from_apply_steps(profile, steps)
            form_store_source = "apply_steps"
        # Stamp kit fill policy so materialize skips soft sibling packs when strict
        if isinstance(resolved_store, dict):
            resolved_store = {**resolved_store, "strict_soft": bool(strict_soft)}

    if not _playwright_available():
        return {
            "ok": False,
            "request_id": rid,
            "version": ONE_CLICK_VERSION,
            "error": "playwright_missing",
            "message": "Install Playwright: pip install playwright && python -m playwright install chromium",
            "steps_prepared": len(steps),
            "forge": forge,
            "strict_soft": bool(strict_soft),
            "use_form_store": use_form_store,
            "form_store_source": form_store_source,
            "form_store_packs": len((resolved_store or {}).get("job_packs") or [])
            if resolved_store
            else 0,
            "kit_matched_shortlist": kit_matched_shortlist,
            "summary": {
                "eligible": len(steps),
                "attempted": 0,
                "filled": 0,
                "submitted": 0,
                "opened_manual": 0,
                "acted": 0,
                **shortlist_kit,
            },
            # Still return prepared materials so callers/tests can verify Tailor RT path
            "steps": steps,
            "materials": [
                {
                    "job_id": s.get("job_id"),
                    "title": s.get("title"),
                    "company": s.get("company"),
                    "apply_url": s.get("apply_url"),
                    "keyword_inject": s.get("keyword_inject") or [],
                    "has_cover": bool(s.get("cover_note")),
                    "has_forged_resume": bool(s.get("forged_resume")),
                    "star_count": len(s.get("star_bullets") or []),
                }
                for s in steps
            ],
        }

    batch = execute_auto_apply_batch(
        profile,
        steps,
        submit=submit,
        headless=headless,
        max_jobs=budget,
        delay_sec=delay_sec,
        form_store=resolved_store,
    )

    # Prefer fill-time match meta when batch exposes form_pack_match; else shortlist tiers
    kit_summary = count_kit_tiers_from_batch(batch) or shortlist_kit

    elapsed = round((time.perf_counter() - t0) * 1000, 2)
    ent_metrics().incr("one_click.run")
    ent_metrics().observe_ms("one_click.total", elapsed)
    if batch.get("submitted"):
        ent_metrics().incr("one_click.submitted", int(batch["submitted"]))

    fillable_n = sum(
        1 for s in steps if is_high_confidence_ats(str(s.get("apply_url") or ""))
    )
    attempted = int(batch.get("count") or 0)
    filled = int(batch.get("filled_only") or batch.get("filled") or 0)
    submitted_n = int(batch.get("submitted") or 0)
    manual_n = int(batch.get("opened_manual") or 0)
    # Prefer exclusive acted from batch (filled does not include submitted)
    acted = int(batch.get("acted") or (filled + submitted_n + manual_n))
    ok = acted > 0

    if submitted_n > 0:
        message = (
            f"Auto-applied: submitted {submitted_n}"
            + (f", filled-only {filled}" if filled else "")
            + (f", {manual_n} need you" if manual_n else "")
            + " (submitted = click+fill quality, not employer confirmation)"
        )
    elif filled > 0:
        message = (
            f"Filled {filled} form(s) (submit click blocked on some ATS)"
            + (f", {manual_n} opened for you" if manual_n else "")
        )
    elif manual_n > 0:
        message = (
            f"No public forms on this shortlist — opened {manual_n} for you. "
            "Turn off LinkedIn or try roles with Greenhouse/Freshteam boards."
        )
    else:
        message = "Nothing applied — check API / Playwright / job URLs"

    return {
        "ok": ok,
        "request_id": rid,
        "version": ONE_CLICK_VERSION,
        "mode": "karpathy_auto_apply",
        "submit": submit,
        "auto_submit_ats": True,
        "strict_gate": strict_gate,
        "strict_soft": bool(strict_soft),
        "playwright": True,
        "message": message,
        "honesty": (
            "Auto-apply means: open apply page, fill fields, click Submit via Playwright. "
            "LinkedIn Easy Apply and login walls cannot be fully automated without your session. "
            "Success metric = filled + submitted, not tabs opened."
        ),
        "autofill_profile": build_autofill_profile(profile),
        "forge": forge,
        "use_form_store": use_form_store,
        "form_store_source": form_store_source,
        "form_store_packs": len((resolved_store or {}).get("job_packs") or [])
        if resolved_store
        else 0,
        "kit_matched_shortlist": kit_matched_shortlist,
        "materials": [
            {
                "job_id": m.get("job_id"),
                "title": m.get("title"),
                "company": m.get("company"),
                "apply_url": m.get("apply_url"),
                "keyword_inject": m.get("keyword_inject") or [],
                "has_cover": bool(m.get("cover_note")),
                "has_forged_resume": bool(m.get("forged_resume")),
                "star_count": len(m.get("star_bullets") or []),
                "tailor_rt_grade": m.get("tailor_rt_grade"),
            }
            for m in materials
        ],
        "skipped": [
            {
                "job_id": s.get("id"),
                "title": s.get("title"),
                "skip_reasons": s.get("skip_reasons"),
            }
            for s in skipped[:30]
        ],
        "browser": batch,
        "summary": {
            "eligible": len(steps),
            "fillable_ats": fillable_n,
            "attempted": attempted,
            "filled": filled,
            "submitted": submitted_n,
            "opened_manual": manual_n,
            "acted": acted,
            "kit_matched": int(kit_summary.get("kit_matched") or 0),
            "kit_id": int(kit_summary.get("kit_id") or 0),
            "kit_soft": int(kit_summary.get("kit_soft") or 0),
        },
        "elapsed_ms": elapsed,
    }
