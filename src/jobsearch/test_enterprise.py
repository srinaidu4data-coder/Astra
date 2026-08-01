"""Enterprise control-plane unit tests (no live network required)."""

from __future__ import annotations

import time
import copy

from jobsearch.enterprise import (
    BreakerState,
    CircuitBreaker,
    CircuitOpenError,
    ResultCache,
    TokenBucket,
    BreakerRegistry,
    materialize_cached_run,
    run_fingerprint,
    new_request_id,
    enterprise_status,
    liveness,
    readiness,
    protected_fetch,
    cache as global_cache,
    breakers as global_breakers,
    metrics as global_metrics,
)
from jobsearch.agents import run_research_team, PRODUCT_VERSION, PRODUCT_GRADE


def test_request_id_format():
    rid = new_request_id()
    assert rid.startswith("js-")
    assert len(rid) >= 10


def test_fingerprint_stable():
    p = {"target_title": "SAP FICO", "skills": ["sap", "fico"], "summary": "x"}
    a = run_fingerprint(
        p,
        use_live=True,
        remote="all",
        location="us",
        exclude_linkedin=False,
        include_seed=False,
        limit=50,
        min_score=0.0,
    )
    b = run_fingerprint(
        p,
        use_live=True,
        remote="all",
        location="us",
        exclude_linkedin=False,
        include_seed=False,
        limit=50,
        min_score=0.0,
    )
    assert a == b
    # skill order should not matter
    p2 = {"target_title": "SAP FICO", "skills": ["fico", "sap"], "summary": "x"}
    c = run_fingerprint(
        p2,
        use_live=True,
        remote="all",
        location="us",
        exclude_linkedin=False,
        include_seed=False,
        limit=50,
        min_score=0.0,
    )
    assert a == c


def test_fingerprint_changes_on_title():
    p1 = {"target_title": "SAP", "skills": [], "summary": ""}
    p2 = {"target_title": "React", "skills": [], "summary": ""}
    a = run_fingerprint(
        p1, use_live=True, remote="all", location="us",
        exclude_linkedin=True, include_seed=False, limit=50, min_score=0,
    )
    b = run_fingerprint(
        p2, use_live=True, remote="all", location="us",
        exclude_linkedin=True, include_seed=False, limit=50, min_score=0,
    )
    assert a != b


def test_cache_hit_miss_stale():
    c = ResultCache(ttl_sec=0.15, max_entries=8, stale_sec=1.0)
    c.put("k1", {"ok": True})
    v, st = c.get("k1")
    assert st == "hit" and v == {"ok": True}
    time.sleep(0.2)
    v2, st2 = c.get("k1", allow_stale=True)
    assert st2 == "stale" and v2 == {"ok": True}
    time.sleep(1.0)
    v3, st3 = c.get("k1", allow_stale=True)
    assert st3 == "miss" and v3 is None


def test_cache_eviction():
    c = ResultCache(ttl_sec=60, max_entries=3, stale_sec=60)
    for i in range(5):
        c.put(f"k{i}", i)
        time.sleep(0.01)
    snap = c.snapshot()
    assert snap["entries"] <= 3
    assert snap["evictions"] >= 2


def test_circuit_opens_after_threshold():
    br = CircuitBreaker(name="t", failure_threshold=3, cooldown_sec=30)
    assert br.allow()
    br.record_failure("e1")
    br.record_failure("e2")
    assert br.state == BreakerState.CLOSED
    br.record_failure("e3")
    assert br.state == BreakerState.OPEN
    assert not br.allow()
    snap = br.snapshot()
    assert snap["total_trips"] == 1


def test_circuit_half_open_recovery():
    br = CircuitBreaker(name="t2", failure_threshold=1, cooldown_sec=0.05)
    br.record_failure("boom")
    assert br.state == BreakerState.OPEN
    time.sleep(0.08)
    assert br.allow()  # transitions to half_open
    assert br.state == BreakerState.HALF_OPEN
    br.record_success()
    assert br.state == BreakerState.CLOSED


def test_breaker_registry_raises_when_open():
    reg = BreakerRegistry()
    br = reg.get("board_x")
    br.failure_threshold = 1
    br.cooldown_sec = 60

    def boom():
        raise RuntimeError("down")

    try:
        reg.call("board_x", boom)
    except RuntimeError:
        pass
    assert br.state == BreakerState.OPEN
    try:
        reg.call("board_x", lambda: 1)
        assert False, "should raise CircuitOpenError"
    except CircuitOpenError as e:
        assert e.board == "board_x"


def test_protected_fetch_degrades_to_empty():
    def boom():
        raise RuntimeError("network")

    # trip breaker
    for _ in range(5):
        rows = protected_fetch("test_board_degrade", boom)
        assert rows == []
    # still empty when open
    rows = protected_fetch("test_board_degrade", boom)
    assert rows == []


def test_token_bucket_rate_limit():
    tb = TokenBucket(rate_per_min=60, burst=2)
    assert tb.allow("ip1")
    assert tb.allow("ip1")
    assert not tb.allow("ip1")  # burst exhausted
    assert tb.allow("ip2")  # other key independent


def test_enterprise_status_shape():
    st = enterprise_status()
    assert st["grade"] == "enterprise"
    assert "cache" in st
    assert "circuit_breakers" in st
    assert "capabilities" in st
    assert "fingerprint_cache" in st["capabilities"]
    assert liveness()["status"] == "alive"
    r = readiness()
    assert "ready" in r


def test_pipeline_cache_roundtrip():
    """Same seed profile twice → second hit from cache (offline path)."""
    # isolate: clear global cache
    global_cache().invalidate()
    profile = {
        "target_title": "Software Engineer Enterprise Cache Test",
        "skills": ["python", "fastapi"],
        "summary": "enterprise cache unit test",
    }
    r1 = run_research_team(
        profile,
        use_live=False,
        include_seed=True,
        exclude_linkedin=True,
        location="us",
        limit=40,
    )
    assert r1["ok"]
    assert r1.get("cache", {}).get("served_from_cache") is False
    assert r1.get("request_id")
    r2 = run_research_team(
        profile,
        use_live=False,
        include_seed=True,
        exclude_linkedin=True,
        location="us",
        limit=40,
    )
    assert r2.get("cache", {}).get("served_from_cache") is True
    assert r2.get("cache", {}).get("status") in ("hit", "stale")
    # ranked count stable
    assert len(r1.get("ranked_jobs") or []) == len(r2.get("ranked_jobs") or [])


def test_bypass_cache():
    global_cache().invalidate()
    profile = {
        "target_title": "Bypass Cache Engineer",
        "skills": ["go"],
        "summary": "bypass",
    }
    run_research_team(
        profile, use_live=False, include_seed=True, exclude_linkedin=True, limit=40
    )
    r = run_research_team(
        profile,
        use_live=False,
        include_seed=True,
        exclude_linkedin=True,
        limit=40,
        bypass_cache=True,
    )
    assert r.get("cache", {}).get("served_from_cache") is False


def test_product_version_enterprise():
    # PRODUCT_VERSION is semver major.minor.patch (v3.x Marvel / hub era)
    parts = PRODUCT_VERSION.split(".")
    assert len(parts) >= 2
    assert parts[0].isdigit() and int(parts[0]) >= 3
    assert PRODUCT_GRADE == "enterprise"


def test_materialize_cached_run_no_deepcopy():
    jobs = [{"id": "1", "title": "Eng", "scores": {"ensemble": 90}}]
    cached = {
        "ok": True,
        "request_id": "old",
        "ranked_jobs": jobs,
        "meta": {"elapsed_ms": 999, "fingerprint": "abc"},
        "cache": {"fingerprint": "abc"},
        "enterprise": {"request_id": "old"},
    }
    out = materialize_cached_run(
        cached, request_id="new-rid", cache_status="hit", elapsed_ms=0.4
    )
    assert out["request_id"] == "new-rid"
    assert out["cache"]["served_from_cache"] is True
    assert out["meta"]["elapsed_ms"] == 0.4
    assert out["meta"]["request_id"] == "new-rid"
    # Jobs list shared (immutable contract) — identity equality
    assert out["ranked_jobs"] is jobs
    # Outer envelope is a new dict
    assert out is not cached


def test_token_bucket_prunes_when_over_cap():
    tb = TokenBucket(rate_per_min=600, burst=10)
    tb.MAX_KEYS = 20
    tb.PRUNE_IDLE_SEC = 0.0  # treat all as idle once over cap
    for i in range(40):
        assert tb.allow(f"client-{i}") is True
    assert len(tb._buckets) < 40
    assert tb.pruned > 0


def main() -> int:
    tests = [
        test_request_id_format,
        test_fingerprint_stable,
        test_fingerprint_changes_on_title,
        test_cache_hit_miss_stale,
        test_cache_eviction,
        test_circuit_opens_after_threshold,
        test_circuit_half_open_recovery,
        test_breaker_registry_raises_when_open,
        test_protected_fetch_degrades_to_empty,
        test_token_bucket_rate_limit,
        test_enterprise_status_shape,
        test_pipeline_cache_roundtrip,
        test_bypass_cache,
        test_product_version_enterprise,
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
