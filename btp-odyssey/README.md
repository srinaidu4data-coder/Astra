# SAP BTP Odyssey

**Architect, Build, Operate, Defend, and Master the Intelligent Enterprise**

Local learning product: scenario-driven SAP Business Technology Platform mastery simulation with campaigns, competency graph, incident forges, architecture defense, and evidence-based assessment.

## Launch (Windows)

Double-click:

```
START_BTP_ODYSSEY.bat
```

Or:

```bash
cd btp-odyssey
npm install
npm run product
npm start
```

Open **http://localhost:8787**

## Docker

```bash
docker compose up --build
```

## What you get

| Area | Contents |
|------|----------|
| Districts | 16 learning districts (UI5, CAP, RAP, Integration, Events, Data, Security, Ops, …) |
| Competencies | 40+ versioned competencies with prerequisites |
| Specializations | 16 role paths |
| Campaigns | 8 (Startup → Clean Core → Integration → Data → Security → Inherited → Regulated → Grand) |
| Missions | 8 full learning-loop missions with injected defects |
| Simulation | Deterministic landscapes, logs/metrics/traces, secure remediations |
| Assessment | Process-scored evidence + rationale (not XP mastery) |
| Ethics | Break reminders, no shame streaks, export/delete local data |
| Fidelity | Always labeled Tier 1–2 behavioral simulation |

## Disclaimers

- **Not** affiliated with, endorsed by, or certified by SAP SE  
- **Not** official SAP certification  
- **Does not** guarantee employment or expert status  
- Simulations are **not** live SAP BTP  

SAP and product names are trademarks of their respective owners.

## Develop

```bash
npm run dev:api   # API + static if built
npm run dev:web   # Vite on :5173 with API proxy
npm test
npm run validate:content
```

## Docs

See `docs/` for architecture, threat model, fidelity register, legal risks, and acceptance criteria.

## Version

**2.0.0 Mega Teach** — 50+ concept cards, ~280 teaching micro-steps, learn→check→apply cockpit, Concept Atlas, 8 campaign acts. Live SAP sandboxes and multi-tenant SaaS remain out of local scope by design.

### Mega Teach loop

Every micro-step:

1. **Teach** — explanation, analogy, why it matters, worked example, progressive reveals  
2. **Check** — MC / short-answer concept verification (answer keys server-side)  
3. **Apply** — simulation landscape, logs, diagnosis, secure fix  
4. **Evidence** — multi-dimension assessment with rationale
