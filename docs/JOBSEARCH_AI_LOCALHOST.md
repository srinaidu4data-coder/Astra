# Job Search (Enterprise v3 · localhost default)

Isolated job-search module inside InterviewPulse. **Live boards first.** Practice (synthetic) market is opt-in and labeled.

Enable outside localhost only with `JOBSEARCH_AI_ENABLED=1`.

Product version: `PRODUCT_VERSION` in `src/jobsearch/agents.py` (currently **3.x**).

## Product principles

1. **Honest inventory** — Default results are live postings only (freehire, Remotive, Arbeitnow, LinkedIn guest). No silent seed padding.
2. **Practice market is opt-in** — Synthetic roles for ranking drills; amber **practice** badge; not auto-tracked as applied.
3. **Stages, not agent theater** — Deterministic pipeline: expand → harvest → IR rank → review → drafts → next steps. Fit scores are relative similarity, **not** hire probability.
4. **Filter integrity** — Location / LinkedIn policy are not silently dropped. Soft recovery is limited to work-mode and is returned in `warnings`.
5. **Server is source of truth** — One filter pass on the API; UI shows run filters from the response.
6. **Enterprise control plane** — Fingerprint cache, per-board circuit breakers, request IDs, rate limits, liveness/readiness, process supervisor.
7. **One Jobs hub** — Search, Auto Apply, playbooks (Nexus / career-ops / ApplyPilot / AIHawk / HITL / Autofill), and Night Scout share one page; deep links under `#/jobsearch/*`.

## career-ops (separate project)

Standalone clone of [santifer/career-ops](https://github.com/santifer/career-ops) (MIT):

- Path: `career-ops/`
- Launcher: `START_CAREER_OPS.bat`
- Setup notes: `career-ops/ASTRA_SETUP.md`

Local-first CLI agent (A–G rubric, portal scan, PDF CV). **Not** merged into InterviewPulse Jobs.

## Night Scout (search while you sleep)

Robust overnight harvest so results are ready by morning — multi-tenant ready.

| Piece | Role |
|-------|------|
| **Schedules** | Per-user criteria + `run_hour_local` (default 02:00) |
| **Worker** | `python -m jobsearch.night_worker` claims due jobs with leases |
| **Store** | SQLite WAL `src/data/night_scout.db` (Postgres-swappable) |
| **Morning digest** | `GET /api/jobsearch/night/morning` |
| **Run now** | `POST /api/jobsearch/night/schedules/{id}/run-now` |

UI: unified **Jobs** hub tabs — Search | Auto Apply | Nexus | career-ops | ApplyPilot | AIHawk | HITL | Autofill | Night  

| Hash | Surface |
|------|---------|
| `#/jobsearch` | Search + 1-click AI Auto Apply |
| `#/jobsearch/auto` | Auto Apply studio (campaign) |
| `#/jobsearch/nexus` … `#/jobsearch/autofill` | Research playbooks |
| `#/jobsearch/night` | Night Scout morning digest |

START_JOBSEARCH_LAB.bat starts the night worker alongside the API.

### Frontend notes (v3)

- **Never** derive arrays inside Zustand selectors (e.g. `documents.filter(...)`) — React 19 + `useSyncExternalStore` infinite-loops. Select stable state, then `useMemo`.
- Campaign open/track UI lives only on **Auto Apply** tab (`AutoApplyPage`). Search keeps 1-click Playwright apply; Marvel/HITL under **More**.
- Soft gate is the default for one-click apply (`strict_gate: false`): keep shortlist URLs; do not re-filter by grade unless career-ops strict mode.
- **Primary UX (job-to-be-done):** steps **Search → Profile → Apply**; tabs **Search | Auto Apply | Night Scout**; GitHub-inspired engines under **Playbooks** (Nexus, career-ops, ApplyPilot, AIHawk, HITL, Autofill).

### Backend leaf modules (import hygiene)

| Module | Role | Pulls pipeline graph? |
|--------|------|------------------------|
| `job_model.py` | `is_synthetic_job()` single source of truth | No |
| `autofill.py` | `build_autofill_profile()` ATS field map | No |
| `browser_apply.py` | Playwright fill/submit | Only `autofill` |

Playwright must not import `nexus_pipeline` / forge / SOTA engines at module load.

### Hot-path performance (lab measurements)

| Path | Cost model | Measured (this machine) |
|------|------------|-------------------------|
| Live harvest | Network RTT × boards (parallel, breakers) | Dominates wall time when live |
| `ensemble_rank` fast | O(N · tokens) | ~20 ms @ N=400 |
| Cache **miss** offline | expand+seed+rank | ~7–15 ms |
| Cache **hit** | shallow envelope rebind (no deepcopy) | **≪1 ms** |
| Rate limiter keys | O(1) + prune @ 512 keys | Bounded RAM |

**Scale path:** tenant header `X-Tenant-Id` · multi-worker leases · queue → Redis/SQS · workers → K8s HPA · store → Postgres.

## Auto Apply product page (AIApply-inspired)

**Not a clone of aiapply.co source code or brand.** Original InterviewPulse UI that mirrors their public workflow:

1. Criteria + resume  
2. Find high-match live roles  
3. Tailor resume + cover letter per role  
4. Start Auto Apply campaign (open URLs + track)  
5. Live feed: Pending → Applying now → Applied  

- UI: `http://127.0.0.1:5173/#/auto-apply` (nav: **Auto Apply**)  
- API: `POST /api/jobsearch/apply/auto`  

Honest limit: opens employer apply pages in your browser; does not silent-login third-party ATS.

## Marvel Apply (v3.0 · Prometheus)

State-of-the-art multi-engine match + **Resume Forge** + human-in-the-loop apply.

| Engine family | What it does |
|---------------|--------------|
| Gravitational potential | \(F \propto m_{\mathrm{fit}} m_{\mathrm{market}} / r_{\mathrm{gap}}^2\) |
| Ising energy | Binary apply spins + diversity couplings |
| KL / Jensen–Shannon | Resume↔JD language distance |
| Sinkhorn-lite OT | Soft skill mass transport cost |
| Hedge / MWU | Online fusion of scoring experts |
| UCB1 | Explore under-tried roles |
| NSGA-style Pareto | Multi-objective non-dominated front |
| Hungarian | Resume-variant ↔ job assignment |
| Simulated annealing | Resume bullet order |
| PageRank | Skill graph importance |
| Soft attention | Skill-query pooling |
| Zipf scarcity | Rare-title premium |
| Kalman filter | Latent response-rate tracking |
| PID throttle | Daily apply rate control |
| Spectral clustering | Near-duplicate JD groups |
| Information gain | Certainty-weighted priority |
| Langevin noise | Controlled exploration |
| + Apply Studio stack | MMR, secretary, EV, Thompson, Bayes, knapsack |

**Resume Forge:** authenticity-constrained keyword inject + ATS lift + editable working resume.

API:

- `GET /api/jobsearch/marvel/health`
- `POST /api/jobsearch/marvel/run` — full pipeline
- `POST /api/jobsearch/marvel/score` — multi-engine rank only
- `POST /api/jobsearch/marvel/forge` — one tailored resume
- `POST /api/jobsearch/marvel/forge/batch`

UI: **Marvel Apply** button after search.

## AI Apply Studio (v2.1 · human-in-the-loop)

**Contract:** auto-**prepare**, never auto-**submit**. You open the employer URL and confirm.

| Math (published foundations) | Use in product |
|------------------------------|----------------|
| **MMR** (Carbonell & Goldstein 1998) | Diverse apply queue — not 8 near-duplicate SAP titles |
| **Secretary / optimal stopping** τ=μ+κσ | Soft fit threshold before queueing |
| **EV = P̂·V − C** | Rank by expected utility of applying |
| **Logistic P̂(response)** | Transparent weights on fit, ATS, readiness, URL |
| **Softmax / Plackett–Luce** | Presentation order mass |
| **Thompson sampling (Beta)** | Source prioritization from outcome stats |
| **Bayesian checklist readiness** | Beta-Binomial completeness for apply readiness |
| **ATS keyword coverage** | Set recall of JD skills in resume |
| **Greedy knapsack** | Daily apply budget |

UI: **AI Apply Queue** button after search → queue + cover note + STAR bullets + keyword inject + one-click open apply & mark.

## Enterprise grade (v2.0)

| Capability | Behavior |
|------------|----------|
| **Fingerprint cache** | Identical runs served from in-process TTL cache (120s fresh / 300s stale-while-revalidate). `bypass_cache: true` forces refresh. |
| **Circuit breakers** | Per board (`freehire`, `remotive`, `arbeitnow`, `linkedin`). After 3 failures → OPEN 45s → half-open probe. Fail open to `[]` (other boards continue). |
| **Request IDs** | `X-Request-Id` header (client or server). Echoed on every response + body `request_id`. |
| **Rate limit** | Token bucket on `/run` (~30/min, burst 8) per client IP → HTTP 429. |
| **Liveness / readiness** | `/livez` (process up), `/readyz` (accept traffic), full `/metrics` control plane. |
| **Process supervisor** | `python -m jobsearch.supervisor` restarts API on crash with exponential backoff + heartbeat file. |
| **Structured metrics** | Counters + p50/p95/p99 latency samples for health, run, and each board. |

Not multi-tenant SaaS (no auth mesh, no distributed cache, no K8s). This is **Fortune-100 operational discipline** on a single-node lab: blast-radius isolation, observability, idempotent re-runs, and process reliability.

## Pipeline

| Stage | What it does |
|-------|----------------|
| **expand** | Skill adjacency query expansion (deterministic) |
| **harvest** | Multi-source boards under circuit breakers + optional practice market |
| **rank** | Fast IR ensemble (BM25 / cosine / Jaccard / Bayes / title boost) |
| **review** | Quality flags (gaps, synthetic, missing URL) |
| **drafts** | Template outreach (never auto-sent) |
| **plan** | Upskill gap list |

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jobsearch/health` | Product + enterprise snapshot + freehire probe (cached 60s) |
| GET | `/api/jobsearch/livez` | Liveness (process up) |
| GET | `/api/jobsearch/readyz` | Readiness (accept `/run`) |
| GET | `/api/jobsearch/metrics` | Cache, breakers, rate limit, latency histograms |
| POST | `/api/jobsearch/run` | Pipeline run (`include_seed: false` default, optional `bypass_cache`) |
| POST | `/api/jobsearch/cache/clear` | Flush result cache (lab admin) |
| GET | `/api/jobsearch/apply/health` | AI Apply Studio status (HITL only) |
| POST | `/api/jobsearch/apply/queue` | Optimal apply queue (MMR + secretary + EV + knapsack) |
| POST | `/api/jobsearch/apply/prepare` | Cover note + STAR bullets + ATS keywords for one job |
| POST | `/api/jobsearch/apply/batch` | Batch prepare packets |
| POST | `/api/jobsearch/apply/confirm` | User confirmed applied (audit only — no ATS submit) |

Response extras on `/run`:

- `request_id`, `cache.status` (`hit` \| `stale` \| `miss`), `enterprise.circuit_breakers`
- Headers: `X-Request-Id`, `X-Cache`, `X-Product-Version`, `X-Product-Grade`

## UI

`http://127.0.0.1:5173/#/jobsearch`

1. Resume (optional)  
2. Filters (US + non-LinkedIn common preset)  
3. Search (real server pipeline timings; cache hit shown in toast)  
4. Results — **Live** tab first; practice only if opted in  

Status chip shows enterprise version, open breakers, and cache hit rate.

## Start

```bat
START_JOBSEARCH_LAB.bat
```

This starts:

1. **Supervised API** — `python -m jobsearch.supervisor` (auto-restart on crash)  
2. **Vite UI** on `:5173`  
3. Browser to `/#/jobsearch`  

Heartbeat: `src/jobsearch_supervisor.heartbeat`

Manual (no supervisor):

```text
cd src && venv\Scripts\python.exe copilot_api.py
cd interview-pulse-ai && npm.cmd run dev
```

## Tests

```text
cd src
set PYTHONPATH=.
python -m pytest jobsearch -q
# or module runners:
python -m jobsearch.test_enterprise
python -m jobsearch.test_product
python -m jobsearch.test_edge_cases
python -m jobsearch.test_browser_apply
```

Edge-case suite: offline unit cases always run; HTTP cases against `:8787` **skip** (pass with note) when the lab API is down so CI stays green without a live server.

## Limits (honest)

- Public boards miss much of LinkedIn-heavy markets (e.g. SAP FICO US).
- No auto-apply, no ATS login, tracker is localStorage.
- Ensemble is uncalibrated IR — use as shortlist aid only.
- Cache and breakers are **in-process** (single node). Restart clears both.
- LinkedIn guest scrape remains best-effort and may trip the circuit under rate limits.
