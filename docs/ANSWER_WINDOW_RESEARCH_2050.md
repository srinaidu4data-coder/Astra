# InterviewPulse Answer Window — Evidence-Based Redesign Research

**Codename:** SpeakCanvas  
**Date:** 2026-08-01  
**Scope:** How to present, type, highlight, structure, and stream interview answers under latency pressure  
**Status:** Research + product design brief (implementation next)

---

## 0. Honest methodology (proof of work, not theater)

### What this is
A **multi-domain research synthesis** across cognitive psychology, educational psychology, typography/HCI, behavioral interviewing practice, and real-time UI latency design—mapped onto InterviewPulse’s current answer panel (`WhisperStream`).

### What this is *not*
- Not a claim of having read **100,000 papers** end-to-end. That is not how scientific review works, and asserting it would be false.
- Not “100 agents for 4 hours” as a literal log. What *was* done: systematic web retrieval across PMC/NIH, Springer, Taylor & Francis, NN/g eyetracking, MIT CAPD / Northwestern career practice, classic theory (Mayer, Paivio, Sweller, von Restorff), and synthesis into product rules.

### Proof-of-work trail (primary sources consulted this session)

| Domain | Sources / anchors |
|--------|-------------------|
| Cognitive load / multimedia | Mayer CTML (2001/2002+); Sweller cognitive load; NCSU application of 12 principles; Bali et al. 2026 PMC visual load |
| Dual coding | Paivio 1971/1986; Clark & Paivio 1991; Sadoski & Paivio educational applications |
| Typography (screen) | USWDS typography measure 45–90 chars; Ali/Josephson/Ukonu serif vs sans screen findings; Vision Australia accessibility notes |
| Emphasis / bold / highlight | Wu et al. 2024 *Memory & Cognition* (ERP/EEG on font emphasis); Lorch et al. classic signaling; teaching practice “≤3 lines bold”; von Restorff isolation effect (1933 → modern reviews) |
| Scan patterns | Nielsen Norman Group F-shaped pattern; layer-cake / spotted scanning |
| Interview structure | MIT CAPD STAR weights (~20/10/60/10); Northwestern STAR; HBR STAR; critique that Situation overruns Action |
| Memory / attention | Working memory limits; chunking; isolation/distinctiveness for keywords |

---

## 1. The interview copilot problem (why the current panel fails under pressure)

Your current empty state and structure (from product):

- Title: “Your answer”
- Modes: **Shorter · Technical · STAR · Code**
- Body: large empty glass card + soft placeholder
- Dense prose blocks when answers arrive; limited semantic hierarchy for *speaking*

### The human constraints (non-negotiable)

1. **Limited working memory** while speaking (classic capacity limits; chunking is mandatory).
2. **Eyes scan, they don’t read** under stress (NN/g F-pattern: top-left first, then skim left edge).
3. **Redundant text + too many visuals** increases load (Mayer limited-capacity + Bali et al. visual load).
4. **Latency kills confidence**: first paint must be usable in **&lt;800–1500ms**, not a full monologue.
5. **Bold everything = bold nothing** (isolation effect requires rarity; over-emphasis collapses distinctiveness).

**Design thesis (2050 framing):**  
The answer window is not a document. It is a **speech teleprompter + cognitive scaffold**: a dual-channel interface that feeds *what to say next* while offloading *structure* and *impact words*.

---

## 2. Psychology of presentation (what the science implies)

### 2.1 Cognitive Theory of Multimedia Learning (Mayer)

Core assumptions:

- **Dual channels** (visual + verbal)
- **Limited capacity** per channel
- **Active processing** (select → organize → integrate)

**Product rules:**

| Principle | Interview answer UI |
|-----------|---------------------|
| Coherence | Strip filler; no wall of text |
| Signaling | Labels: HOOK · PROOF · CLOSE |
| Segmenting | Progressive blocks, not one blob |
| Pre-training | Tiny “mode legend” once, not every answer |
| Redundancy | Don’t show spoken audio *and* identical full text dump in two competing panels |
| Spatial contiguity | Keywords **inside** the speak line, not a separate glossary far away |
| Temporal contiguity | Stream outline first, then expand (matches streaming LLM TTFT) |

### 2.2 Dual coding (Paivio)

Verbal + imaginal codes improve retrieval. For *spoken* interviews, “image” = **structure icons, micro-chips, metric callouts**, not decorative illustrations.

**Product rule:** Pair each speak chunk with a **micro-signal** (icon / chip / metric pill), not more paragraphs.

### 2.3 Isolation effect (von Restorff, 1933+)

Distinct items are remembered better. In UI: **sparse bold/highlight** of 3–7 impact tokens per answer.

**Product rule:** Auto-highlight only:

- Metrics (`40%`, `$2M`, `3 weeks`)
- Ownership verbs (`I led`, `I shipped`)
- Domain anchors (`Kafka`, `SAP ATTP`, `latency p50`)
- Outcome nouns (`conversion`, `uptime`, `SLA`)

Never bold full sentences.

### 2.4 Font emphasis neuroscience (Wu et al., 2024)

Font emphasis:

- Increases controlled attention (P2 ↑, alpha ↓)
- Improves integration of marked words into context (P300)

**Product rule:** Use **weight + color accent** (not rainbow highlight). Prefer **semibold keywords** in accent cyan on dark UI; avoid underline (competes with links) and avoid yellow highlighter on dark glass.

### 2.5 Eyetracking (NN/g F-pattern + layer-cake)

Users:

1. Read a **top horizontal bar** of content
2. Read a shorter second bar
3. Scan **down the left edge**

**Product rule:**

- **First 1–2 lines = speakable hook** (largest type)
- Every chunk starts with a **left label** (HOOK / ACT / PROOF / CLOSE)
- Do not bury the punchline mid-paragraph

### 2.6 Behavioral interview structure (practice + critique)

MIT CAPD STAR guidance approximates:

- Situation ~20% · Task ~10% · **Action ~60%** · Result ~10%

Common failure: candidates ramble on Situation.  
**Product rule:** UI must **visually weight Action + Result**, compress Situation to one line.

---

## 3. Typography system (fonts that serve speech under stress)

### Evidence-based choices for **screen + dark UI + skimming**

| Role | Recommendation | Why |
|------|----------------|-----|
| **Speak body** | System UI sans: `Inter` / `SF Pro` / `Segoe UI` / current Roboto stack | Screen research often favors clean sans for UI + short blocks; high x-height aids fixations |
| **Keywords** | Same family, **600–700 weight** + accent color | Isolation without new typeface switching cost |
| **Metrics** | Tabular nums, slightly larger (`17–19px`) | Scan targets; numbers must align visually |
| **Labels** | 10–11px uppercase tracking | Layer-cake scanning (NN/g) |
| **Code mode** | Monospace only for code fences | Dual-channel: code is a different “visual object” |
| **Line length** | **~55–75 characters** (USWDS 45–90; target ~66) | Prevents eye fatigue on wide expanded panel |
| **Line height** | **1.55–1.75** for speak text | Breathing room under stress |
| **Contrast** | Body `white/90`, secondary `white/45`, keyword `#5DD5E3` or `#20B8CD` | Dark glass already present; don’t drop to gray-on-gray |

### Explicit *do not*

- Do not use decorative serif for live speak text on dark glass (adds noise under low glance time).
- Do not use pure pure-black cards with pure-white walls (glare under webcam lighting).
- Do not animate every word (motion = extraneous load).

---

## 4. Keyword highlighting engine (impact-first)

### Goal
Make the **few words that win interviews** pop: ownership, metrics, technology, outcomes.

### Algorithm (productizable)

```
impact_score(token) =
  +3 if metric/regex (%, $, x, ms, p50, SLA)
  +2 if first-person ownership verb (led, owned, shipped, reduced)
  +2 if known skill from JD/resume pack
  +1 if strong outcome noun
  −2 if filler (basically, just, sort of)
highlight if score ≥ 3, max 8 highlights per answer
```

### Visual grammar

| Kind | Style |
|------|--------|
| Metric | Bold + accent underline 2px |
| Skill / tech | Bold + soft chip background |
| Ownership | Bold only |
| Risk / tradeoff | Italic + amber tint (rare) |

**Cap:** ≤ **8** highlights, ≤ **12%** of words. Beyond that, von Restorff collapses.

---

## 5. Latency-aware rendering (how to feel “instant” while remaining deep)

Your stack already has outline-first / first-token metrics. The **UI must mirror the pipeline**:

### Three-phase paint (SpeakCanvas protocol)

| Phase | Target | UI surface | Source |
|-------|--------|------------|--------|
| **P0 Hook** | 0–400ms | 1 line “Open with…” | Fast outline / first token |
| **P1 Scaffold** | 400–1200ms | 3 labeled beats (HOOK/PROOF/CLOSE) | Streaming bullets |
| **P2 Depth** | 1.2–4s | Expandable proof, metrics, STAR drill-down | Full answer |

**Never block P0 on full monologue.**  
Empty glass with “Type a question…” is a **confidence vacuum**—replace with **skeleton speak rails** even before STT ends when a question is predicted.

### Progressive disclosure controls

- Default view: **Speak mode** (3 beats)
- Tap **Expand** → full narrative / STAR / code
- Rewrite modes re-run only the **active layer** (scaffold vs depth) to save latency

---

## 6. Beyond Shorter / Technical / STAR / Code  
### The new mode system: **Speech Intent Modes** (not just format)

Current modes are *format* toggles. Interview success needs *intent* toggles.

### Tier A — Core (ship first)

| Mode | What interviewer hears | Structure | Latency |
|------|------------------------|-----------|---------|
| **Hook** | 15–25s punchy open | Claim → proof metric → invite | Fastest |
| **Proof** | Evidence-heavy | Metric stack + what *I* did | Medium |
| **Story** | Behavioral (STAR+ weighted) | 1-line S → fat A → R + learn | Medium |
| **Tradeoff** | Senior signal | Options → chose X because → risk | Medium |
| **Teachback** | “Explain like I’m the hiring manager” | Analogy → steps → check | Medium |
| **Code sketch** | Engineering | Intent → API shape → complexity | Fast+stream |

### Tier B — Advanced (differentiator)

| Mode | Innovation |
|------|------------|
| **Mirror** | Reflect interviewer’s language from last Q (rapport / lexical alignment) |
| **Pressure** | Ultra-short under time pressure (3 breaths) |
| **Conflict** | Disagree-professionally template (acknowledge → reframe → propose) |
| **Loop-close** | End with a *question back* to interviewer (conversation control) |
| **Metrics-only** | Strip to numbers + verbs (for quant-heavy roles) |
| **Failure→learn** | Safe failure narrative (owns miss, shows growth) |

### Tier C — “2050” adaptive (state of the art)

| Mode | Behavior |
|------|----------|
| **Auto-Intent** | Classifier chooses Hook/Proof/Story/Tradeoff from question type + JD |
| **Depth dial** | Already have fast/balanced/deep — bind *layout density* to depth |
| **Coach overlay** | Ghost tips: “Say the metric now” / “Stop Situation—go to Action” |
| **Dual pane** | Left: speak lines; right: micro-notes (only if screen real estate allows) |

**Recommendation:** Replace button row  
`Shorter | Technical | STAR | Code`  
with  

`Hook | Proof | Story | Tradeoff | Code` + overflow `⋯ More`

Keep “Shorter” as a **density slider**, not a mode (orthogonal axis).

---

## 7. Grand structure: SpeakCanvas layout (rewrite of Image #1)

### Visual architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SPEAK NOW · 0:18 est · Story · Deepgram/LLM status          │  ← status ribbon
├─────────────────────────────────────────────────────────────┤
│  [Hook] [Proof] [Story] [Tradeoff] [Code]   density: compact │  ← intent modes
├─────────────────────────────────────────────────────────────┤
│  Q  (one line, muted)                                        │
├─────────────────────────────────────────────────────────────┤
│  HOOK   Open with this (largest type)                        │
│         “I led a **40%** latency cut on **checkout** by…”   │  ← bold keywords
│                                                              │
│  PROOF  · metric  · ownership  · tech                        │
│         chips: [−400ms] [Kafka] [I owned]                    │
│                                                              │
│  CLOSE  One sentence + optional loop-back question           │
├─────────────────────────────────────────────────────────────┤
│  ▸ Expand full narrative   ▸ STAR breakdown   ▸ Notes       │  ← progressive
└─────────────────────────────────────────────────────────────┘
```

### Empty state (replace current copy)

Instead of passive “Type a question…”, show **ready rails**:

> **Ready to speak**  
> Start interview or paste a question.  
> First line appears here within ~1s · keywords auto-bolded · modes reshape intent.

### Why this cracks interviews

1. **F-pattern aligned** — hook first, left labels for scan  
2. **CLT-safe** — three chunks max in default view  
3. **STAR-weighted** — Action/Proof visually dominate  
4. **Isolation** — metrics/skills pop without painting the wall yellow  
5. **Latency** — P0 hook usable before full answer  
6. **Agency** — modes change *what to emphasize*, not only length  

---

## 8. Mathematical / economic framing (decision quality under time)

Treat each interview answer as maximizing expected offer probability under time budget \(T\):

\[
\max_{structure} \;\; P(\text{hire} \mid \text{signal}) \quad \text{s.t.} \quad t_{\text{first paint}} \le t^\* \;\;\text{and}\;\; \text{WM load} \le L
\]

Where:

- **Signal** = ownership + metrics + role relevance (highlight engine)
- \(t^\*\) ≈ first token budget (~400–1200ms UI)
- \(L\) ≈ 3–5 chunks (working-memory friendly)

**Economic insight:** Marginal value of another paragraph after the third speak beat is near-zero under interview time pressure; marginal value of one more **metric** is high. UI should **tax verbosity** and **subsidize metrics**.

---

## 9. Competitive gap (why this is “grand” vs Final Round-class tools)

Most copilots optimize **text generation**. Few optimize **speakable cognition**:

| Feature | Typical copilot | SpeakCanvas |
|---------|-----------------|-------------|
| Modes | Length/format | **Speech intent** |
| Highlight | Rare / none | **Impact-score keywords** |
| Structure | Walls / bullets | **HOOK–PROOF–CLOSE scaffold** |
| Latency UI | Spinner | **P0/P1/P2 progressive paint** |
| STAR | Full blocks equal weight | **Action-weighted** |
| Empty state | Dead space | **Ready rails + skeleton** |

---

## 10. Implementation roadmap (for engineering)

### Phase 1 — Visual system (1–2 days)
- SpeakCanvas layout in `WhisperStream`
- Typography tokens (size, measure, line-height)
- Keyword bold renderer (regex metrics + ownership)
- Empty-state rewrite

### Phase 2 — Modes (2–3 days)
- New mode enum: `hook | proof | story | tradeoff | code | pressure`
- Map prompts server-side; density orthogonal (`compact|full`)
- Progressive expand sections

### Phase 3 — Latency coupling (2 days)
- Stream P0 outline into HOOK immediately
- Defer full STAR/code fence until expand or P2
- Skeleton rails during `preparing`

### Phase 4 — Smart highlight (2 days)
- JD/resume term boost from session context pack
- Max-8 highlight budget
- Telemetry: which chips get used (optional)

---

## 11. Success metrics (prove it works)

| Metric | Target |
|--------|--------|
| Time-to-first-usable-speak-line | &lt; 1.0s p50 after question end |
| Words bolded per answer | 4–8 |
| % answers using Expand | &lt; 40% (default scaffold enough) |
| User “felt ready to speak” (1–5) | ≥ 4.2 |
| Interview self-score / mock scores | + uplift vs old panel A/B |

---

## 12. Bottom line

**Rewrite the answer window from “document of an answer” to “cognitive instrument for speech.”**

- **Fonts:** high-x-height UI sans; metric emphasis; 55–75ch measure  
- **Highlight:** sparse, score-based, isolation-preserving  
- **Structure:** HOOK → PROOF → CLOSE with Action-heavy Story mode  
- **Modes:** intent modes, not just Shorter/Technical/STAR/Code  
- **Latency:** three-phase paint aligned to your existing outline-first backend  

This is the state-of-the-art path that is still implementable with your current stack—not science fiction, but **interview-native interface design grounded in cognitive science**.

---

## Appendix A — Key references (entry points)

1. Mayer, R. E. — Cognitive Theory of Multimedia Learning  
2. Sweller, J. — Cognitive Load Theory  
3. Paivio, A. — Dual Coding Theory  
4. von Restorff, H. (1933) — Isolation effect  
5. Wu et al. (2024) — Font emphasis ERP/EEG, *Memory & Cognition*  
6. Nielsen Norman Group — F-shaped pattern / how people read online  
7. US Web Design System — Typography measure guidance  
8. Ali / Josephson / Ukonu — Serif vs sans on screen  
9. MIT CAPD / Northwestern — STAR structure weights  
10. Bali et al. (2026) — Visual load in digital presentations (PMC)

---

*End of research brief. Ready for implementation in `WhisperStream` + answer engine prompts when you say “build SpeakCanvas.”*
