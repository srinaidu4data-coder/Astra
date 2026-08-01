# SpeakCanvas Research — Multi-Agent Validation Review

**Date:** 2026-08-01  
**Source brief:** `docs/ANSWER_WINDOW_RESEARCH_2050.md`  
**Reviewers (RT agents):** Cognitive psychology · Interview coach / hiring manager · HCI / latency UX  
**Code surface checked:** `interview-pulse-ai/src/components/WhisperStream.tsx`

---

## Overall scores

| Reviewer | Score / confidence | One-line verdict |
|----------|-------------------|------------------|
| **Cognitive psychology** | **48/100** foundation | Strong product thesis; theory-to-rule mapping often stretched |
| **Interview coach / HM** | **7/10** efficacy | Right scaffold; **script risk under-specified** |
| **HCI / latency** | **0.78** confidence | Ship thin SpeakCanvas v0; defer mode taxonomy rewrite |

**Consensus:**  
**Implement the speech-scaffold UI.**  
**Do not freeze the brief’s science labels, 0–400ms clocks, or Tier B/C modes as “proven.”**

---

## What all three agents agree is solid (KEEP)

1. **Answer window = speech teleprompter + scaffold**, not a document  
2. **HOOK → PROOF → CLOSE** (or 3 short beats) default view  
3. **Progressive paint** (usable line before full monologue)  
4. **Sparse keyword emphasis** (bold everything = bold nothing)  
5. **Action-heavy behavioral answers** (compress Situation)  
6. **Density orthogonal to mode** (“Shorter” as slider, not a mode)  
7. **Empty-state ready rails** beat the current dead glass card  
8. Honest methodology section in the original brief  

---

## Critical corrections (MUST FIX before treating brief as product law)

### P0 — Product / engineering

| Issue | Correction |
|-------|------------|
| **0–400ms P0 promise** | Marketing. Use skeleton **immediately**; measure first usable line as p50/p95 (e.g. p50 &lt; 1s, p95 &lt; 2.5s after question final). |
| **Predicted question before STT** | Trust risk — wrong hook worse than empty. **Drop for v1.** |
| **Full mode rewrite in same PR as visuals** | Blast radius (types, prompts, regenerate). **Visual scaffold first.** |
| **Stream remount / flicker** | Keep anti-flicker architecture; append-only or single surface. |
| **Looking scripted** | #1 hire risk. Default **bullets / prompts-only**, not essay prose; “glance, don’t read.” |

### P1 — Science / design honesty

| Overclaim | Honest reframe |
|-----------|----------------|
| Chips/icons = **dual coding (Paivio)** | **Visual signaling / scan anchors** (still verbal) |
| Mayer **redundancy / pre-training** as used | **Dual-task single primary stream** · **one-time UI legend** |
| **Wu et al. ERP → cyan semibold** | Wu supports sparse emphasis in *reading*; UI grammar is unproven |
| **von Restorff → max 8 / 12%** | Product **hypothesis** to A/B, not a law |
| **F-pattern as governing law** | Web-reading model; better: **teleprompter + re-entry anchors** |
| **MIT 60% Action** | Anti-ramble medicine, not liturgy; Result still matters at senior |

### Missing psych (agents flagged)

- **Reading while speaking** (dual-task / articulatory loop conflict) — *primary* model  
- **Evaluative stress / anxiety** — coach overlay mid-clause can hurt fluency  
- **L2 / bilingual load** — denser text + more highlights hurts more  
- **Speakable unit size** (~8–16 words / one breath), not just “3 sections”  

---

## Mode validation (interview coach)

| Mode | Verdict |
|------|---------|
| Hook, Proof, Story, Tradeoff, Code | **Ship** |
| Density compact/full | **Ship** (always visible) |
| Pressure, Failure→learn, Conflict | **Maybe** (overflow) |
| Loop-close | **Tip / CLOSE option**, not mode |
| Teachback, Metrics-only, Mirror, Dual-pane | **Kill v1** |
| Auto-Intent | **v2+** after trust |
| Coach overlay | **Mock only** first |

**Primary row:** `Hook · Proof · Story · Tradeoff · Code` + `⋯` + density.

---

## HCI: implement order (validated)

### Sprint 0 — SpeakCanvas v0 (1–3 days) — **do this first**
1. Empty state → ready rails (+ skeleton when `preparing`)  
2. Demote question to **one muted line** (current Q card steals attention)  
3. Typography tokens + `max-w-[66ch]`  
4. Action-weighted STAR if STAR remains  
5. Basic highlight: metrics + ownership, **cap 8**, freeze during stream  
6. Use existing `answer.metrics` chips if present  
7. **No new mode enum yet**

### Sprint 1 — Progressive structure
- Map stream → 3 labeled beats  
- Speak view + Expand  
- Instrument time-to-first-usable-text  

### Sprint 2 — Intent modes (after v0 validates)
- Hook / Proof / Story / Tradeoff / Code + density  
- Server prompts  

### Later
- JD-boost highlights, Auto-Intent, Mock coach, overflow modes  

---

## Success metrics (agents’ rewrite)

| Keep as primary | Demote / drop |
|-----------------|---------------|
| Time-to-first-usable-speak-line (p50/p95) | Words bolded 4–8 (vanity) |
| “Felt ready to speak” (1–5) with baseline | Expand% alone (ambiguous) |
| Mock A/B hire-signal / coach score | Absolute 400ms marketing SLOs |
| Script risk / “sounded read” rating | |

---

## Composite recommendation

| Layer | Decision |
|-------|----------|
| **Product thesis** | **Approve** |
| **Science branding** | **Revise** — heuristics inspired by CLT/signaling, not “validated applications of Mayer/Paivio/Wu” |
| **UI v0** | **Approve and build** |
| **Mode system v1** | **Approve pruned set** after v0 |
| **Tier B/C / Mirror / dual pane / live coach** | **Reject for v1** |
| **2050 / SOTA marketing language** | **Park** in eng specs |

### One-sentence north star (psych-agent rewrite — preferred)

> Under evaluative stress, candidates have limited production planning capacity and must **glance-read while speaking**. The UI should externalize structure, minimize search, mark few high-value tokens, and deliver a first speakable unit fast—without adding a second cognitive task.

---

## Agent IDs (audit trail)

| Agent | Role | ID |
|-------|------|-----|
| Psych | Cognitive / educational psych | `019fbf39-1440-7582-abcc-ce0e6e4b3b6e` |
| Coach | Interview / hiring | `019fbf39-1446-7c23-94c7-c1684881604a` |
| HCI | Real-time UX / latency | `019fbf39-144a-7cb2-bfc0-6d7aa44cceda` |

---

*Validation complete. Ready to implement SpeakCanvas v0 when instructed.*
