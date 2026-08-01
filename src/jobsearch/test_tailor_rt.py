"""Tailor RT multi-agent pipeline tests (no network)."""

from __future__ import annotations

from jobsearch.form_pack import build_form_pack
from jobsearch.tailor_rt import (
    agent_evidence,
    agent_jd_analyst,
    agent_validator,
    run_tailor_rt,
    tailor_materials,
    tailor_rt_batch,
)


def _profile():
    return {
        "name": "Sri Naidu",
        "email": "srinaidu4data@gmail.com",
        "phone": "+1 469 555 0199",
        "target_title": "SAP ABAP HANA Consultant",
        "skills": ["SAP", "ABAP", "HANA", "Fiori", "S4HANA", "OOABAP"],
        "resume_text": (
            "Sri Naidu\n"
            "SAP ABAP HANA Consultant\n"
            "Phone: +1 469 555 0199\n"
            "Experienced SAP consultant specializing in ABAP, HANA, and S/4HANA.\n"
            "Built Fiori apps and optimized ABAP reports for finance modules.\n"
            "Skills: SAP, ABAP, HANA, CDS views, OData, Fiori, S4HANA.\n"
        ),
        "resume_filename": "Sri_Naidu_SAP_ABAP_HANA_Consultant.docx",
    }


def _job():
    return {
        "id": "j1",
        "title": "SAP ABAP HANA Consultant",
        "company": "Acme Corp",
        "skills": ["SAP", "ABAP", "HANA", "S4HANA"],
        "text": (
            "We need a Senior SAP ABAP HANA Consultant with strong OOABAP, "
            "CDS views, Fiori, and S/4HANA experience. Remote US."
        ),
        "apply_url": "https://example.com/apply/1",
        "source": "freehire",
    }


def test_jd_analyst_extracts_must_haves():
    a = agent_jd_analyst(_job())
    assert a["agent"] == "jd_analyst"
    assert a["job_title"]
    assert a["keywords"]
    assert a["must_have"]


def test_evidence_grounds_supported_skills():
    a = agent_jd_analyst(_job())
    e = agent_evidence(_profile(), a)
    assert e["agent"] == "evidence"
    assert e["supported"]
    assert e["coverage_of_must"] > 0
    # Quantum physics should not be inventable as allowed inject from empty
    assert "quantum" not in " ".join(e["allowed_inject"])


def test_run_tailor_rt_passes_for_aligned_profile():
    r = run_tailor_rt(_profile(), _job(), max_rounds=2)
    assert r["ok"] is True
    assert r["schema"] == "astra.tailor_rt.v1"
    assert r["forged_resume"]
    assert "PK" not in r["forged_resume"]
    assert r["agents"]["validator"]["scores"]["ats_coverage"] >= 0
    assert r["overall_score"] is not None
    # Aligned SAP profile should pass or be close
    assert r["grade"] in ("A", "B", "C", "D")
    assert r["agents"]["jd_analyst"]["must_have"]


def test_validator_fails_fabrication():
    a = agent_jd_analyst(_job())
    e = agent_evidence(_profile(), a)
    bad = {
        "forged_resume": "I am ex-google PhD with 15 years at Meta inventing HANA.",
        "injects": ["quantum-ml"],
    }
    v = agent_validator(_profile(), _job(), a, e, bad)
    assert v["passed"] is False
    assert v["scores"]["authenticity"] == 0.0 or "Fabrication" in " ".join(
        v.get("weaknesses") or []
    )


def test_tailor_materials_includes_cover_and_stars():
    """Single entry emits inject-aligned cover_note + star_bullets (shared cover path)."""
    mat = tailor_materials(_profile(), _job(), max_rounds=2, use_rt=True)
    assert mat.get("ok") is True
    assert mat.get("forged_resume")
    cover = (mat.get("cover_note") or "").lower()
    stars = " ".join(str(b).lower() for b in (mat.get("star_bullets") or []))
    assert cover
    assert "acme" in cover or "hiring team" in cover
    # Profile skills + real injects (skip generic tokens) appear in materials
    assert "sap" in cover or "abap" in cover or "hana" in cover
    assert "sap" in stars or "abap" in stars or "python" in stars or stars
    assert isinstance(mat.get("star_bullets"), list)
    assert mat.get("cover_note")
    # Same template family as apply_engine.build_cover_note
    assert "editable draft" in cover


def test_form_pack_uses_tailor_rt():
    pack = build_form_pack(_profile(), _job(), forge=True, use_tailor_rt=True)
    assert pack["ok"] is True
    assert pack.get("tailor_rt") is not None
    assert pack["tailored_resume"]
    assert pack["fields"]["email"] == "srinaidu4data@gmail.com"
    # form_pack reuses tailor_materials cover path
    assert pack.get("cover_note")
    assert "— Generated as an editable draft" in (pack.get("cover_note") or "")


def test_batch_ranks_by_score():
    jobs = [
        _job(),
        {
            "id": "j2",
            "title": "Python Django Developer",
            "company": "Other",
            "skills": ["python", "django"],
            "text": "Need deep Django and PostgreSQL expert.",
            "source": "freehire",
        },
    ]
    b = tailor_rt_batch(_profile(), jobs, limit=2, max_rounds=1)
    assert b["count"] == 2
    assert b["results"][0]["overall_score"] >= b["results"][1]["overall_score"]


def test_must_haves_exclude_company_and_title_noise():
    a = agent_jd_analyst(_job())
    low = {x.lower() for x in (a["must_have"] + a["keywords"])}
    assert "acme" not in low
    assert "experience" not in low
    # real tech should remain
    assert any(x in low for x in ("sap", "abap", "hana", "s4hana", "fiori", "ooabap"))


def test_tailor_materials_shared_entry():
    from jobsearch.tailor_rt import tailor_materials

    m = tailor_materials(_profile(), _job(), max_rounds=1)
    assert m["ok"] is True
    assert m["source"] in ("tailor_rt", "resume_forge")
    assert m["forged_resume"]
    assert "EVIDENCE-ALIGNED" not in m["forged_resume"]
    assert "GAP HONESTY" not in m["forged_resume"]
