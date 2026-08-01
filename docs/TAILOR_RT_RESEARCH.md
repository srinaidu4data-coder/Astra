# Tailor RT — Research & Implementation

**Date:** 2026-07-31  
**Feature:** Multi-agent resume tailoring + validation loop for Astra Job Search lab.

## GitHub research (best patterns)

| Project | Stars / note | Pattern adopted |
|--------|----------------|-----------------|
| [praneethravuri/gary](https://github.com/praneethravuri/gary) | CrewAI 3-agent | **Job Analyst → Resume Tailor → Resume Validator** |
| [Pickle-Pixel/ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) | Full auto-apply | **Never fabricate**; preserve resume facts; reorganize only |
| [rsinghcodes/Tailr](https://github.com/rsinghcodes/Tailr) | LangGraph + RAG | **Ground every edit in real experience** (evidence chunks) |
| [javiera-vasquez/claude-code-job-tailor](https://github.com/javiera-vasquez/claude-code-job-tailor) | Claude agents | Weighted skill match, requirement ranking |
| [santifer/career-ops](https://github.com/santifer/career-ops) | Large local skill | Structured fit rubric A–F |
| Astra `resume_forge` | In-repo | ATS / OT / authenticity multi-objective forge |

## Best solution we implemented

**Tailor RT** (`src/jobsearch/tailor_rt.py` v1.1) — deterministic multi-agent pipeline (no paid LLM required; auditable on localhost):

1. **jd_analyst** — must-haves / keywords with noise filter (no company names, no title fluff)  
2. **evidence** — map JD needs → phrases already in the resume (Tailr / ApplyPilot guardrail)  
3. **tailor** — ATS-clean body via `resume_forge` + evidence-backed injects only (meta reports stay outside the resume text)  
4. **validator** — ATS coverage, keyword rate, authenticity, fabrication hard-fail, contact readiness  
5. **RT loop** — if fail, reduce inject budget and re-tailor (max rounds)

**Shared entry:** `tailor_materials()` — used by form packs, auto-apply campaign, and Nexus tailor stage (single forge path).

## API

- `POST /api/jobsearch/apply/tailor-rt` — single job  
- `POST /api/jobsearch/apply/tailor-rt/batch` — top shortlist  
- Form pack + auto-apply campaign use Tailor RT by default when forging

## UI

Search → **Tools → Tailor RT** — batch-validates top live jobs, shows PASS/FAIL grade, copy tailored resume, optional “Use as resume”.

## Honesty

Never invents employers, degrees, or years. Unsupported must-haves are listed as **honest gaps**. User owns every claim before submit.
