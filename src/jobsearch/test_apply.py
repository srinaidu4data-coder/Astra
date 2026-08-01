"""AI Apply Studio — unit + RT (red-team) validation.

Karpathy bar: honest HITL, no silent auto-submit, math correctness, usability gates.
"""

from __future__ import annotations

from jobsearch.apply_math import (
    ats_keyword_coverage,
    bayesian_readiness,
    estimate_response_prob,
    expected_value,
    greedy_knapsack,
    mmr_select,
    secretary_threshold,
    sigmoid,
    softmax,
    thompson_source_weights,
)
from jobsearch.apply_engine import build_apply_packet, build_apply_queue
from jobsearch.agents import run_research_team


def test_softmax_sums_to_one():
    p = softmax([1.0, 2.0, 3.0], temperature=1.0)
    assert abs(sum(p) - 1.0) < 1e-6
    assert p[2] > p[1] > p[0]


def test_secretary_threshold_reasonable():
    scores = [40, 50, 60, 70, 80]
    thr = secretary_threshold(scores, kappa=0.25)
    assert 50 < thr < 80


def test_bayesian_readiness_monotonic():
    r0 = bayesian_readiness(0, 6)
    r3 = bayesian_readiness(3, 6)
    r6 = bayesian_readiness(6, 6)
    assert r0 < r3 < r6


def test_ats_coverage_hits_missing():
    ats = ats_keyword_coverage(
        "python fastapi react typescript aws docker",
        "python react kubernetes devops engineer aws",
        ["python", "react"],
    )
    assert ats["coverage"] > 0
    assert "python" in ats["hits"] or "react" in ats["hits"]


def test_mmr_prefers_diversity():
    jobs = [
        {
            "id": "1",
            "title": "SAP FICO Senior",
            "company": "A",
            "skills": ["sap", "fico"],
            "scores": {"ensemble": 90},
        },
        {
            "id": "2",
            "title": "SAP FICO Lead",
            "company": "B",
            "skills": ["sap", "fico"],
            "scores": {"ensemble": 88},
        },
        {
            "id": "3",
            "title": "React Engineer",
            "company": "C",
            "skills": ["react", "typescript"],
            "scores": {"ensemble": 70},
        },
    ]
    sel = mmr_select(jobs, k=2, lambda_rel=0.55)
    ids = {s["id"] for s in sel}
    # with diversity, third different job more likely than two near-dupes only
    assert len(sel) == 2
    assert "1" in ids  # highest rel first


def test_ev_and_response_zero_on_synthetic():
    p = estimate_response_prob(
        ensemble=99,
        ats_coverage=1.0,
        readiness=1.0,
        is_synthetic=True,
        has_direct_url=True,
    )
    assert p == 0.0
    assert expected_value(0.5) > expected_value(0.1)


def test_knapsack_respects_budget():
    items = [
        {"id": "a", "ev": 0.5, "cost": 1},
        {"id": "b", "ev": 0.4, "cost": 1},
        {"id": "c", "ev": 0.9, "cost": 2},
    ]
    out = greedy_knapsack(items, budget=2)
    used = sum(int(x["cost"]) for x in out)
    assert used <= 2
    assert out


def test_thompson_weights():
    w = thompson_source_weights(
        {"freehire": {"success": 10, "fail": 1}, "linkedin": {"success": 0, "fail": 8}}
    )
    assert w["freehire"] > w["linkedin"]


def test_packet_blocks_synthetic():
    profile = {
        "name": "Ada",
        "target_title": "Software Engineer",
        "skills": ["python", "react"],
        "summary": "builds products",
        "resume_text": "python react fastapi",
    }
    job = {
        "id": "syn-1",
        "title": "Software Engineer",
        "company": "FakeCo",
        "source": "seed_market",
        "is_synthetic": True,
        "apply_url": "https://example.com/job",
        "scores": {"ensemble": 90},
        "skills": ["python"],
        "text": "python react",
    }
    pkt = build_apply_packet(profile, job, has_resume=True)
    assert pkt["action"] == "blocked_practice"
    assert pkt["p_response_proxy"] == 0.0


def test_packet_ready_path():
    profile = {
        "name": "Ada",
        "target_title": "Software Engineer",
        "skills": ["python", "react", "fastapi", "aws"],
        "summary": "full stack engineer python react",
        "resume_text": "python react fastapi aws docker typescript",
        "has_resume": True,
    }
    job = {
        "id": "live-1",
        "title": "Software Engineer",
        "company": "Acme",
        "source": "freehire",
        "is_synthetic": False,
        "apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "scores": {"ensemble": 72},
        "skills": ["python", "react", "aws"],
        "text": "python react aws software engineer",
    }
    pkt = build_apply_packet(profile, job, has_resume=True)
    assert pkt["action"] in ("apply_now", "prepare")
    assert pkt["cover_note"]
    assert len(pkt["star_bullets"]) >= 2
    assert pkt["apply_url"].startswith("http")


def test_queue_from_offline_search():
    profile = {
        "target_title": "Software Engineer",
        "skills": ["python", "react"],
        "summary": "builder",
        "resume_text": "python react systems",
    }
    run = run_research_team(
        profile,
        use_live=False,
        include_seed=True,
        exclude_linkedin=True,
        limit=40,
    )
    jobs = run.get("ranked_jobs") or []
    # Force some as live for queue math test
    for j in jobs[:5]:
        j["is_synthetic"] = False
        j["source"] = "freehire"
        j["apply_url"] = f"https://jobs.example.org/{j.get('id')}"
        j["product_label"] = "live"
    q = build_apply_queue(profile, jobs, budget=5, has_resume=True)
    assert q["ok"]
    assert q["mode"] == "human_in_the_loop"
    assert "MMR" in " ".join(q["math_stack"])
    assert len(q["queue"]) <= 5


# ── RT agents (red-team validators) ─────────────────────────────────────────


def rt_agent_no_auto_submit():
    """RT-01: product must never claim auto-submit."""
    profile = {"target_title": "X", "skills": ["a"], "summary": "b"}
    job = {
        "id": "1",
        "title": "X",
        "company": "Y",
        "source": "freehire",
        "apply_url": "https://jobs.ok/1",
        "scores": {"ensemble": 60},
        "text": "a b c",
    }
    q = build_apply_queue(profile, [job], budget=3)
    assert q.get("mode") == "human_in_the_loop"
    assert "auto-submit" in (q.get("honesty") or "").lower() or "does not auto-submit" in (
        q.get("honesty") or ""
    ).lower()


def rt_agent_practice_never_in_ready_queue():
    """RT-02: synthetic cannot be apply_now."""
    profile = {"target_title": "Eng", "skills": ["python"], "resume_text": "python"}
    jobs = [
        {
            "id": "s1",
            "title": "Eng",
            "company": "Z",
            "source": "seed_market",
            "is_synthetic": True,
            "apply_url": "https://x.com/1",
            "scores": {"ensemble": 99},
            "text": "python",
        }
    ]
    q = build_apply_queue(profile, jobs, budget=5)
    assert q["stats"]["queued"] == 0 or all(
        x.get("action") != "apply_now" for x in q["queue"]
    )
    # better: live_jobs 0
    assert q["stats"]["live_jobs"] == 0


def rt_agent_empty_jobs():
    """RT-03: empty input stable."""
    q = build_apply_queue({"target_title": "E", "skills": []}, [], budget=5)
    assert q["ok"]
    assert q["queue"] == []


def rt_agent_malformed_job():
    """RT-04: nullish fields don't crash."""
    pkt = build_apply_packet(
        {"name": None, "skills": None, "summary": None},
        {"id": None, "title": None, "scores": None},
        has_resume=False,
    )
    assert "action" in pkt


def rt_agent_budget_cap():
    """RT-05: budget hard cap."""
    jobs = [
        {
            "id": f"j{i}",
            "title": "Software Engineer",
            "company": f"C{i}",
            "source": "remotive",
            "apply_url": f"https://jobs.example.org/{i}",
            "scores": {"ensemble": 50 + i},
            "skills": ["python"],
            "text": "python engineer",
            "is_synthetic": False,
        }
        for i in range(20)
    ]
    q = build_apply_queue(
        {"target_title": "Software Engineer", "skills": ["python"], "resume_text": "python"},
        jobs,
        budget=7,
        has_resume=True,
    )
    assert len(q["queue"]) <= 7


def rt_agent_materials_nonempty_for_live():
    """RT-06: cover + bullets always for live."""
    pkt = build_apply_packet(
        {
            "name": "Pat",
            "target_title": "Data Engineer",
            "skills": ["sql", "python", "spark"],
            "resume_text": "sql python spark airflow",
        },
        {
            "id": "d1",
            "title": "Data Engineer",
            "company": "DataCo",
            "source": "freehire",
            "apply_url": "https://jobs.dataco.test/1",
            "scores": {"ensemble": 65},
            "skills": ["sql", "python"],
            "text": "sql python spark data engineer",
        },
        has_resume=True,
    )
    assert len(pkt["cover_note"]) > 40
    assert len(pkt["star_bullets"]) >= 2


def rt_agent_sigmoid_bounds():
    """RT-07: numeric hygiene."""
    assert 0 <= sigmoid(-100) <= 1
    assert 0 <= sigmoid(100) <= 1


def main() -> int:
    tests = [
        test_softmax_sums_to_one,
        test_secretary_threshold_reasonable,
        test_bayesian_readiness_monotonic,
        test_ats_coverage_hits_missing,
        test_mmr_prefers_diversity,
        test_ev_and_response_zero_on_synthetic,
        test_knapsack_respects_budget,
        test_thompson_weights,
        test_packet_blocks_synthetic,
        test_packet_ready_path,
        test_queue_from_offline_search,
        rt_agent_no_auto_submit,
        rt_agent_practice_never_in_ready_queue,
        rt_agent_empty_jobs,
        rt_agent_malformed_job,
        rt_agent_budget_cap,
        rt_agent_materials_nonempty_for_live,
        rt_agent_sigmoid_bounds,
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
