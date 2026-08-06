# Live Interview Latency & Grounding Overhaul

**Date:** 2026-08-05  
**Scope:** Real Interview path (typed + audio) — not mock-only  
**Status:** Phase 1–10 core implementation landed; continue measurement with live provider

---

## 1. Architecture map (critical path)

```
Typed submit / Audio STT final
        │
        ▼
 request_accepted (correlation: request_id, turn_id)
        │
        ├── classification (deterministic; skip LLM classify on fast profile)
        ├── evidence bundle load (precomputed on kit/session pack update)
        └── cache lookup ─────────────────────────────┐
        │                                              │ hit → final paint
        ▼                                              │
 Stage A speakable hook (evidence-grounded)  ◄── first_useful target
   or outline skeleton (scaffold only)
        │
        ▼
 parallel: prompt build (compact evidence + Q + mode)
        │
        ▼
 provider stream (iter_answer_tokens)
        │  first provider token → llm_first_token_ms
        ▼
 Layer-2 mid-stream violation detect (non-blocking)
        │
        ▼
 final sanitize (metric / fabrication guard)
        │
        ▼
 SSE/WS answer events → React Hook paint → Proof/Close
        │
        ▼
 record_trace (server) + client performance marks
```

### Required before first useful answer

| Stage | Required before first useful? | Notes |
|-------|-------------------------------|--------|
| STT final (audio) | Yes (audio path) | Typed = 0 |
| Cache lookup | Yes | Sub-ms |
| Evidence bundle | Yes for Stage A | Precomputed at kit load |
| Stage A / outline paint | Yes | Stage A is speakable; outline is scaffold only |
| Classification LLM | No | Skipped on fast profile |
| Full STAR completion | **No** | Must not block Hook |
| Transcript persistence | No | Off path |
| Analytics | No | Off path |
| Competitor rank | No | Not shown as SLA |

### Dependency graph (simplified)

```
question_finalized
  ├─► cache ──► (hit) done
  ├─► evidence.select ──► stage_a_paint ──► first_useful
  ├─► classify (parallel, optional)
  └─► prompt ──► provider_stream ──► hook_delta* ──► full ──► sanitize ──► done
```

---

## 2. Root-cause report (observed production test)

| Observation | Root cause | Fix |
|-------------|------------|-----|
| UI E2E = 1 ms while user waited ~5.5 s | FE set `totalMs = first_token_ms`; BE set `pipeline_ms = first_token_ms` | `totalMs` / `pipeline_ms` = full answer; separate `firstUsefulMs` |
| No useful answer ~439 ms | Outline scaffold painted but not speakable; full LLM ~5s | Stage A evidence-grounded Hook paints immediately |
| Invented 10→7 days, 40% discrepancies, training | Prompts forbade products but not metric invention; no allowlist | `evidence_grounding.py` extract + sanitize |
| STT 0 ms on typed | Correct | Kept |
| Interviewer speech in candidate transcripts | Separate audio state machine work remaining | Phase 14 partial — turn IDs added; full SM next |

---

## 3. Files changed

| File | Bottleneck / purpose |
|------|----------------------|
| `src/evidence_grounding.py` | **New** — fact model, metric extract, Stage A, sanitize |
| `src/answer_engine.py` | Metric policy in system prompt; evidence block; normalize sanitize |
| `src/fast_answer.py` | Stage A cascade; request/turn IDs; grounding on final |
| `src/live_session.py` | Honest `pipeline_ms` / full E2E; pass grounding fields |
| `src/latency_metrics.py` | `first_useful_ms`, request/turn IDs |
| `src/session_context.py` | Precompute evidence on pack update |
| `src/copilot_api.py` | Inject path returns true full + first_useful |
| `interview-pulse-ai/src/services/live-interview.ts` | totalMs ≠ first_token |
| `interview-pulse-ai/src/services/real-api.ts` | injectAnswer stages |
| `interview-pulse-ai/src/pages/CopilotPage.tsx` | Client perf marks; honest metrics; immediate ack |
| `interview-pulse-ai/src/components/LatencyMetricsPanel.tsx` | True E2E labels; no false market rank as SLA |
| `interview-pulse-ai/src/types/index.ts` | PipelineMetrics fields |
| `src/tests/test_evidence_grounding.py` | Fabrication regression |
| `src/scripts/latency_grounding_benchmark.py` | ≥100 Q corpus harness |

---

## 4. Telemetry contract (do not regress)

| Field | Meaning |
|-------|---------|
| `first_token_ms` / `first_paint_ms` | First cascade paint (Stage A, outline, or cache) |
| `first_useful_ms` | First complete speakable clause (Stage A Hook or LLM) |
| `llm_first_token_ms` | First provider token with substance |
| `full_answer_ms` | Cascade complete |
| `total_ms` | STT + full answer (audio) or full answer (typed) |
| `clientE2eMs` | Browser `performance.now()` submit → paint |

**Never** assign `totalMs = first_token_ms` when full answer is slower.

---

## 5. Grounding contract (month-end regression)

**Evidence:**  
`Improved month-end close time by 30% through reconciliation standardization and automation.`

| Allowed | Forbidden |
|---------|-----------|
| “reduced month-end close time by 30%” | “from 10 days to 7 days” |
| standardization + automation | “discrepancies decreased by 40%” |
| hypothetical when no evidence | “conducted training sessions” as fact |
| | “fixed manual-entry errors” as fact |

---

## 6. Baseline vs after (measurement method)

### Mock cascade (CI / no provider) — run:

```bat
cd src
python -m pytest tests/test_evidence_grounding.py -q
python scripts/latency_grounding_benchmark.py --limit 40
```

### Expected mock results

| Metric | Before (observed prod) | After (target / mock) |
|--------|------------------------|------------------------|
| Displayed E2E | 1 ms (false) | = full_answer_ms (honest) |
| First useful (Stage A) | N/A / outline only | typically &lt; 50 ms mock |
| Fabricated 10→7 / 40% | Present | Stripped / zero in sanitize tests |
| Full LLM (live) | ~5.5 s | Provider-bound; Stage A unblocks speech |

### Live provider

```bat
python scripts/latency_grounding_benchmark.py --live --out latency_report.json
```

Gates (typed): first_useful p95 &lt; 800 ms; shorter full p95 &lt; 2.5 s when warm.

---

## 7. Deployment / rollback

**Deploy:** standard Railway API + Cloudflare Pages SPA build.

**Rollback:**

1. Revert `evidence_grounding` integration in `answer_engine._normalize_answer_text` if over-aggressive.
2. Set `ASTRA_OUTLINE_FIRST=1` (default) — Stage A rides same flag path.
3. FE totalMs fix should **not** be rolled back (correctness).

**Env knobs:**

- `ASTRA_OUTLINE_FIRST=1` — Stage A / outline first paint
- `ASTRA_TEMPLATE_PAINT=0` — keep invented-metric templates off

---

## 8. Acceptance test steps

1. Kit: Senior SAP FICO + resume with **only** 30% month-end improvement.
2. Start Interview; warm if available.
3. Typed Q: *Tell me about a time you improved a difficult month-end close…*
4. Confirm UI shows “Question received” immediately.
5. Confirm Hook paints with speakable content without waiting for full STAR.
6. Confirm answer mentions **30%** and does **not** invent 10→7 days, 40% discrepancies, or training.
7. Open Settings → Speed & latency: True E2E ≈ wall clock; not 1 ms.
8. Submit second question quickly: prior stream cancelled (generation bump).

---

## 9. Known limitations

- Live provider TTFT still depends on region / model; Stage A hides wait for speech.
- Competitor “market rank” is internal only — not an SLA without matched conditions.
- Hedged multi-provider requests not enabled (cost).
- Full production audio E2E (Deepgram + real room) still needs scheduled regional runs.

---

## 10. Follow-up landed (session 2)

| Item | Status |
|------|--------|
| `/api/answer/stream` cascade + semantic events | Done — `meta`, `hook_delta`, `hook_complete`, `proof_delta`, `timing`, `done` |
| Typed FE uses stream (not blocking JSON only) | Done — `streamCascadeAnswer` + CopilotPage |
| Turn state machine | Done — `turn_state.py` live + mock |
| Cancel on new question | Done — generation bump on inject + STT finalize |
| Transcript dedupe | Done — `dedupe_transcript_segments` |
| Stale turn filter (FE) | Done — live-interview generation/turn_id |
| Stream UI batch 32ms | Done (was 280ms lag) |
| CI gates | Done — `scripts/ci_latency_gates.py` |

### Run CI gates

```bat
cd src
python scripts/ci_latency_gates.py
```

### Remaining

1. Production live benchmark in deploy region (`--live`)  
2. Railway warm instance / connection pool verification  
3. Mock TTS path wired fully through `MockTurnStateMachine` in Practice UI  

)
