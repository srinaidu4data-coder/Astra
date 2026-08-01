# Jobs UX vNext — merge of three deep-research runs (2026-08-01)

Synthesizes:

1. **UI/UX multi-agent orchestration** (simplify chrome; one surface)
2. **Fluid low-cognition flow** (10 remits, one trigger, fixed pipeline)
3. **Features backlog** (ship what matters; refuse hijack/silent apply)

## Product principle

> User never plans the pipeline. One primary verb per phase. Specialists stay invisible.

## Four screens (only)

| Phase | User does | System does |
|-------|-----------|-------------|
| **Start** | Title + email | — |
| **Results** | Adjust picks (max 4) | Search, rank, pre-select form-friendly |
| **Confirm** | HITL claim sheet | List jobs + submit intent |
| **Truth** | Read outcomes | Playwright fill; trust log |

Night / Form pack / Metrics / campaign studio → **Advanced only**.

## One car (no dual engines)

| Do | Don't |
|----|--------|
| Journey **Apply** = run selected apply on Search | Route Apply to a second tab/engine |
| Primary CTA after results = **Apply selected (N)** | Hero **Search & Apply** |
| Enter key = Search only | Enter = full lifecycle |
| Card primary = **Open listing** | Label open URL as Apply |

## Features to add (prioritized)

### P0 — fluid (low thinking)

- [x] Journey/flow Apply stays on Search path (same apply engine)
- [x] Coach secondary: no surprise lifecycle; truth dismiss
- [x] STAR bullets → autofill `additional_info` / cover
- [x] Rename card **Apply** → **Open listing** (JobCard)
- [x] One Next rail: coach owns CTA; FlowNext suppressed on Search/Apply (keep journey strip)
- [ ] Full collapse of journey into coach chips (optional; YAGNI for now)

### Quality bar (deep-research-6)
After each change ask: *Is this the simplest thing that could possibly work and still help the next engineer?*
Refuse: multi-agent UI theater, dual apply engines, silent metrics failures, “completed” KPI language that overclaims.

### P1 — trust / honesty (already partly shipped)

- [x] Trust statuses: quality rejected / click failed / duplicate
- [x] Exclusive filled vs submitted counters
- [x] Weekly completed = real submitted only
- [x] KPI chip copy: “submit clicks this week (lab)” not “completed”

### P1 — apply path polish

- [x] star_bullets on autofill field map
- [x] Skip cover rebuild when forge_blob.ok (LOOP_STATUS)
- [ ] Mid-batch checkpoint resume after cancel (defer: lab cancel is rare; YAGNI until measured pain)
- [x] Atomic metrics write + fail loud (not silent except)

### P2 — interview track (separate)

- Production wiring: OAuth, Stripe, Deepgram, WASAPI
- Competitor gaps: multi-language STT, coding screengrab, HireVue — **not Jobs**

### Refuse

- LinkedIn session hijack, silent mass POST, fabricated resume facts
- Cloud always-on auto-apply without auth
- 100 concurrent design agents in the product UI

## Agent remits (backend only — not user-visible)

Discover → Rank → Tailor RT → Form fill → Truth/metrics.  
Orchestrator = fixed sequential pipeline + HITL interrupt.

## Success metrics

- Time-to-first-truth-log for new user &lt; 2 minutes
- One primary CTA visible per phase
- submitted + filled_only exclusive; no double-count acted
- Lab only: loopback; no career bet on production apply claims
