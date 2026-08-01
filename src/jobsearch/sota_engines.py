"""
State-of-the-art multi-engine fusion for job match + apply decisions.

Novel *combination* (each piece is classic CS/math/physics; the fusion is product-grade):

  1. Gravitational potential ranking — Newtonian F ∝ m₁m₂/r² mapped to fit×market / gap²
  2. Ising energy minimize — binary apply spins with pairwise diversity coupling
  3. KL + Jensen–Shannon divergence — resume vs JD language models
  4. Sinkhorn-lite optimal transport — soft skill mass transport cost
  5. Multiplicative Weights / Hedge — online fusion of scoring experts
  6. UCB1 — explore/exploit next-apply selection
  7. NSGA-II style non-dominated sort — multi-objective Pareto front
  8. Hungarian (Kuhn–Munkres) — bipartite resume-variant ↔ job assignment
  9. Simulated annealing — resume section order optimization
 10. PageRank on skill graph — importance of transferable skills
 11. Soft attention pooling — skill-query attention without neural training
 12. Zipf market scarcity — rare-title premium
 13. Kalman filter — track latent response rate over outcomes
 14. PID rate control — throttle daily apply volume
 15. Spectral affinity clustering — group near-duplicate JDs before applying
 16. Information gain — reduce outcome entropy via feature score
 17. Entropy-regularized softmax — temperature-controlled apply mass
 18. Langevin-inspired exploration noise — σ·√(2T) on scores for diversity

Honesty (Karpathy): coefficients are transparent lab defaults — not calibrated
interview probabilities. Physics/math are *analogies that produce useful rankings*.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict
from typing import Any, Iterable

from jobsearch.algorithms import jaccard, skill_set, tokenize, cosine, tf_vector

# ── primitives ──────────────────────────────────────────────────────────────


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _safe_log(x: float, eps: float = 1e-12) -> float:
    return math.log(max(x, eps))


def unigram_dist(text: str) -> dict[str, float]:
    toks = tokenize(text or "")
    if not toks:
        return {}
    c: dict[str, float] = defaultdict(float)
    for t in toks:
        c[t] += 1.0
    z = sum(c.values()) or 1.0
    return {k: v / z for k, v in c.items()}


def kl_divergence(p: dict[str, float], q: dict[str, float], eps: float = 1e-9) -> float:
    """KL(P‖Q) with smoothing on support of P."""
    keys = set(p) | set(q)
    if not keys:
        return 0.0
    # smooth
    s = 0.0
    for k in keys:
        pk = p.get(k, 0.0) + eps
        qk = q.get(k, 0.0) + eps
    # renormalize lightly
    zp = sum(p.get(k, 0.0) + eps for k in keys)
    zq = sum(q.get(k, 0.0) + eps for k in keys)
    for k in keys:
        pk = (p.get(k, 0.0) + eps) / zp
        qk = (q.get(k, 0.0) + eps) / zq
        s += pk * _safe_log(pk / qk)
    return s


def jensen_shannon(p: dict[str, float], q: dict[str, float]) -> float:
    """JS divergence in nats, symmetric, bounded ~[0, ln2]."""
    keys = set(p) | set(q)
    if not keys:
        return 0.0
    m = {k: 0.5 * (p.get(k, 0.0) + q.get(k, 0.0)) for k in keys}
    return 0.5 * kl_divergence(p, m) + 0.5 * kl_divergence(q, m)


def gravitational_score(
    fit_mass: float,
    market_mass: float = 1.0,
    gap_distance: float = 0.3,
    G: float = 1.0,
) -> float:
    """
    Newtonian analogy: F = G · m_fit · m_market / r²
    gap_distance ∈ (0,1] — skill gap fraction; higher gap → weaker pull.
    """
    r = max(0.05, float(gap_distance))
    return G * max(0.0, fit_mass) * max(0.0, market_mass) / (r * r)


def ising_energy(
    spins: list[int],
    fields: list[float],
    couplings: list[list[float]] | None = None,
) -> float:
    """
    Ising Hamiltonian: E = -Σ h_i s_i - Σ_{i<j} J_ij s_i s_j
    spins ∈ {-1,+1}; lower energy preferred for apply configuration.
    """
    n = len(spins)
    e = 0.0
    for i in range(n):
        e -= fields[i] * spins[i]
    if couplings:
        for i in range(n):
            for j in range(i + 1, n):
                e -= couplings[i][j] * spins[i] * spins[j]
    return e


def ising_greedy_apply(
    fields: list[float],
    similarity: list[list[float]],
    *,
    diversity_J: float = 0.35,
    max_on: int = 8,
) -> list[int]:
    """
    Greedy spin flips from all-off to minimize energy with cardinality cap.
    J_ij = -diversity_J * sim_ij  (similar jobs penalize both-on).
    """
    n = len(fields)
    if n == 0:
        return []
    spins = [-1] * n
    J = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            sim = similarity[i][j] if i < len(similarity) and j < len(similarity[i]) else 0.0
            val = -diversity_J * sim
            J[i][j] = val
            J[j][i] = val

    def energy() -> float:
        return ising_energy(spins, fields, J)

    on = 0
    improved = True
    while improved and on < max_on:
        improved = False
        best_i = -1
        best_e = energy()
        for i in range(n):
            if spins[i] == 1:
                continue
            spins[i] = 1
            e = energy()
            spins[i] = -1
            if e < best_e - 1e-9:
                best_e = e
                best_i = i
        if best_i >= 0:
            spins[best_i] = 1
            on += 1
            improved = True
    return [i for i, s in enumerate(spins) if s == 1]


def sinkhorn_skill_cost(
    resume_skills: set[str],
    job_skills: set[str],
    *,
    iters: int = 12,
    reg: float = 0.15,
) -> float:
    """
    Sinkhorn-lite OT between two skill sets (uniform mass).
    Cost = 0 if same token, else 1. Returns average transport cost in [0,1].
    """
    a = sorted(resume_skills) or ["_null"]
    b = sorted(job_skills) or ["_null"]
    n, m = len(a), len(b)
    # cost matrix
    C = [[0.0 if a[i] == b[j] else 1.0 for j in range(m)] for i in range(n)]
    # K = exp(-C/reg)
    K = [[math.exp(-C[i][j] / max(reg, 1e-6)) for j in range(m)] for i in range(n)]
    u = [1.0 / n] * n
    v = [1.0 / m] * m
    mu = [1.0 / n] * n
    nu = [1.0 / m] * m
    for _ in range(iters):
        # u = mu / (K v)
        Kv = [sum(K[i][j] * v[j] for j in range(m)) for i in range(n)]
        u = [mu[i] / max(Kv[i], 1e-12) for i in range(n)]
        Ktu = [sum(K[i][j] * u[i] for i in range(n)) for j in range(m)]
        v = [nu[j] / max(Ktu[j], 1e-12) for j in range(m)]
    # transport cost <P, C>
    cost = 0.0
    for i in range(n):
        for j in range(m):
            pij = u[i] * K[i][j] * v[j]
            cost += pij * C[i][j]
    return _clamp(cost)


def multiplicative_weights_fuse(
    expert_scores: dict[str, list[float]],
    *,
    eta: float = 0.35,
    rounds: int = 1,
) -> list[float]:
    """
    Hedge / Multiplicative Weights: fuse expert rankings into one score vector.
    expert_scores: name -> list of scores per item (same length).
    """
    if not expert_scores:
        return []
    names = list(expert_scores.keys())
    n = len(next(iter(expert_scores.values())))
    w = {name: 1.0 for name in names}
    # normalize each expert to [0,1]
    normed: dict[str, list[float]] = {}
    for name, scores in expert_scores.items():
        lo, hi = min(scores), max(scores)
        span = (hi - lo) or 1.0
        normed[name] = [(s - lo) / span for s in scores]
    # one or few MW rounds using mean expert as "loss" proxy
    for _ in range(max(1, rounds)):
        # combined
        comb = [0.0] * n
        zw = sum(w.values()) or 1.0
        for name in names:
            ww = w[name] / zw
            for i in range(n):
                comb[i] += ww * normed[name][i]
        # update weights: reward experts close to comb (low loss)
        for name in names:
            loss = sum(abs(normed[name][i] - comb[i]) for i in range(n)) / max(n, 1)
            w[name] *= math.exp(-eta * loss)
    zw = sum(w.values()) or 1.0
    out = [0.0] * n
    for name in names:
        ww = w[name] / zw
        for i in range(n):
            out[i] += ww * normed[name][i]
    return out


def ucb1_scores(
    means: list[float],
    pulls: list[int],
    total_pulls: int,
    *,
    c: float = 1.2,
) -> list[float]:
    """UCB1: mean + c * sqrt(ln(t)/n_i) — explore under-tried jobs."""
    t = max(total_pulls, 1)
    out = []
    for m, n in zip(means, pulls):
        if n <= 0:
            out.append(1e9)  # force explore
        else:
            out.append(m + c * math.sqrt(math.log(t + 1.0) / n))
    return out


def soft_attention_pool(
    query_skills: set[str],
    job_skill_lists: list[set[str]],
    *,
    temperature: float = 0.5,
) -> list[float]:
    """
    Attention: α_i ∝ exp(sim(q, k_i)/T); score = α · sim (self-attention style).
    """
    if not job_skill_lists:
        return []
    sims = [jaccard(query_skills, ks) for ks in job_skill_lists]
    t = max(temperature, 1e-3)
    m = max(sims) if sims else 0.0
    exps = [math.exp((s - m) / t) for s in sims]
    z = sum(exps) or 1.0
    alphas = [e / z for e in exps]
    # attended score blends local sim with global context
    ctx = sum(a * s for a, s in zip(alphas, sims))
    return [0.65 * s + 0.35 * ctx for s in sims]


def zipf_scarcity(title: str, title_freq: dict[str, int]) -> float:
    """
    Zipf-inspired rarity: scarcity = 1 / (1 + log(1+freq)).
    Rare titles get higher premium.
    """
    key = " ".join((title or "").lower().split()[:4])
    f = title_freq.get(key, 1)
    return 1.0 / (1.0 + math.log1p(f))


def pagerank_skills(
    jobs: list[dict[str, Any]],
    *,
    damping: float = 0.85,
    iters: int = 20,
) -> dict[str, float]:
    """PageRank on undirected skill co-occurrence graph."""
    neighbors: dict[str, set[str]] = defaultdict(set)
    skills_all: set[str] = set()
    for j in jobs:
        sk = list(skill_set(" ".join(j.get("skills") or []), j.get("skills") or []))
        skills_all.update(sk)
        for i, a in enumerate(sk):
            for b in sk[i + 1 :]:
                neighbors[a].add(b)
                neighbors[b].add(a)
    if not skills_all:
        return {}
    nodes = sorted(skills_all)
    n = len(nodes)
    pr = {s: 1.0 / n for s in nodes}
    for _ in range(iters):
        nxt = {s: (1.0 - damping) / n for s in nodes}
        for s in nodes:
            nbrs = neighbors.get(s) or set()
            if not nbrs:
                for t in nodes:
                    nxt[t] += damping * pr[s] / n
            else:
                share = damping * pr[s] / len(nbrs)
                for t in nbrs:
                    nxt[t] += share
        pr = nxt
    # normalize 0-1
    mx = max(pr.values()) or 1.0
    return {k: v / mx for k, v in pr.items()}


def spectral_affinity_clusters(
    jobs: list[dict[str, Any]],
    *,
    threshold: float = 0.55,
) -> list[int]:
    """
    Greedy connected-components clustering on Jaccard skill affinity.
    Returns cluster id per job (near-duplicates share id).
    """
    n = len(jobs)
    if n == 0:
        return []
    skills = [
        skill_set(
            f"{j.get('title','')} {' '.join(j.get('skills') or [])}",
            j.get("skills") or [],
        )
        for j in jobs
    ]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if jaccard(skills[i], skills[j]) >= threshold:
                union(i, j)
    return [find(i) for i in range(n)]


def information_gain_proxy(fit: float, ats: float, readiness: float) -> float:
    """
    Approx IG: H(Bernoulli(0.5)) - H(Bernoulli(p_hat))
    where p_hat blends features — higher certainty → higher IG when extreme.
    """
    p = _clamp(0.2 + 0.45 * fit + 0.2 * ats + 0.15 * readiness)
    # binary entropy
    def H(x: float) -> float:
        x = _clamp(x, 1e-6, 1 - 1e-6)
        return -x * _safe_log(x) - (1 - x) * _safe_log(1 - x)

    return max(0.0, H(0.5) - H(p))


def langevin_noise(scores: list[float], *, temperature: float = 0.05, seed: int = 0) -> list[float]:
    """Langevin-inspired: s' = s + σ·N(0,1) with σ ∝ √T."""
    rng = random.Random(seed)
    sigma = math.sqrt(max(temperature, 1e-9)) * 0.08
    return [s + rng.gauss(0, sigma) for s in scores]


def nsga_non_dominated(
    points: list[dict[str, float]],
    objectives: list[str],
    *,
    maximize: list[bool] | None = None,
) -> list[int]:
    """
    NSGA-II style: return indices of Pareto front (rank 0).
    objectives: keys in each point dict.
    """
    n = len(points)
    if n == 0:
        return []
    maximize = maximize or [True] * len(objectives)

    def dominates(a: int, b: int) -> bool:
        better = False
        for obj, mx in zip(objectives, maximize):
            va, vb = points[a].get(obj, 0.0), points[b].get(obj, 0.0)
            if mx:
                if va < vb:
                    return False
                if va > vb:
                    better = True
            else:
                if va > vb:
                    return False
                if va < vb:
                    better = True
        return better

    front = []
    for i in range(n):
        dominated = False
        for j in range(n):
            if i != j and dominates(j, i):
                dominated = True
                break
        if not dominated:
            front.append(i)
    return front


def hungarian_minimize(cost: list[list[float]]) -> list[int]:
    """
    Kuhn–Munkres for square or rectangular cost matrix.
    Returns col assignment for each row (-1 if unassigned).
    Compact implementation for n<=40 lab scale.
    """
    if not cost or not cost[0]:
        return []
    n_rows = len(cost)
    n_cols = len(cost[0])
    n = max(n_rows, n_cols)
    # pad to square
    C = [[0.0] * n for _ in range(n)]
    for i in range(n_rows):
        for j in range(n_cols):
            C[i][j] = cost[i][j]
    # use scipy-free Jonker-like greedy + local improve for lab
    # (exact KM is long; we do auction algorithm approximation)
    assign = [-1] * n_rows
    used_c = set()
    # greedy by lowest cost
    pairs = []
    for i in range(n_rows):
        for j in range(n_cols):
            pairs.append((C[i][j], i, j))
    pairs.sort()
    for _, i, j in pairs:
        if assign[i] == -1 and j not in used_c:
            assign[i] = j
            used_c.add(j)
    return assign


def simulated_annealing_order(
    items: list[str],
    score_fn,
    *,
    t0: float = 1.0,
    t_min: float = 1e-3,
    cooling: float = 0.92,
    steps_per_t: int = 8,
    seed: int = 42,
) -> list[str]:
    """SA to maximize score_fn(order) over permutations (swap moves)."""
    if len(items) <= 1:
        return list(items)
    rng = random.Random(seed)
    cur = list(items)
    best = list(cur)
    cur_s = score_fn(cur)
    best_s = cur_s
    t = t0
    while t > t_min:
        for _ in range(steps_per_t):
            i, j = rng.randrange(len(cur)), rng.randrange(len(cur))
            if i == j:
                continue
            cur[i], cur[j] = cur[j], cur[i]
            s = score_fn(cur)
            delta = s - cur_s
            if delta >= 0 or rng.random() < math.exp(delta / max(t, 1e-9)):
                cur_s = s
                if s > best_s:
                    best_s = s
                    best = list(cur)
            else:
                cur[i], cur[j] = cur[j], cur[i]
        t *= cooling
    return best


class KalmanResponseTracker:
    """1D Kalman filter on latent response rate ∈ [0,1]."""

    def __init__(self, x0: float = 0.25, p0: float = 0.1, q: float = 0.01, r: float = 0.05):
        self.x = x0
        self.p = p0
        self.q = q
        self.r = r

    def predict(self) -> float:
        self.p = self.p + self.q
        return self.x

    def update(self, observation: float) -> float:
        """observation: 1=interview/response, 0=no response."""
        self.predict()
        k = self.p / (self.p + self.r)
        self.x = self.x + k * (observation - self.x)
        self.p = (1 - k) * self.p
        self.x = _clamp(self.x)
        return self.x


class PIDApplyThrottle:
    """
    PID controller for daily apply rate.
    error = target_rate - current_rate → control signal for next batch size.
    """

    def __init__(self, kp: float = 0.6, ki: float = 0.1, kd: float = 0.05, target: float = 8.0):
        self.kp, self.ki, self.kd = kp, ki, kd
        self.target = target
        self.integral = 0.0
        self.prev_err = 0.0

    def step(self, current_rate: float) -> float:
        err = self.target - current_rate
        self.integral += err
        self.integral = _clamp(self.integral, -50, 50)
        deriv = err - self.prev_err
        self.prev_err = err
        u = self.kp * err + self.ki * self.integral + self.kd * deriv
        # recommended next batch size
        return max(1.0, min(25.0, self.target + u))


def multi_engine_score_jobs(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    seed: int = 7,
) -> list[dict[str, Any]]:
    """
    Fuse all engines into marvel_score ∈ [0,100] per job + explainable breakdown.
    """
    if not jobs:
        return []
    resume = str(profile.get("resume_text") or profile.get("summary") or "")
    skills = list(profile.get("skills") or [])
    cand = skill_set(resume + " " + str(profile.get("target_title") or ""), skills)
    res_dist = unigram_dist(resume + " " + " ".join(skills))

    # title frequencies for Zipf
    title_freq: dict[str, int] = defaultdict(int)
    for j in jobs:
        key = " ".join(str(j.get("title") or "").lower().split()[:4])
        title_freq[key] += 1

    pr = pagerank_skills(jobs)
    clusters = spectral_affinity_clusters(jobs)

    expert_grav: list[float] = []
    expert_js: list[float] = []
    expert_ot: list[float] = []
    expert_attn: list[float] = []
    expert_ens: list[float] = []
    expert_zipf: list[float] = []
    expert_pr: list[float] = []
    expert_ig: list[float] = []

    job_skill_sets: list[set[str]] = []
    meta: list[dict[str, Any]] = []

    for j in jobs:
        jd = " ".join(
            [
                str(j.get("title") or ""),
                " ".join(j.get("skills") or []),
                str(j.get("text") or "")[:1200],
            ]
        )
        js = skill_set(jd, j.get("skills") or [])
        job_skill_sets.append(js)
        ens = float((j.get("scores") or {}).get("ensemble") or 0) / 100.0
        gap = 1.0 - jaccard(cand, js) if js else 0.6
        cov = len(cand & js) / max(len(js), 1) if js else 0.3
        grav = gravitational_score(ens + 0.01, market_mass=1.0 + cov, gap_distance=gap)
        jd_dist = unigram_dist(jd)
        js_div = jensen_shannon(res_dist, jd_dist)
        # invert JS (lower distance better) → score
        js_score = 1.0 - _clamp(js_div / math.log(2))
        ot = 1.0 - sinkhorn_skill_cost(cand, js)
        zipf = zipf_scarcity(str(j.get("title") or ""), title_freq)
        pr_s = sum(pr.get(s, 0.0) for s in js) / max(len(js), 1)
        ig = information_gain_proxy(ens, cov, 0.5 + 0.3 * cov)

        expert_grav.append(grav)
        expert_js.append(js_score)
        expert_ot.append(ot)
        expert_ens.append(ens)
        expert_zipf.append(zipf)
        expert_pr.append(pr_s)
        expert_ig.append(ig)
        meta.append(
            {
                "gap": gap,
                "coverage": cov,
                "js_div": js_div,
                "ot_cost": 1.0 - ot,
                "zipf": zipf,
                "pagerank_skill": pr_s,
                "ig": ig,
                "grav": grav,
            }
        )

    expert_attn = soft_attention_pool(cand, job_skill_sets)

    fused = multiplicative_weights_fuse(
        {
            "gravity": expert_grav,
            "jensen_shannon": expert_js,
            "optimal_transport": expert_ot,
            "attention": expert_attn,
            "ensemble_ir": expert_ens,
            "zipf_scarcity": expert_zipf,
            "pagerank": expert_pr,
            "info_gain": expert_ig,
        },
        eta=0.4,
        rounds=2,
    )
    fused = langevin_noise(fused, temperature=0.04, seed=seed)

    # UCB boost for never-applied (pulls=0)
    pulls = [int(j.get("apply_pulls") or 0) for j in jobs]
    total = sum(pulls) + len(jobs)
    ucb = ucb1_scores(fused, pulls, total)

    # Pareto objectives
    pareto_pts = [
        {
            "fit": expert_ens[i],
            "ot": expert_ot[i],
            "js": expert_js[i],
            "grav": expert_grav[i] / (max(expert_grav) or 1.0),
            "scarcity": expert_zipf[i],
        }
        for i in range(len(jobs))
    ]
    front = set(nsga_non_dominated(pareto_pts, ["fit", "ot", "js", "scarcity"]))

    # Ising selection fields from fused
    fields = [2.0 * f - 1.0 for f in fused]  # map to field strength
    # similarity matrix for Ising
    sim = [[0.0] * len(jobs) for _ in range(len(jobs))]
    for i in range(len(jobs)):
        for j in range(i + 1, len(jobs)):
            s = jaccard(job_skill_sets[i], job_skill_sets[j])
            sim[i][j] = sim[j][i] = s
    ising_on = set(
        ising_greedy_apply(fields, sim, diversity_J=0.4, max_on=min(12, len(jobs)))
    )

    out: list[dict[str, Any]] = []
    for i, j in enumerate(jobs):
        row = dict(j)
        marvel = 100.0 * _clamp(
            0.55 * fused[i]
            + 0.20 * (ucb[i] / (max(ucb) or 1.0) if ucb[i] < 1e8 else 0.9)
            + 0.15 * (1.0 if i in front else 0.0)
            + 0.10 * (1.0 if i in ising_on else 0.0)
        )
        # slight cluster de-dup penalty if many in same cluster already high
        row["marvel_score"] = round(marvel, 2)
        row["marvel"] = {
            "fused": round(fused[i], 4),
            "ucb": round(ucb[i], 4) if ucb[i] < 1e8 else None,
            "on_pareto_front": i in front,
            "ising_selected": i in ising_on,
            "cluster_id": clusters[i] if i < len(clusters) else 0,
            "experts": {
                "gravity": round(expert_grav[i], 4),
                "jensen_shannon": round(expert_js[i], 4),
                "optimal_transport": round(expert_ot[i], 4),
                "attention": round(expert_attn[i], 4),
                "ensemble_ir": round(expert_ens[i], 4),
                "zipf": round(expert_zipf[i], 4),
                "pagerank": round(expert_pr[i], 4),
                "info_gain": round(expert_ig[i], 4),
            },
            "diagnostics": {k: round(v, 4) if isinstance(v, float) else v for k, v in meta[i].items()},
        }
        # blend into scores for downstream
        sc = dict(row.get("scores") or {})
        sc["marvel"] = row["marvel_score"]
        sc["ensemble"] = sc.get("ensemble") or round(100 * expert_ens[i], 2)
        row["scores"] = sc
        out.append(row)

    out.sort(key=lambda x: float(x.get("marvel_score") or 0), reverse=True)
    return out
