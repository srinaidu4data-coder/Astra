# Evidence decision table → Living Enterprise successor

**Audit basis:** `LIVING_ENTERPRISE_AUDIT.md` (2026-08-08)  
**Successor codename:** BTP Odyssey: The Living Enterprise  

| Current capability | Route / location | Supporting evidence | Decision | User impact | Proposed successor | Acceptance criterion |
|--------------------|------------------|---------------------|----------|-------------|--------------------|----------------------|
| Health + disclaimer | `GET /health` | 200, SAP independence disclaimer | **Keep** | Trust | Same + Living Enterprise product name | Health returns ok + product Living Enterprise |
| SPA shell | `GET /` | title SAP BTP Odyssey, 157ms | **Improve** | First paint | Living shell: progressive disclosure, guest CTA &lt;60s | Guest reaches incident step 1 under 60s on broadband |
| Full challenge pack download | `GET /api/challenges` | 3.6MB, 16s | **Replace** | Blocks mobile | Paginated / spine slice / concept-scoped fetch | Initial challenges payload &lt;250KB or &lt;1.5s p75 |
| Concept catalog | `GET /api/catalog` | 16 domains, 157 concepts | **Keep** + improve search | Navigation | Mastery constellation + search | Search finds concept by title/tag &lt;300ms client |
| Linear PLAY campaign | view `play` | 1099 challenges, 7 variants | **Improve** | Depth vs overwhelm | Persona-filtered campaigns + free how/when arcade | Beginner path ≤40 gates to first transfer check |
| Concept Atlas + Use Arena | view `atlas` | code + linkedGames | **Keep** | How/when practice | Constellaion + arcade retained | Each concept has ≥3 how/when practice modes |
| Architect trade-offs | view `architect` | `/api/architect/*` | **Keep** | Judgment | Core loop “select architecture” phase | Scenario complete with rationale saved as evidence |
| Mission mega-teach | view `mission` | 8 missions | **Improve** | Realism | Flagship Living Incident loop | Full loop: diagnose→configure→test→debrief |
| Deterministic simulation | packages/simulation | local code | **Keep** | Safe practice | Power Living Enterprise sandbox | Same seed → same world snapshot |
| Ethical return loop | assessment/dopamine | returnLoop JSON | **Keep** | Healthy return | Default on Continue dashboard | stopHint + no punitive streak fields |
| Prestige / rank | engagement blob | learner API | **Improve** | Motivation | Portfolio evidence primary; rank secondary optional | Rank never required for content unlock |
| Session break minutes | settings | learner.settings | **Keep** | Wellness | + session goals, quiet hours, grace streaks | Break reminder fires; skip never punishes |
| reducedMotion / highContrast | settings + CSS data attrs | API + code | **Keep** | A11y | + low-stim, data-saver, silent, low-power | Prefs persist and apply before first animation |
| Export / delete | `/api/export`, delete | 200 | **Keep** | GDPR-ish | Portfolio export formats | Delete clears runtime learner blob |
| Auth / registration | — | No routes | **Add** | Continuity | Guest + optional local profile (later SSO) | Guest works offline of SSO; register optional |
| Deep links | SPA only `/` | Observed | **Add** | Share/resume | Hash routes `#/incident/:id` | Refresh resumes same phase |
| Spaced retrieval queue | partial openLoops | code | **Add** | Durability | Review queue UI | Due item appears after debrief schedule |
| Portfolio artifacts | evidence array | store | **Add** | Transfer proof | Publishable debrief + privacy | Artifact exportable as Markdown/JSON |
| Team / cohort | — | Absent | **Defer** | L&D | Schema stub only R2 | Stub documented, not blocking R1 |
| Live SAP sandbox | fidelity tier3 | Omitted | **Defer** | Realism | Consent + preview stub | No fake “connected to SAP” claims |
| Support / feedback | — | Absent | **Add** | Trust | In-app feedback form local log | Submit writes local feedback file |
| Noscript / offline | HTML | no noscript | **Add** | Resilience | Noscript message + offline banner | Offline shows recovery CTA |
| Notifications FOMO | flags only | API | **Keep constrained** | Ethics | Opt-in only; no scarcity timers | No progressive unlock loss for silence |

## Migration & rollback

| Asset | Migration | Rollback |
|-------|-----------|----------|
| Challenge clears | Map `challengesCleared[]` IDs unchanged | Restore prior Docker image |
| Learner settings | Extend schema with defaults for new fields | Ignore unknown keys on old server |
| Concept content | Reuse JSON; add living metadata sidecar | Delete sidecar |
| Engagement prestige | Carry forward | Optional reset endpoint |
| Deployment | Railway service `btp-odyssey` new image | Redeploy previous Railway deployment ID |

## Content migration plan

1. Keep `content/concepts`, `competencies`, `missions`, `domains`.  
2. Serve challenges via **spine index** + **lazy chapter** files (generate from existing pack).  
3. Map each concept’s 7 games into Living “practice cards” without requiring full pack download.  
4. Flagship Living Incident reuses mission `r1-northwind-order-insights` + incident forge.

## Account migration plan

1. Current: anonymous file learner.  
2. Living R1: same file store + optional display name / persona.  
3. Future: SSO — import export JSON; no silent account merge without consent.
