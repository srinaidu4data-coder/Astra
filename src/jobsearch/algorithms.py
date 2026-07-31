"""
Math / science–inspired job–candidate matching.

Ensemble of classical IR + discrete optimization + information theory:
  - BM25 (Robertson et al.) — term importance under document length prior
  - Cosine similarity on TF skill vectors (Salton vector-space model)
  - Jaccard set overlap — requirement coverage
  - Softmax-weighted multi-criteria utility (decision theory)
  - Shannon entropy over skill coverage — opportunity diversity
  - Graph degree centrality on skill co-occurrence (social / network science)
  - Greedy set cover for upskill recommendations (approx. NP-hard cover)
  - Elo-style pairwise preference (rating systems)
  - Bayesian-ish posterior fit given observed skill hits
  - Spectral adjacency score for career-path distance

None of these call LLMs; they are deterministic and fast for localhost lab use.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from typing import Any, Iterable

_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9\+\#\.\-]{1,32}")


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


def skill_set(text: str, extra: Iterable[str] | None = None) -> set[str]:
    toks = set(tokenize(text))
    if extra:
        toks |= {e.strip().lower() for e in extra if e and str(e).strip()}
    # normalize common aliases
    aliases = {
        "js": "javascript",
        "ts": "typescript",
        "py": "python",
        "ml": "machinelearning",
        "ai": "artificialintelligence",
        "k8s": "kubernetes",
        "postgres": "postgresql",
        "reactjs": "react",
        "nodejs": "node",
    }
    out: set[str] = set()
    for t in toks:
        out.add(aliases.get(t, t.replace(".", "").replace("-", "")))
    return out


def tf_vector(tokens: list[str]) -> dict[str, float]:
    c = Counter(tokens)
    if not c:
        return {}
    n = float(sum(c.values()))
    return {k: v / n for k, v in c.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) & set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na <= 0 or nb <= 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def bm25_score(
    query_tokens: list[str],
    doc_tokens: list[str],
    *,
    avgdl: float,
    df: dict[str, int],
    n_docs: int,
    k1: float = 1.2,
    b: float = 0.75,
) -> float:
    """Okapi BM25 (Robertson / Zaragoza)."""
    if not query_tokens or not doc_tokens or n_docs <= 0:
        return 0.0
    tf = Counter(doc_tokens)
    dl = len(doc_tokens)
    score = 0.0
    for q in set(query_tokens):
        f = tf.get(q, 0)
        if f <= 0:
            continue
        n_q = df.get(q, 0)
        idf = math.log(1.0 + (n_docs - n_q + 0.5) / (n_q + 0.5))
        denom = f + k1 * (1.0 - b + b * dl / max(avgdl, 1.0))
        score += idf * (f * (k1 + 1.0)) / max(denom, 1e-9)
    # squash to ~[0,1]
    return 1.0 - math.exp(-score / 8.0)


def shannon_entropy(probs: list[float]) -> float:
    """Information-theoretic diversity of a discrete distribution."""
    h = 0.0
    for p in probs:
        if p > 0:
            h -= p * math.log(p + 1e-12, 2)
    return h


def skill_graph_centrality(jobs: list[dict[str, Any]]) -> dict[str, float]:
    """
    Degree centrality on skill co-occurrence graph:
    skills that appear with many other skills score higher (network science).
    """
    co: dict[str, set[str]] = defaultdict(set)
    for job in jobs:
        skills = list(skill_set(job.get("text", ""), job.get("skills") or []))
        for i, s in enumerate(skills):
            for t in skills:
                if s != t:
                    co[s].add(t)
    if not co:
        return {}
    max_deg = max(len(v) for v in co.values()) or 1
    return {s: len(nbrs) / max_deg for s, nbrs in co.items()}


def greedy_set_cover(
    universe: set[str], collections: list[tuple[str, set[str]]]
) -> list[str]:
    """Classic greedy approximation for set cover (Chvátal / Johnson)."""
    remaining = set(universe)
    chosen: list[str] = []
    pools = [(name, set(s)) for name, s in collections]
    while remaining and pools:
        best_i = -1
        best_gain = 0
        for i, (_name, s) in enumerate(pools):
            gain = len(s & remaining)
            if gain > best_gain:
                best_gain = gain
                best_i = i
        if best_i < 0 or best_gain == 0:
            break
        name, s = pools.pop(best_i)
        chosen.append(name)
        remaining -= s
    return chosen


def elo_rank(scores: list[float], k: float = 16.0) -> list[float]:
    """
    Pairwise Elo updates treating higher raw score as a win.
    Produces a smoothed ranking signal less sensitive to outliers.
    """
    n = len(scores)
    if n == 0:
        return []
    ratings = [1500.0] * n
    order = sorted(range(n), key=lambda i: scores[i], reverse=True)
    for a_idx in range(n):
        for b_idx in range(a_idx + 1, n):
            i, j = order[a_idx], order[b_idx]
            # i ranked above j in raw score
            ea = 1.0 / (1.0 + 10 ** ((ratings[j] - ratings[i]) / 400.0))
            ratings[i] += k * (1.0 - ea)
            ratings[j] += k * (0.0 - (1.0 - ea))
    # normalize to 0-1
    lo, hi = min(ratings), max(ratings)
    if hi - lo < 1e-9:
        return [0.5] * n
    return [(r - lo) / (hi - lo) for r in ratings]


def bayesian_fit(hits: int, required: int, prior: float = 0.35) -> float:
    """
    Beta-Binomial style posterior mean:
      posterior = (prior_a + hits) / (prior_a + prior_b + required)
    with prior mapped to pseudo-counts.
    """
    if required <= 0:
        return prior
    a = prior * 4.0
    b = (1.0 - prior) * 4.0
    return (a + hits) / (a + b + required)


def spectral_path_distance(
    candidate_skills: set[str], job_skills: set[str], skill_neighbors: dict[str, set[str]]
) -> float:
    """
    1-hop adjacency similarity: fraction of job skills reachable from candidate
    skills via co-occurrence graph (spectral / diffusion intuition, truncated).
    """
    if not job_skills:
        return 0.5
    reachable = set(candidate_skills)
    for s in list(candidate_skills):
        reachable |= skill_neighbors.get(s, set())
    hit = len(reachable & job_skills)
    return hit / max(len(job_skills), 1)


def ensemble_rank(
    profile_text: str,
    profile_skills: list[str],
    jobs: list[dict[str, Any]],
    *,
    weights: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """
    Multi-algorithm ensemble. Returns jobs sorted by ensemble score with
    per-algorithm breakdown for RT agent transparency.
    """
    w = {
        "bm25": 0.22,
        "cosine": 0.18,
        "jaccard": 0.18,
        "bayes": 0.14,
        "centrality": 0.08,
        "spectral": 0.08,
        "elo": 0.07,
        "diversity_bonus": 0.05,
    }
    if weights:
        w.update(weights)

    q_tokens = tokenize(profile_text) + [s.lower() for s in profile_skills]
    cand_skills = skill_set(profile_text, profile_skills)
    q_vec = tf_vector(q_tokens)

    # corpus stats for BM25
    docs = [tokenize(j.get("text", "") + " " + " ".join(j.get("skills") or [])) for j in jobs]
    avgdl = sum(len(d) for d in docs) / max(len(docs), 1)
    df: dict[str, int] = defaultdict(int)
    for d in docs:
        for t in set(d):
            df[t] += 1
    n_docs = len(docs)

    centrality = skill_graph_centrality(jobs)
    neighbors: dict[str, set[str]] = defaultdict(set)
    for job in jobs:
        sk = list(skill_set(job.get("text", ""), job.get("skills") or []))
        for s in sk:
            for t in sk:
                if s != t:
                    neighbors[s].add(t)

    raw_rows: list[dict[str, Any]] = []
    for i, job in enumerate(jobs):
        jtext = job.get("text", "")
        jskills = skill_set(jtext, job.get("skills") or [])
        j_tokens = docs[i]
        j_vec = tf_vector(j_tokens)

        s_bm25 = bm25_score(q_tokens, j_tokens, avgdl=avgdl, df=df, n_docs=n_docs)
        s_cos = cosine(q_vec, j_vec)
        s_jac = jaccard(cand_skills, jskills)
        req = list(job.get("skills") or []) or list(jskills)[:12]
        hits = sum(1 for r in req if r.lower().replace(" ", "") in cand_skills or r.lower() in cand_skills)
        s_bayes = bayesian_fit(hits, max(len(req), 1))
        # boost if job skills are high-centrality (transferable market skills)
        cent = 0.0
        if jskills and centrality:
            cent = sum(centrality.get(s, 0.0) for s in jskills) / max(len(jskills), 1)
        s_spec = spectral_path_distance(cand_skills, jskills, neighbors)

        raw_rows.append(
            {
                "job": job,
                "bm25": s_bm25,
                "cosine": s_cos,
                "jaccard": s_jac,
                "bayes": s_bayes,
                "centrality": cent,
                "spectral": s_spec,
                "hits": hits,
                "required": len(req),
                "gap_skills": sorted(
                    {
                        r
                        for r in (job.get("skills") or [])
                        if r.lower().replace(" ", "") not in cand_skills
                        and r.lower() not in cand_skills
                    }
                )[:8],
            }
        )

    base = [
        0.35 * r["bm25"]
        + 0.25 * r["cosine"]
        + 0.25 * r["jaccard"]
        + 0.15 * r["bayes"]
        for r in raw_rows
    ]
    elo = elo_rank(base)

    # diversity: prefer jobs that add new skill clusters (entropy of coverage)
    covered: set[str] = set()
    diversity: list[float] = []
    order_by_base = sorted(range(len(raw_rows)), key=lambda i: base[i], reverse=True)
    temp_scores = [0.0] * len(raw_rows)
    for idx in order_by_base:
        jskills = skill_set(
            raw_rows[idx]["job"].get("text", ""),
            raw_rows[idx]["job"].get("skills") or [],
        )
        novel = len(jskills - covered)
        temp_scores[idx] = novel / max(len(jskills), 1) if jskills else 0.0
        covered |= jskills
    diversity = temp_scores

    # Softmax utility blend
    scored: list[dict[str, Any]] = []
    for i, r in enumerate(raw_rows):
        ensemble = (
            w["bm25"] * r["bm25"]
            + w["cosine"] * r["cosine"]
            + w["jaccard"] * r["jaccard"]
            + w["bayes"] * r["bayes"]
            + w["centrality"] * r["centrality"]
            + w["spectral"] * r["spectral"]
            + w["elo"] * elo[i]
            + w["diversity_bonus"] * diversity[i]
        )
        job = dict(r["job"])
        src = str(job.get("source") or "")
        is_synth = bool(
            job.get("is_synthetic") or src in ("seed_market", "seed")
        )
        # Product rule: live boards dominate; synthetic is practice-only
        if is_synth:
            ensemble = ensemble * 0.55
        else:
            ensemble = min(1.0, ensemble + 0.12)
        # Title match boost — profile tokens + skills (title-only signal)
        title_l = (job.get("title") or "").lower()
        qbits = [t for t in (profile_text or "").lower().split() if len(t) > 2][:12]
        skill_bits = [str(s).lower() for s in profile_skills if len(str(s)) > 2][:12]
        title_hits = sum(1 for t in set(qbits + skill_bits) if t in title_l)
        if title_hits and not is_synth:
            ensemble = min(1.0, ensemble + 0.04 * min(title_hits, 4))
        elif title_hits and is_synth:
            ensemble = min(1.0, ensemble + 0.005 * min(title_hits, 2))
        # Penalize weak title overlap even if body matched (defense in depth)
        if title_hits == 0 and not is_synth:
            ensemble = ensemble * 0.35
        job["is_synthetic"] = is_synth
        job["product_label"] = "practice" if is_synth else "live"
        job["title_hits"] = title_hits
        job["scores"] = {
            "ensemble": round(100 * ensemble, 1),
            "bm25": round(100 * r["bm25"], 1),
            "cosine": round(100 * r["cosine"], 1),
            "jaccard": round(100 * r["jaccard"], 1),
            "bayesian_fit": round(100 * r["bayes"], 1),
            "skill_centrality": round(100 * r["centrality"], 1),
            "spectral_path": round(100 * r["spectral"], 1),
            "elo": round(100 * elo[i], 1),
            "diversity": round(100 * diversity[i], 1),
        }
        job["skill_hits"] = r["hits"]
        job["skill_required"] = r["required"]
        job["gap_skills"] = r["gap_skills"]
        # Absolute IR bands — UI should treat as relative ranking aid only
        job["verdict"] = (
            "strong"
            if ensemble >= 0.72 and not is_synth
            else "good"
            if ensemble >= 0.55 and not is_synth
            else "moderate"
            if ensemble >= 0.4
            else "weak"
        )
        if is_synth:
            job["verdict"] = "practice"
        scored.append(job)

    scored.sort(key=lambda j: j["scores"]["ensemble"], reverse=True)
    return scored


def upskill_plan(
    profile_skills: list[str], ranked_jobs: list[dict[str, Any]], top_k: int = 8
) -> list[dict[str, Any]]:
    """Greedy set-cover of missing skills across top jobs."""
    cand = skill_set("", profile_skills)
    gap_counts: Counter[str] = Counter()
    for job in ranked_jobs[: top_k * 2]:
        for g in job.get("gap_skills") or []:
            gap_counts[g.lower()] += 1
    # treat each skill as a singleton set weighted by frequency
    universe = set(gap_counts.keys())
    collections = [(s, {s}) for s, _ in gap_counts.most_common(40)]
    order = greedy_set_cover(universe, collections)
    plan = []
    for s in order[:top_k]:
        plan.append(
            {
                "skill": s,
                "demand": gap_counts[s],
                "why": f"Appears in {gap_counts[s]} high-ranked openings you don't fully cover",
                "approx_hours": min(40, 6 + gap_counts[s] * 3),
            }
        )
    return plan
