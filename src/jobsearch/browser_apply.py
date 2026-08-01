"""
Browser Auto-Apply (Karpathy-simple).

The only thing that matters:
  open URL → find form fields → fill from profile → click Submit.

Hard login walls (LinkedIn Easy Apply, Indeed) cannot be done without a user
session — those open for the human. Everything else gets a real Playwright attempt.

Localhost lab only.
"""

from __future__ import annotations

import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from jobsearch.apply_truth import qualifies_as_submitted
from jobsearch.autofill import build_autofill_profile
from jobsearch.form_pack import (
    _pack_apply_url,
    has_url_id_token_match,
    select_job_pack_for_page,
)

BROWSER_APPLY_VERSION = "2.2.2-karpathy"

# Re-export for older imports / tests
qualifies_for_submitted = qualifies_as_submitted


def _playwright_available() -> bool:
    try:
        import playwright  # noqa: F401

        return True
    except Exception:
        return False


def detect_ats(url: str) -> str:
    u = (url or "").lower()
    if "greenhouse.io" in u or "boards.greenhouse" in u:
        return "greenhouse"
    if "lever.co" in u:
        return "lever"
    if "ashbyhq.com" in u or "jobs.ashby" in u:
        return "ashby"
    if "workable.com" in u:
        return "workable"
    if "freshteam.com" in u or "freshworks.com" in u:
        return "freshteam"
    if "bamboohr.com" in u:
        return "bamboohr"
    if "smartrecruiters.com" in u:
        return "smartrecruiters"
    if "myworkdayjobs.com" in u or "workday" in u:
        return "workday"
    if "icims.com" in u:
        return "icims"
    if "jobvite.com" in u:
        return "jobvite"
    if "oraclecloud.com" in u or "fa-ewjt" in u:
        return "oracle"
    if "linkedin.com" in u:
        return "linkedin"
    if "indeed.com" in u:
        return "indeed"
    if "himalayas.app" in u:
        return "himalayas"
    if "remotive.com" in u:
        return "remotive"
    return "generic"


# Impossible without user cookies / Easy Apply session
HARD_LOGIN_ATS = frozenset({"linkedin", "indeed"})

# High-confidence public application forms (prefer these for the apply budget)
HIGH_CONFIDENCE_ATS = frozenset(
    {
        "greenhouse",
        "lever",
        "ashby",
        "workable",
        "freshteam",
        "bamboohr",
        "generic",  # freehire often lands on real forms (Freshteam etc.)
        "smartrecruiters",
    }
)


def is_fillable_ats(url: str) -> bool:
    """True when we should spend Playwright time (not a pure login wall)."""
    return detect_ats(url) not in HARD_LOGIN_ATS


def is_high_confidence_ats(url: str) -> bool:
    return detect_ats(url) in HIGH_CONFIDENCE_ATS


def open_manual_apply(
    url: str,
    *,
    job_id: str | None = None,
    title: str | None = None,
    company: str | None = None,
    reason: str = "manual_ats",
    cover_note: str = "",
    open_browser: bool = True,
) -> dict[str, Any]:
    """Honest non-automated path — open tab for the user (non-blocking)."""
    ats = detect_ats(url)
    opened = False
    if open_browser and url.startswith("http"):
        try:
            import threading
            import webbrowser

            def _open() -> None:
                try:
                    webbrowser.open(url)
                except Exception:
                    pass

            threading.Thread(target=_open, daemon=True).start()
            opened = True
        except Exception:
            opened = False
    return {
        "ok": True,
        "url": url,
        "job_id": job_id,
        "title": title,
        "company": company,
        "ats": ats,
        "status": "opened_manual",
        "submitted": False,
        "filled_fields": [],
        "manual_fallback": True,
        "browser_opened": opened,
        "error": f"{ats}: needs you ({reason})",
        "version": BROWSER_APPLY_VERSION,
    }


def _merge_skill_injects(prof: dict[str, Any], injects: list[str]) -> None:
    """Append keyword injects onto profile.skills (list) without inventing claims."""
    if not injects:
        return
    existing = prof.get("skills")
    if isinstance(existing, list):
        seen = {str(s).lower() for s in existing}
        merged = list(existing)
        for inj in injects:
            if inj.lower() not in seen:
                merged.append(inj)
                seen.add(inj.lower())
        prof["skills"] = merged
    elif not existing:
        prof["skills"] = list(injects)


def overlay_form_pack(
    profile: dict[str, Any],
    pack: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Apply a form-pack / job_pack onto a browser-apply profile.

    Used when an extension-store multi-pack is resolved for the page URL so
    Playwright fill uses the same tailored resume/cover/injects as the Chrome kit.
    """
    prof = dict(profile or {})
    if not pack or not isinstance(pack, dict):
        return prof
    fields = pack.get("fields") if isinstance(pack.get("fields"), dict) else {}
    tailored = str(
        pack.get("tailored_resume")
        or pack.get("resume_file_text")
        or fields.get("resume_text")
        or ""
    ).strip()
    if tailored:
        prof["resume_text"] = tailored
        prof["forged_resume"] = tailored
    forge = pack.get("forge") if isinstance(pack.get("forge"), dict) else {}
    cover = str(
        pack.get("cover_note")
        or forge.get("cover_note")
        or fields.get("cover_letter")
        or fields.get("cover")
        or ""
    ).strip()
    if cover:
        prof["cover_note"] = cover
    stars = [
        str(b).strip()
        for b in (pack.get("star_bullets") or forge.get("star_bullets") or [])
        if str(b).strip()
    ]
    if stars:
        prof["star_bullets"] = stars
    injects = [
        str(i).strip()
        for i in (forge.get("injects") or pack.get("injects") or [])
        if str(i).strip()
    ]
    _merge_skill_injects(prof, injects)
    # Contact fields from pack only fill gaps (profile / lab UI still wins when set)
    for src, dst in (
        ("email", "email"),
        ("phone", "phone"),
        ("full_name", "name"),
        ("linkedin_url", "linkedin_url"),
        ("portfolio_url", "portfolio_url"),
        ("location", "location"),
    ):
        val = str(fields.get(src) or "").strip()
        if val and not str(prof.get(dst) or "").strip():
            prof[dst] = val
    if pack.get("job_id"):
        prof["form_pack_job_id"] = pack.get("job_id")
    return prof


def materialize_step_profile(
    profile: dict[str, Any],
    step: dict[str, Any] | None = None,
    *,
    form_store: dict[str, Any] | None = None,
    page_url: str | None = None,
) -> tuple[dict[str, Any], str]:
    """
    Merge one-click / auto_apply step materials into a per-job profile.

    Prefer Tailor RT forged_resume + inject-aligned cover_note so generic ATS
    fill matches prepared materials (not the untailored base profile).

    When form_store (extension-store v1 / multi job_packs) is provided, select the
    pack for page_url via select_job_pack_for_page — same URL matching as the
    Chrome content script — then overlay pack materials under step materials.
    """
    prof = dict(profile or {})
    step = dict(step or {})
    url = str(
        page_url or step.get("apply_url") or step.get("url") or ""
    ).strip()

    match_meta: dict[str, Any] = {}
    # Rich Tailor RT step (one-click) has forged_resume; thin prepare-only has cover alone
    step_has_forge = bool(str(step.get("forged_resume") or "").strip())
    if form_store and isinstance(form_store, dict):
        pack, reason, score = select_job_pack_for_page(form_store, url or None)
        if pack:
            job = pack.get("job") if isinstance(pack.get("job"), dict) else {}
            jid = str(pack.get("job_id") or (job or {}).get("id") or "").strip()
            pack_url = _pack_apply_url(pack)
            # Soft host+slug vs job-id/path token — UI shows soft vs id selection
            id_token = bool(
                reason == "url"
                and has_url_id_token_match(url or None, pack_url, jid or None)
            )
            sc = int(score or 0)
            # Align with kit_match_tier: id_token or score >= 70 counts as strong
            strong_url = reason == "url" and (
                id_token or sc >= 70
            )
            if reason == "url":
                match_kind = "id" if strong_url else "soft"
            else:
                match_kind = str(reason or "none")
            match_meta = {
                "reason": reason,
                "score": score,
                "job_id": pack.get("job_id") or jid or None,
                "title": (job or {}).get("title") if job else None,
                "id_token": id_token,
                "match_kind": match_kind,
            }
            # strict_soft (default product policy): do not overlay soft same-board
            # sibling packs — they mis-fill tailored resume/cover. Still record meta.
            store_strict_soft = form_store.get("strict_soft")
            if store_strict_soft is True and reason == "url" and not strong_url:
                match_meta["preferred"] = "strict_soft_skip"
                match_meta["soft_skipped"] = True
                pack = None  # fall through without materials overlay

        if pack:
            prof = overlay_form_pack(prof, pack)
            forge = pack.get("forge") if isinstance(pack.get("forge"), dict) else {}
            pack_injects = [
                str(i).strip() for i in (forge.get("injects") or []) if str(i).strip()
            ]
            tr = str(pack.get("tailored_resume") or "").strip()
            cn = str(
                pack.get("cover_note") or forge.get("cover_note") or ""
            ).strip()
            pack_stars = [
                str(b).strip()
                for b in (pack.get("star_bullets") or forge.get("star_bullets") or [])
                if str(b).strip()
            ]
            # URL-matched Apply Kit pack beats generic prepareApplyPacket cover when
            # the step has no forged_resume (sequential Search path). One-click steps
            # with Tailor RT forge still win below.
            pack_authoritative = reason == "url" and not step_has_forge
            if pack_authoritative:
                if tr:
                    step["forged_resume"] = tr
                if cn:
                    step["cover_note"] = cn
                if pack_stars:
                    step["star_bullets"] = pack_stars
                if pack_injects:
                    step["keyword_inject"] = pack_injects
                match_meta["preferred"] = "form_store_pack"
            else:
                # Seed step from pack only when step lacks tailored materials
                if not step_has_forge and tr:
                    step["forged_resume"] = tr
                if not str(step.get("cover_note") or "").strip() and cn:
                    step["cover_note"] = cn
                if pack_stars and not (step.get("star_bullets") or []):
                    step["star_bullets"] = pack_stars
                if pack_injects and not (step.get("keyword_inject") or []):
                    step["keyword_inject"] = pack_injects
                if reason == "url":
                    match_meta["preferred"] = "step_materials"
                else:
                    match_meta["preferred"] = "pack_seed"

    cover = str(step.get("cover_note") or prof.get("cover_note") or "").strip()
    forged = str(step.get("forged_resume") or "").strip()
    if forged:
        prof["resume_text"] = forged
        prof["forged_resume"] = forged
    if cover:
        prof["cover_note"] = cover
    # Step STAR bullets (auto_apply / one-click) win over pack-seeded list
    stars = [
        str(b).strip()
        for b in (step.get("star_bullets") or prof.get("star_bullets") or [])
        if str(b).strip()
    ]
    if stars:
        prof["star_bullets"] = stars
    injects = [
        str(i).strip()
        for i in (step.get("keyword_inject") or [])
        if str(i).strip()
    ]
    _merge_skill_injects(prof, injects)
    if match_meta:
        prof["form_pack_match"] = match_meta
    return prof, cover


def _field_map(profile: dict[str, Any]) -> dict[str, str]:
    af = build_autofill_profile(profile)
    f = af.get("fields") or {}
    ans = af.get("common_answers") or {}
    # Prefer inject-aligned cover_note; never use "how did you hear" as cover letter
    cover = str(
        profile.get("cover_note")
        or f.get("cover_letter")
        or f.get("cover")
        or f.get("summary")
        or ""
    ).strip()
    resume = str(
        profile.get("resume_text") or profile.get("forged_resume") or f.get("resume_text") or ""
    ).strip()
    skills = profile.get("skills") or f.get("skills") or ""
    if isinstance(skills, list):
        skills = ", ".join(str(s) for s in skills[:12])
    return {
        "first_name": str(f.get("first_name") or ""),
        "last_name": str(f.get("last_name") or ""),
        "full_name": str(f.get("full_name") or ""),
        "email": str(f.get("email") or ""),
        "phone": str(f.get("phone") or ""),
        "linkedin": str(f.get("linkedin_url") or ""),
        "website": str(f.get("portfolio_url") or ""),
        "location": str(f.get("location") or ""),
        "summary": str(f.get("summary") or cover[:1500] or ""),
        "cover": cover[:4000],
        "resume_text": resume[:8000],
        "skills": str(skills or ""),
        "authorization": str(f.get("work_authorization") or ""),
        "salary": str(ans.get("salary_expectation") or ""),
        "start_date": str(ans.get("start_date") or ""),
    }


async def _fill_by_selectors(page, selectors: list[str], value: str) -> bool:
    if not value:
        return False
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            if not await loc.is_visible(timeout=600):
                continue
            await loc.click(timeout=800)
            await loc.fill("", timeout=800)
            await loc.fill(value, timeout=2000)
            return True
        except Exception:
            continue
    return False


async def _fill_by_label(page, labels: list[str], value: str) -> bool:
    if not value:
        return False
    for lab in labels:
        try:
            loc = page.get_by_label(re.compile(lab, re.I)).first
            if await loc.count() == 0:
                continue
            await loc.fill(value, timeout=2000)
            return True
        except Exception:
            continue
    for lab in labels:
        try:
            loc = page.get_by_placeholder(re.compile(lab, re.I)).first
            if await loc.count() == 0:
                continue
            await loc.fill(value, timeout=2000)
            return True
        except Exception:
            continue
    return False


async def _upload_resume(page, path: str | None) -> bool:
    if not path or not Path(path).exists():
        return False
    try:
        inputs = page.locator('input[type="file"]')
        n = await inputs.count()
        if n == 0:
            return False
        await inputs.first.set_input_files(path)
        return True
    except Exception:
        return False


async def _try_submit(page) -> bool:
    """Click the most likely submit / apply button (Freshteam, Greenhouse, generic)."""
    candidates = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit Application")',
        'button:has-text("Submit application")',
        'button:has-text("Send Application")',
        'button:has-text("Send application")',
        'button:has-text("Submit")',
        'input[value*="Submit" i]',
        'button:has-text("Apply for this job")',
        'button:has-text("Apply Now")',
        'button:has-text("Apply")',
        'a.button:has-text("Submit")',
        'a:has-text("Submit Application")',
        'a:has-text("Submit")',
        # Freshteam
        'button.btn-primary',
        'input.btn-primary',
        '[data-testid*="submit" i]',
    ]
    for sel in candidates:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            if not await loc.is_visible(timeout=800):
                continue
            # Skip fake "Apply" that only scrolls / is disabled
            try:
                disabled = await loc.is_disabled()
                if disabled:
                    continue
            except Exception:
                pass
            await loc.scroll_into_view_if_needed(timeout=1000)
            await loc.click(timeout=3000)
            await page.wait_for_timeout(800)
            return True
        except Exception:
            continue
    # Last resort: any visible button with submit-ish text via JS
    try:
        clicked = await page.evaluate(
            """() => {
              const re = /submit|send application|apply now/i;
              const nodes = [...document.querySelectorAll('button, input[type=submit], a.btn, a.button')];
              for (const n of nodes) {
                const t = (n.innerText || n.value || '').trim();
                if (re.test(t) && n.offsetParent !== null) { n.click(); return t; }
              }
              return null;
            }"""
        )
        return bool(clicked)
    except Exception:
        return False


async def _aggressive_text_fill(page, fields: dict[str, str]) -> list[str]:
    """
    Karpathy fallback: walk visible inputs and fill by type/name heuristics.
    This is what makes Freshteam / generic boards actually work.
    """
    filled: list[str] = []
    try:
        inputs = page.locator(
            "input:visible, textarea:visible, "
            'input[type="text"], input[type="email"], input[type="tel"], textarea'
        )
        n = await inputs.count()
    except Exception:
        return filled

    email = fields.get("email") or ""
    phone = fields.get("phone") or ""
    first = fields.get("first_name") or ""
    last = fields.get("last_name") or ""
    full = fields.get("full_name") or f"{first} {last}".strip()
    cover = fields.get("cover") or fields.get("summary") or ""
    resume = fields.get("resume_text") or ""
    skills = fields.get("skills") or ""

    for i in range(min(n, 40)):
        try:
            el = inputs.nth(i)
            if not await el.is_visible(timeout=200):
                continue
            name = (
                (await el.get_attribute("name") or "")
                + " "
                + (await el.get_attribute("id") or "")
                + " "
                + (await el.get_attribute("placeholder") or "")
                + " "
                + (await el.get_attribute("aria-label") or "")
            ).lower()
            typ = (await el.get_attribute("type") or "text").lower()
            tag = await el.evaluate("e => e.tagName.toLowerCase()")

            val = ""
            key = ""
            if typ == "email" or "email" in name or "e-mail" in name:
                val, key = email, "email"
            elif typ == "tel" or "phone" in name or "mobile" in name:
                val, key = phone, "phone"
            elif "first" in name and "name" in name:
                val, key = first, "first_name"
            elif "last" in name and "name" in name:
                val, key = last, "last_name"
            elif name.strip() in ("name", "full_name", "fullname") or (
                "full" in name and "name" in name
            ):
                val, key = full, "full_name"
            elif "linkedin" in name:
                val, key = fields.get("linkedin") or "", "linkedin"
            elif tag == "textarea" and (
                "resume" in name or "cv" in name or "curriculum" in name
            ):
                val, key = resume or cover, "resume_text"
            elif tag == "textarea" and (
                "cover" in name
                or "message" in name
                or "comment" in name
                or "additional" in name
                or "letter" in name
                or "why" in name
            ):
                val, key = cover, "cover"
            elif "skill" in name:
                val, key = skills, "skills"
            elif "location" in name or "city" in name:
                val, key = fields.get("location") or "", "location"

            if not val or key in filled:
                continue
            await el.click(timeout=500)
            await el.fill(val, timeout=1500)
            if key not in filled:
                filled.append(key)
        except Exception:
            continue
    return filled


async def _fill_ats(page, ats: str, fields: dict[str, str], resume_path: str | None) -> dict[str, Any]:
    filled: list[str] = []
    pairs = [
        (
            [
                "#first_name",
                'input[name="job_application[first_name]"]',
                'input[name="first_name"]',
                'input[name*="first" i]',
                'input[autocomplete="given-name"]',
            ],
            ["first name", "given name"],
            "first_name",
        ),
        (
            [
                "#last_name",
                'input[name="job_application[last_name]"]',
                'input[name="last_name"]',
                'input[name*="last" i]',
                'input[autocomplete="family-name"]',
            ],
            ["last name", "family name", "surname"],
            "last_name",
        ),
        (
            [
                "#email",
                'input[type="email"]',
                'input[name="email"]',
                'input[name*="email" i]',
                'input[autocomplete="email"]',
            ],
            ["email", "e-mail"],
            "email",
        ),
        (
            [
                "#phone",
                'input[type="tel"]',
                'input[name="phone"]',
                'input[name*="phone" i]',
                'input[autocomplete="tel"]',
            ],
            ["phone", "mobile", "telephone"],
            "phone",
        ),
        (
            ['input[name*="linkedin" i]', 'input[id*="linkedin" i]'],
            ["linkedin", "linked in"],
            "linkedin",
        ),
        (
            [
                'textarea[name*="cover" i]',
                'textarea[id*="cover" i]',
                "#cover_letter",
                'textarea[name*="letter" i]',
                'textarea[name*="additional" i]',
                'textarea[name*="message" i]',
                'textarea[name*="comment" i]',
                # last resort: single message box on simple boards
                "textarea",
            ],
            [
                "cover letter",
                "cover",
                "additional information",
                "additional info",
                "message",
                "why are you",
                "why do you want",
            ],
            "cover",
        ),
        (
            [
                'textarea[name*="resume" i]',
                'textarea[id*="resume" i]',
                'textarea[name*="cv" i]',
                'textarea[name*="paste" i]',
            ],
            ["resume text", "paste resume", "paste your resume", "curriculum"],
            "resume_text",
        ),
        (
            [
                'input[name*="skill" i]',
                'textarea[name*="skill" i]',
                'input[id*="skill" i]',
            ],
            ["skills", "technical skills", "keywords"],
            "skills",
        ),
    ]
    for sels, labels, key in pairs:
        val = fields.get(key) or ""
        if not val:
            continue
        ok = await _fill_by_selectors(page, sels, val)
        if not ok:
            ok = await _fill_by_label(page, labels, val)
        if ok and key not in filled:
            filled.append(key)

    if "full_name" not in filled and fields.get("full_name"):
        if await _fill_by_selectors(
            page,
            [
                'input[name="name"]',
                "#name",
                'input[autocomplete="name"]',
                'input[name*="full" i]',
            ],
            fields["full_name"],
        ) or await _fill_by_label(page, ["full name", "^name$"], fields["full_name"]):
            filled.append("full_name")

    # Aggressive walk — Freshteam etc.
    for key in await _aggressive_text_fill(page, fields):
        if key not in filled:
            filled.append(key)

    uploaded = await _upload_resume(page, resume_path)
    if uploaded:
        filled.append("resume_file")

    return {"filled_fields": filled, "resume_uploaded": uploaded, "ats": ats}


async def _resolve_form_page(page):
    """Prefer frame / page that has email or name inputs."""
    await page.wait_for_timeout(600)
    sel = 'input[type="email"], input[name*="email" i], #email, #first_name, input[name="name"], input[type="tel"]'
    try:
        if await page.locator(sel).count() > 0:
            return page
    except Exception:
        pass
    for frame in page.frames:
        try:
            if await frame.locator(sel).count() > 0:
                return frame
        except Exception:
            continue
    return page


async def _click_apply_entry(page) -> bool:
    for apply_sel in [
        'a:has-text("Apply for this job")',
        'a:has-text("I\'m interested")',
        'button:has-text("I\'m interested")',
        'a:has-text("Apply Now")',
        'button:has-text("Apply Now")',
        'a:has-text("Apply")',
        'button:has-text("Apply")',
        'a[href*="application"]',
        'a[href*="apply"]',
    ]:
        try:
            loc = page.locator(apply_sel).first
            if await loc.count() and await loc.is_visible(timeout=400):
                await loc.click(timeout=2000)
                await page.wait_for_timeout(1200)
                return True
        except Exception:
            continue
    return False


async def apply_one_async(
    url: str,
    profile: dict[str, Any],
    *,
    submit: bool = True,
    headless: bool = True,
    timeout_ms: int = 35000,
    cover_note: str = "",
    job_id: str | None = None,
    title: str | None = None,
    company: str | None = None,
) -> dict[str, Any]:
    """
    One job, one browser, try to apply.

    submit=True is the default product path — fill AND click submit when form found.
    Job identity (title/company/job_id) is attached so metrics stay joinable.
    """
    ats = detect_ats(url)

    # LinkedIn / Indeed: cannot auto-apply without user session
    if ats in HARD_LOGIN_ATS:
        return open_manual_apply(
            url,
            job_id=job_id,
            title=title,
            company=company,
            reason=f"{ats}_needs_login_session",
            cover_note=cover_note or str(profile.get("cover_note") or ""),
        )

    if not _playwright_available():
        return open_manual_apply(
            url,
            job_id=job_id,
            title=title,
            company=company,
            reason="playwright_missing",
            cover_note=cover_note or str(profile.get("cover_note") or ""),
        )

    from playwright.async_api import async_playwright

    if cover_note:
        profile = {**profile, "cover_note": cover_note}
    fields = _field_map(profile)
    resume_path = _write_temp_resume(
        str(profile.get("resume_text") or profile.get("forged_resume") or ""),
        name=re.sub(r"\W+", "_", fields.get("full_name") or "resume")[:40],
    )
    t0 = time.perf_counter()
    result: dict[str, Any] = {
        "ok": False,
        "url": url,
        "ats": ats,
        "job_id": job_id,
        "title": title,
        "company": company,
        "submit_requested": submit,
        "submitted": False,
        "filled_fields": [],
        "status": "pending",
    }
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=headless)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 900},
            )
            page = await context.new_page()
            page.set_default_timeout(timeout_ms)
            resp = await page.goto(url, wait_until="domcontentloaded")
            result["http_status"] = resp.status if resp else 0
            try:
                await page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:
                await page.wait_for_timeout(1200)

            await _click_apply_entry(page)

            form_page = await _resolve_form_page(page)
            fill_info = await _fill_ats(form_page, ats, fields, resume_path)
            result["filled_fields"] = list(fill_info["filled_fields"] or [])
            result["resume_uploaded"] = fill_info["resume_uploaded"]

            # Frames fallback
            if not result["filled_fields"] and not result.get("resume_uploaded"):
                for frame in page.frames:
                    fill_info = await _fill_ats(frame, ats, fields, resume_path)
                    if fill_info["filled_fields"] or fill_info.get("resume_uploaded"):
                        form_page = frame
                        result["filled_fields"] = list(fill_info["filled_fields"] or [])
                        result["resume_uploaded"] = fill_info["resume_uploaded"]
                        break

            has_signal = bool(result["filled_fields"]) or bool(result.get("resume_uploaded"))
            if not has_signal:
                # Try one more apply click + wait (multi-step boards)
                await _click_apply_entry(page)
                await page.wait_for_timeout(1500)
                form_page = await _resolve_form_page(page)
                fill_info = await _fill_ats(form_page, ats, fields, resume_path)
                result["filled_fields"] = list(fill_info["filled_fields"] or [])
                result["resume_uploaded"] = fill_info["resume_uploaded"]
                has_signal = bool(result["filled_fields"]) or bool(result.get("resume_uploaded"))

            if not has_signal:
                result["status"] = "opened_manual"
                result["ok"] = True
                result["manual_fallback"] = True
                result["error"] = (
                    f"{ats}: no public form fields found (login wall / multi-step SSO). "
                    "Open link to finish."
                )
                # Non-blocking open for user
                try:
                    import threading
                    import webbrowser

                    threading.Thread(
                        target=lambda: webbrowser.open(url), daemon=True
                    ).start()
                    result["browser_opened"] = True
                except Exception:
                    result["browser_opened"] = False
            else:
                result["status"] = "filled"
                result["ok"] = True

            # SUBMIT — click alone is not product "submitted" (see apply_truth)
            if submit and result["ok"] and not result.get("manual_fallback"):
                clicked = await _try_submit(form_page)
                if not clicked:
                    clicked = await _try_submit(page)
                result["submit_click"] = bool(clicked)
                counted = qualifies_as_submitted(
                    result.get("filled_fields"),
                    click_ok=bool(clicked),
                    resume_uploaded=bool(result.get("resume_uploaded")),
                )
                result["submitted"] = counted
                n_fields = len(result.get("filled_fields") or [])
                if counted:
                    result["status"] = "submitted"
                    await page.wait_for_timeout(1200)
                elif clicked:
                    # Click happened but product truth rejects thin fill
                    result["status"] = "submit_quality_rejected"
                    result["error"] = (
                        f"Submit clicked but fill too thin (fields={n_fields}) — not counted."
                    )
                else:
                    result["status"] = "submit_click_failed"
                    result["error"] = "Filled form but submit control not found."

            try:
                shot = tempfile.mktemp(suffix=".png")
                await page.screenshot(path=shot, full_page=False)
                result["screenshot"] = shot
            except Exception:
                pass

            await browser.close()
    except Exception as e:
        result["ok"] = False
        result["status"] = "error"
        result["error"] = str(e)[:300]
    finally:
        if resume_path:
            try:
                os.unlink(resume_path)
            except OSError:
                pass
    result["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    result["version"] = BROWSER_APPLY_VERSION
    return result


def _write_temp_resume(text: str, name: str = "resume") -> str | None:
    body = (text or "").strip()
    if not body:
        return None
    fd, path = tempfile.mkstemp(prefix=f"{name}_", suffix=".txt")
    os.close(fd)
    Path(path).write_text(body, encoding="utf-8")
    return path


def apply_one(
    url: str,
    profile: dict[str, Any],
    *,
    submit: bool = True,
    headless: bool = True,
    cover_note: str = "",
    form_store: dict[str, Any] | None = None,
    job_id: str | None = None,
    title: str | None = None,
    company: str | None = None,
) -> dict[str, Any]:
    """Sync wrapper for FastAPI."""
    import asyncio

    pack_match = None
    if form_store:
        profile, derived_cover = materialize_step_profile(
            profile,
            {
                "apply_url": url,
                "cover_note": cover_note,
                "job_id": job_id,
                "title": title,
                "company": company,
            },
            form_store=form_store,
            page_url=url,
        )
        if not cover_note and derived_cover:
            cover_note = derived_cover
        if isinstance(profile.get("form_pack_match"), dict):
            pack_match = profile["form_pack_match"]

    kwargs = dict(
        submit=submit,
        headless=headless,
        cover_note=cover_note,
        job_id=job_id,
        title=title,
        company=company,
    )
    try:
        out = asyncio.run(apply_one_async(url, profile, **kwargs))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            out = loop.run_until_complete(apply_one_async(url, profile, **kwargs))
        finally:
            loop.close()
    if pack_match and isinstance(out, dict):
        out["form_pack_match"] = pack_match
    return out


def execute_auto_apply_batch(
    profile: dict[str, Any],
    steps: list[dict[str, Any]],
    *,
    submit: bool = True,
    headless: bool = True,
    max_jobs: int = 10,
    delay_sec: float = 0.8,
    form_store: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Autonomous apply loop (Karpathy):
      1. Prefer high-confidence public ATS
      2. Skip pure login walls for the automated budget (still report them)
      3. Playwright fill + submit on each remaining job
    """
    t0 = time.perf_counter()

    def _prio(step: dict[str, Any]) -> tuple[int, float]:
        url = str(step.get("apply_url") or step.get("url") or "")
        ats = detect_ats(url)
        if ats in ("greenhouse", "lever", "ashby", "freshteam"):
            p = 0
        elif ats in ("workable", "bamboohr", "generic", "smartrecruiters"):
            p = 1
        elif ats in HARD_LOGIN_ATS:
            p = 99
        elif ats in ("workday", "icims", "oracle"):
            p = 5  # still try; often empty forms
        else:
            p = 3
        score = float(step.get("ensemble_fit") or step.get("score") or 0)
        return (p, -score)

    ordered = sorted(list(steps or []), key=_prio)
    results: list[dict[str, Any]] = []
    n = 0
    login_skipped = 0

    for i, step in enumerate(ordered):
        if n >= max_jobs:
            break
        url = str(step.get("apply_url") or step.get("url") or "").strip()
        if not url.startswith("http"):
            results.append(
                {
                    "ok": False,
                    "job_id": step.get("job_id"),
                    "title": step.get("title"),
                    "company": step.get("company"),
                    "status": "skipped_no_url",
                }
            )
            continue

        # Don't burn the apply budget on LinkedIn Easy Apply — report only
        if detect_ats(url) in HARD_LOGIN_ATS:
            login_skipped += 1
            # Only open first login-wall job so user isn't flooded
            one = open_manual_apply(
                url,
                job_id=str(step.get("job_id") or "") or None,
                title=step.get("title"),
                company=step.get("company"),
                reason="login_wall_not_auto",
                cover_note=str(step.get("cover_note") or ""),
                open_browser=(login_skipped <= 1),
            )
            results.append(one)
            # Do NOT count against n heavily — still count so budget isn't infinite
            n += 1
            continue

        prof, cover = materialize_step_profile(
            profile,
            step,
            form_store=form_store,
            page_url=url,
        )

        one = apply_one(
            url,
            prof,
            submit=submit,
            headless=headless,
            cover_note=cover,
            job_id=str(step.get("job_id") or "") or None,
            title=step.get("title"),
            company=step.get("company"),
        )
        if isinstance(prof.get("form_pack_match"), dict) and not one.get(
            "form_pack_match"
        ):
            one["form_pack_match"] = prof["form_pack_match"]
        results.append(one)
        n += 1
        more_budget = n < max_jobs
        more_steps = i + 1 < len(ordered)
        if more_budget and more_steps:
            time.sleep(max(0.2, min(delay_sec, 2.0)))

    # Exclusive counters (never count submitted inside filled)
    submitted = sum(1 for r in results if r.get("submitted") or r.get("status") == "submitted")
    filled_only = sum(
        1
        for r in results
        if not r.get("submitted")
        and r.get("status")
        in (
            "filled",
            "filled_submit_failed",  # legacy alias
            "submit_quality_rejected",
            "submit_click_failed",
        )
    )
    manual = sum(
        1 for r in results if r.get("manual_fallback") or r.get("status") == "opened_manual"
    )
    return {
        "ok": True,
        "version": BROWSER_APPLY_VERSION,
        "playwright": _playwright_available(),
        "submit": submit,
        "count": len(results),
        "filled": filled_only,
        "filled_only": filled_only,
        "submitted": submitted,
        "opened_manual": manual,
        "acted": submitted + filled_only + manual,
        "login_walls_skipped": login_skipped,
        "results": results,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
        "honesty": (
            "Auto-apply = Playwright fills public forms and may click Submit. "
            "Submitted means click + fill quality, not employer confirmation. "
            "LinkedIn/Indeed need your session."
        ),
    }
