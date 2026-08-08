# Evidence-first audit — SAP BTP Odyssey (production)

**Product under audit:** https://btp-odyssey-production.up.railway.app/  
**Audit date:** 2026-08-08 12:02–12:05 CDT (−05:00)  
**Method:** Authorized public HTTP probes (no credentials required; product has no login).  
**Client:** Windows PowerShell `Invoke-WebRequest` / `Invoke-RestMethod` (scripted; **not** a full browser viewport session).  
**Viewport:** N/A for scripted probes — **browser layout / mobile gestures not verified in this pass**.  
**Screenshots/recordings:** Not captured in this agent environment — **deferred**.  
**Authentication state:** Unauthenticated guest only (single server-side `local-learner` file store).

## 1. Reachability

| Route | Auth | Status | Bytes (approx) | Timing | Notes |
|-------|------|--------|----------------|--------|-------|
| `GET /health` | public | **200** | 200 | — | `ok:true`, product SAP BTP Odyssey, version **2.0.0**, release mega-teach-2.0, SAP disclaimer present |
| `GET /` | public | **200** | 1032 | **157 ms** | SPA shell `<title>SAP BTP Odyssey</title>`, `lang` present, **no noscript**, assets cache-busted `?v=pipe-*` |
| `GET /assets/index-C7MhDf1x.js` | public | **200** | 384427 | — | Main bundle |
| `GET /api/catalog` | public | **200** | ~100 KB | **549 ms** | 16 domains, 157 concepts, 8 missions |
| `GET /api/learner` | public | **200** | ~2 KB | — | Single local learner; settings include theme, reducedMotion, highContrast, sessionBreakMinutes |
| `GET /api/challenges` | public | **200** | **~3.66 MB** | **16025 ms** | Pack v7.0.0, **1099** challenges — **availability risk** on cold/mobile |
| `GET /api/quests` | public | **200** | ~20 KB | — | Domain-phase quests; ethics copy present |
| `GET /api/architect/scenarios` | public | **200** | ~12 KB | — | Architect trade-off scenarios |
| `GET /api/export` | public | **200** | ~0.8 KB | — | Export timestamp + profile |

### Could not verify (this pass)

- Interactive click-paths in a real browser (drag-drop challenges, arena, canvas FPS)
- Mobile Safari/Chrome layouts and touch
- Screen reader announcements, keyboard-only full journeys
- WebSocket or multi-user concurrency
- Registration/login/OAuth (routes **do not exist**)
- Authenticated multi-tenant isolation
- Real SAP sandbox connection flows
- Video/audio caption quality under reduced-motion
- Screenshot/recording artifacts

Anything below labeled **observed** is from HTTP + local repo inventory. Anything labeled **code-inferred** is from the local monorepo at `btp-odyssey/` matching production build fingerprint (same JS hash deployed).

## 2. Information architecture (code-inferred + API)

**SPA views (App.tsx):** `home | play | mission | skills | paths | atlas | architect | trees | settings | result`

**Nav labels observed in code:** Home, PLAY, Mission, Atlas, Architect, Skills, Paths, Trees, Settings

**No URL routing** beyond single SPA `/` — deep links to missions/challenges **not** first-class (hash/query partial resume only via client state).

## 3. Curriculum & SAP coverage (API-observed)

| Asset | Count | Evidence |
|-------|------:|----------|
| Domains / districts | 16 | `/api/catalog` |
| Concepts | 157 | catalog `conceptCount` |
| Missions | 8 | catalog missions |
| Challenges | 1099 | pack totalChallenges v7 |
| Games per concept | 7 | intro/when/how/trap/scenario/compare/mastery |
| Architect scenarios | ≥1 pack | `/api/architect/scenarios` |
| Fidelity default | tier2_behavioral | catalog product |

**Gaps vs Living Enterprise north star (not observed as present):**

- Guest personalized persona diagnostic  
- Certification-path selector (disclaimer-safe)  
- Spaced-review queue as first-class UI  
- Portfolio publication privacy  
- Team/cohort  
- Real sandbox connect/revoke  
- Transfer-check scheduling  
- Blameless IR debrief as structured artifact  

## 4. Progression, scoring, rewards (API + code)

**Observed keepable:**

- Ethical return loop fields: unfinished challenge, goal gradient, stopHint, comeback bonus (optional), ethicsLine  
- Prestige / architect rank (engagement blob)  
- Challenge clear with process stats (wrongs, hints, precision)  
- Session break minutes setting  
- Export + delete endpoints  

**Observed risks:**

- 3.6 MB challenge payload blocks “meaningful start &lt; 60s” on slow networks  
- Linear path lock + free-play split may confuse learners  
- “Prestige” language can feel XP-like without portfolio evidence  

## 5. Auth, profiles, settings

| Capability | Status | Evidence |
|------------|--------|----------|
| Guest no-login play | **Present** | No auth routes; local-learner |
| Registration / SSO | **Absent** | No routes |
| Multi-device sync | **Absent** | File store single learner |
| Settings: theme, reducedMotion, highContrast, break minutes | **Present** | learner.settings |
| Quiet hours / notification prefs beyond flag | **Partial** | notificationsEnabled only |
| Account deletion | **Present** | POST `/api/learner/delete` |

## 6. Accessibility (partial)

| Check | Result |
|-------|--------|
| `lang` on HTML | Present |
| `noscript` fallback | **Missing** |
| reducedMotion setting | Present (API + code applies `data-reduced-motion`) |
| Keyboard drag-drop parity | **Not verified** in browser |
| Captions / audio description for cinematics | Code has skippable cinematics; **full WCAG audit deferred** |

## 7. Performance & reliability

| Metric | Value | Impact |
|--------|------:|--------|
| HTML TTFB-ish | 157 ms | Acceptable |
| Catalog | 549 ms | Acceptable |
| Challenges JSON | **16 s / 3.6 MB** | **Critical** — blocks mobile and guest cold start |
| Health | 200 ok | Good |

## 8. Visual / animation / audio

**Code-inferred strengths:** Canvas biomes, ConceptUseArena mini-games, cinematic stage, audio sfx with mute path.  
**Not verified:** frame rate, seizure risk of pulses, audio on reduced-motion devices.

## 9. Errors / dead ends (code-inferred)

- Feature wall: many nav destinations at once  
- Mission + PLAY + Atlas + Architect compete without progressive disclosure  
- Challenge free-play vs path lock can strand learners  
- No offline degraded mode  
- No support/feedback channel UI  

## 10. Reusable assets to **keep**

- `packages/simulation` landscapes, incidents, logs  
- `packages/assessment` ethical return loops, tradeoffs, evaluate  
- `packages/content-engine` + Zod schemas  
- `content/concepts` (157) with mnemonics, use cases, trade-offs  
- Challenge generators (when/how/trap pedagogy) — **slice payload**  
- Architect scenarios  
- Fidelity / legal disclaimers  
- Docker/Railway single-container deploy  

## 11. Explicit non-claims

This audit did **not** complete interactive browser journeys, mobile devices, or authenticated multi-user tests. No assumptions about unmeasured UX quality are presented as observations.
