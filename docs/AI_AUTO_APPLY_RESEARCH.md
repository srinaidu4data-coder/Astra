# GitHub AI Auto-Apply research → Astra Apply Nexus

**Date:** 2026-07-31  
**Goal:** Identify best open-source AI auto-apply systems and ship the *next* best thing inside InterviewPulse (original code, not a copy of AGPL/noncommercial trees).

## Leaderboard (GitHub / product)

| Project | ~Stars / type | Strength | Weakness | License |
|---------|---------------|----------|----------|---------|
| **[santifer/career-ops](https://github.com/santifer/career-ops)** | ~62k | A–G rubric quality filter, PDF CV, portal scan, local-first CLI | Not a browser form submitter; CLI-agent oriented | MIT |
| **[feder-cr/Jobs_Applier_AI_Agent_AIHawk](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk)** | ~30k | First viral auto-applier; media-proven | LinkedIn-heavy, detection wars, plugins removed | AGPL-3.0 |
| **[Pickle-Pixel/ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot)** | Growing | Clean **6-stage** pipeline; multi-board; dry-run; parallel workers | Heavy Claude Code dependency for form submit | AGPL-3.0 |
| **[Liam-Frost/AutoApply](https://github.com/Liam-Frost/AutoApply)** | ~100+ | FastAPI+Vue product; HITL review queue; Celery; multi-LLM | PolyForm **Noncommercial** — not free for commercial SaaS | Noncommercial |
| **Simplify / LoopCV / AIApply** | Closed SaaS | Autofill extension / volume apply | Not open source; paywalls | Proprietary |

## What we steal as *ideas* (not code)

| Idea | Source | Nexus implementation |
|------|--------|----------------------|
| Discover → Enrich → Score → Tailor → Cover → Apply | ApplyPilot | `nexus_pipeline` stages |
| Dry-run / never silent submit | ApplyPilot + AutoApply + career-ops | `mode: dry_run \| campaign` |
| Min score gate (no spray-and-pray) | career-ops | `min_score` + letter grade A–F |
| Explainable skips | AutoApply | `skip_reasons[]` per job |
| Profile autofill field map | Simplify-style | `autofill_profile` JSON for forms |
| Night continuous discovery | LoopCV / our Night Scout | hooks into night worker digest |
| Parallel-ready plan | ApplyPilot workers | step list with worker slots |
| Human-gated open URL | All serious tools | open browser + track; no ATS password bots |

## What we deliberately refuse

- LinkedIn session hijack / undetected chrome farms (ToS + ban risk; AIHawk pain class)
- Silent form POST without user browser session
- Fabricating resume facts (career-ops / ApplyPilot honesty)

## Nexus product claim

**Astra Apply Nexus** = multi-board harvest (InterviewPulse) + quality gate (career-ops spirit) + 6-stage materials (ApplyPilot spirit) + HITL campaign (AutoApply spirit) + night digests + enterprise cache/breakers — in one Jobs hub.

## Soft vs strict apply gate

| Mode | When | Behavior |
|------|------|----------|
| **Soft** (default) | Search 1-click, Auto Apply, most playbooks | Keep shortlist jobs with valid `http` apply URLs; do not re-filter by grade |
| **Strict** | career-ops-style / high `min_score` | Enforce min ensemble + letter grade before Playwright |

One-click API: `POST /api/jobsearch/apply/one-click` with `strict_gate: false` (default).

## Implemented under Jobs hub (localhost)

| Tab | Inspired by | URL |
|-----|-------------|-----|
| Search | InterviewPulse | `#/jobsearch` |
| Auto Apply | Classic campaign studio | `#/jobsearch/auto` |
| Nexus | Best-of-breed synthesis | `#/jobsearch/nexus` |
| career-ops | santifer/career-ops (strict gate) | `#/jobsearch/careerops` |
| ApplyPilot | 6-stage pipeline UI | `#/jobsearch/applypilot` |
| AIHawk | Higher-volume open-URL campaign | `#/jobsearch/aihawk` |
| HITL Review | Liam-Frost AutoApply approve gate | `#/jobsearch/hitl` |
| Autofill | Simplify field pack | `#/jobsearch/autofill` |
| Night | Overnight discover | `#/jobsearch/night` |

All modes hard-gated to localhost lab.

## One-click AI Auto Apply (Playwright) — implemented

| Endpoint | Role |
|----------|------|
| `POST /api/jobsearch/apply/one-click` | Gate → tailor → browser fill → optional **Submit** |
| `POST /api/jobsearch/apply/browser` | Single URL apply |

UI: Jobs → Search results → **AI Auto Apply (1-click)** (confirm dialog).

Engine: `browser_apply.py` (Greenhouse/Lever/Ashby/generic selectors).  
Requires `playwright` + Chromium in API venv.

Limitations: CAPTCHA, login walls, and nonstandard ATS may return `no_form_detected` / partial fill.
