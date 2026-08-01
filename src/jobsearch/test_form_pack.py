"""Form pack + extension store unit tests (no network)."""

from __future__ import annotations

from jobsearch.form_pack import (
    FORM_PACK_SCHEMA,
    build_base_extension_store,
    build_form_pack,
    form_store_from_apply_steps,
    has_url_id_token_match,
    score_url_match,
    select_job_pack_for_page,
)


def test_form_pack_base_and_job():
    profile = {
        "name": "Alex Candidate",
        "email": "a@example.com",
        "phone": "555",
        "target_title": "Software Engineer",
        "skills": ["python", "react"],
        "resume_text": "Alex\nPython React",
    }
    base = build_form_pack(profile, None, forge=False)
    assert base["ok"] is True
    assert base["schema"] == FORM_PACK_SCHEMA
    assert base["fields"]["email"] == "a@example.com"
    assert base["label_map"]["email"] == "a@example.com"

    job = {
        "id": "j1",
        "title": "Backend Engineer",
        "company": "Acme",
        "text": "python fastapi django apis",
        "apply_url": "https://example.com/jobs/1",
    }
    pack = build_form_pack(profile, job, forge=True)
    assert pack["ok"] is True
    assert pack["tailored_resume"]
    assert pack["cover_note"]
    assert len(pack["qa"]) >= 5
    assert "python" in pack["tailored_resume"].lower() or pack["forge"].get("injects") is not None


def test_extension_store():
    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "resume",
    }
    jobs = [
        {
            "id": "j1",
            "title": "SWE",
            "company": "Co",
            "text": "python react",
            "apply_url": "https://x.test/apply",
        }
    ]
    store = build_base_extension_store(profile, jobs, forge_top=1)
    assert store["ok"] is True
    assert store["base"]["ok"] is True
    assert len(store["job_packs"]) == 1
    # Chrome content script + Playwright honor this for soft sibling skip
    assert store.get("strict_soft") is True


def test_form_pack_cover_and_qa_align_with_injects():
    """Cover note + why_* answers should surface Tailor RT inject keywords, not only profile skills."""
    profile = {
        "name": "Alex Candidate",
        "email": "a@example.com",
        "phone": "555",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": (
            "Alex Candidate\nBackend Engineer\n"
            "Python APIs and services. Built REST backends.\n"
            "Skills: python, flask.\n"
        ),
    }
    job = {
        "id": "j-kw",
        "title": "Backend Engineer",
        "company": "Acme",
        "skills": ["python", "fastapi", "kubernetes", "docker"],
        "text": (
            "Backend Engineer with Python, FastAPI, Kubernetes, Docker, "
            "and Terraform experience. Remote."
        ),
        "apply_url": "https://boards.example.com/jobs/1",
    }
    pack = build_form_pack(profile, job, forge=True, use_tailor_rt=True)
    assert pack["ok"] is True
    injects = [str(i).lower() for i in (pack.get("forge") or {}).get("injects") or []]
    cover = (pack.get("cover_note") or "").lower()
    why = " ".join(
        q["answer"].lower()
        for q in (pack.get("qa") or [])
        if q.get("id") in ("why_company", "why_role", "cover_letter")
    )
    # Baseline skills always appear
    assert "python" in cover
    # When Tailor RT/forge yields injects, cover + Q&A must mention at least one
    if injects:
        assert any(inj in cover or inj in why for inj in injects), (
            f"injects={injects} not reflected in cover/qa"
        )
        # label_map should also expose keyword phrase for extension autofill
        skills_label = (pack.get("label_map") or {}).get("skills") or ""
        assert any(inj in skills_label.lower() for inj in injects) or "python" in skills_label.lower()
    # forge sidecar mirrors top-level materials for forge-only consumers
    forge = pack.get("forge") or {}
    assert forge.get("cover_note") == pack.get("cover_note")
    assert list(forge.get("star_bullets") or []) == list(pack.get("star_bullets") or [])


def test_score_url_match_greenhouse_and_lever():
    gh_a = "https://boards.greenhouse.io/acme/jobs/44112233"
    gh_b = "https://boards.greenhouse.io/acme/jobs/99887766"
    page_a = "https://boards.greenhouse.io/acme/jobs/44112233"
    page_apply = "https://boards.greenhouse.io/acme/jobs/44112233/application"
    assert score_url_match(page_a, gh_a) >= 50
    assert score_url_match(page_apply, gh_a) >= 50
    assert score_url_match(page_a, gh_b) < score_url_match(page_a, gh_a)
    # Different host family → 0
    assert score_url_match("https://jobs.lever.co/acme/abc", gh_a) == 0

    lever = "https://jobs.lever.co/acme/6a1b2c3d-1111-2222-3333-444455556666"
    lever_page = "https://jobs.lever.co/acme/6a1b2c3d-1111-2222-3333-444455556666/apply"
    assert score_url_match(lever_page, lever) >= 50


def test_has_url_id_token_match_vs_soft_slug():
    kit = "https://boards.greenhouse.io/acme/jobs/22222222"
    soft = "https://boards.greenhouse.io/acme/jobs/11111111"
    page = "https://boards.greenhouse.io/acme/jobs/22222222/application"
    assert has_url_id_token_match(page, kit, "job-right") is True
    assert has_url_id_token_match(page, soft, "job-wrong") is False
    # Same-board soft score still can be ~50, but not an id-token hit
    assert score_url_match(page, soft) >= 40
    assert score_url_match(page, kit) > score_url_match(page, soft)


def test_select_job_pack_for_page_prefers_id_token_over_sibling_soft():
    """Multi-pack same host: id-token pack wins even if a soft sibling also scores >=50."""
    store = {
        "ok": True,
        "active_job_id": "job-soft-first",
        "job_packs": [
            # Listed first; host+slug soft-matches the page but wrong job id
            {
                "ok": True,
                "job_id": "job-soft-first",
                "job": {
                    "id": "job-soft-first",
                    "title": "Sibling Soft",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
                },
                "fields": {"email": "a@x.com", "full_name": "Alex"},
                "cover_note": "wrong sibling",
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
                "fields": {"email": "a@x.com", "full_name": "Alex"},
                "cover_note": "right pack",
            },
        ],
    }
    pack, reason, score = select_job_pack_for_page(
        store, "https://boards.greenhouse.io/acme/jobs/22222222/application"
    )
    assert reason == "url"
    assert score >= 50
    assert pack is not None
    assert pack["job_id"] == "job-right"
    assert pack.get("cover_note") == "right pack"


def test_select_soft_only_prefers_active_job_id():
    """When no id-token hit, soft same-board hits prefer active_job_id over first pack."""
    # Page id 99999999 matches neither pack's job number → both soft host+slug only
    page = "https://boards.greenhouse.io/acme/jobs/99999999/application"
    store = {
        "ok": True,
        "active_job_id": "job-active",
        "job_packs": [
            {
                "ok": True,
                "job_id": "job-first",
                "job": {
                    "id": "job-first",
                    "title": "First Soft",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
                },
                "cover_note": "first pack",
                "fields": {"email": "a@x.com"},
            },
            {
                "ok": True,
                "job_id": "job-active",
                "job": {
                    "id": "job-active",
                    "title": "Active Soft",
                    "company": "Acme",
                    "apply_url": "https://boards.greenhouse.io/acme/jobs/22222222",
                },
                "cover_note": "active pack",
                "fields": {"email": "a@x.com"},
            },
        ],
    }
    # Soft qualifies both; neither is id-token match for 99999999
    assert has_url_id_token_match(
        page, store["job_packs"][0]["job"]["apply_url"], "job-first"
    ) is False
    assert has_url_id_token_match(
        page, store["job_packs"][1]["job"]["apply_url"], "job-active"
    ) is False
    pack, reason, score = select_job_pack_for_page(store, page)
    assert reason == "url"
    assert score >= 50
    assert pack is not None
    assert pack["job_id"] == "job-active"
    assert pack.get("cover_note") == "active pack"

    # Without active_job_id → first max soft (first pack in list when scores equal)
    store_no_active = {**store, "active_job_id": ""}
    pack2, reason2, _ = select_job_pack_for_page(store_no_active, page)
    assert reason2 == "url"
    assert pack2 is not None
    assert pack2["job_id"] == "job-first"


def test_select_job_pack_for_page_prefers_url_over_active_id():
    store = {
        "ok": True,
        "active_job_id": "job-wrong",
        "base": {"ok": True, "job_id": "base-profile", "fields": {"email": "a@x.com"}},
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
                "fields": {"email": "a@x.com", "full_name": "Alex"},
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
                "fields": {"email": "a@x.com", "full_name": "Alex"},
            },
        ],
    }
    pack, reason, score = select_job_pack_for_page(
        store, "https://boards.greenhouse.io/acme/jobs/22222222/application"
    )
    assert reason == "url"
    assert score >= 50
    assert pack is not None
    assert pack["job_id"] == "job-right"

    # No page URL → active_job_id
    pack2, reason2, _ = select_job_pack_for_page(store, None)
    assert reason2 == "active_id"
    assert pack2 is not None
    assert pack2["job_id"] == "job-wrong"

    # job_id embedded in URL when apply_url missing
    store2 = {
        "ok": True,
        "active_job_id": "x",
        "job_packs": [
            {
                "ok": True,
                "job_id": "gh-999888777",
                "job": {"id": "gh-999888777", "title": "T", "apply_url": ""},
                "fields": {"email": "a@x.com"},
            }
        ],
    }
    pack3, reason3, _ = select_job_pack_for_page(
        store2, "https://boards.greenhouse.io/co/jobs/gh-999888777"
    )
    assert reason3 == "url"
    assert pack3 is not None
    assert pack3["job_id"] == "gh-999888777"


def test_form_store_from_apply_steps_url_select():
    """one_click steps → lightweight store selects pack by apply_url (no re-forge)."""
    profile = {
        "name": "Alex",
        "email": "a@example.com",
        "skills": ["python"],
        "resume_text": "base",
    }
    steps = [
        {
            "job_id": "j-a",
            "title": "Role A",
            "company": "Acme",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/11111111",
            "cover_note": "cover A",
            "forged_resume": "resume A",
            "keyword_inject": ["alpha"],
            "star_bullets": ["STAR A with alpha"],
        },
        {
            "job_id": "j-b",
            "title": "Role B",
            "company": "Acme",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/22222222",
            "cover_note": "cover B",
            "forged_resume": "resume B",
            "keyword_inject": ["beta"],
            "star_bullets": ["STAR B with beta"],
        },
    ]
    store = form_store_from_apply_steps(profile, steps)
    assert store["ok"] is True
    assert store["source"] == "apply_steps"
    assert len(store["job_packs"]) == 2
    pack, reason, score = select_job_pack_for_page(
        store, "https://boards.greenhouse.io/acme/jobs/22222222/application"
    )
    assert reason == "url"
    assert score >= 50
    assert pack is not None
    assert pack["job_id"] == "j-b"
    assert pack["tailored_resume"] == "resume B"
    assert "beta" in (pack.get("forge") or {}).get("injects") or []
    # star_bullets + forge cover sidecar preserved (no re-forge drop)
    assert pack.get("star_bullets") == ["STAR B with beta"]
    assert (pack.get("forge") or {}).get("cover_note") == "cover B"
    assert (pack.get("forge") or {}).get("star_bullets") == ["STAR B with beta"]
