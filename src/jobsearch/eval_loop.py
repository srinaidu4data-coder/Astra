"""
Karpathy-style auto eval loop for Job Search product quality.

Run:
  cd src && venv\\Scripts\\python.exe -m jobsearch.eval_loop

Gates (world-class bar):
  G1 title_precision  — every returned title matches domain/target
  G2 us_precision     — under location=us, zero non-US leaks
  G3 no_bare_remote   — no Remote/UNKNOWN without US text
  G4 no_nonlatin      — no Cyrillic/CJK titles under US
  G5 no_synthetic     — include_seed=False ⇒ zero synthetic
  G6 linkedin_when_on — exclude_linkedin=False ⇒ source has linkedin (or warn)
  G7 volume_floor     — US+LI allowed ⇒ ≥8 live results for SAP FICO
  G8 top_relevance    — top-5 all title-relevant (domain)
  G9 unit_suite       — golden unit tests pass
"""

from __future__ import annotations

import re
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable

from jobsearch.catalog import (
    is_strict_us_job,
    title_matches_query,
    _is_bare_remote_location,
    looks_non_us_listing,
)
from jobsearch.agents import run_research_team


NON_LATIN = re.compile(
    r"[\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u3040-\u30FF\uac00-\ud7af]"
)


@dataclass
class GateResult:
    name: str
    ok: bool
    detail: str
    score: float = 0.0  # 0-1


@dataclass
class LoopReport:
    iteration: int
    gates: list[GateResult] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    elapsed_ms: float = 0

    @property
    def all_ok(self) -> bool:
        return all(g.ok for g in self.gates)

    def print(self) -> None:
        print(f"\n═══ Iteration {self.iteration} ({self.elapsed_ms:.0f}ms) ═══")
        for g in self.gates:
            mark = "✓" if g.ok else "✗"
            print(f"  {mark} {g.name:22s}  score={g.score:.2f}  {g.detail}")
        if self.failures:
            print("  Failures:")
            for f in self.failures[:12]:
                print(f"    • {f}")


def _run_scenario(
    title: str,
    skills: list[str],
    *,
    location: str = "us",
    remote: str = "all",
    exclude_linkedin: bool = True,
    include_seed: bool = False,
) -> dict[str, Any]:
    return run_research_team(
        {
            "name": "Eval",
            "target_title": title,
            "summary": f"{title} {' '.join(skills)}",
            "skills": skills,
            "has_resume": True,
        },
        use_live=True,
        location=location,
        remote=remote,
        exclude_linkedin=exclude_linkedin,
        include_seed=include_seed,
        limit=120,
        has_resume=True,
    )


def eval_title_precision(jobs: list[dict], target: str) -> GateResult:
    if not jobs:
        return GateResult("title_precision", True, "empty set (ok)", 1.0)
    bad = [j for j in jobs if not title_matches_query(str(j.get("title") or ""), target)]
    ok = len(bad) == 0
    sample = (bad[0].get("title") if bad else "")[:50]
    return GateResult(
        "title_precision",
        ok,
        f"{len(jobs) - len(bad)}/{len(jobs)} ok" + (f" e.g. {sample}" if bad else ""),
        1.0 - len(bad) / max(len(jobs), 1),
    )


def eval_us_precision(jobs: list[dict]) -> GateResult:
    if not jobs:
        return GateResult("us_precision", True, "empty set", 1.0)
    bad = []
    for j in jobs:
        if not is_strict_us_job(j):
            bad.append(j)
        elif looks_non_us_listing(j):
            bad.append(j)
        elif _is_bare_remote_location(str(j.get("location") or "")):
            bad.append(j)
        elif NON_LATIN.search(str(j.get("title") or "")):
            bad.append(j)
        elif str(j.get("country") or "").lower() in (
            "eu",
            "in",
            "ca",
            "uk",
            "latam",
            "other",
        ):
            bad.append(j)
    ok = len(bad) == 0
    sample = ""
    if bad:
        b = bad[0]
        sample = f"{(b.get('title') or '')[:35]} @ {(b.get('location') or '')[:30]}"
    return GateResult(
        "us_precision",
        ok,
        f"{len(jobs) - len(bad)}/{len(jobs)} US" + (f" LEAK: {sample}" if bad else ""),
        1.0 - len(bad) / max(len(jobs), 1),
    )


def eval_no_synthetic(jobs: list[dict], include_seed: bool) -> GateResult:
    if include_seed:
        return GateResult("no_synthetic", True, "seed allowed", 1.0)
    synth = [j for j in jobs if j.get("is_synthetic") or j.get("source") in ("seed", "seed_market")]
    return GateResult(
        "no_synthetic",
        len(synth) == 0,
        f"synthetic={len(synth)}",
        1.0 if not synth else 0.0,
    )


def eval_linkedin(jobs: list[dict], exclude: bool, sources: list[str]) -> GateResult:
    if exclude:
        li = [j for j in jobs if str(j.get("source") or "") == "linkedin" or j.get("is_linkedin")]
        return GateResult(
            "linkedin_when_on",
            len(li) == 0,
            f"excluded mode li_rows={len(li)}",
            1.0 if not li else 0.0,
        )
    has_src = "linkedin" in (sources or [])
    li_n = sum(1 for j in jobs if str(j.get("source") or "") == "linkedin")
    # Pass if we got LinkedIn jobs OR source list includes linkedin (harvest attempted)
    ok = li_n >= 3 or has_src
    return GateResult(
        "linkedin_when_on",
        ok,
        f"linkedin_jobs={li_n} sources={sources}",
        min(1.0, li_n / 5.0) if li_n else (0.5 if has_src else 0.0),
    )


def eval_volume(jobs: list[dict], min_n: int = 8) -> GateResult:
    n = len(jobs)
    return GateResult(
        "volume_floor",
        n >= min_n,
        f"n={n} (need ≥{min_n})",
        min(1.0, n / max(min_n, 1)),
    )


def eval_top_relevance(jobs: list[dict], target: str, k: int = 5) -> GateResult:
    top = jobs[:k]
    if not top:
        return GateResult("top_relevance", False, "no jobs", 0.0)
    good = sum(1 for j in top if title_matches_query(str(j.get("title") or ""), target))
    return GateResult(
        "top_relevance",
        good == len(top),
        f"{good}/{len(top)} top titles match",
        good / len(top),
    )


def eval_unit_suite() -> GateResult:
    try:
        from jobsearch import test_product as tp

        tp.test_infer_country_location_wins()
        tp.test_us_filter_drops_non_us()
        tp.test_product_default_no_seed()
        tp.test_practice_market_opt_in()
        tp.test_seed_ranked_below_live()
        tp.test_query_gate_sap()
        tp.test_run_product_live_first_offline_seed_off()
        return GateResult("unit_suite", True, "all golden tests passed", 1.0)
    except Exception as e:
        return GateResult("unit_suite", False, f"{type(e).__name__}: {e}", 0.0)


def run_iteration(iteration: int) -> LoopReport:
    t0 = time.perf_counter()
    report = LoopReport(iteration=iteration)
    target = "SAP FICO Consultant"
    skills = ["sap", "fico", "s4hana", "tax", "controlling"]

    # A) US + non-LinkedIn + all work modes
    a = _run_scenario(target, skills, location="us", exclude_linkedin=True)
    jobs_a = a.get("ranked_jobs") or []
    report.gates.append(eval_title_precision(jobs_a, target))
    report.gates.append(eval_us_precision(jobs_a))
    report.gates.append(eval_no_synthetic(jobs_a, False))
    report.gates.append(eval_top_relevance(jobs_a, target))

    # B) US + LinkedIn allowed (volume + linkedin)
    b = _run_scenario(target, skills, location="us", exclude_linkedin=False)
    jobs_b = b.get("ranked_jobs") or []
    sources_b = (b.get("agents") or {}).get("harvester", {}).get("sources") or []
    report.gates.append(eval_us_precision(jobs_b))
    report.gates.append(eval_linkedin(jobs_b, False, sources_b))
    report.gates.append(eval_volume(jobs_b, min_n=8))
    report.gates.append(eval_title_precision(jobs_b, target))

    # C) US + remote only (the failure mode from screenshot)
    c = _run_scenario(
        target, skills, location="us", remote="remote", exclude_linkedin=False
    )
    jobs_c = c.get("ranked_jobs") or []
    report.gates.append(eval_us_precision(jobs_c))
    report.gates.append(eval_title_precision(jobs_c, target))
    # no bare remote / non-latin
    bare = [
        j
        for j in jobs_c
        if _is_bare_remote_location(str(j.get("location") or ""))
        or NON_LATIN.search(str(j.get("title") or ""))
        or str(j.get("country") or "").lower() == "unknown"
    ]
    report.gates.append(
        GateResult(
            "no_bare_remote",
            len(bare) == 0,
            f"bad_remote_or_unknown={len(bare)}"
            + (
                f" e.g. {(bare[0].get('title') or '')[:30]} @ {bare[0].get('location')}"
                if bare
                else ""
            ),
            1.0 if not bare else 0.0,
        )
    )

    # D) React engineer sanity (generic domain)
    d = _run_scenario(
        "Senior React Engineer",
        ["react", "typescript", "frontend"],
        location="us",
        exclude_linkedin=True,
    )
    jobs_d = d.get("ranked_jobs") or []
    report.gates.append(eval_title_precision(jobs_d, "Senior React Engineer"))
    report.gates.append(eval_us_precision(jobs_d))

    report.gates.append(eval_unit_suite())

    for g in report.gates:
        if not g.ok:
            report.failures.append(f"{g.name}: {g.detail}")

    report.elapsed_ms = (time.perf_counter() - t0) * 1000
    return report


# ── Auto-fixes applied when gates fail ──────────────────────────────────────

def auto_fix_from_report(report: LoopReport) -> list[str]:
    """
    Apply code-level auto-fixes for known failure modes.
    Returns list of fix descriptions applied.
    """
    applied: list[str] = []
    fail_names = {g.name for g in report.gates if not g.ok}

    # Fix pack is applied via catalog patches when we detect patterns
    # (most fixes already in catalog; this reloads modules after manual patches)
    if "us_precision" in fail_names or "no_bare_remote" in fail_names:
        # Reinforce post-rank US filter in agents if missing
        try:
            import jobsearch.agents as agents
            import jobsearch.catalog as catalog

            src = open(agents.__file__, encoding="utf-8").read()
            if "is_strict_us_job" not in src or "post_us_filter" not in src:
                # inject post-rank US filter — done in fix_agents_post_filter()
                fix_agents_post_filter()
                applied.append("agents: post-rank strict US filter")
            # Reload
            import importlib

            importlib.reload(catalog)
            importlib.reload(agents)
        except Exception as e:
            applied.append(f"us fix error: {e}")

    if "title_precision" in fail_names or "top_relevance" in fail_names:
        try:
            fix_title_gate_stricter()
            applied.append("catalog: stricter title gate + rank drop")
        except Exception as e:
            applied.append(f"title fix error: {e}")

    if "linkedin_when_on" in fail_names:
        try:
            fix_linkedin_retry()
            applied.append("catalog: linkedin multi-query + location variants")
        except Exception as e:
            applied.append(f"linkedin fix error: {e}")

    return applied


def fix_agents_post_filter() -> None:
    """Ensure run_research_team re-applies strict US after rank."""
    path = __file__.replace("eval_loop.py", "agents.py")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if "post_us_filter" in src:
        return
    # Insert after title filter block
    needle = "dropped_title = before_title - len(ranked)"
    if needle not in src:
        return
    patch = '''
    # post_us_filter — never return non-US under location=us
    if str(location or "").lower() in ("us", "usa", "united states", "u.s."):
        from jobsearch.catalog import is_strict_us_job
        before_us = len(ranked)
        ranked = [j for j in ranked if is_strict_us_job(j)]
        dropped_us = before_us - len(ranked)
        if dropped_us:
            harvest.setdefault("diagnostics", {}).setdefault("warnings", []).append(
                f"Dropped {dropped_us} non-US roles after ranking (post_us_filter)."
            )
'''
    src = src.replace(needle, needle + patch)
    # ensure import available
    if "is_strict_us_job" not in src.split("def run_research_team")[0]:
        src = src.replace(
            "from jobsearch.catalog import load_jobs, title_matches_query",
            "from jobsearch.catalog import is_strict_us_job, load_jobs, title_matches_query",
        )
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)


def fix_title_gate_stricter() -> None:
    """Bump domain rules: require stronger title anchors for SAP family."""
    path = __file__.replace("eval_loop.py", "catalog.py")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if "TITLE_MIN_DOMAIN_SCORE" in src:
        return
    # Already have title_matches_query — add secondary SAP finance requirement
    marker = "def title_matches_query(job_title: str, query: str, *, min_overlap: int = 1) -> bool:"
    if marker not in src:
        return
    # inject finance-family preference after domain_title_ok check
    old = '''    if not domain_title_ok(job_title, query):
        return False

    q_toks = [t for t in relevance_tokens(query) if t not in ("finance",)]  # too broad alone'''
    new = '''    if not domain_title_ok(job_title, query):
        return False

    # TITLE_MIN_DOMAIN_SCORE: for SAP searches, prefer FICO/FI/CO/S4 in title over bare "SAP Specialist"
    ql = (query or "").lower()
    tl = (job_title or "").lower()
    if any(x in ql for x in ("fico", "fi/co", "s4hana", "s/4")):
        # allow FI, CO, FICO, Controlling, Finance with SAP
        if "sap" in tl and not any(
            x in tl
            for x in (
                "fico",
                "fi/co",
                "fi-co",
                "fi co",
                " fi ",
                " co ",
                "controlling",
                "finance",
                "s/4",
                "s4",
                "treasury",
                "tax",
                "vertex",
                "rar",
                "lease",
            )
        ):
            # bare "SAP Specialist / ABAP" without finance signal — drop for FICO queries
            if any(x in tl for x in ("abap", "basis", "security", "mm/sd", " mm ", " sd ", "hr", "successfactors")):
                return False

    q_toks = [t for t in relevance_tokens(query) if t not in ("finance",)]  # too broad alone'''
    if old in src:
        src = src.replace(old, new)
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)


def fix_linkedin_retry() -> None:
    path = __file__.replace("eval_loop.py", "catalog.py")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if "LINKEDIN_LOC_VARIANTS" in src:
        return
    old = '''            if not exclude_linkedin:
                # Primary + one expanded query — keep volume low (ToS-friendly)
                for q in qlist[:2]:
                    tasks.append(
                        ex.submit(
                            _safe,
                            f"linkedin:{q[:40]}",
                            fetch_linkedin_guest,
                            q,
                            location=li_location,
                            limit=30,
                            remote_only=remote_only,
                        )
                    )'''
    new = '''            if not exclude_linkedin:
                # LINKEDIN_LOC_VARIANTS — primary query × US location variants
                li_locs = [li_location]
                if li_location.lower() in ("united states", "usa", "us"):
                    li_locs = ["United States", "United States of America"]
                for q in qlist[:3]:
                    for locv in li_locs[:2]:
                        tasks.append(
                            ex.submit(
                                _safe,
                                f"linkedin:{q[:30]}:{locv[:12]}",
                                fetch_linkedin_guest,
                                q,
                                location=locv,
                                limit=25,
                                remote_only=remote_only,
                            )
                        )'''
    if old in src:
        src = src.replace(old, new)
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)


def main(max_iters: int = 4) -> int:
    print("Job Search — Karpathy auto loop")
    print("World-class gates: title · US · synthetic · LinkedIn · volume · units\n")
    best_score = -1.0
    last: LoopReport | None = None

    for i in range(1, max_iters + 1):
        # fresh imports each iteration
        import importlib
        import jobsearch.catalog as c
        import jobsearch.agents as a
        import jobsearch.algorithms as al

        importlib.reload(c)
        importlib.reload(al)
        importlib.reload(a)

        report = run_iteration(i)
        report.print()
        last = report
        score = sum(g.score for g in report.gates) / max(len(report.gates), 1)
        print(f"  Aggregate score: {score:.3f}")
        best_score = max(best_score, score)

        if report.all_ok:
            print("\n★ ALL GATES GREEN — world-class bar met.")
            return 0

        print("\n  Applying auto-fixes…")
        fixes = auto_fix_from_report(report)
        if fixes:
            for f in fixes:
                print(f"    → {f}")
        else:
            print("    → no automatic fix available; hard-coding remaining guards…")
            # Force apply all fix packs once
            try:
                fix_agents_post_filter()
                fix_title_gate_stricter()
                fix_linkedin_retry()
                print("    → applied full fix pack")
            except Exception as e:
                print(f"    → fix pack error: {e}")
                traceback.print_exc()

        time.sleep(0.3)

    print(f"\nLoop finished. Best score={best_score:.3f}")
    if last and not last.all_ok:
        print("Remaining failures:")
        for f in last.failures:
            print(f"  • {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
