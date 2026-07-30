# Job Search AI (localhost lab)

Isolated candidate module inspired by [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search), reimplemented inside InterviewPulse **without** changing copilot, mock interview, billing, or admin production paths.

## Devil’s advocate on ai-job-search

| Claim / design | Pushback |
|----------------|----------|
| “Runs on your machine” | Still depends on Claude Code + Bun + LaTeX + network scrapers — high setup friction for non-engineers. |
| Danish-first portals | Great for DK; weak default for US/global candidates without `/add-portal`. |
| LinkedIn guest scrape | Against LinkedIn ToS; brittle HTML; ban risk. freehire is safer. |
| Drafter–reviewer LaTeX | Quality ceiling high, but slow and template-fragile; PDF/ATS loops burn tokens. |
| Fit scores as truth | Rubric is subjective; no calibration against hire outcomes in-repo. |
| Auto-apply fantasies | Framework correctly drafts only — but UX of agentic apply tempts unsafe automation. |
| Single-user CLI | Not multi-tenant SaaS; no account isolation, rate limits, or audit for a product. |
| Profile depth required | Cold-start users with thin CVs get generic output — same failure mode as thin prompts. |
| No live market signal | Rankings ignore velocity (how fast jobs fill), company health, referral graphs. |
| Security model | “Instruction-level” defenses vs untrusted JD text are soft; need hard sandboxes for agents. |

**What to steal anyway:** scout→rank→apply staging, critic agent, eligibility gates, outcome tracking, upskill gap heatmap, portal skill contract.

## What we added (lab)

### Single UI button
Sidebar **Job Search AI** (only when hostname is `localhost` / `127.0.0.1`). One primary action: **Job Search AI**.

### RT agents
| Agent | Role |
|-------|------|
| **Scout** | Expand title + skill adjacency facets |
| **Harvester** | Seed corpus + optional freehire.me |
| **Scorer** | Multi-algorithm ensemble (below) |
| **Critic** | Devil’s-advocate flags (stretch roles, seed data, gaps) |
| **Outreach** | Draft DM/email only — never sends |
| **Planner** | Greedy set-cover upskill list |

### Algorithms (math / IR / networks)
- **BM25** (Robertson) — term relevance  
- **Cosine TF** (Salton VSM)  
- **Jaccard** skill coverage  
- **Bayesian** Beta–Binomial skill posterior  
- **Degree centrality** on skill co-occurrence graph  
- **Spectral / diffusion** 1-hop path coverage  
- **Elo** pairwise ranking smooth  
- **Diversity bonus** — novel skill clusters (information-style novelty)  
- **Greedy set cover** (Chvátal) for upskill plan  

## Localhost only
- Frontend: `isJobSearchLabHost()` hides nav on production domains.  
- Backend: `/api/jobsearch/*` returns 404 unless client/host is loopback **or** `JOBSEARCH_AI_ENABLED=1`.

## How to test
```bash
# terminal 1 — API
cd src
python copilot_api.py

# terminal 2 — UI
cd interview-pulse-ai
npm run dev
```
Open http://localhost:5173 → **Job Search AI** → fill skills → **Job Search AI** button.

## Explicitly not shipped yet (next RT backlog)
1. Real multi-market portals (US: Greenhouse boards, Remotive, Adzuna API keys).  
2. Eligibility / visa hard gates (from 04-job-evaluation.md).  
3. Application tracker + outcomes (CSV / DB).  
4. Cover letter / CV tailoring (reuse Knowledge docs + optional LLM).  
5. Interview prep handoff into existing Mock module.  
6. Company health signals (news, glassdoor-like proxies — licensed data).  
7. Referral graph / alumni network ranking.  
8. Human-in-the-loop send (Gmail OAuth) with double confirm.  
9. Online learning-to-rank calibrated on user outcomes.  
10. Production feature flag + billing entitlement (after lab sign-off).

## Isolation guarantee
- New package: `src/jobsearch/`  
- New page/service only; no changes to answer_engine latency path beyond router include.  
- No production CF path required for lab.
