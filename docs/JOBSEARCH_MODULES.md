# Job Search — module map (reworked)

Every backend + UI engine is a **module** with a clear role. Prefer leaf modules over god objects.

## Backend (`src/jobsearch/`)

| Module | Layer | Responsibility |
|--------|-------|----------------|
| `job_model` | core | Synthetic flags, live filter, apply URL |
| `contracts` | core | Response envelopes, `MODULE_REGISTRY` |
| `autofill` | apply | ATS field map (leaf) |
| `catalog` | data | Board harvest + filters |
| `algorithms` | score | BM25 / ensemble rank |
| `apply_math` | score | MMR, EV, secretary, ATS coverage |
| `sota_engines` | score | Marvel multi-engine scores |
| `enterprise` | control | Cache, breakers, rate limit, metrics |
| `agents` | pipeline | Search orchestrator (expand→plan) |
| `apply_engine` | apply | Packets + HITL queue |
| `auto_apply` | apply | Campaign plan |
| `browser_apply` | apply | Playwright fill/submit |
| `one_click_apply` | apply | Gate → forge → browser batch |
| `resume_forge` | apply | Tailored resume text |
| `nexus_pipeline` | pipeline | 6-stage grade + materials + soft fallback |
| `marvel_pipeline` | pipeline | SOTA multi-engine apply studio |
| `night_store` / `night_worker` | data/worker | Overnight schedules + digests |
| `*_api` | HTTP | Thin FastAPI routers |
| `supervisor` | ops | Process restart |

## Frontend (`interview-pulse-ai/src/modules/jobs/`)

| Module | Responsibility |
|--------|----------------|
| `hubConfig` | Hash routes, primary + playbook tabs |
| `JobHubShell` | Shared chrome (header, tabs, offline banner) |
| `ApplicationsPanel` | Tracker + CSV export |
| `JobCard` | Single result card actions |
| `useJobLabHealth` | Shared 30s health poll |

Pages (`JobSearchPage`, `AutoApplyPage`, `JobPlaybooks`, `NightScoutPage`) compose these modules.

## Health

`GET /api/jobsearch/health` includes `modules: MODULE_REGISTRY` for observability.
