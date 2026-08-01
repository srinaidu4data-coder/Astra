# Astra Apply Kit (Chrome extension)

**Purpose:** Hold AI-tailored resume + form answers so you can autofill job applications on any ATS page (Greenhouse, Lever, Freshteam, Workday-ish, generic). Works with the Job Search lab auto-apply pipeline.

Inspired by public patterns (Simplify-style profile autofill, AIHawk-style resume tailoring) — **original code**, localhost lab.

## Install (unpacked)

1. Start the lab: `START_JOBSEARCH_LAB.bat` (API `:8787` + UI `:5173`).
2. Open Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select this folder:
   `interview-pulse-ai/extension/astra-apply-kit`
4. In Jobs UI → **Export Apply Kit** (or Tools → Export Apply Kit) → downloads `astra-apply-kit.json`.
5. Click the extension icon → **Import JSON** (paste or open the file) **or** Sync from lab for a base pack.
6. Open an employer apply page → click **Fill form** on the floating bar (or popup **Fill this page**).

## What it stores

- Contact fields (name, email, phone, LinkedIn, location)
- Tailored resume text per job (Resume Forge keyword inject)
- Cover note + common interview/application Q&A
- Label map for fuzzy form matching

## Strict soft kit (default on)

Popup toggle **Strict soft kit** stamps `strict_soft` on the stored Apply Kit (same policy as the Jobs lab):

- **On (default):** only strong id/path URL matches fill tailored packs; soft same-board sibling packs are skipped (base contact only).
- **Off:** soft same-board packs may fill (higher risk of wrong materials).

## What it does *not* do

- Does **not** bypass LinkedIn login / CAPTCHA
- Does **not** silently submit without you (content script fills; you submit)
- Does **not** upload binary PDFs automatically (browser security) — paste resume text or attach file manually

## Lab API

```
POST http://127.0.0.1:8787/api/jobsearch/apply/form-pack
POST http://127.0.0.1:8787/api/jobsearch/apply/extension-store
```

## Related OSS

- [AIHawk Jobs Applier](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk) — agent-style apply automation
- [Simplify](https://simplify.jobs/) — commercial autofill (reference product shape only)
