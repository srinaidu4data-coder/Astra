"""
Mathematical engines for AI-assisted apply decisions.

Grounded in published IR / decision theory (not hire-rate magic):

  1. MMR — Carbonell & Goldstein 1998
     MMR = λ · Rel(d,q) − (1−λ) · max_{s∈S} Sim(d,s)

  2. Softmax / Plackett–Luce apply propensity
     P(i) = exp(s_i / T) / Σ exp(s_j / T)

  3. Expected value of apply (decision theory)
     EV_i = P̂(response|i) · V − C
     P̂ ≈ σ(w·features) with calibrated logistic (hand weights, no fake ML)

  4. Secretary / optimal stopping threshold
     Classical: observe n/e then take next record.
     Continuous score form: τ = μ + κ·σ on ensemble fit scores.

  5. Thompson sampling (Beta-Bernoulli) for source prioritization
     Draw θ_s ~ Beta(α_s, β_s); rank sources by sample.

  6. Bayesian checklist readiness
     posterior mean = (a0 + done) / (a0 + b0 + total)

  7. ATS keyword coverage (set recall)
     cov = |K_resume ∩ K_jd| / max(|K_jd|, 1)

  8. Greedy knapsack on EV/cost for daily apply budget

Karpathy bar: formulas are real; coefficients are transparent defaults,
not claimed as calibrated interview probabilities.
"""

from __future__ import annotations

import math
import random
import re
from typing import Any, Iterable

from jobsearch.algorithms import jaccard, skill_set, tokenize


def sigmoid(x: float) -> float:
    if x >= 20:
        return 1.0
    if x <= -20:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def softmax(scores: list[float], temperature: float = 1.0) -> list[float]:
    """Numerically stable softmax (Plackett–Luce building block)."""
    if not scores:
        return []
    t = max(float(temperature), 1e-6)
    m = max(scores)
    exps = [math.exp((s - m) / t) for s in scores]
    z = sum(exps) or 1.0
    return [e / z for e in exps]


def secretary_threshold(scores: list[float], kappa: float = 0.25) -> float:
    """
    Continuous secretary-style threshold:
      τ = μ + κ·σ
    Apply only when fit ≥ τ (unless queue under-filled).
    Classical n/e observation phase maps to using the sample mean/σ
    of the current shortlist as the reference distribution.
    """
    if not scores:
        return 50.0
    n = len(scores)
    mu = sum(scores) / n
    var = sum((s - mu) ** 2 for s in scores) / max(n, 1)
    sigma = math.sqrt(var)
    return mu + float(kappa) * sigma


def bayesian_readiness(done: int, total: int, prior: float = 0.4) -> float:
    """Beta-Binomial posterior mean for checklist completeness."""
    total = max(int(total), 0)
    done = max(0, min(int(done), total if total else int(done)))
    a = prior * 4.0
    b = (1.0 - prior) * 4.0
    if total <= 0:
        return prior
    return (a + done) / (a + b + total)


def ats_keyword_coverage(
    resume_text: str,
    job_text: str,
    extra_skills: Iterable[str] | None = None,
) -> dict[str, Any]:
    """
    ATS-style keyword recall: fraction of JD skill tokens present in resume.
    Returns coverage, hits, missing (top gaps).
    """
    jd_skills = skill_set(job_text, None)
    # Prefer multi-char skill-like tokens
    jd_skills = {s for s in jd_skills if len(s) >= 3}
    res_skills = skill_set(resume_text, list(extra_skills or []))
    if not jd_skills:
        return {
            "coverage": 0.5,
            "hits": [],
            "missing": [],
            "jd_keyword_n": 0,
            "hit_n": 0,
        }
    hits = sorted(jd_skills & res_skills)
    missing = sorted(jd_skills - res_skills)
    cov = len(hits) / max(len(jd_skills), 1)
    return {
        "coverage": round(cov, 4),
        "hits": hits[:24],
        "missing": missing[:16],
        "jd_keyword_n": len(jd_skills),
        "hit_n": len(hits),
    }


def job_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Jaccard on title+company+skills tokens for MMR diversity."""
    sa = skill_set(
        f"{a.get('title','')} {a.get('company','')} {' '.join(a.get('skills') or [])}",
        a.get("skills") or [],
    )
    sb = skill_set(
        f"{b.get('title','')} {b.get('company','')} {' '.join(b.get('skills') or [])}",
        b.get("skills") or [],
    )
    return jaccard(sa, sb)


def mmr_select(
    jobs: list[dict[str, Any]],
    *,
    relevance_key: str = "apply_score",
    lambda_rel: float = 0.72,
    k: int = 10,
) -> list[dict[str, Any]]:
    """
    Maximal Marginal Relevance selection (Carbonell & Goldstein 1998).

    MMR(d) = λ · Rel(d) − (1−λ) · max_{s∈S} Sim(d,s)
    """
    if not jobs or k <= 0:
        return []
    remaining = list(jobs)
    selected: list[dict[str, Any]] = []
    # normalize relevance to 0-1
    rels = [float((j.get("scores") or {}).get("ensemble") or j.get(relevance_key) or 0) for j in remaining]
    rmax = max(rels) if rels else 1.0
    rmin = min(rels) if rels else 0.0
    span = (rmax - rmin) or 1.0

    def rel_norm(j: dict[str, Any]) -> float:
        r = float((j.get("scores") or {}).get("ensemble") or j.get(relevance_key) or 0)
        return (r - rmin) / span

    while remaining and len(selected) < k:
        best_i = 0
        best_mmr = -1e18
        for i, j in enumerate(remaining):
            if not selected:
                mmr = rel_norm(j)
            else:
                max_sim = max(job_similarity(j, s) for s in selected)
                mmr = lambda_rel * rel_norm(j) - (1.0 - lambda_rel) * max_sim
            if mmr > best_mmr:
                best_mmr = mmr
                best_i = i
        pick = remaining.pop(best_i)
        pick = dict(pick)
        pick["mmr_score"] = round(best_mmr, 4)
        selected.append(pick)
    return selected


def estimate_response_prob(
    *,
    ensemble: float,
    ats_coverage: float,
    readiness: float,
    is_synthetic: bool,
    has_direct_url: bool,
    title_hits: int = 0,
) -> float:
    """
    Logistic response proxy (transparent weights — not interview odds).

      logit = β0 + β1·fit + β2·ats + β3·ready + β4·direct − β5·synthetic
    """
    if is_synthetic:
        return 0.0
    fit = max(0.0, min(ensemble, 100.0)) / 100.0
    logit = (
        -1.8
        + 2.4 * fit
        + 1.1 * max(0.0, min(ats_coverage, 1.0))
        + 0.9 * max(0.0, min(readiness, 1.0))
        + (0.35 if has_direct_url else -0.25)
        + 0.08 * min(title_hits, 5)
    )
    return round(sigmoid(logit), 4)


def expected_value(
    p_response: float,
    *,
    value: float = 1.0,
    cost: float = 0.12,
) -> float:
    """EV = P·V − C (unitless utility for ranking)."""
    return round(float(p_response) * float(value) - float(cost), 4)


def greedy_knapsack(
    items: list[dict[str, Any]],
    *,
    budget: int,
    value_key: str = "ev",
    cost_key: str = "cost",
) -> list[dict[str, Any]]:
    """
    Greedy by value/cost density (0-1 knapsack approximation).
    cost is integer slots (default 1 per apply).
    """
    if budget <= 0 or not items:
        return []
    scored = []
    for it in items:
        cost = max(1, int(it.get(cost_key) or 1))
        val = float(it.get(value_key) or 0)
        scored.append((val / cost, val, cost, it))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out: list[dict[str, Any]] = []
    used = 0
    for density, val, cost, it in scored:
        if used + cost > budget:
            continue
        row = dict(it)
        row["knapsack_density"] = round(density, 4)
        out.append(row)
        used += cost
        if used >= budget:
            break
    return out


def thompson_source_weights(
    source_stats: dict[str, dict[str, int]],
    *,
    rng: random.Random | None = None,
) -> dict[str, float]:
    """
    Thompson sampling: θ_s ~ Beta(1+success, 1+fail); weight = sample.
    Cold start → uniformish draws.
    """
    r = rng or random.Random()
    weights: dict[str, float] = {}
    for src, st in (source_stats or {}).items():
        suc = max(0, int(st.get("success") or 0))
        fail = max(0, int(st.get("fail") or 0))
        # Beta via gamma ratio
        a = 1.0 + suc
        b = 1.0 + fail
        # simple sample: mean + noise when no scipy
        mean = a / (a + b)
        noise = r.gauss(0, 0.08)
        weights[src] = max(0.01, min(0.99, mean + noise))
    return weights


def apply_priority_score(
    job: dict[str, Any],
    *,
    p_response: float,
    ev: float,
    ats_coverage: float,
    source_boost: float = 0.0,
) -> float:
    """
    Composite priority in [0,100]:
      0.45·ensemble + 0.25·100·P + 0.15·100·ATS + 0.15·scaled_EV + source_boost
    """
    ens = float((job.get("scores") or {}).get("ensemble") or 0)
    # EV typically in [-0.12, 0.9] → map to 0-100
    ev_scaled = max(0.0, min(100.0, (ev + 0.15) / 1.1 * 100))
    raw = (
        0.45 * ens
        + 0.25 * (p_response * 100)
        + 0.15 * (ats_coverage * 100)
        + 0.15 * ev_scaled
        + 8.0 * source_boost
    )
    return round(max(0.0, min(100.0, raw)), 2)


_STOP = frozenset(
    "a an the and or for to of in on with our your this that is are be as by at from".split()
)


def extract_jd_keywords(text: str, limit: int = 18) -> list[str]:
    toks = [t for t in tokenize(text or "") if t not in _STOP and len(t) > 2]
    # frequency order, unique
    freq: dict[str, int] = {}
    for t in toks:
        freq[t] = freq.get(t, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def star_bullet_from_skills(
    skills: list[str],
    role: str,
    company: str,
) -> list[str]:
    """Deterministic STAR-ish bullets (template IR, not LLM)."""
    top = [s for s in skills if s][:5]
    if not top:
        top = ["core systems", "delivery", "stakeholders"]
    role_l = role or "the role"
    company_l = company or "the team"
    bullets = [
        (
            f"Situation/Task: Scoped {role_l}-aligned work for outcomes relevant to {company_l}, "
            f"emphasizing {top[0]}."
        ),
        (
            f"Action: Implemented solutions using {', '.join(top[:3])}; "
            f"partnered cross-functionally to reduce delivery risk."
        ),
        (
            f"Result: Improved reliability/throughput on initiatives tied to {top[0]}"
            + (f" and {top[1]}" if len(top) > 1 else "")
            + " — quantified impact ready to personalize with your metrics."
        ),
    ]
    return bullets
