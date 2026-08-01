"""Astra Apply Nexus unit tests."""

from __future__ import annotations

from jobsearch.nexus_pipeline import (
    application_qa_bank,
    build_autofill_profile,
    grade_to_5,
    letter_grade,
    run_nexus_pipeline,
    stage_enrich,
    stage_score,
    stage_tailor_and_cover,
)


def _profile():
    return {
        "name": "Ada Lovelace",
        "target_title": "Software Engineer",
        "skills": ["python", "react", "aws"],
        "summary": "builder",
        "resume_text": "python react fastapi aws software engineer",
        "email": "ada@example.com",
    }


def _jobs():
    return [
        {
            "id": "1",
            "title": "Software Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/1",
            "scores": {"ensemble": 78},
            "skills": ["python", "react"],
            "text": "python react aws engineer",
            "is_synthetic": False,
        },
        {
            "id": "2",
            "title": "Intern",
            "company": "Low",
            "source": "remotive",
            "apply_url": "https://jobs.lever.co/low/2",
            "scores": {"ensemble": 30},
            "skills": ["html"],
            "text": "intern",
            "is_synthetic": False,
        },
        {
            "id": "syn",
            "title": "SE",
            "company": "Fake",
            "source": "seed_market",
            "is_synthetic": True,
            "scores": {"ensemble": 99},
            "apply_url": "https://example.com/x",
            "text": "x",
        },
    ]


def test_grades():
    assert letter_grade(90) == "A"
    assert letter_grade(40) == "F"
    assert 1.0 <= grade_to_5(50) <= 5.0


def test_score_gate_skips_low_and_synthetic():
    enr = stage_enrich(_jobs())
    passed, skipped = stage_score(enr, min_score=55, min_grade="D")
    ids = {str(p.get("id")) for p in passed}
    assert "1" in ids
    assert "2" not in ids
    assert any("practice_synthetic" in str(s.get("skip_reasons")) for s in skipped)


def test_autofill_and_qa():
    af = build_autofill_profile(_profile())
    assert af["fields"]["first_name"] == "Ada"
    assert "email" in af["fields"]
    qa = application_qa_bank(_profile(), _jobs()[0])
    assert len(qa) >= 3


def test_pipeline_dry_run():
    r = run_nexus_pipeline(
        _profile(),
        _jobs(),
        min_score=50,
        budget=5,
        has_resume=True,
        forge=True,
        mode="dry_run",
    )
    assert r["ok"]
    assert r["auto_submit_ats"] is False
    assert r["mode"] == "dry_run"
    assert r["stats"]["passed_gate"] >= 1
    assert r["stats"]["materials"] >= 1


def test_soft_fallback_when_strict_gate_empty():
    """Live-board scores often <75 — still produce materials via soft fallback."""
    low = [
        {
            "id": "low1",
            "title": "Software Engineer",
            "company": "X",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/x/1",
            "scores": {"ensemble": 42},
            "skills": ["python"],
            "text": "python engineer",
            "is_synthetic": False,
        }
    ]
    r = run_nexus_pipeline(
        _profile(),
        low,
        min_score=75,
        min_grade="B",
        budget=5,
        forge=False,
        mode="dry_run",
        soft_fallback=True,
    )
    assert r["ok"]
    assert r["stats"]["materials"] >= 1
    assert r["stats"].get("soft_fallback") is True
    assert r.get("warnings")
    assert r["materials"]
    assert r["autofill_profile"]["schema"] == "astra.autofill.v1"
    assert "ApplyPilot" in " ".join(r["inspired_by"])


def test_pipeline_campaign():
    r = run_nexus_pipeline(
        _profile(),
        _jobs(),
        min_score=50,
        budget=3,
        has_resume=True,
        forge=False,
        mode="campaign",
    )
    assert r["ok"]
    # campaign may build apply steps
    assert r["stages"]["score"]["passed"] >= 1


def test_stage_tailor_cover_aligns_with_forge_injects():
    """Nexus materials prefer Tailor RT injects in cover_note + keyword_inject + qa_bank."""
    profile = {
        "name": "Alex",
        "target_title": "Backend Engineer",
        "skills": ["python"],
        "resume_text": "Alex\nBackend Engineer\nPython APIs.\nSkills: python, flask.\n",
        "email": "a@example.com",
    }
    jobs = [
        {
            "id": "nk1",
            "title": "Backend Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/99",
            "scores": {"ensemble": 75},
            "skills": ["python", "fastapi", "kubernetes", "docker"],
            "text": (
                "Backend Engineer with Python, FastAPI, Kubernetes, Docker, "
                "and Terraform. Remote."
            ),
            "is_synthetic": False,
            "nexus_score": 75,
            "nexus_grade": "B",
        }
    ]
    mats = stage_tailor_and_cover(profile, jobs, has_resume=True, forge=True)
    assert mats
    m = mats[0]
    cover = (m.get("cover_note") or "").lower()
    injects = [str(i).lower() for i in (m.get("keyword_inject") or [])]
    qa_blob = " ".join(
        str(row.get("a") or "").lower() for row in (m.get("qa_bank") or [])
    )
    stars = " ".join(str(b).lower() for b in (m.get("star_bullets") or []))
    assert cover
    if injects:
        assert any(inj in cover for inj in injects), (
            f"cover missing injects={injects}: {cover[:200]}"
        )
        assert any(inj in qa_blob for inj in injects), (
            f"qa_bank missing injects={injects}: {qa_blob[:200]}"
        )
        assert any(inj in stars for inj in injects), (
            f"star_bullets missing injects={injects}: {stars[:200]}"
        )
    assert "python" in cover or injects


def test_application_qa_bank_merges_injects():
    qa = application_qa_bank(
        {"skills": ["python"], "target_title": "Backend Engineer"},
        {"title": "Backend Engineer", "company": "Acme"},
        injects=["kubernetes", "fastapi"],
    )
    blob = " ".join(r["a"].lower() for r in qa)
    assert "python" in blob
    assert "kubernetes" in blob
    assert "fastapi" in blob


def main() -> int:
    tests = [
        test_grades,
        test_score_gate_skips_low_and_synthetic,
        test_autofill_and_qa,
        test_pipeline_dry_run,
        test_pipeline_campaign,
        test_stage_tailor_cover_aligns_with_forge_injects,
        test_application_qa_bank_merges_injects,
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
