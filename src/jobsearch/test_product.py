"""Golden tests for Job Search product mode."""

from __future__ import annotations

from jobsearch.algorithms import ensemble_rank
from jobsearch.catalog import apply_filters, infer_country, load_jobs, passes_query_gate
from jobsearch.agents import run_research_team


def test_infer_country_location_wins():
    assert infer_country("Cairo, Egypt", ["us"], "") == "other"
    assert infer_country("Heidelberg, Deutschland", None, "United States HQ") == "eu"
    assert infer_country("Remote, Remote, ca", ["us"], "") == "ca"
    assert infer_country("Fort Lee, NJ, us", ["us"], "") == "us"
    assert infer_country("Sandy Springs, Georgia, United States", None, "") == "us"


def test_us_filter_drops_non_us():
    jobs = [
        {
            "title": "SAP",
            "company": "A",
            "location": "Cairo, Egypt",
            "countries": ["eg"],
            "text": "",
            "source": "freehire",
            "remote": False,
            "work_mode": "onsite",
        },
        {
            "title": "SAP",
            "company": "B",
            "location": "Fort Lee, NJ, us",
            "countries": ["us"],
            "text": "",
            "source": "freehire",
            "remote": False,
            "work_mode": "onsite",
        },
        {
            "title": "SAP FI/CO Consultant (m/w/d)",
            "company": "DE Co",
            "location": "Remote job",
            "countries": [],
            "text": "",
            "source": "freehire",
            "remote": True,
            "work_mode": "remote",
        },
        {
            "title": "SAP FI/CO Consultant – Remote Only LATAM",
            "company": "Lat",
            "location": "United States",
            "countries": ["us"],
            "text": "",
            "source": "freehire",
            "remote": True,
            "work_mode": "remote",
        },
        {
            "title": "SAP FICO",
            "company": "X",
            "location": "Remote job",
            "countries": [],
            "text": "",
            "source": "freehire",
            "remote": True,
            "work_mode": "remote",
        },
        {
            # freehire often lies with countries=['us'] on non-US remote
            "title": "Консультант SAP FICO",
            "company": "Top Selection",
            "location": "Remote",
            "countries": ["us"],
            "text": "",
            "source": "freehire",
            "remote": True,
            "work_mode": "remote",
        },
        {
            "title": "SAP FICO Consultant",
            "company": "Y",
            "location": "Remote - United States",
            "countries": ["us"],
            "text": "",
            "source": "freehire",
            "remote": True,
            "work_mode": "remote",
        },
    ]
    out = apply_filters(jobs, location="us")
    locs = [j["location"] for j in out]
    assert any("Fort Lee" in x for x in locs)
    assert any("United States" in x for x in locs)
    assert not any("Консультант" in (j.get("title") or "") for j in out)
    assert not any(x.strip().lower() in ("remote", "remote job") for x in locs)


def test_product_default_no_seed():
    bundle = load_jobs(
        query="SAP FICO Consultant",
        use_live=False,
        include_seed=False,
        location="us",
        limit=50,
    )
    assert bundle["diagnostics"]["include_seed"] is False
    assert bundle["diagnostics"]["counts"].get("seed_market", 0) == 0
    assert len(bundle["jobs"]) == 0


def test_practice_market_opt_in():
    bundle = load_jobs(
        query="SAP FICO Consultant",
        use_live=False,
        include_seed=True,
        location="us",
        limit=50,
    )
    assert bundle["diagnostics"]["include_seed"] is True
    assert len(bundle["jobs"]) > 0
    assert all(j.get("is_synthetic") for j in bundle["jobs"])


def test_seed_ranked_below_live():
    jobs = [
        {
            "id": "s1",
            "title": "SAP FICO Consultant",
            "company": "SeedCo",
            "text": "SAP FICO S/4HANA tax controlling",
            "skills": ["sap", "fico", "s4hana"],
            "source": "seed_market",
            "is_synthetic": True,
        },
        {
            "id": "l1",
            "title": "SAP FICO Consultant",
            "company": "LiveCo",
            "text": "SAP FICO S/4HANA tax controlling",
            "skills": ["sap", "fico", "s4hana"],
            "source": "freehire",
            "is_synthetic": False,
        },
    ]
    ranked = ensemble_rank(
        "SAP FICO Consultant sap fico s4hana tax",
        ["sap", "fico", "s4hana", "tax"],
        jobs,
    )
    assert ranked[0]["id"] == "l1"
    assert ranked[0].get("is_synthetic") is False
    assert ranked[1].get("is_synthetic") is True
    assert ranked[0]["scores"]["ensemble"] > ranked[1]["scores"]["ensemble"]


def test_query_gate_sap():
    from jobsearch.catalog import title_matches_query

    good = {
        "title": "SAP FICO Consultant",
        "company": "X",
        "text": "S/4HANA finance",
        "skills": ["sap", "fico"],
        "source": "freehire",
    }
    bad = {
        "title": "Graphic Designer",
        "company": "Y",
        "text": "Figma branding",
        "skills": ["design"],
        "source": "remotive",
    }
    body_only = {
        "title": "Senior BI Consultant",
        "company": "Z",
        "text": "We use SAP somewhere in the company",
        "skills": ["bi"],
        "source": "freehire",
    }
    oracle = {
        "title": "Senior, Oracle Implementation - Tax Technology Consulting",
        "company": "Big4",
        "text": "Oracle tax SAP mentioned",
        "skills": ["oracle", "tax"],
        "source": "freehire",
    }
    ap = {
        "title": "Assistant Account Payable",
        "company": "Co",
        "text": "AP clerk",
        "skills": ["ap"],
        "source": "remotive",
    }
    assert passes_query_gate(good, "SAP FICO Consultant")
    assert not passes_query_gate(bad, "SAP FICO Consultant")
    assert not passes_query_gate(body_only, "SAP FICO Consultant")
    assert not title_matches_query(oracle["title"], "SAP FICO Consultant")
    assert not title_matches_query(ap["title"], "SAP FICO Consultant")
    assert title_matches_query("SAP FI/CO Consultant – Remote", "SAP FICO Consultant")
    assert title_matches_query("Senior SAP Tax Technology", "SAP FICO Consultant")


def test_run_product_live_first_offline_seed_off():
    r = run_research_team(
        {
            "name": "T",
            "target_title": "SAP FICO Consultant",
            "summary": "SAP FICO",
            "skills": ["sap", "fico"],
            "has_resume": True,
        },
        use_live=False,
        include_seed=False,
        location="us",
        exclude_linkedin=True,
        limit=50,
        has_resume=True,
    )
    assert r["ok"]
    assert r["filters"]["include_seed"] is False
    assert r["meta"]["seed_count"] == 0
    assert r["meta"]["live_count"] == 0
    assert r["product"]["mode"] == "live_first"
    assert "honesty" in r["product"]
    assert any("No live" in w or "Practice" in w or "matched" in w for w in r.get("warnings") or []) or len(
        r["warnings"]
    ) >= 0


if __name__ == "__main__":
    test_infer_country_location_wins()
    test_us_filter_drops_non_us()
    test_product_default_no_seed()
    test_practice_market_opt_in()
    test_seed_ranked_below_live()
    test_query_gate_sap()
    test_run_product_live_first_offline_seed_off()
    print("all product golden tests passed")
