# System Architecture

**Status:** Implemented skeleton (R0)  
**Last updated:** 2026-08-07  

## Goals

- Strongly typed contracts (TypeScript + Zod)  
- Modular bounded contexts  
- Deterministic simulation with seeds  
- Versioned content outside the UI  
- Provider-neutral AI mentor with local mock  
- Local runtime without production SAP credentials  

## High-level diagram

```
┌─────────────┐     HTTP/JSON      ┌──────────────────┐
│  apps/web   │ ◄────────────────► │    apps/api      │
│  React/Vite │                    │  content + sim   │
└─────────────┘                    └────────┬─────────┘
                                            │
           ┌────────────────────────────────┼────────────────────────┐
           ▼                ▼               ▼            ▼           ▼
   content-engine     simulation      competency   assessment    shared
   (load/validate)    (world/kernel)  (graph)      (evaluate)    (schemas)
           │
           ▼
      content/*.json
```

## Bounded contexts

| Context | Package / app | Responsibility |
|---------|---------------|----------------|
| Shared contracts | `@btp-odyssey/shared` | Zod schemas, fidelity, mastery types |
| Content platform | `@btp-odyssey/content-engine` + `content/` | Load, validate, publish-ready structure |
| Competency | `@btp-odyssey/competency` | Graph, prereqs, unlock |
| Simulation | `@btp-odyssey/simulation` | World state, landscape, incidents, observability |
| Assessment | `@btp-odyssey/assessment` | Deterministic scoring, mock mentor |
| API | `apps/api` | Session, mission progress, sim actions |
| Web | `apps/web` | Learner UX, districts map, mission player |

## Data

R0–R1 uses in-memory session state + filesystem content.  
Planned: relational store (SQLite/Postgres), migrations, object storage abstraction.

## AI gateway

- Interface: `mentorRespond` (deterministic mock)  
- Future: provider adapters, cost accounting, grounding checks  
- Local default requires **no** API keys  

## Security baseline

- No secrets in repo  
- Tenant isolation designed for multi-org (R7); single local learner in R1  
- Simulations only; no real SAP API calls  
- Input validation via Zod on content and key API payloads  

## Architecture decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| ADR-001 | TypeScript monorepo | Shared types, one language for sim + UI |
| ADR-002 | Content as JSON files | Not hard-coded in pages; lintable |
| ADR-003 | Deterministic PRNG + seeds | Reproducible scenarios and tests |
| ADR-004 | Mock mentor first | Offline, zero AI spend, ethical baseline |
| ADR-005 | Vite + lightweight HTTP API | Fast local DX; swap later if needed |
