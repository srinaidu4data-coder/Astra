# Release acceptance criteria

## Release 0 — foundations

| Criterion | Evidence |
|-----------|----------|
| Product architecture documented | docs/SYSTEM_ARCHITECTURE.md |
| Curriculum graph (R1) | content/competencies + docs/COMPETENCY_GRAPH.md |
| Content schema + validation | packages/shared schemas + npm run validate:content |
| Simulation kernel deterministic | packages/simulation tests |
| Design system tokens | docs/DESIGN_SYSTEM.md + web CSS |
| Security baseline / threat model | docs/THREAT_MODEL.md |
| Observability in sim | logs/metrics/traces |
| Local runtime | API + web |
| Risk + fidelity registers | docs/* |

## Release 1 — vertical journey

| Criterion | Evidence |
|-----------|----------|
| Connects UI5, CAP, HANA sim, identity, integration, events, ops, debug, architecture review, assessment, reflection | mission r1-northwind-order-insights steps |
| Injectable defect + remediation | audience mismatch |
| Process-based evaluation with rationale | evaluateMission |
| Fidelity disclosed in UI | fidelity banner |
| Tests for journey | tests/r1-journey.test.ts |
| No credential requirement | local mock |

## Gate

Advance only when automated tests pass and disclaimers remain accurate.
