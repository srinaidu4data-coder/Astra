"""Auto Apply campaign tests."""

from __future__ import annotations

from jobsearch.auto_apply import build_auto_apply_campaign, log_auto_apply_step
from jobsearch.one_click_apply import (
    KIT_RANK_MIN_URL_SCORE,
    KIT_TIER_ID,
    KIT_TIER_NONE,
    KIT_TIER_SOFT,
    count_kit_tiers_for_jobs,
    count_kit_tiers_from_batch,
    job_has_form_store_url_match,
    kit_match_tier,
    kit_sort_tier,
    one_click_auto_apply,
    rank_jobs_for_apply,
)


def _profile():
    return {
        "name": "Test",
        "target_title": "Software Engineer",
        "skills": ["python", "react"],
        "resume_text": "python react fastapi software engineer",
        "has_resume": True,
    }


def _jobs():
    return [
        {
            "id": "a1",
            "title": "Software Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/1",
            "scores": {"ensemble": 70},
            "skills": ["python", "react"],
            "text": "python react engineer",
            "is_synthetic": False,
        },
        {
            "id": "a2",
            "title": "Backend Engineer",
            "company": "Beta",
            "source": "remotive",
            "apply_url": "https://jobs.lever.co/beta/2",
            "scores": {"ensemble": 60},
            "skills": ["python"],
            "text": "python backend",
            "is_synthetic": False,
        },
        {
            "id": "syn",
            "title": "SE",
            "company": "X",
            "source": "seed_market",
            "is_synthetic": True,
            "apply_url": "https://example.com/x",
            "scores": {"ensemble": 99},
            "skills": ["python"],
            "text": "python",
        },
    ]


def test_campaign_builds_steps():
    c = build_auto_apply_campaign(_profile(), _jobs(), budget=5, forge=True)
    assert c["ok"]
    assert c["auto_submit_ats"] is False
    assert c["stats"]["steps"] >= 1
    assert all(s.get("apply_url") for s in c["steps"])
    assert all(s.get("cover_note") for s in c["steps"])
    assert not any(s.get("job_id") == "syn" for s in c["steps"])


def test_synthetic_skipped():
    c = build_auto_apply_campaign(_profile(), _jobs(), budget=10)
    reasons = [s.get("reason") for s in c.get("skipped") or []]
    assert "practice_listing" in reasons or c["stats"]["steps"] == 2


def test_log_step():
    r = log_auto_apply_step(campaign_id="c1", job_id="a1", status="applied")
    assert r["ok"]
    assert r["status"] == "applied"


def test_resolve_cover_rebuilds_from_packet_injects_when_no_forge():
    """Packet-only keyword_inject must still rebuild cover + STAR (not leave generic cover)."""
    from jobsearch.apply_engine import resolve_cover_and_injects

    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": "Alex\nPython engineer.\n",
    }
    job = {
        "id": "j1",
        "title": "Backend Engineer",
        "company": "Acme",
        "text": "Python FastAPI Kubernetes",
        "skills": ["python", "fastapi", "kubernetes"],
    }
    packet = {
        "title": "Backend Engineer",
        "company": "Acme",
        "cover_note": "Generic cover with no stack keywords.",
        "keyword_inject": ["fastapi", "kubernetes"],
        "star_bullets": ["Did generic work."],
        "ats": {},
    }
    cover, injects, stars = resolve_cover_and_injects(profile, job, packet, forge_blob=None)
    assert injects == ["fastapi", "kubernetes"]
    cover_l = cover.lower()
    stars_l = " ".join(stars).lower()
    assert "fastapi" in cover_l or "kubernetes" in cover_l
    assert "fastapi" in stars_l or "kubernetes" in stars_l
    assert "generic cover" not in cover_l


def test_resolve_cover_prefers_prebuilt_mat_cover_note():
    """When tailor_materials already emitted cover_note, do not rebuild from packet ATS."""
    from jobsearch.apply_engine import resolve_cover_and_injects

    profile = {
        "name": "Alex",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": "Alex\nPython.\n",
    }
    job = {
        "id": "j1",
        "title": "Backend Engineer",
        "company": "Acme",
        "text": "Python FastAPI Kubernetes",
        "skills": ["python", "fastapi", "kubernetes"],
    }
    packet = {
        "title": "Backend Engineer",
        "company": "Acme",
        "cover_note": "Generic packet cover.",
        "keyword_inject": ["terraform"],
        "star_bullets": ["packet star"],
        "ats": {"hits": ["python"], "missing": ["terraform"]},
    }
    prebuilt = (
        "Dear Acme hiring team,\n\nI'm Alex, focused on Backend Engineer roles. "
        "Your Backend Engineer posting stands out because it maps to my strengths "
        "in fastapi, kubernetes, python.\n\n— PREBUILT_MARKER\n"
        "— Generated as an editable draft (never auto-sent)."
    )
    forge_blob = {
        "injects": ["fastapi", "kubernetes"],
        "cover_note": prebuilt,
        "star_bullets": [
            "Situation-Task: delivered fastapi/kubernetes for Acme Backend Engineer."
        ],
    }
    cover, injects, stars = resolve_cover_and_injects(
        profile, job, packet, forge_blob=forge_blob
    )
    assert injects == ["fastapi", "kubernetes"]
    assert cover == prebuilt
    assert "PREBUILT_MARKER" in cover
    assert "generic packet" not in cover.lower()
    assert stars == forge_blob["star_bullets"]


def test_resolve_cover_rebuild_prefers_forge_ats_after():
    """Fallback rebuild uses forge ats_after gap line, not stale packet.ats missing."""
    from jobsearch.apply_engine import resolve_cover_and_injects

    profile = {
        "name": "Alex",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": "Alex\nPython.\n",
    }
    job = {
        "id": "j1",
        "title": "Backend Engineer",
        "company": "Acme",
        "text": "Python FastAPI Kubernetes",
        "skills": ["python", "fastapi", "kubernetes"],
    }
    packet = {
        "title": "Backend Engineer",
        "company": "Acme",
        "cover_note": "Generic packet cover.",
        "keyword_inject": ["legacy-only"],
        "star_bullets": [],
        "ats": {"hits": ["python"], "missing": ["cobol", "fortran"]},
    }
    # No prebuilt cover — force rebuild; injects from forge; ATS from ats_after
    forge_blob = {
        "injects": ["fastapi"],
        "cover_note": "",
        "star_bullets": [],
        "ats_after": {"hits": ["python", "fastapi"], "missing": ["kubernetes"]},
    }
    cover, injects, stars = resolve_cover_and_injects(
        profile, job, packet, forge_blob=forge_blob
    )
    assert injects == ["fastapi"]
    cover_l = cover.lower()
    assert "fastapi" in cover_l
    assert "kubernetes" in cover_l  # gap from ats_after
    assert "cobol" not in cover_l and "fortran" not in cover_l
    assert stars


def test_campaign_cover_aligns_with_forge_injects():
    """When Tailor RT yields injects, step cover_note and keyword_inject must surface them."""
    profile = {
        "name": "Alex",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": (
            "Alex\nBackend Engineer\nPython APIs and services.\nSkills: python, flask.\n"
        ),
        "has_resume": True,
    }
    jobs = [
        {
            "id": "kw1",
            "title": "Backend Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/99",
            "scores": {"ensemble": 75},
            "skills": ["python", "fastapi", "kubernetes", "docker"],
            "text": (
                "Backend Engineer with Python, FastAPI, Kubernetes, Docker, "
                "and Terraform. Remote US."
            ),
            "is_synthetic": False,
        }
    ]
    c = build_auto_apply_campaign(profile, jobs, budget=3, forge=True)
    assert c["ok"] and c["steps"]
    step = c["steps"][0]
    cover = (step.get("cover_note") or "").lower()
    injects = [str(i).lower() for i in (step.get("keyword_inject") or [])]
    stars = " ".join(str(b).lower() for b in (step.get("star_bullets") or []))
    assert cover
    # Prefer forge injects when present
    if injects:
        assert any(inj in cover for inj in injects), (
            f"cover missing injects={injects}: {cover[:200]}"
        )
        assert any(inj in stars for inj in injects), (
            f"star_bullets missing injects={injects}: {stars[:200]}"
        )
    assert "python" in cover or injects


def test_rank_jobs_for_apply_kit_url_first():
    """Apply Kit URL match outranks colder high-ensemble Greenhouse without a pack."""
    # Distinct hosts — same-board GH slugs alone can soft-score >=50 via host+company
    kit_url = "https://jobs.lever.co/acme/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    cold_url = "https://boards.greenhouse.io/otherco/jobs/11111111"
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-job",
                "job": {
                    "id": "kit-job",
                    "title": "Kit Role",
                    "apply_url": kit_url,
                },
                "cover_note": "kit cover",
                "tailored_resume": "kit resume",
            }
        ],
        "active_job_id": "kit-job",
    }
    jobs = [
        {
            "id": "cold",
            "title": "Cold GH",
            "company": "OtherCo",
            "apply_url": cold_url,
            "scores": {"ensemble": 99},
        },
        {
            "id": "kit",
            "title": "Kit Lever",
            "company": "Acme",
            "apply_url": kit_url,
            "scores": {"ensemble": 40},
        },
    ]
    ranked = rank_jobs_for_apply(jobs, form_store=store)
    assert [j["id"] for j in ranked] == ["kit", "cold"]
    assert job_has_form_store_url_match(
        store, kit_url, min_url_score=KIT_RANK_MIN_URL_SCORE
    ) is True
    assert job_has_form_store_url_match(
        store, cold_url, min_url_score=KIT_RANK_MIN_URL_SCORE
    ) is False

    # No kit → same ATS tier uses ensemble (higher score first); cold GH vs kit Lever
    # both priority 0, so ensemble wins → cold first
    no_kit = rank_jobs_for_apply(jobs, form_store=None)
    assert no_kit[0]["id"] == "cold"


def test_rank_jobs_for_apply_ignores_same_board_soft_match():
    """Host+company slug (~50) must not kit-boost; only strong id/path match (>=70)."""
    kit_url = "https://boards.greenhouse.io/acme/jobs/22222222"
    soft_url = "https://boards.greenhouse.io/acme/jobs/11111111"
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-job",
                "job": {
                    "id": "kit-job",
                    "title": "Kit Role",
                    "apply_url": kit_url,
                },
            }
        ],
    }
    # Soft same-board hit still qualifies at fill threshold 50
    assert job_has_form_store_url_match(store, soft_url, min_url_score=50) is True
    assert job_has_form_store_url_match(
        store, soft_url, min_url_score=KIT_RANK_MIN_URL_SCORE
    ) is False
    assert job_has_form_store_url_match(
        store, kit_url, min_url_score=KIT_RANK_MIN_URL_SCORE
    ) is True

    jobs = [
        {
            "id": "soft",
            "title": "Soft sibling",
            "company": "Acme",
            "apply_url": soft_url,
            "scores": {"ensemble": 99},
        },
        {
            "id": "kit",
            "title": "True kit",
            "company": "Acme",
            "apply_url": kit_url,
            "scores": {"ensemble": 40},
        },
    ]
    ranked = rank_jobs_for_apply(jobs, form_store=store)
    assert [j["id"] for j in ranked] == ["kit", "soft"]
    assert kit_match_tier(store, kit_url) == KIT_TIER_ID
    assert kit_match_tier(store, soft_url) == KIT_TIER_SOFT

    # Even with soft floor, three-tier ranking keeps id above soft (budget safe)
    weak = rank_jobs_for_apply(jobs, form_store=store, min_url_score=50)
    assert weak[0]["id"] == "kit"
    assert weak[1]["id"] == "soft"


def test_rank_jobs_for_apply_id_beats_soft_for_budget_slice():
    """Top-N budget must take id matches before soft siblings steal slots."""
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "pack-a",
                "job": {
                    "id": "pack-a",
                    "title": "Pack A",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/22222222",
                },
            },
            {
                "ok": True,
                "job_id": "pack-b",
                "job": {
                    "id": "pack-b",
                    "title": "Pack B",
                    "apply_url": "https://jobs.lever.co/beta/cccccccc-cccc-cccc-cccc-cccccccccccc",
                },
            },
        ],
    }
    jobs = [
        {
            "id": "soft-1",
            "title": "Soft sibling",
            "company": "Acme",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
            "scores": {"ensemble": 99},
        },
        {
            "id": "soft-2",
            "title": "Soft sibling 2",
            "company": "Acme",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/33333333",
            "scores": {"ensemble": 98},
        },
        {
            "id": "id-lever",
            "title": "True lever pack",
            "company": "Beta",
            "apply_url": "https://jobs.lever.co/beta/cccccccc-cccc-cccc-cccc-cccccccccccc",
            "scores": {"ensemble": 20},
        },
        {
            "id": "cold",
            "title": "Cold other",
            "company": "Other",
            "apply_url": "https://boards.greenhouse.io/otherco/jobs/44444444",
            "scores": {"ensemble": 90},
        },
    ]
    # Default strict_soft: id → cold → soft (soft demoted to avoid mis-fill)
    ranked = rank_jobs_for_apply(jobs, form_store=store)
    assert ranked[0]["id"] == "id-lever"
    assert ranked[1]["id"] == "cold"
    assert {ranked[2]["id"], ranked[3]["id"]} == {"soft-1", "soft-2"}
    assert kit_match_tier(store, jobs[0]["apply_url"]) == KIT_TIER_SOFT
    assert kit_match_tier(store, jobs[2]["apply_url"]) == KIT_TIER_ID
    assert kit_match_tier(store, jobs[3]["apply_url"]) == KIT_TIER_NONE
    shortlist = ranked[:1]
    assert shortlist[0]["id"] == "id-lever"

    # Non-strict: soft still after id but before cold
    loose = rank_jobs_for_apply(jobs, form_store=store, strict_soft=False)
    assert loose[0]["id"] == "id-lever"
    assert loose[1]["id"] in ("soft-1", "soft-2")
    assert loose[-1]["id"] == "cold"


def test_rank_strict_soft_demotes_soft_below_cold():
    """strict_soft (default) prefers cold ATS over soft sibling pack mis-fill."""
    kit_url = "https://boards.greenhouse.io/acme/jobs/22222222"
    soft_url = "https://boards.greenhouse.io/acme/jobs/11111111"
    cold_url = "https://boards.greenhouse.io/otherco/jobs/44444444"
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-job",
                "job": {"id": "kit-job", "title": "Kit", "apply_url": kit_url},
            }
        ],
    }
    jobs = [
        {
            "id": "soft",
            "title": "Soft sibling",
            "company": "Acme",
            "apply_url": soft_url,
            "scores": {"ensemble": 99},
        },
        {
            "id": "cold",
            "title": "Cold GH",
            "company": "Other",
            "apply_url": cold_url,
            "scores": {"ensemble": 40},
        },
    ]
    assert kit_sort_tier(KIT_TIER_SOFT, strict_soft=True) > kit_sort_tier(
        KIT_TIER_NONE, strict_soft=True
    )
    strict = rank_jobs_for_apply(jobs, form_store=store, strict_soft=True)
    assert [j["id"] for j in strict] == ["cold", "soft"]

    loose = rank_jobs_for_apply(jobs, form_store=store, strict_soft=False)
    assert [j["id"] for j in loose] == ["soft", "cold"]


def test_one_click_respects_strict_soft_false(monkeypatch):
    """strict_soft=False shortlists soft same-board kit before cold ATS (budget=1)."""
    captured: dict = {}

    def fake_batch(profile, steps, **kwargs):
        captured["steps"] = steps
        return {
            "ok": True,
            "count": 1,
            "filled": 1,
            "submitted": 0,
            "opened_manual": 0,
            "results": [{"status": "filled", "job_id": steps[0].get("job_id")}],
        }

    monkeypatch.setattr(
        "jobsearch.one_click_apply.execute_auto_apply_batch", fake_batch
    )
    monkeypatch.setattr(
        "jobsearch.one_click_apply._playwright_available", lambda: True
    )
    kit_url = "https://boards.greenhouse.io/acme/jobs/22222222"
    soft_url = "https://boards.greenhouse.io/acme/jobs/11111111"
    cold_url = "https://boards.greenhouse.io/otherco/jobs/44444444"
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-job",
                "job": {"id": "kit-job", "title": "Kit", "apply_url": kit_url},
            }
        ],
    }
    profile = {
        "name": "Test",
        "email": "t@example.com",
        "skills": ["python"],
        "resume_text": "python engineer",
    }
    jobs = [
        {
            "id": "soft",
            "title": "Soft sibling",
            "company": "Acme",
            "apply_url": soft_url,
            "url": soft_url,
            "url_ok": True,
            "scores": {"ensemble": 99},
            "skills": ["python"],
            "text": "python",
            "is_synthetic": False,
        },
        {
            "id": "cold",
            "title": "Cold GH",
            "company": "Other",
            "apply_url": cold_url,
            "url": cold_url,
            "url_ok": True,
            "scores": {"ensemble": 40},
            "skills": ["python"],
            "text": "python",
            "is_synthetic": False,
        },
    ]
    r = one_click_auto_apply(
        profile,
        jobs,
        budget=1,
        submit=False,
        forge=False,
        form_store=store,
        use_form_store=True,
        strict_soft=False,
    )
    assert r.get("ok") is True
    assert r.get("strict_soft") is False
    steps = captured.get("steps") or []
    assert len(steps) == 1
    assert steps[0].get("job_id") == "soft"
    assert int((r.get("summary") or {}).get("kit_soft") or 0) == 1
    assert int((r.get("summary") or {}).get("kit_id") or 0) == 0

    r2 = one_click_auto_apply(
        profile,
        jobs,
        budget=1,
        submit=False,
        forge=False,
        form_store=store,
        use_form_store=True,
        strict_soft=True,
    )
    assert r2.get("strict_soft") is True
    steps2 = captured.get("steps") or []
    assert len(steps2) == 1
    assert steps2[0].get("job_id") == "cold"
    # cold has no kit match
    assert int((r2.get("summary") or {}).get("kit_soft") or 0) == 0
    assert int((r2.get("summary") or {}).get("kit_id") or 0) == 0


def test_one_click_request_model_has_strict_soft():
    """API OneClickRequest surfaces strict_soft for power-user opt-in."""
    from jobsearch.apply_api import OneClickRequest, ProfileIn

    body = OneClickRequest(
        profile=ProfileIn(name="T", email="t@example.com"),
        jobs=[],
        strict_soft=False,
    )
    assert body.strict_soft is False
    body_default = OneClickRequest(
        profile=ProfileIn(name="T", email="t@example.com"),
        jobs=[],
    )
    assert body_default.strict_soft is True


def test_one_click_shortlist_prefers_kit_match(monkeypatch):
    """budget=1 with Apply Kit must shortlist the URL-matched job, not colder top ATS."""
    captured: dict = {}

    def fake_batch(profile, steps, **kwargs):
        captured["steps"] = steps
        captured["form_store"] = kwargs.get("form_store")
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

    kit_url = "https://jobs.lever.co/acme/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    cold_url = "https://boards.greenhouse.io/other/jobs/11111111"
    caller_store = {
        "ok": True,
        "source": "apply_kit_export",
        "job_packs": [
            {
                "ok": True,
                "job_id": "lever-kit",
                "job": {
                    "id": "lever-kit",
                    "title": "Kit Lever",
                    "apply_url": kit_url,
                },
                "tailored_resume": "kit resume",
                "cover_note": "kit cover",
                "fields": {"email": "a@example.com"},
            }
        ],
        "active_job_id": "lever-kit",
    }
    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "python engineer",
        "has_resume": True,
    }
    jobs = [
        {
            "id": "cold-gh",
            "title": "Cold Greenhouse",
            "company": "Other",
            "source": "freehire",
            "apply_url": cold_url,
            "scores": {"ensemble": 95},
            "skills": ["python"],
            "text": "python",
            "is_synthetic": False,
        },
        {
            "id": "lever-kit",
            "title": "Kit Lever",
            "company": "Acme",
            "source": "freehire",
            "apply_url": kit_url,
            "scores": {"ensemble": 40},
            "skills": ["python"],
            "text": "python",
            "is_synthetic": False,
        },
    ]
    r = one_click_auto_apply(
        profile,
        jobs,
        budget=1,
        submit=False,
        forge=False,
        form_store=caller_store,
        use_form_store=True,
    )
    assert r.get("ok") is True
    assert int(r.get("kit_matched_shortlist") or 0) == 1
    assert int((r.get("summary") or {}).get("kit_id") or 0) == 1
    assert int((r.get("summary") or {}).get("kit_soft") or 0) == 0
    assert int((r.get("summary") or {}).get("kit_matched") or 0) == 1
    steps = captured.get("steps") or []
    assert len(steps) == 1
    assert steps[0].get("job_id") == "lever-kit"
    assert kit_url in str(steps[0].get("apply_url") or "")


def test_count_kit_tiers_for_jobs_and_batch():
    """Helpers split id vs soft for summary.kit_* fields."""
    kit_url = "https://boards.greenhouse.io/acme/jobs/22222222"
    soft_url = "https://boards.greenhouse.io/acme/jobs/11111111"
    cold_url = "https://boards.greenhouse.io/otherco/jobs/44444444"
    store = {
        "ok": True,
        "job_packs": [
            {
                "ok": True,
                "job_id": "kit-job",
                "job": {"id": "kit-job", "title": "Kit", "apply_url": kit_url},
            }
        ],
    }
    jobs = [
        {"id": "id", "apply_url": kit_url},
        {"id": "soft", "apply_url": soft_url},
        {"id": "cold", "apply_url": cold_url},
    ]
    c = count_kit_tiers_for_jobs(store, jobs)
    assert c == {"kit_id": 1, "kit_soft": 1, "kit_matched": 2}
    assert count_kit_tiers_for_jobs(None, jobs)["kit_matched"] == 0

    batch = {
        "results": [
            {"job_id": "a", "form_pack_match": {"reason": "url", "match_kind": "id", "id_token": True, "score": 100}},
            {"job_id": "b", "form_pack_match": {"reason": "url", "match_kind": "soft", "id_token": False, "score": 50}},
            {"job_id": "c"},  # no match meta
        ]
    }
    b = count_kit_tiers_from_batch(batch)
    assert b == {"kit_id": 1, "kit_soft": 1, "kit_matched": 2}
    assert count_kit_tiers_from_batch({"results": [{"status": "filled"}]}) is None


def main() -> int:
    tests = [
        test_campaign_builds_steps,
        test_synthetic_skipped,
        test_log_step,
        test_resolve_cover_rebuilds_from_packet_injects_when_no_forge,
        test_campaign_cover_aligns_with_forge_injects,
        test_rank_jobs_for_apply_kit_url_first,
        test_rank_jobs_for_apply_ignores_same_board_soft_match,
        test_rank_jobs_for_apply_id_beats_soft_for_budget_slice,
        test_rank_strict_soft_demotes_soft_below_cold,
        test_one_click_respects_strict_soft_false,
        test_one_click_request_model_has_strict_soft,
        test_one_click_shortlist_prefers_kit_match,
        test_count_kit_tiers_for_jobs_and_batch,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
