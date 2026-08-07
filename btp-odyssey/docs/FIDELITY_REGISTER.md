# Fidelity Register

Every simulated service must remain honest about what it is not.

| Resource / experience | Tier | Last verified | Notes |
|----------------------|------|---------------|-------|
| Global/subaccount hierarchy | tier2_behavioral | 2026-08-07 | Structural model only |
| XSUAA-style auth | tier2_behavioral | 2026-08-07 | No real JWT crypto |
| Destination OAuth fields | tier2_behavioral | 2026-08-07 | Audience as config field |
| CAP OData service | tier2_behavioral | 2026-08-07 | Metadata + health |
| HANA Cloud | tier2_behavioral | 2026-08-07 | No SQL engine |
| UI5 app | tier1_conceptual / tier2 | 2026-08-07 | No OpenUI5 runtime |
| Integration flow | tier2_behavioral | 2026-08-07 | Config + status |
| Event topic | tier2_behavioral | 2026-08-07 | Schema name only |
| Ops dashboard | tier1_conceptual | 2026-08-07 | Panel names |
| Architecture Board mentor | tier1_conceptual | 2026-08-07 | Deterministic mock |
| Costs (USD/month) | tier1_conceptual | 2026-08-07 | Illustrative |

## Validation evidence

- Unit tests: simulation determinism, incident apply/fix  
- Content validation: Zod schemas + referential integrity  
- Manual playthrough: R1 mission steps (developer)  

## Learner-facing rule

The UI must show the mission fidelity banner before interactive simulation steps.
