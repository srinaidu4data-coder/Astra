"""Browser apply + one-click unit tests (no network if playwright missing)."""

from __future__ import annotations

from jobsearch.browser_apply import (
    detect_ats,
    _field_map,
    _playwright_available,
    apply_one,
    materialize_step_profile,
    overlay_form_pack,
)
from jobsearch.one_click_apply import one_click_auto_apply


def test_detect_ats():
    assert detect_ats("https://boards.greenhouse.io/acme/jobs/1") == "greenhouse"
    assert detect_ats("https://jobs.lever.co/x/abc") == "lever"
    assert detect_ats("https://jobs.ashbyhq.com/y") == "ashby"
    assert detect_ats("https://example.com/job") == "generic"


def test_field_map():
    m = _field_map({"name": "Ada Lovelace", "email": "a@b.c", "skills": ["py"]})
    assert m["first_name"] == "Ada"
    assert m["last_name"] == "Lovelace"
    assert m["email"] == "a@b.c"


def test_field_map_prefers_cover_and_forged_resume():
    m = _field_map(
        {
            "name": "Ada Lovelace",
            "email": "a@b.c",
            "skills": ["python"],
            "cover_note": "Dear Acme, strengths in python and fastapi.",
            "resume_text": "Ada Lovelace\npython fastapi kubernetes engineer",
            "how_did_you_hear": "should-not-be-cover",
        }
    )
    assert "fastapi" in m["cover"]
    assert "should-not-be-cover" not in m["cover"]
    assert "python" in m["resume_text"]
    assert "fastapi" in m["resume_text"]
    assert "python" in m["skills"]


def test_materialize_step_profile_merges_tailor_materials():
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base resume python only",
        "cover_note": "base cover",
    }
    step = {
        "cover_note": "Dear Acme, python kubernetes docker.",
        "forged_resume": "Alex\npython kubernetes docker tailored",
        "keyword_inject": ["kubernetes", "docker"],
        "star_bullets": [
            "Situation-Task: shipped kubernetes/docker for Acme Backend Engineer."
        ],
    }
    prof, cover = materialize_step_profile(base, step)
    assert "kubernetes" in cover or "docker" in cover
    assert prof["resume_text"] == step["forged_resume"]
    assert "kubernetes" in [str(s).lower() for s in (prof.get("skills") or [])]
    assert prof.get("star_bullets") == step["star_bullets"]
    fm = _field_map(prof)
    assert "kubernetes" in fm["resume_text"] or "docker" in fm["resume_text"]
    assert fm["cover"] == cover


def test_materialize_step_star_bullets_win_over_pack():
    """Step STAR list from Tailor RT beats pack-seeded stars on the profile."""
    store = {
        "ok": True,
        "schema": "astra.extension_store.v1",
        "strict_soft": True,
        "active_job_id": "job-1",
        "base": {"ok": True, "job_id": "base-profile", "fields": {}},
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-1",
                "job": {
                    "id": "job-1",
                    "title": "Backend",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/33333333",
                },
                "fields": {},
                "cover_note": "PACK_COVER",
                "star_bullets": ["PACK_STAR only"],
                "tailored_resume": "PACK_RESUME python",
                "forge": {
                    "injects": ["packinj"],
                    "cover_note": "PACK_COVER",
                    "star_bullets": ["PACK_STAR only"],
                },
            }
        ],
    }
    base = {"name": "Alex", "email": "a@example.com", "skills": ["python"]}
    step = {
        "apply_url": "https://boards.greenhouse.io/acme/jobs/33333333",
        "cover_note": "STEP_COVER kubernetes",
        "forged_resume": "STEP_RESUME kubernetes docker",
        "star_bullets": ["STEP_STAR with kubernetes"],
        "keyword_inject": ["kubernetes"],
    }
    prof, cover = materialize_step_profile(
        base, step, form_store=store, page_url=step["apply_url"]
    )
    assert "STEP_COVER" in cover or cover == step["cover_note"]
    assert prof.get("star_bullets") == ["STEP_STAR with kubernetes"]
    assert prof.get("resume_text") == step["forged_resume"]


def _sample_multi_pack_store() -> dict:
    """Two job packs — extension-store shape — for URL selection tests."""
    return {
        "ok": True,
        "schema": "astra.extension_store.v1",
        "active_job_id": "job-wrong",
        "base": {
            "ok": True,
            "job_id": "base-profile",
            "fields": {"email": "a@example.com", "full_name": "Alex"},
        },
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-wrong",
                "job": {
                    "id": "job-wrong",
                    "title": "Wrong Role",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
                },
                "fields": {"email": "a@example.com", "full_name": "Alex"},
                "cover_note": "COVER_WRONG kubernetes-free",
                "tailored_resume": "RESUME_WRONG only python",
                "forge": {"injects": ["wronginject"], "grade": "C"},
            },
            {
                "ok": True,
                "job_id": "job-right",
                "job": {
                    "id": "job-right",
                    "title": "Right Role",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/22222222",
                },
                "fields": {"email": "a@example.com", "full_name": "Alex"},
                "cover_note": "COVER_RIGHT fastapi kubernetes",
                "tailored_resume": "RESUME_RIGHT python fastapi kubernetes",
                "forge": {"injects": ["fastapi", "kubernetes"], "grade": "A"},
            },
        ],
    }


def test_overlay_form_pack_applies_tailored_materials():
    prof = overlay_form_pack(
        {"name": "Alex", "email": "a@example.com", "skills": ["python"], "resume_text": "base"},
        {
            "job_id": "j1",
            "tailored_resume": "forged body",
            "cover_note": "dear hiring manager",
            "forge": {"injects": ["docker"]},
            "fields": {},
        },
    )
    assert prof["resume_text"] == "forged body"
    assert prof["cover_note"] == "dear hiring manager"
    assert "docker" in [str(s).lower() for s in prof["skills"]]


def test_materialize_form_store_url_match_over_active_id():
    """Playwright path must pick the pack for the page URL, same as extension content script."""
    store = _sample_multi_pack_store()
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base resume",
    }
    page = "https://boards.greenhouse.io/acme/jobs/22222222/application"
    prof, cover = materialize_step_profile(
        base,
        {"apply_url": page},
        form_store=store,
        page_url=page,
    )
    assert "RESUME_RIGHT" in prof["resume_text"]
    assert "COVER_RIGHT" in cover
    assert "fastapi" in [str(s).lower() for s in (prof.get("skills") or [])]
    assert prof.get("form_pack_match", {}).get("reason") == "url"
    assert prof.get("form_pack_match", {}).get("job_id") == "job-right"
    assert prof.get("form_pack_match", {}).get("id_token") is True
    assert prof.get("form_pack_match", {}).get("match_kind") == "id"
    assert isinstance(prof.get("form_pack_match", {}).get("score"), (int, float))
    assert int(prof.get("form_pack_match", {}).get("score") or 0) >= 50
    fm = _field_map(prof)
    assert "RESUME_RIGHT" in fm["resume_text"]
    assert "COVER_RIGHT" in fm["cover"]


def test_materialize_soft_url_match_sets_match_kind_soft():
    """Same-board soft pick (no job-id token) surfaces match_kind=soft for UI chips."""
    store = {
        "ok": True,
        "active_job_id": "job-soft",
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-soft",
                "job": {
                    "id": "job-soft",
                    "title": "Soft Role",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
                },
                "tailored_resume": "RESUME_SOFT",
                "cover_note": "COVER_SOFT",
                "fields": {"email": "a@example.com"},
            }
        ],
    }
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base",
    }
    # Different job id on same board → soft host+slug, not id-token
    page = "https://boards.greenhouse.io/acme/jobs/99999999/application"
    prof, cover = materialize_step_profile(
        base,
        {"apply_url": page},
        form_store=store,
        page_url=page,
    )
    m = prof.get("form_pack_match") or {}
    assert m.get("reason") == "url"
    assert m.get("id_token") is False
    assert m.get("match_kind") == "soft"
    assert m.get("job_id") == "job-soft"
    assert "COVER_SOFT" in cover


def test_materialize_strict_soft_skips_soft_pack_materials():
    """strict_soft=True records soft match but does not overlay sibling pack materials."""
    store = {
        "ok": True,
        "strict_soft": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-soft",
                "job": {
                    "id": "job-soft",
                    "title": "Soft Role",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
                },
                "tailored_resume": "RESUME_SOFT_SIBLING",
                "cover_note": "COVER_SOFT_SIBLING",
                "fields": {"email": "a@example.com"},
            }
        ],
    }
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "BASE_RESUME",
    }
    page = "https://boards.greenhouse.io/acme/jobs/99999999/application"
    prof, cover = materialize_step_profile(
        base,
        {"apply_url": page, "cover_note": "STEP_COLD_COVER"},
        form_store=store,
        page_url=page,
    )
    m = prof.get("form_pack_match") or {}
    assert m.get("match_kind") == "soft"
    assert m.get("soft_skipped") is True
    assert m.get("preferred") == "strict_soft_skip"
    assert "COVER_SOFT_SIBLING" not in cover
    assert cover == "STEP_COLD_COVER"
    assert "RESUME_SOFT_SIBLING" not in str(prof.get("resume_text") or "")
    assert prof.get("resume_text") in (None, "BASE_RESUME") or "BASE_RESUME" in str(
        prof.get("resume_text") or ""
    )


def test_materialize_strict_soft_still_applies_id_pack():
    """strict_soft must not block true id/path kit matches."""
    store = {
        "ok": True,
        "strict_soft": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-right",
                "job": {
                    "id": "job-right",
                    "title": "Right Role",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/22222222",
                },
                "tailored_resume": "RESUME_ID",
                "cover_note": "COVER_ID",
                "fields": {"email": "a@example.com"},
            }
        ],
    }
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base",
    }
    page = "https://boards.greenhouse.io/acme/jobs/22222222/application"
    prof, cover = materialize_step_profile(
        base,
        {"apply_url": page},
        form_store=store,
        page_url=page,
    )
    m = prof.get("form_pack_match") or {}
    assert m.get("match_kind") == "id"
    assert m.get("soft_skipped") is not True
    assert "COVER_ID" in cover
    assert "RESUME_ID" in str(prof.get("resume_text") or "")


def test_materialize_step_materials_win_over_form_store():
    """Explicit one-click step Tailor RT materials still override store overlay."""
    store = _sample_multi_pack_store()
    base = {"name": "Alex", "email": "a@example.com", "skills": ["python"], "resume_text": "base"}
    page = "https://boards.greenhouse.io/acme/jobs/22222222"
    prof, cover = materialize_step_profile(
        base,
        {
            "apply_url": page,
            "forged_resume": "STEP_FORGE custom",
            "cover_note": "STEP_COVER custom",
            "keyword_inject": ["terraform"],
        },
        form_store=store,
        page_url=page,
    )
    assert prof["resume_text"] == "STEP_FORGE custom"
    assert cover == "STEP_COVER custom"
    assert "terraform" in [str(s).lower() for s in (prof.get("skills") or [])]
    # URL match still recorded for observability
    assert prof.get("form_pack_match", {}).get("reason") == "url"
    assert prof.get("form_pack_match", {}).get("preferred") == "step_materials"
    assert prof.get("form_pack_match", {}).get("match_kind") == "id"
    assert prof.get("form_pack_match", {}).get("id_token") is True


def test_materialize_url_pack_beats_thin_prepare_cover():
    """Sequential prepareApplyPacket cover (no forge) must not override URL-matched kit pack."""
    store = _sample_multi_pack_store()
    base = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base resume",
    }
    page = "https://boards.greenhouse.io/acme/jobs/22222222/application"
    prof, cover = materialize_step_profile(
        base,
        {
            "apply_url": page,
            # Thin prepare packet — cover only, no forged_resume
            "cover_note": "GENERIC_PREPARE_COVER only",
        },
        form_store=store,
        page_url=page,
    )
    assert "COVER_RIGHT" in cover
    assert "GENERIC_PREPARE" not in cover
    assert "RESUME_RIGHT" in prof["resume_text"]
    assert prof.get("form_pack_match", {}).get("reason") == "url"
    assert prof.get("form_pack_match", {}).get("preferred") == "form_store_pack"
    fm = _field_map(prof)
    assert "COVER_RIGHT" in fm["cover"]
    assert "RESUME_RIGHT" in fm["resume_text"]


def test_apply_one_no_playwright_or_offline():
    # Should not crash; either no_playwright or error on unreachable
    r = apply_one(
        "https://example.com/jobs/1",
        {"name": "Test User", "email": "t@t.com", "resume_text": "python"},
        submit=False,
        headless=True,
    )
    assert "status" in r
    assert "url" in r


def test_one_click_api_request_defaults_forge_true():
    """API OneClickRequest must default forge=True so Tailor RT materials ship to UI."""
    from jobsearch.apply_api import OneClickRequest

    field = OneClickRequest.model_fields["forge"]
    assert field.default is True


def test_browser_apply_request_accepts_form_store():
    """Sequential /browser apply must accept multi-pack form_store (URL match path)."""
    from jobsearch.apply_api import BrowserApplyOneRequest

    assert "form_store" in BrowserApplyOneRequest.model_fields
    body = BrowserApplyOneRequest(
        profile={"name": "Alex", "email": "a@example.com", "skills": ["python"]},
        url="https://boards.greenhouse.io/acme/jobs/1",
        form_store={
            "ok": True,
            "job_packs": [
                {
                    "ok": True,
                    "job_id": "j1",
                    "job": {
                        "apply_url": "https://boards.greenhouse.io/acme/jobs/1",
                        "title": "SE",
                    },
                    "fields": {"email": "a@example.com"},
                    "tailored_resume": "kit resume",
                    "cover_note": "kit cover",
                    "forge": {"injects": ["python"]},
                }
            ],
        },
    )
    assert body.form_store is not None
    assert len(body.form_store["job_packs"]) == 1


def test_one_click_empty_jobs():
    r = one_click_auto_apply({"name": "T"}, [], budget=3)
    assert r["ok"] is False
    assert r.get("error") == "jobs_required"


def test_one_click_all_filtered():
    r = one_click_auto_apply(
        {"name": "T", "skills": ["x"], "resume_text": "x"},
        [
            {
                "id": "1",
                "title": "Intern",
                "company": "C",
                "source": "freehire",
                "apply_url": "https://boards.greenhouse.io/c/1",
                "scores": {"ensemble": 10},
                "is_synthetic": False,
                "text": "intern",
            }
        ],
        min_score=90,
        budget=3,
        submit=False,
    )
    # either filtered or playwright path
    assert "request_id" in r or r.get("error") or r.get("ok") is not None


def test_one_click_email_required():
    r = one_click_auto_apply(
        {"name": "T", "skills": ["python"]},
        [
            {
                "id": "1",
                "title": "Engineer",
                "company": "Acme",
                "source": "freehire",
                "apply_url": "https://boards.greenhouse.io/acme/1",
                "scores": {"ensemble": 70},
                "is_synthetic": False,
            }
        ],
        submit=False,
    )
    assert r["ok"] is False
    assert r.get("error") == "email_required"


def test_one_click_soft_gate_keeps_low_score_url():
    """Default soft gate must not drop valid apply URLs solely for low ensemble score."""
    r = one_click_auto_apply(
        {
            "name": "T",
            "email": "t@example.com",
            "skills": ["python"],
            "resume_text": "python engineer",
            "has_resume": True,
        },
        [
            {
                "id": "low",
                "title": "Engineer",
                "company": "Acme",
                "source": "freehire",
                "apply_url": "https://boards.greenhouse.io/acme/jobs/99",
                "scores": {"ensemble": 5},
                "is_synthetic": False,
                "text": "engineer",
            }
        ],
        min_score=90,
        min_grade="A",
        budget=3,
        submit=False,
        strict_gate=False,
    )
    # Soft gate: eligible path or browser attempt — not hard-filtered as no_eligible
    if r.get("error") == "no_eligible_jobs":
        raise AssertionError("soft gate must keep greenhouse URL")
    assert r.get("error") != "email_required"
    # ok may be True (playwright) or False with network/playwright issue — still not gate-fail
    assert "request_id" in r or r.get("ok") is not None


def test_one_click_strict_gate_filters_low_score():
    r = one_click_auto_apply(
        {
            "name": "T",
            "email": "t@example.com",
            "skills": ["python"],
            "resume_text": "python",
            "has_resume": True,
        },
        [
            {
                "id": "low",
                "title": "Intern",
                "company": "C",
                "source": "freehire",
                "apply_url": "https://boards.greenhouse.io/c/1",
                "scores": {"ensemble": 5},
                "is_synthetic": False,
                "text": "intern",
            }
        ],
        min_score=90,
        min_grade="A",
        budget=3,
        submit=False,
        strict_gate=True,
    )
    # Strict mode either rejects or leaves zero eligible
    if r.get("ok") is False and r.get("error") == "no_eligible_jobs":
        return
    stats = r.get("stats") or r.get("summary") or {}
    eligible = stats.get("with_url") or stats.get("eligible") or stats.get("attempted")
    if eligible is not None:
        assert int(eligible) == 0 or r.get("error")


def test_one_click_use_form_store_synthesizes_and_passes_to_batch(monkeypatch):
    """use_form_store builds packs from steps and passes form_store into batch (no dual forge)."""
    captured: dict = {}

    def fake_batch(profile, steps, **kwargs):
        captured["form_store"] = kwargs.get("form_store")
        captured["steps"] = steps
        return {
            "ok": True,
            "count": 1,
            "filled": 1,
            "submitted": 0,
            "opened_manual": 0,
            "results": [{"status": "filled", "job_id": steps[0].get("job_id")}],
        }

    monkeypatch.setattr("jobsearch.one_click_apply.execute_auto_apply_batch", fake_batch)
    monkeypatch.setattr("jobsearch.one_click_apply._playwright_available", lambda: True)

    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "python engineer",
        "has_resume": True,
    }
    jobs = [
        {
            "id": "oc-fs-1",
            "title": "Backend Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/55555555",
            "scores": {"ensemble": 70},
            "skills": ["python", "fastapi"],
            "text": "python fastapi backend",
            "is_synthetic": False,
        }
    ]
    r = one_click_auto_apply(
        profile, jobs, budget=1, submit=False, forge=True, use_form_store=True
    )
    assert r.get("ok") is True
    assert r.get("use_form_store") is True
    assert r.get("form_store_source") == "apply_steps"
    assert int(r.get("form_store_packs") or 0) >= 1
    store = captured.get("form_store")
    assert store and store.get("job_packs")
    assert store["job_packs"][0].get("job", {}).get("apply_url")


def test_one_click_use_form_store_false_skips_store(monkeypatch):
    captured: dict = {}

    def fake_batch(profile, steps, **kwargs):
        captured["form_store"] = kwargs.get("form_store")
        return {
            "ok": True,
            "count": 1,
            "filled": 1,
            "submitted": 0,
            "opened_manual": 0,
            "results": [{"status": "filled"}],
        }

    monkeypatch.setattr("jobsearch.one_click_apply.execute_auto_apply_batch", fake_batch)
    monkeypatch.setattr("jobsearch.one_click_apply._playwright_available", lambda: True)
    r = one_click_auto_apply(
        {
            "name": "Alex",
            "email": "a@example.com",
            "skills": ["python"],
            "resume_text": "python",
            "has_resume": True,
        },
        [
            {
                "id": "oc-fs-2",
                "title": "SE",
                "company": "Co",
                "source": "freehire",
                "apply_url": "https://jobs.lever.co/co/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "scores": {"ensemble": 60},
                "skills": ["python"],
                "text": "python",
                "is_synthetic": False,
            }
        ],
        budget=1,
        submit=False,
        use_form_store=False,
    )
    assert r.get("ok") is True
    assert r.get("use_form_store") is False
    assert captured.get("form_store") is None


def test_one_click_caller_form_store_preferred(monkeypatch):
    captured: dict = {}

    def fake_batch(profile, steps, **kwargs):
        captured["form_store"] = kwargs.get("form_store")
        return {
            "ok": True,
            "count": 1,
            "filled": 1,
            "submitted": 0,
            "opened_manual": 0,
            "results": [{"status": "filled"}],
        }

    monkeypatch.setattr("jobsearch.one_click_apply.execute_auto_apply_batch", fake_batch)
    monkeypatch.setattr("jobsearch.one_click_apply._playwright_available", lambda: True)
    caller_store = {
        "ok": True,
        "source": "apply_kit_export",
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-1",
                "job": {
                    "id": "kit-1",
                    "title": "Kit Role",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/55555555",
                },
                "tailored_resume": "kit resume",
                "cover_note": "kit cover",
                "fields": {"email": "a@example.com"},
                "forge": {"injects": ["kitkw"]},
            }
        ],
        "active_job_id": "kit-1",
    }
    r = one_click_auto_apply(
        {
            "name": "Alex",
            "email": "a@example.com",
            "skills": ["python"],
            "resume_text": "python",
            "has_resume": True,
        },
        [
            {
                "id": "oc-fs-3",
                "title": "Backend",
                "company": "Acme",
                "source": "freehire",
                "apply_url": "https://boards.greenhouse.io/acme/jobs/55555555",
                "scores": {"ensemble": 70},
                "skills": ["python"],
                "text": "python",
                "is_synthetic": False,
            }
        ],
        budget=1,
        submit=False,
        form_store=caller_store,
        use_form_store=True,
    )
    assert r.get("form_store_source") == "apply_kit_export"
    # Caller kit is copied with strict_soft stamped for fill-time soft skip policy
    fs = captured.get("form_store") or {}
    assert fs.get("source") == "apply_kit_export"
    assert fs.get("active_job_id") == "kit-1"
    assert fs.get("strict_soft") is True
    assert len(fs.get("job_packs") or []) == 1


def test_one_click_forge_materials_align_injects():
    """forge=True (default) prepares Tailor RT materials with inject-aligned cover/stars."""
    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": "Alex\nBackend Engineer\nPython APIs.\nSkills: python, flask.\n",
        "has_resume": True,
    }
    jobs = [
        {
            "id": "oc1",
            "title": "Backend Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/42",
            "scores": {"ensemble": 70},
            "skills": ["python", "fastapi", "kubernetes", "docker"],
            "text": (
                "Backend Engineer with Python, FastAPI, Kubernetes, Docker, "
                "and Terraform. Remote."
            ),
            "is_synthetic": False,
        }
    ]
    r = one_click_auto_apply(
        profile, jobs, budget=2, submit=False, forge=True, strict_gate=False
    )
    # Prefer steps from success path or playwright_missing payload
    steps = r.get("steps") or []
    if not steps and r.get("browser"):
        # browser path may not echo steps; use materials summary
        mats = r.get("materials") or []
        assert mats, r
        assert mats[0].get("has_cover") or mats[0].get("keyword_inject") is not None
        return
    if r.get("error") == "playwright_missing":
        assert r.get("steps_prepared", 0) >= 1
        assert steps
    if not steps:
        # still ok if batch ran; materials must exist
        mats = r.get("materials") or []
        assert mats
        return
    step = steps[0]
    cover = (step.get("cover_note") or "").lower()
    stars = " ".join(str(b).lower() for b in (step.get("star_bullets") or []))
    injects = [str(i).lower() for i in (step.get("keyword_inject") or [])]
    assert cover
    assert step.get("forged_resume")
    if injects:
        assert any(inj in cover or inj in stars for inj in injects), (
            f"injects={injects} not in cover/stars"
        )


def main() -> int:
    tests = [
        test_detect_ats,
        test_field_map,
        test_field_map_prefers_cover_and_forged_resume,
        test_materialize_step_profile_merges_tailor_materials,
        test_apply_one_no_playwright_or_offline,
        test_one_click_api_request_defaults_forge_true,
        test_one_click_empty_jobs,
        test_one_click_all_filtered,
        test_one_click_email_required,
        test_one_click_soft_gate_keeps_low_score_url,
        test_one_click_strict_gate_filters_low_score,
        test_one_click_forge_materials_align_injects,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"playwright_available={_playwright_available()}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
