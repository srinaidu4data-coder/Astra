# Jobs product collapse (post multi-org review)

## Cut

- Marvel / Nexus / career-ops / ApplyPilot / AIHawk / HITL as **primary navigation** → legacy hashes redirect to **Apply**
- 3-minute improve scheduler **cancelled** (`019fba451b48`)
- Cosmetic OS CSS thrash paused — Material tokens remain until UX research

## Ship shape

| Tab | Purpose |
|-----|---------|
| **Search** | Discover + Search & Apply + Trust log |
| **Apply** | Single apply pipeline (AutoApplyPage) |
| **Night** | Overnight scout |
| **Advanced** | Form pack · Metrics only |

## Build checklist

1. **Trust UI** — `ApplyTrustPanel`: submitted | filled | manual | skipped + reason  
2. **One Apply path** — hub collapse above  
3. **Boot CI** — `npm run check:boot` / `prebuild` (rankMemories export graph)  
4. **PII hygiene** — `saveFormPackSecure` truncates resume text; 7-day TTL  
5. **Metrics** — `GET /api/jobsearch/apply/metrics` + Advanced → Metrics page; auto-record on one-click/browser apply  

## North-star KPI

`kpi.value` = submitted + filled (not opened_manual alone)  
`kpi.weekly_completed` = applications **submitted** this ISO week  
Stored under `src/data/apply_metrics.json`  
Audit log: `src/data/apply_audit.jsonl` (url, pack_id, submitted, user_id, ts)

## Review asks (implemented)

| Ask | Status |
|-----|--------|
| One apply pipeline (hide Marvel/Nexus names) | Hub + AutoApply strings |
| Instrument by ATS | metrics + Trust UI |
| Weekly completed number | Metrics KPI card |
| HITL claim gate before submit | `HitlClaimGate` on Search apply |
| Lab-only banner | always on Jobs shell |
| Boot CI | `npm run check:boot` |
| PII clear on logout | `auth.logout` → `clearAllJobsearchLocalData` |
| Audit log | apply_audit.jsonl |
| Latency p50/p95 | metrics snapshot |
| Forge top-K | form_pack forge_top=3 default |
| Honesty red-team + golden eval | `test_honesty_redteam` + `test_eval_golden` |
