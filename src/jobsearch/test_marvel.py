"""Marvel Apply + SOTA engines + Resume Forge tests + RT agents."""

from __future__ import annotations

from jobsearch.sota_engines import (
    KalmanResponseTracker,
    PIDApplyThrottle,
    gravitational_score,
    hungarian_minimize,
    ising_greedy_apply,
    jensen_shannon,
    kl_divergence,
    multi_engine_score_jobs,
    multiplicative_weights_fuse,
    nsga_non_dominated,
    sinkhorn_skill_cost,
    soft_attention_pool,
    unigram_dist,
    ucb1_scores,
)
from jobsearch.resume_forge import forge_resume_for_job, forge_variants
from jobsearch.marvel_pipeline import run_marvel_apply, MARVEL_VERSION


def _profile():
    return {
        "name": "Ada Lovelace",
        "target_title": "Software Engineer",
        "skills": ["python", "react", "fastapi", "aws"],
        "summary": "builds reliable products",
        "resume_text": (
            "Software Engineer. Python FastAPI React AWS Docker. "
            "Shipped APIs and UIs for data products."
        ),
        "has_resume": True,
    }


def _jobs():
    return [
        {
            "id": "j1",
            "title": "Software Engineer",
            "company": "Acme",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/acme/jobs/1",
            "scores": {"ensemble": 72},
            "skills": ["python", "react", "aws"],
            "text": "python react aws software engineer microservices",
            "is_synthetic": False,
        },
        {
            "id": "j2",
            "title": "Backend Engineer",
            "company": "Beta",
            "source": "remotive",
            "apply_url": "https://jobs.lever.co/beta/2",
            "scores": {"ensemble": 65},
            "skills": ["python", "fastapi", "postgres"],
            "text": "python fastapi postgres backend engineer",
            "is_synthetic": False,
        },
        {
            "id": "j3",
            "title": "React Engineer",
            "company": "Gamma",
            "source": "freehire",
            "apply_url": "https://boards.greenhouse.io/gamma/3",
            "scores": {"ensemble": 60},
            "skills": ["react", "typescript", "css"],
            "text": "react typescript frontend engineer",
            "is_synthetic": False,
        },
        {
            "id": "syn",
            "title": "Software Engineer",
            "company": "Fake",
            "source": "seed_market",
            "is_synthetic": True,
            "scores": {"ensemble": 99},
            "skills": ["python"],
            "text": "python",
        },
    ]


def test_gravity_decreases_with_gap():
    a = gravitational_score(0.8, gap_distance=0.2)
    b = gravitational_score(0.8, gap_distance=0.8)
    assert a > b


def test_kl_js_basic():
    p = unigram_dist("python python react")
    q = unigram_dist("python java")
    assert kl_divergence(p, q) >= 0
    assert jensen_shannon(p, q) >= 0
    assert jensen_shannon(p, p) < 0.05


def test_sinkhorn_same_skills_low_cost():
    s = {"python", "react"}
    assert sinkhorn_skill_cost(s, s) < 0.15


def test_mw_fuse_length():
    f = multiplicative_weights_fuse(
        {"a": [1.0, 2.0, 3.0], "b": [3.0, 2.0, 1.0]}, rounds=2
    )
    assert len(f) == 3


def test_ucb_explores_unpulled():
    u = ucb1_scores([0.5, 0.9], [0, 5], 10)
    assert u[0] > u[1]


def test_ising_selects_some():
    fields = [1.0, 0.8, 0.2, -0.5]
    sim = [[0, 0.9, 0.1, 0.1], [0.9, 0, 0.1, 0.1], [0.1, 0.1, 0, 0.2], [0.1, 0.1, 0.2, 0]]
    on = ising_greedy_apply(fields, sim, max_on=2)
    assert 0 < len(on) <= 2


def test_pareto_front():
    pts = [
        {"fit": 0.9, "ot": 0.5},
        {"fit": 0.5, "ot": 0.9},
        {"fit": 0.4, "ot": 0.4},
    ]
    front = nsga_non_dominated(pts, ["fit", "ot"])
    assert 0 in front and 1 in front
    assert 2 not in front


def test_hungarian_assign():
    cost = [[1.0, 2.0], [2.0, 1.0]]
    a = hungarian_minimize(cost)
    assert a[0] in (0, 1)
    assert len(a) == 2


def test_attention_pool():
    q = {"python", "react"}
    jobs = [{"python", "django"}, {"react", "css"}, {"java"}]
    s = soft_attention_pool(q, jobs)
    assert len(s) == 3
    assert s[0] > 0 or s[1] > 0


def test_kalman_pid():
    k = KalmanResponseTracker()
    k.update(1)
    k.update(0)
    assert 0 <= k.x <= 1
    pid = PIDApplyThrottle(target=8)
    n = pid.step(3)
    assert 1 <= n <= 25


def test_multi_engine_ranks():
    scored = multi_engine_score_jobs(_profile(), _jobs())
    assert all("marvel_score" in j for j in scored if not j.get("is_synthetic"))
    assert scored[0]["marvel_score"] >= scored[-1]["marvel_score"]


def test_forge_lifts_or_maintains_ats():
    f = forge_resume_for_job(_profile(), _jobs()[0])
    assert f["forged_resume"]
    assert f["scalar_score"] > 0
    assert "authenticity" in f["objectives"]
    assert f["objectives"]["authenticity"] > 0.2


def test_forge_blocks_nothing_on_live():
    v = forge_variants(_profile(), _jobs(), limit=3)
    assert v["count"] >= 1
    assert all(x.get("job_id") != "syn" for x in v["variants"])


def test_marvel_pipeline():
    r = run_marvel_apply(_profile(), _jobs(), budget=5, has_resume=True, forge_top=3)
    assert r["ok"]
    assert r["auto_submit"] is False
    assert r["mode"] == "human_in_the_loop"
    assert len(r["engines"]) >= 15
    assert r["stats"]["live_jobs"] == 3
    assert r["version"] == MARVEL_VERSION
    assert r["queue"] is not None


def rt_agent_no_auto_submit_marvel():
    r = run_marvel_apply(_profile(), _jobs(), budget=3)
    assert r["auto_submit"] is False
    assert "never" in (r["honesty"] or "").lower() or "human" in (r["mode"] or "")


def rt_agent_synthetic_excluded():
    r = run_marvel_apply(_profile(), _jobs(), budget=5)
    ids = {str(j.get("id")) for j in r.get("ranked_jobs") or []}
    assert "syn" not in ids


def rt_agent_forge_no_fabrication_markers():
    f = forge_resume_for_job(_profile(), _jobs()[0])
    text = f["forged_resume"].lower()
    assert "nobel" not in text
    assert "ex-google" not in text


def rt_agent_empty_jobs():
    r = run_marvel_apply(_profile(), [], budget=5)
    assert r["ok"]
    assert r["stats"]["queued"] == 0


def main() -> int:
    tests = [
        test_gravity_decreases_with_gap,
        test_kl_js_basic,
        test_sinkhorn_same_skills_low_cost,
        test_mw_fuse_length,
        test_ucb_explores_unpulled,
        test_ising_selects_some,
        test_pareto_front,
        test_hungarian_assign,
        test_attention_pool,
        test_kalman_pid,
        test_multi_engine_ranks,
        test_forge_lifts_or_maintains_ats,
        test_forge_blocks_nothing_on_live,
        test_marvel_pipeline,
        rt_agent_no_auto_submit_marvel,
        rt_agent_synthetic_excluded,
        rt_agent_forge_no_fabrication_markers,
        rt_agent_empty_jobs,
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
