# Job Search (product mode · localhost default)

Isolated job-search module inside InterviewPulse. **Live boards first.** Practice (synthetic) market is opt-in and labeled.

Enable outside localhost only with `JOBSEARCH_AI_ENABLED=1`.

## Product principles

1. **Honest inventory** — Default results are live postings only (freehire, Remotive, Arbeitnow). No silent seed padding.
2. **Practice market is opt-in** — Synthetic roles for ranking drills; amber **practice** badge; not auto-tracked as applied.
3. **Stages, not agent theater** — Deterministic pipeline: expand → harvest → IR rank → review → drafts → next steps. Fit scores are relative similarity, **not** hire probability.
4. **Filter integrity** — Location / LinkedIn policy are not silently dropped. Soft recovery is limited to work-mode and is returned in `warnings`.
5. **Server is source of truth** — One filter pass on the API; UI shows run filters from the response.

## Pipeline

| Stage | What it does |
|-------|----------------|
| **expand** | Skill adjacency query expansion (deterministic) |
| **harvest** | Multi-source boards + optional practice market |
| **rank** | BM25 / cosine / Jaccard / Bayes / Elo ensemble |
| **review** | Quality flags (gaps, synthetic, missing URL) |
| **drafts** | Template outreach (never auto-sent) |
| **plan** | Upskill gap list |

## API

- `GET /api/jobsearch/health` — product version, honesty blurb, freehire probe  
- `POST /api/jobsearch/run` — body includes `include_seed: false` by default  

## UI

`http://127.0.0.1:5173/#/jobsearch`

1. Resume (optional)  
2. Filters (US + non-LinkedIn common preset)  
3. Search (real server pipeline timings)  
4. Results — **Live** tab first; practice only if opted in  

## Start

```bat
START_JOBSEARCH_LAB.bat
```

Or:

```text
cd src && venv\Scripts\python.exe copilot_api.py
cd interview-pulse-ai && npm.cmd run dev
```

## Tests

```text
cd src
venv\Scripts\python.exe -m jobsearch.test_product
```

## Limits (honest)

- Public boards miss much of LinkedIn-heavy markets (e.g. SAP FICO US).
- No auto-apply, no ATS login, tracker is localStorage.
- Ensemble is uncalibrated IR — use as shortlist aid only.
