# Feature preservation certificate — Interview + Materials merge

**Date:** 2026-08-04  
**Scope:** Combine Co-Pilot + Knowledge into one Interview home; move latency stack to Settings; Apple-simple UX for users under 40.  
**Principle:** Progressive disclosure (Apple HIG: clarity, deference, content-first). No capability removed.

---

## Design research summary

| Source | Applied principle |
|--------|-------------------|
| Apple HIG (foundations) | Clarity, hierarchy, one primary action |
| WWDC / iOS 2025 design | Content first; chrome defers; reduce clutter |
| Mobile 2025 guides | Large touch targets, progressive disclosure, min 44–48px CTAs |
| Young-user patterns (&lt;40) | Plain labels (“Start”, “Materials”), fewer tabs, hide power tools |

---

## Navigation before → after

| Before | After | Status |
|--------|-------|--------|
| Sidebar: **Copilot** | **Interview** | Renamed, same route `copilot` |
| Sidebar: **Knowledge** | Removed from nav | Features live under Interview → Materials |
| Sidebar: Mock, Analytics, Settings | Same | Preserved |
| Mobile: Copilot, Knowledge, Mock, Stats, Settings | Interview, Mock, Stats, Settings | Knowledge merged |
| Deep link `knowledge` route | Redirects to Interview + Materials open | Preserved |
| Brand subtitle “AI Copilot” | “Live answers” | Cosmetic only |
| Mobile welcome “Start with Copilot” | “Start Interview” | Same action |
| Jobs “JD saved to Knowledge” toast | “JD saved to Interview Materials” | Same store write |

---

## Co-Pilot (Interview) feature matrix

| Feature / control | Before | After | Certificate |
|-------------------|--------|-------|-------------|
| Start interview | Button “Start interview” | Button **Start** (same handler `toggleSession`) | ✅ |
| Stop interview | Button “Stop interview” | Button **Stop** | ✅ |
| Reset | Clears session, cards, role, context, fullSessionReset | Same | ✅ |
| Hide controls | Hide + floating Show / Start-Stop | Same | ✅ |
| LiveWaveform | Present | Present | ✅ |
| Status line | Present | Present | ✅ |
| Phase label + device | Present | Present | ✅ |
| Role field | Present | Present | ✅ |
| Job context field | Present | Present | ✅ |
| “Sent to answers” line | Present | “Answers use:” (same data) | ✅ |
| Answer depth select | Present | Present | ✅ |
| Depth pills near type-Q | Present | Present | ✅ |
| Type question + Answer | Present | Present | ✅ |
| How this works | Always visible block | Collapsible (same 4 steps + tips) | ✅ |
| Backend offline tip | In How this works | Same (when expanded) + ApiStatusBadge banner | ✅ |
| Audio source note when session on | Present | Present | ✅ |
| Live transcript | Always-open section | Collapsible **Transcript** (same lines + status log) | ✅ |
| Status log under transcript | Present | Present when transcript open | ✅ |
| WhisperStream answer panel | Present | Present (hero, more vertical space) | ✅ |
| Answer modes / rewrite | Present | Present | ✅ |
| Expand answer | Present | Present | ✅ |
| Detach / popout answer | Present | Present | ✅ |
| ApiStatusBadge banner | Present | Present | ✅ |
| WebSocket live interview | All callbacks | Unchanged | ✅ |
| Manual / inject / offline answer | Present | Present | ✅ |
| setSessionContext on Start (JD/resume docs) | Present | Present | ✅ |
| Metrics still written to store | onMetrics / setMetrics | Same (display moved) | ✅ |

---

## Knowledge → Materials feature matrix

| Feature / control | Before (Knowledge page) | After (Interview → Materials) | Certificate |
|-------------------|-------------------------|-------------------------------|-------------|
| Clear knowledge context | Button + confirm | **Clear all** + same confirm (wording: materials) | ✅ |
| Upload drop zone | Present | Present | ✅ |
| Drop type: Subject PDF / Notes / Resume / JD file | Present | Present | ✅ |
| File buttons: Resume, Subject PDF, Notes, Job description | Present | Present | ✅ |
| Drag-and-drop | Present | Present | ✅ |
| Parse PDF/DOCX/MD/TXT | Present | Present | ✅ |
| Documents list + count | Present | Present | ✅ |
| Per-document delete | Present | Present | ✅ |
| Clear documents button | Present | Present | ✅ |
| Job match title input | Present | Present | ✅ |
| Paste JD textarea | Present | Present | ✅ |
| Match button | Present | Present | ✅ |
| Match score + memory hits | Present | Present | ✅ |
| STAR memories grid (S/T/A/R) | Present | Present | ✅ |
| Clear STAR memories | Present | **Clear STAR** | ✅ |
| setSessionContext on upload | resume/JD/notes | Same | ✅ |
| vectorizeToMemories | Present | Present | ✅ |
| Login wipe of knowledge | store `clearKnowledgeContext` | Unchanged | ✅ |
| Header summary counts | Present | Accordion summary + open body | ✅ |

---

## Latency stack (image) feature matrix

| Feature / control | Before (Copilot bottom) | After (Settings → Speed & latency) | Certificate |
|-------------------|-------------------------|--------------------------------------|-------------|
| Session ON/Off | Metric card | Same (uses `listening` store) | ✅ |
| First token | Metric card | Same | ✅ |
| Full answer | Metric card | Same | ✅ |
| STT | Metric card | Same | ✅ |
| Latency stack: Outline, Cache, Classify, LLM first, Full ans, E2E | Present | Present | ✅ |
| vs competitors toggle | Present | Present | ✅ |
| Market rank grades | Present | Present | ✅ |
| Competitor comparison table | Present | Present | ✅ |
| Tip line | Present | Present | ✅ |
| Last source / samples | Present | Present | ✅ |
| Poll every 12s | On Copilot when API ok | On Settings panel mount | ✅ |
| Live metrics from interview | setMetrics on answer | Unchanged; Settings reads store | ✅ |

---

## Settings (unchanged + added)

| Feature | Status |
|---------|--------|
| Account & billing (all buttons) | ✅ Unchanged |
| Intelligence (demo, keys, job context, tone, audio source) | ✅ Unchanged |
| Stealth (protection, click-through, opacity, overlay) | ✅ Unchanged |
| **Speed & latency** section | ✅ **Added** (moved from Interview) |

---

## Word / label map (user-visible)

| Before | After | Intent |
|--------|-------|--------|
| Copilot | Interview | Plain language for &lt;40 |
| Knowledge | Materials (section) | Files that power answers |
| Start interview / Stop interview | Start / Stop | Shorter primary CTA |
| Clear knowledge context | Clear all | Same action |
| Clear STAR memories | Clear STAR | Same action |
| Interview knowledge context | Materials summary line | Same data |
| Or type a question (skips STT lag) | Type a question | Simpler |
| Live interview | Interview | One home |
| How this works (always open) | How this works (tap to open) | Progressive disclosure |
| Live transcript | Transcript (tap to open) | Progressive disclosure |
| Latency on main screen | Settings → Speed & latency | De-clutter Interview |

---

## Explicit non-removals

1. No upload type removed.  
2. No answer mode removed.  
3. No stealth/billing control removed.  
4. No latency stage or competitor column removed.  
5. No live STT / inject / reset path removed.  
6. Legacy `knowledge` NavRoute type retained; `setRoute('knowledge')` opens Interview + Materials.  
7. Jobs “save JD” still writes a job document into the same store.

---

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` → **exit 0**  
- Implementation files:
  - `interview-pulse-ai/src/components/MaterialsPanel.tsx` (new)
  - `interview-pulse-ai/src/components/LatencyMetricsPanel.tsx` (new)
  - `interview-pulse-ai/src/pages/CopilotPage.tsx` (unified Interview)
  - `interview-pulse-ai/src/pages/SettingsPage.tsx` (latency host)
  - Nav: Sidebar, MobileNav, TopBar, MobileTopBar, MobileWelcome, App

---

## Certificate statement

**I certify that this redesign relocates and renames controls for simplicity without deleting product capabilities.** Every button, metric, upload path, match/STAR tool, and interview control listed above exists in the post-merge UI, either on Interview (including Materials accordion) or Settings (Speed & latency).

Signed as implementation completion record: 2026-08-04 · InterviewPulse UI merge.
