# Threat Model (R0 baseline)

**Scope:** Local edition + future multi-tenant SaaS shape  
**Method:** Lightweight STRIDE  
**Date:** 2026-08-07  

## Assets

- Learner progress and assessment evidence  
- Curriculum content integrity  
- Simulation integrity (anti-cheat light)  
- Future org/tenant data  
- AI prompts and any future API keys  

## Trust boundaries

1. Browser ↔ API  
2. API ↔ content filesystem  
3. API ↔ future DB  
4. Mentor/AI provider (future)  
5. Tenant A ↔ Tenant B (future)  

## Key threats and mitigations

| Threat | Mitigation (current / planned) |
|--------|--------------------------------|
| Spoofed mastery claims in UI | Server-side evaluation; expose rationale |
| Malicious uploaded content (future) | Treat as untrusted; schema validate; sandbox |
| Prompt injection via learner text | Mock mentor ignores tool execution; future: isolation |
| Secret leakage | No production secrets; .gitignore env files |
| Cross-tenant leakage | Not multi-tenant yet; design isolation early |
| Dependency compromise | Lockfile; future SBOM + audit CI |
| Misleading fidelity | Mandatory fidelity disclosure on missions |
| Unbounded AI cost | Mock default; future budgets and routing |

## Out of scope (explicit)

- Attacking real SAP systems  
- Teaching credential theft or persistence  
- Production deployment hardening (tracked for R7)  

## Residual risk

Medium: SAP technical accuracy drift without continuous source review.  
Low (local): single-user process memory sessions.
