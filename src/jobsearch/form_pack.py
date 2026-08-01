"""
Form Pack — AI-tailored resume + complete ATS answer kit for browser autofill.

Inspired by public product patterns (Simplify-style profile pack, AIHawk-style
tailoring) but original code for Astra Job Search lab.

One pack powers:
  - Playwright one-click apply
  - Chrome extension content-script autofill on any ATS page
  - Clipboard / manual paste when automation fails
"""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

from jobsearch.apply_engine import build_cover_note
from jobsearch.autofill import build_autofill_profile, sanitize_resume_text
from jobsearch.resume_forge import FORGE_VERSION
from jobsearch.tailor_rt import TAILOR_RT_VERSION, tailor_materials

FORM_PACK_VERSION = "1.3.3"
FORM_PACK_SCHEMA = "astra.form_pack.v1"

# Path segments that do not identify a specific job listing
_URL_SKIP_SEGMENTS = frozenset(
    {
        "",
        "www",
        "jobs",
        "job",
        "apply",
        "application",
        "applications",
        "careers",
        "career",
        "en",
        "us",
        "uk",
        "boards",
        "embed",
        "o",
        "s",
        "j",
        "v1",
        "v2",
        "api",
        "view",
        "posting",
        "position",
        "positions",
        "opening",
        "openings",
        "gh_jid",
    }
)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
_JOB_ID_QUERY_KEYS = frozenset(
    {
        "gh_jid",
        "jobid",
        "job_id",
        "job",
        "id",
        "posting_id",
        "lever-source",
    }
)


def _parse_apply_url(url: str | None) -> dict[str, Any]:
    """Normalize an apply/page URL into host, path tokens, and id-like keys."""
    raw = str(url or "").strip()
    if not raw:
        return {"host": "", "path": "", "tokens": [], "ids": set()}
    if "://" not in raw:
        raw = "https://" + raw
    try:
        p = urlparse(raw)
    except Exception:
        return {"host": "", "path": "", "tokens": [], "ids": set()}
    host = (p.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (p.path or "").lower().rstrip("/")
    tokens: list[str] = []
    ids: set[str] = set()
    for seg in path.split("/"):
        s = seg.strip().lower()
        if not s or s in _URL_SKIP_SEGMENTS:
            continue
        # strip common trailing junk
        s = s.split(".")[0] if s.endswith(".html") else s
        tokens.append(s)
        if s.isdigit() and len(s) >= 4:
            ids.add(s)
        elif _UUID_RE.match(s):
            ids.add(s)
        elif len(s) >= 8 and re.match(r"^[a-z0-9_-]+$", s) and any(c.isdigit() for c in s):
            # greenhouse-ish alphanumeric job tokens
            ids.add(s)
    try:
        qs = parse_qs(p.query or "", keep_blank_values=False)
        for k, vals in qs.items():
            lk = str(k).lower()
            if lk not in _JOB_ID_QUERY_KEYS and "jid" not in lk and "job" not in lk:
                continue
            for v in vals:
                vv = str(v).strip().lower()
                if vv:
                    ids.add(vv)
                    tokens.append(vv)
    except Exception:
        pass
    return {"host": host, "path": path, "tokens": tokens, "ids": ids}


def score_url_match(page_url: str | None, pack_url: str | None) -> int:
    """
    Score how well a page URL matches a job pack apply_url.
    0 = no match. >=50 is strong enough to prefer this pack over active_job_id.
    """
    page = _parse_apply_url(page_url)
    pack = _parse_apply_url(pack_url)
    if not page["host"] or not pack["host"]:
        return 0
    score = 0
    ph, ah = page["host"], pack["host"]
    if ph == ah:
        score += 40
    elif ph.endswith("." + ah) or ah.endswith("." + ph):
        score += 30
    else:
        # boards.greenhouse.io vs company.greenhouse.io — same ATS family + shared token later
        p_parts = ph.split(".")
        a_parts = ah.split(".")
        if len(p_parts) >= 2 and len(a_parts) >= 2 and p_parts[-2:] == a_parts[-2:]:
            score += 15
        else:
            return 0  # different sites — do not soft-match

    # Exact path (ignoring trailing slash / query noise already stripped)
    if page["path"] and page["path"] == pack["path"]:
        score += 60
    else:
        p_tok = set(page["tokens"])
        a_tok = set(pack["tokens"])
        shared = p_tok & a_tok
        # Prefer id-like shared tokens (job numbers / uuids)
        shared_ids = page["ids"] & pack["ids"]
        if shared_ids:
            score += 55
        # Company board slug etc.
        shared_soft = shared - shared_ids
        if shared_soft:
            score += min(30, 10 * len(shared_soft))
        # Last pack token appears in page path (common for /jobs/<id>/apply)
        if pack["tokens"]:
            last = pack["tokens"][-1]
            if last in page["path"]:
                score += 20 if last in pack["ids"] or last.isdigit() else 10
    return int(score)


def _pack_apply_url(pack: dict[str, Any]) -> str:
    job = pack.get("job") if isinstance(pack.get("job"), dict) else {}
    return str(
        (job or {}).get("apply_url")
        or (job or {}).get("url")
        or pack.get("apply_url")
        or ""
    ).strip()


def has_url_id_token_match(
    page_url: str | None,
    pack_url: str | None,
    job_id: str | None = None,
) -> bool:
    """
    True when page and pack share a job-id-like token (numeric id / uuid / job_id),
    not merely the same host + company board slug.
    """
    page = _parse_apply_url(page_url)
    pack = _parse_apply_url(pack_url)
    if page["ids"] & pack["ids"]:
        return True
    # Exact listing path (with or without /application suffix already tokenized)
    if page["path"] and pack["path"] and page["path"] == pack["path"]:
        return True
    raw_page = str(page_url or "").lower()
    jid = str(job_id or "").strip()
    if jid and jid not in ("base-profile",) and jid.lower() in raw_page:
        return True
    if pack["tokens"]:
        last = pack["tokens"][-1]
        if (last in pack["ids"] or (last.isdigit() and len(last) >= 4)) and last in (
            page["path"] or ""
        ):
            return True
    return False


def select_job_pack_for_page(
    store: dict[str, Any] | None,
    page_url: str | None = None,
    *,
    min_url_score: int = 50,
) -> tuple[dict[str, Any] | None, str, int]:
    """
    Pick the best form pack for the current browser page.

    Priority:
      1. job_pack whose apply_url best matches page_url (score >= min_url_score).
         When several packs qualify, prefer id-token matches over same-board
         host+slug soft hits so sibling Greenhouse packs do not cross-fill.
         When only soft hits qualify, prefer store.active_job_id if it is among
         them (user's chosen pack) instead of arbitrary first/highest soft.
      2. store.active_job_id (no qualifying URL match)
      3. first healthy job_pack
      4. base profile pack

    Returns (pack, reason, score) where reason is url|active_id|first|base|none.
    """
    if not store or not isinstance(store, dict):
        return None, "none", 0
    packs = [
        p
        for p in (store.get("job_packs") or [])
        if isinstance(p, dict) and p.get("ok") is not False
    ]
    active_id = str(store.get("active_job_id") or "").strip()
    best_score = 0
    page = str(page_url or "").strip()
    if page and packs:
        # (score, has_id_token, pack)
        scored: list[tuple[int, bool, dict[str, Any]]] = []
        for p in packs:
            job = p.get("job") if isinstance(p.get("job"), dict) else {}
            pack_url = _pack_apply_url(p)
            jid = str(p.get("job_id") or (job or {}).get("id") or "").strip()
            sc = score_url_match(page, pack_url)
            # Also allow job_id substring match (some boards put id only in path)
            if jid and jid not in ("base-profile",) and jid.lower() in page.lower():
                sc = max(sc, 70)
            if sc > best_score:
                best_score = sc
            if sc < min_url_score:
                continue
            id_hit = has_url_id_token_match(page, pack_url, jid)
            scored.append((sc, id_hit, p))
        if scored:
            id_pool = [t for t in scored if t[1]]
            if id_pool:
                # Strong id-token matches: highest score wins
                best_sc = max(t[0] for t in id_pool)
                for sc, _id_hit, p in id_pool:
                    if sc == best_sc:
                        return p, "url", best_sc
            # Soft-only pool: prefer active_job_id among soft hits when set
            if active_id:
                for sc, _id_hit, p in scored:
                    jid = str(
                        p.get("job_id")
                        or (
                            (p.get("job") or {}).get("id")
                            if isinstance(p.get("job"), dict)
                            else ""
                        )
                        or ""
                    ).strip()
                    if jid == active_id:
                        return p, "url", sc
            # Else highest soft score (stable: first max)
            best_sc = max(t[0] for t in scored)
            for sc, _id_hit, p in scored:
                if sc == best_sc:
                    return p, "url", best_sc

    if active_id and packs:
        for p in packs:
            if str(p.get("job_id") or "") == active_id:
                return p, "active_id", best_score
    if packs:
        return packs[0], "first", best_score
    base = store.get("base")
    if isinstance(base, dict):
        return base, "base", 0
    # Lone form pack stored without extension_store wrapper
    if store.get("fields") or store.get("schema") == FORM_PACK_SCHEMA:
        return store, "base", 0
    return None, "none", 0


def merge_skill_phrase(
    profile: dict[str, Any],
    injects: list[str] | None = None,
    *,
    limit: int = 6,
) -> str:
    """Profile skills first, then Tailor RT / forge injects (deduped, order-preserving)."""
    raw: list[str] = []
    skills = profile.get("skills") or []
    if isinstance(skills, list):
        raw.extend(str(s).strip() for s in skills if str(s).strip())
    for inj in injects or []:
        t = str(inj).strip()
        if t:
            raw.append(t)
    seen: set[str] = set()
    out: list[str] = []
    for s in raw:
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break
    return ", ".join(out) or "relevant engineering skills"


# Back-compat alias for any private callers
_merge_skill_phrase = merge_skill_phrase

# Default Q&A for common application questions (honest, editable)
_DEFAULT_QA: list[dict[str, str]] = [
    {
        "id": "why_company",
        "question": "Why do you want to work here?",
        "answer": (
            "I'm drawn to the team's mission and the technical challenges of this role. "
            "My background aligns with the stack and impact areas in the posting, and I want "
            "to contribute measurable product and engineering outcomes."
        ),
    },
    {
        "id": "why_role",
        "question": "Why are you interested in this role?",
        "answer": (
            "The role matches my experience building reliable systems and shipping features "
            "end-to-end. I'm motivated by ownership, collaboration, and continuous learning."
        ),
    },
    {
        "id": "strengths",
        "question": "What are your greatest strengths?",
        "answer": (
            "Clear communication, ownership of outcomes, and pragmatic problem-solving under "
            "ambiguity — plus hands-on delivery across backend, APIs, and product-facing work."
        ),
    },
    {
        "id": "weakness",
        "question": "What is a weakness / area of growth?",
        "answer": (
            "I can over-index on thoroughness early in a project; I've learned to time-box "
            "discovery, ship MVPs, and iterate with feedback."
        ),
    },
    {
        "id": "conflict",
        "question": "Tell me about a conflict or disagreement at work.",
        "answer": (
            "I surface trade-offs early with data, align on shared goals, and propose a small "
            "experiment when stakeholders disagree — then let results guide the next step."
        ),
    },
    {
        "id": "achievement",
        "question": "Describe a major achievement.",
        "answer": (
            "Delivered a high-impact project by breaking work into milestones, reducing risk "
            "with incremental releases, and partnering with stakeholders on measurable outcomes."
        ),
    },
    {
        "id": "years_exp",
        "question": "Years of experience",
        "answer": "",  # filled from profile
    },
    {
        "id": "work_auth",
        "question": "Work authorization",
        "answer": "",
    },
    {
        "id": "sponsorship",
        "question": "Do you require sponsorship?",
        "answer": "No / Prefer not to say — edit in profile",
    },
    {
        "id": "salary",
        "question": "Salary expectation",
        "answer": "Competitive / market rate for the role and location",
    },
    {
        "id": "start_date",
        "question": "Available start date",
        "answer": "2–4 weeks",
    },
    {
        "id": "remote",
        "question": "Remote / hybrid preference",
        "answer": "Flexible — open to remote, hybrid, or onsite as needed",
    },
    {
        "id": "relocate",
        "question": "Willing to relocate?",
        "answer": "Open to discuss",
    },
    {
        "id": "hear",
        "question": "How did you hear about us?",
        "answer": "Job board / career site / public listing",
    },
]


def _tailor_qa(
    profile: dict[str, Any],
    job: dict[str, Any],
    cover: str,
    injects: list[str] | None = None,
) -> list[dict[str, str]]:
    """Clone defaults and inject job/company-specific flavor (no LLM required)."""
    company = str(job.get("company") or "the company")
    title = str(job.get("title") or "this role")
    skill_s = _merge_skill_phrase(profile, injects, limit=6)
    years = str(profile.get("years_experience") or "").strip() or "5+"
    auth = str(profile.get("work_authorization") or "Authorized to work")

    out: list[dict[str, str]] = []
    for row in _DEFAULT_QA:
        item = dict(row)
        if item["id"] == "why_company":
            item["answer"] = (
                f"I'm excited about {company} and the {title} mandate. "
                f"My strengths in {skill_s} map well to what you're hiring for, "
                f"and I want to help ship reliable impact."
            )
        elif item["id"] == "why_role":
            item["answer"] = (
                f"The {title} role at {company} matches how I work: ownership, "
                f"collaboration, and shipping with {skill_s}."
            )
        elif item["id"] == "years_exp":
            item["answer"] = years
        elif item["id"] == "work_auth":
            item["answer"] = auth
        elif item["id"] == "sponsorship":
            req = profile.get("require_sponsorship")
            if req is True:
                item["answer"] = "Yes"
            elif req is False:
                item["answer"] = "No"
            else:
                item["answer"] = str(
                    profile.get("sponsorship_answer") or "No / Prefer to discuss"
                )
        elif item["id"] == "salary":
            item["answer"] = str(
                profile.get("salary_expectation") or "Competitive / market rate"
            )
        elif item["id"] == "start_date":
            item["answer"] = str(profile.get("start_date") or "2–4 weeks")
        elif item["id"] == "hear":
            item["answer"] = str(
                profile.get("how_did_you_hear") or "Job board / public career listing"
            )
        out.append(item)

    if cover:
        out.insert(
            0,
            {
                "id": "cover_letter",
                "question": "Cover letter / additional information",
                "answer": cover[:2500],
            },
        )
    return out


def _cover_note(
    profile: dict[str, Any],
    job: dict[str, Any],
    injects: list[str] | None = None,
    ats: dict[str, Any] | None = None,
) -> str:
    """
    Job cover draft — delegates to apply_engine.build_cover_note (same as
    resolve_cover_and_injects / tailor_materials) so form packs, one-click, and
    nexus share one inject-aligned template.
    """
    return build_cover_note(
        profile,
        job,
        ats=ats if isinstance(ats, dict) else {},
        injects=injects,
    )


def build_form_pack(
    profile: dict[str, Any],
    job: dict[str, Any] | None = None,
    *,
    forge: bool = True,
    inject_budget: int = 8,
    use_tailor_rt: bool = True,
    max_rt_rounds: int = 3,
) -> dict[str, Any]:
    """
    Build a complete form pack for one job (or base profile if job is None).

    Pack is extension-ready JSON + Playwright-ready fields.
    When forge=True and a job is present, prefer Tailor RT (Analyze→Tailor→Validate)
    over bare resume_forge so apply packs are validator-gated.
    """
    t0 = time.perf_counter()
    profile = dict(profile or {})
    job = dict(job or {})
    job_id = str(job.get("id") or "base-profile")

    # Ensure readable resume text exists (drop binary garbage)
    cleaned = sanitize_resume_text(profile.get("resume_text"))
    if cleaned:
        profile["resume_text"] = cleaned
    elif not profile.get("resume_text"):
        skills = profile.get("skills") or []
        if not isinstance(skills, list):
            skills = []
        profile["resume_text"] = (
            f"{profile.get('name') or 'Candidate'}\n"
            f"{profile.get('target_title') or 'Software Engineer'}\n"
            f"Email: {profile.get('email') or ''}\n"
            f"Phone: {profile.get('phone') or ''}\n"
            f"Skills: {', '.join(str(s) for s in skills[:20])}\n"
            f"{profile.get('summary') or ''}\n"
        )
    else:
        profile["resume_text"] = ""  # was binary

    forge_blob: dict[str, Any] = {}
    tailor_rt_blob: dict[str, Any] | None = None
    tailored_resume = str(profile.get("resume_text") or "")
    injects: list[str] = []
    star_bullets: list[str] = []
    mat_ats: dict[str, Any] = {}
    # Prefer cover from tailor_materials (single path with resolve_cover_and_injects)
    cover_from_mat = ""
    if forge and job.get("title"):
        mat = tailor_materials(
            profile,
            job,
            max_rounds=max_rt_rounds,
            inject_budget=inject_budget,
            use_rt=use_tailor_rt,
        )
        tailored_resume = str(mat.get("forged_resume") or tailored_resume)
        injects = [str(i).strip() for i in (mat.get("injects") or []) if str(i).strip()]
        cover_from_mat = str(mat.get("cover_note") or "").strip()
        star_bullets = [
            str(b).strip() for b in (mat.get("star_bullets") or []) if str(b).strip()
        ]
        mat_ats = mat.get("ats_after") if isinstance(mat.get("ats_after"), dict) else {}
        forge_blob = {
            "version": mat.get("version") or FORGE_VERSION,
            "source": mat.get("source"),
            "injects": injects,
            "ats_before": mat.get("ats_before"),
            "ats_after": mat.get("ats_after"),
            "objectives": mat.get("objectives"),
            "scalar_score": mat.get("scalar_score"),
            "tailor_rt_passed": mat.get("passed"),
            "grade": mat.get("grade"),
            "error": mat.get("error"),
        }
        tailor_rt_blob = mat.get("tailor_rt")

    # Build cover/Q&A after tailor so inject keywords match forged resume
    if job.get("title"):
        cover = cover_from_mat or _cover_note(
            profile, job, injects=injects, ats=mat_ats
        )
    else:
        cover = str(profile.get("summary") or "")
    skill_phrase = _merge_skill_phrase(profile, injects, limit=8)

    # Autofill leaf profile + override resume with tailored text
    af = build_autofill_profile(
        {
            **profile,
            "resume_text": tailored_resume,
            "cover_note": cover,
        }
    )
    fields = dict(af.get("fields") or {})
    fields["resume_text"] = tailored_resume[:8000]
    fields["cover_letter"] = cover[:2500]
    fields["cover"] = cover[:2500]
    fields["skills"] = skill_phrase

    qa = _tailor_qa(profile, job, cover, injects=injects)

    # Flat map for content scripts: label_hint → value
    label_map: dict[str, str] = {
        "first name": fields.get("first_name") or "",
        "last name": fields.get("last_name") or "",
        "full name": fields.get("full_name") or "",
        "name": fields.get("full_name") or "",
        "email": fields.get("email") or "",
        "phone": fields.get("phone") or "",
        "mobile": fields.get("phone") or "",
        "telephone": fields.get("phone") or "",
        "linkedin": fields.get("linkedin_url") or "",
        "portfolio": fields.get("portfolio_url") or "",
        "website": fields.get("portfolio_url") or "",
        "location": fields.get("location") or "",
        "city": fields.get("city") or "",
        "country": fields.get("country") or "United States",
        "work authorization": fields.get("work_authorization") or "",
        "years of experience": fields.get("years_experience") or "",
        "current title": fields.get("current_title") or "",
        "salary": str(profile.get("salary_expectation") or "Competitive"),
        "start date": str(profile.get("start_date") or "2–4 weeks"),
        "cover letter": cover[:2500],
        "additional information": cover[:1500],
        "message": cover[:1500],
        "skills": skill_phrase,
        "keywords": skill_phrase,
        "technical skills": skill_phrase,
    }
    for q in qa:
        label_map[q["question"].lower()[:80]] = q["answer"]

    pack = {
        "ok": True,
        "schema": FORM_PACK_SCHEMA,
        "version": FORM_PACK_VERSION,
        "forge_version": forge_blob.get("version") or FORGE_VERSION,
        "job_id": job_id,
        "job": {
            "id": job_id,
            "title": job.get("title"),
            "company": job.get("company"),
            "apply_url": job.get("apply_url") or job.get("url"),
            "source": job.get("source"),
        },
        "profile_snapshot": {
            "name": profile.get("name"),
            "email": profile.get("email"),
            "phone": profile.get("phone"),
            "target_title": profile.get("target_title"),
        },
        "fields": fields,
        "common_answers": af.get("common_answers") or {},
        "eeo_defaults": af.get("eeo_defaults") or {},
        "qa": qa,
        "label_map": label_map,
        "cover_note": cover,
        "star_bullets": star_bullets,
        "tailored_resume": tailored_resume,
        "resume_file_text": tailored_resume,  # extension can offer download as .txt
        # forge sidecar mirrors materials so consumers that only read pack.forge
        # still get inject-aligned cover + STAR (same as top-level fields).
        "forge": {
            "injects": forge_blob.get("injects") or [],
            "cover_note": cover,
            "star_bullets": list(star_bullets),
            "ats_before": forge_blob.get("ats_before"),
            "ats_after": forge_blob.get("ats_after"),
            "objectives": forge_blob.get("objectives"),
            "scalar_score": forge_blob.get("scalar_score"),
            "tailor_rt_passed": forge_blob.get("tailor_rt_passed"),
            "grade": forge_blob.get("grade"),
            "source": forge_blob.get("source"),
        }
        if forge_blob
        else {},
        "tailor_rt": {
            "version": tailor_rt_blob.get("version") or TAILOR_RT_VERSION,
            "passed": tailor_rt_blob.get("passed"),
            "grade": tailor_rt_blob.get("grade"),
            "overall_score": tailor_rt_blob.get("overall_score"),
            "rounds": tailor_rt_blob.get("rounds") or [],
            "suggestions": tailor_rt_blob.get("suggestions") or [],
            "strengths": tailor_rt_blob.get("strengths") or [],
            "weaknesses": tailor_rt_blob.get("weaknesses") or [],
            "agents": tailor_rt_blob.get("agents") or {},
        }
        if tailor_rt_blob
        else None,
        "extension": {
            "storage_key": "astra_form_pack_v1",
            "instructions": (
                "Load unpacked Chrome extension from interview-pulse-ai/extension/astra-apply-kit. "
                "Click Sync from lab or paste this JSON into the extension popup."
            ),
        },
        "honesty": (
            "Form pack is candidate-owned data for autofill. Tailor RT (Analyze→Tailor→Validate) "
            "grounds keywords in your resume evidence and never fabricates employers. "
            "LinkedIn Easy Apply still needs your session. "
            "You review/submit when the board requires login or CAPTCHA."
        ),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }
    return pack


def build_base_extension_store(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]] | None = None,
    *,
    forge_top: int = 3,  # NVIDIA ask: cap forge top-K (never batch of 100)
) -> dict[str, Any]:
    """
    Bundle for Chrome extension: base profile + optional per-job packs.
    """
    t0 = time.perf_counter()
    base = build_form_pack(profile, None, forge=False)
    job_packs = []
    for j in (jobs or [])[: max(0, forge_top)]:
        if not j:
            continue
        try:
            job_packs.append(build_form_pack(profile, j, forge=True))
        except Exception as e:
            job_packs.append(
                {
                    "ok": False,
                    "job_id": j.get("id"),
                    "error": str(e)[:160],
                }
            )
    return {
        "ok": True,
        "schema": "astra.extension_store.v1",
        "version": FORM_PACK_VERSION,
        "base": base,
        "job_packs": job_packs,
        "active_job_id": (job_packs[0] or {}).get("job_id") if job_packs else "base-profile",
        # Product default: Chrome content script + Playwright skip soft sibling packs
        "strict_soft": True,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
        "export_json": None,  # filled by API if needed
    }


def form_store_from_apply_steps(
    profile: dict[str, Any],
    steps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Build a lightweight extension-store from already-tailored apply steps.

    Does NOT re-run Tailor RT / resume forge — reuses forged_resume, cover_note,
    and keyword_inject from one_click / auto_apply materials so Playwright can
    select packs by page URL (same select_job_pack_for_page path as the extension).
    """
    t0 = time.perf_counter()
    profile = dict(profile or {})
    # Cheap base: contact fields only (no forge)
    try:
        base = build_form_pack(profile, None, forge=False)
    except Exception:
        base = {
            "ok": True,
            "job_id": "base-profile",
            "fields": {
                "email": profile.get("email") or "",
                "full_name": profile.get("name") or "",
                "phone": profile.get("phone") or "",
            },
        }
    job_packs: list[dict[str, Any]] = []
    for s in steps or []:
        if not isinstance(s, dict):
            continue
        jid = str(s.get("job_id") or s.get("id") or "").strip() or f"step-{len(job_packs)}"
        url = str(s.get("apply_url") or s.get("url") or "").strip()
        title = s.get("title") or ""
        company = s.get("company") or ""
        tailored = str(s.get("forged_resume") or s.get("tailored_resume") or "").strip()
        cover = str(s.get("cover_note") or "").strip()
        stars = [
            str(b).strip()
            for b in (s.get("star_bullets") or [])
            if str(b).strip()
        ]
        injects = [
            str(i).strip()
            for i in (s.get("keyword_inject") or s.get("injects") or [])
            if str(i).strip()
        ]
        fields = {
            "email": profile.get("email") or "",
            "full_name": profile.get("name") or "",
            "phone": profile.get("phone") or "",
            "resume_text": tailored[:8000] if tailored else str(profile.get("resume_text") or "")[:8000],
            "cover_letter": cover[:2500],
            "cover": cover[:2500],
        }
        job_packs.append(
            {
                "ok": True,
                "schema": FORM_PACK_SCHEMA,
                "version": FORM_PACK_VERSION,
                "job_id": jid,
                "job": {
                    "id": jid,
                    "title": title,
                    "company": company,
                    "apply_url": url,
                },
                "fields": fields,
                "cover_note": cover,
                "star_bullets": stars,
                "tailored_resume": tailored or str(profile.get("resume_text") or ""),
                "forge": {
                    "injects": injects,
                    "cover_note": cover,
                    "star_bullets": stars,
                    "grade": s.get("tailor_rt_grade"),
                    "tailor_rt_passed": s.get("tailor_rt_passed"),
                    "source": "apply_steps",
                },
            }
        )
    return {
        "ok": True,
        "schema": "astra.extension_store.v1",
        "version": FORM_PACK_VERSION,
        "source": "apply_steps",
        "base": base,
        "job_packs": job_packs,
        "active_job_id": (job_packs[0] or {}).get("job_id") if job_packs else "base-profile",
        "strict_soft": True,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def pack_to_extension_json(store: dict[str, Any]) -> str:
    """Serialize store for chrome.storage / file download."""
    return json.dumps(store, ensure_ascii=False, indent=2)
