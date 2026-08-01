"""
ATS autofill field map — leaf module (no jobsearch imports).

Used by browser apply, one-click, Nexus, form packs, and Autofill playbook.
"""

from __future__ import annotations

import re
from typing import Any


def _looks_like_email(s: str) -> bool:
    s = (s or "").strip()
    return bool(s) and "@" in s and "." in s.split("@")[-1]


def looks_like_binary_garbage(text: str) -> bool:
    """True for ZIP/DOCX binary, 'RESUME: PK…', or high non-printable ratio."""
    t = (text or "").strip()
    if not t:
        return False
    # Any OOXML/ZIP-shaped blob (including long decoded DOCX)
    if t.startswith("PK"):
        if len(t) <= 4:
            return True
        if t.startswith(("PK\x03", "PK\x04", "PK\x05", "PK\x06", "PK\x07", "PK\x08")):
            return True
        head = t[:800]
        if re.search(r"Content_Types|word/|_rels|docProps|\[Content_Types\]", head, re.I):
            return True
        letters = sum(1 for c in t[:120] if c.isalpha())
        if letters / max(len(t[:120]), 1) < 0.4:
            return True
    # clean_profile often wraps as RESUME:\nPK…
    head = t[:80]
    if "RESUME:" in head.upper() and "PK" in head:
        after = re.split(r"RESUME:\s*", t, maxsplit=1, flags=re.I)
        if len(after) > 1 and after[1].lstrip().startswith("PK"):
            return True
    if re.search(r"RESUME:\s*PK", t[:120], re.I):
        return True
    if re.search(r"\[Content_Types\]\.xml|word/document\.xml", t[:800], re.I):
        return True
    sample = t[:500]
    bad = sum(1 for c in sample if ord(c) < 9 or (13 < ord(c) < 32) or c == "\ufffd")
    if (bad / max(len(sample), 1)) > 0.06:
        return True
    if len(t) > 80:
        words = re.findall(r"[A-Za-z]{3,}", t[:2000])
        if len(words) < 5:
            return True
    return False


def sanitize_resume_text(text: str | None) -> str:
    """Return readable resume text or empty string if binary/garbage."""
    raw = str(text or "")
    if not raw.strip():
        return ""
    if looks_like_binary_garbage(raw):
        return ""
    # Drop a trailing RESUME: PK block if mixed
    if "RESUME:" in raw[:200] and looks_like_binary_garbage(raw):
        return ""
    return raw.strip()


def _derive_name_from_email(email: str) -> tuple[str, str, str]:
    """
    srinaidu4data@gmail.com → ("Srinaidu", "", "Srinaidu")
    jane.doe@x.com → ("Jane", "Doe", "Jane Doe")
    """
    local = (email or "").split("@", 1)[0]
    local = re.sub(r"\d+", " ", local)
    tokens = [t for t in re.split(r"[._\-\s]+", local) if t and t.isalpha()]
    if not tokens:
        return "Candidate", "", "Candidate"
    first = tokens[0].capitalize()
    last = tokens[1].capitalize() if len(tokens) > 1 else ""
    full = f"{first} {last}".strip()
    return first, last, full


_PLACEHOLDER_NAMES = frozenset(
    {"", "candidate", "user", "unknown", "n/a", "na", "test", "applicant"}
)


def _is_placeholder_name(name: str) -> bool:
    return (name or "").strip().lower() in _PLACEHOLDER_NAMES


def _name_from_resume_filename(filename: str) -> tuple[str, str, str] | None:
    """Sri_Naidu_SAP_ABAP_HANA_Consultant.docx → Sri Naidu"""
    if not filename:
        return None
    base = re.sub(r"\.[^.]+$", "", filename)
    skip = {
        "resume",
        "cv",
        "sap",
        "abap",
        "hana",
        "consultant",
        "engineer",
        "developer",
        "profile",
        "final",
        "updated",
        "new",
        "copy",
        "s4hana",
        "fico",
        "bw",
        "basis",
    }
    tokens = [
        t
        for t in re.split(r"[_\s\-]+", base)
        if t and t.isalpha() and t.lower() not in skip and len(t) > 1
    ]
    if len(tokens) >= 2:
        first = tokens[0].capitalize()
        last = tokens[1].capitalize()
        return first, last, f"{first} {last}"
    if len(tokens) == 1 and len(tokens[0]) >= 3:
        first = tokens[0].capitalize()
        return first, "", first
    return None


def _name_from_resume_body(resume: str) -> tuple[str, str, str] | None:
    """First non-empty line often is the candidate name on a CV."""
    if not resume or looks_like_binary_garbage(resume):
        return None
    for line in resume.splitlines()[:12]:
        line = line.strip()
        if not line or len(line) > 60:
            continue
        if _looks_like_email(line) or re.search(r"\d{3}", line):
            continue
        if re.search(
            r"\b(resume|curriculum|vitae|objective|summary|experience|education|skills)\b",
            line,
            re.I,
        ):
            continue
        parts = [p for p in re.split(r"\s+", line) if p.isalpha() and len(p) > 1]
        if 2 <= len(parts) <= 4:
            first = parts[0].capitalize()
            last = parts[-1].capitalize()
            mid = " ".join(p.capitalize() for p in parts[1:-1])
            full = f"{first} {mid} {last}".replace("  ", " ").strip()
            return first, last, full
        if len(parts) == 1 and len(parts[0]) >= 3:
            first = parts[0].capitalize()
            return first, "", first
    return None


_PHONE_RE = re.compile(
    r"(?:(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{3,4}[\s\-.]?\d{0,4})"
)


def extract_phone(text: str) -> str:
    """Best-effort phone from free text (resume / summary)."""
    if not text or looks_like_binary_garbage(text):
        return ""
    # Prefer lines labeled phone / mobile / cell
    for line in text.splitlines()[:40]:
        if re.search(r"\b(phone|mobile|cell|tel|contact)\b", line, re.I):
            m = _PHONE_RE.search(line)
            if m:
                digits = re.sub(r"\D", "", m.group(0))
                if 10 <= len(digits) <= 15:
                    return m.group(0).strip()
    m = _PHONE_RE.search(text[:2000])
    if not m:
        return ""
    raw = m.group(0).strip()
    digits = re.sub(r"\D", "", raw)
    if 10 <= len(digits) <= 15:
        return raw
    return ""


def parse_person_name(profile: dict[str, Any] | None) -> tuple[str, str, str]:
    """
    Returns (first_name, last_name, full_name).
    Never puts an email address into name fields.
    Prefers real name → resume filename → resume body → email local-part → Candidate.
    """
    profile = profile or {}
    first = str(profile.get("first_name") or "").strip()
    last = str(profile.get("last_name") or "").strip()
    if first or last:
        if _looks_like_email(first) or _is_placeholder_name(first):
            pass  # fall through
        else:
            full = f"{first} {last}".strip()
            return first, last, full

    name = str(profile.get("name") or "").strip()
    email = str(profile.get("email") or "").strip()

    # Discard name if email / placeholder
    if (
        _looks_like_email(name)
        or _is_placeholder_name(name)
        or (email and name.lower() == email.lower())
    ):
        name = ""

    if name:
        parts = name.split(None, 1)
        first = parts[0]
        last = parts[1] if len(parts) > 1 else ""
        if _looks_like_email(first):
            return _derive_name_from_email(email or first)
        return first, last, name

    # Resume filename often encodes the person (Sri_Naidu_SAP_....docx)
    for key in ("resume_filename", "resume_name", "document_name"):
        derived = _name_from_resume_filename(str(profile.get(key) or ""))
        if derived:
            return derived

    resume = sanitize_resume_text(
        str(profile.get("resume_text") or "")
        or str(profile.get("summary") or "")
    )
    from_body = _name_from_resume_body(resume)
    if from_body:
        return from_body

    if email and _looks_like_email(email):
        return _derive_name_from_email(email)

    return "Candidate", "", "Candidate"


_COUNTRY_ALIASES = {
    "us": "United States",
    "usa": "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "uae": "United Arab Emirates",
}


def _canonical_country(name: str) -> str:
    name = (name or "").strip()
    return _COUNTRY_ALIASES.get(name.lower(), name)


def _normalize_location(raw: str) -> tuple[str, str, str]:
    """
    location, city, country friendly defaults.

    Previously any non-US location string (e.g. "Bangalore, India") was
    echoed verbatim into the `country` field ("Bangalore, India" instead of
    "India") — real ATS forms validate country against an exact name /
    dropdown, so every non-US application autofilled the wrong value here.
    Now splits on the last comma ("City, Country" convention) so country
    gets just the country segment; a bare single-token location (no comma)
    is treated as the country itself rather than duplicated into both
    fields with no way to tell city from country.
    """
    loc = (raw or "").strip()
    low = loc.lower()
    if not loc or low in ("all", "anywhere"):
        return "United States", "", "United States"
    if low in ("us", "usa", "u.s.", "u.s.a.", "united states"):
        return "United States", "", "United States"

    if "," in loc:
        city_part, _, country_part = loc.rpartition(",")
        city = city_part.strip()
        country = _canonical_country(country_part.strip()) or "United States"
        return loc, city, country

    return loc, "", _canonical_country(loc) or "United States"


def build_autofill_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    """
    Common ATS field map (Greenhouse / Lever / Ashby / Freshteam / generic).
    Safe for Playwright form fill and Autofill playbook UI.
    """
    profile = profile or {}
    first, last, full = parse_person_name(profile)
    email = str(profile.get("email") or "").strip()
    phone = str(profile.get("phone") or "").strip()

    skills = profile.get("skills") or []
    if not isinstance(skills, list):
        skills = [str(skills)] if skills else []

    loc_raw = str(profile.get("location") or "")
    location, city, country = _normalize_location(loc_raw)
    if profile.get("city"):
        city = str(profile.get("city") or "")
    if profile.get("country"):
        country = str(profile.get("country") or country)

    # Drop binary/garbage resume text (broken DOCX parse shows as "PK…")
    resume_raw = sanitize_resume_text(profile.get("resume_text"))
    summary_raw = str(profile.get("summary") or "").strip()
    if looks_like_binary_garbage(summary_raw):
        summary_raw = ""
    # Strip appended RESUME: blocks from clean_profile (always — never show wrapper)
    if re.search(r"RESUME:\s*", summary_raw, re.I):
        parts = re.split(r"\n?\s*RESUME:\s*\n?", summary_raw, maxsplit=1, flags=re.I)
        head = (parts[0] or "").strip()
        tail = (parts[1] if len(parts) > 1 else "").strip()
        if looks_like_binary_garbage(tail) or tail.lstrip().startswith("PK"):
            summary_raw = head
        else:
            if not resume_raw and tail:
                resume_raw = sanitize_resume_text(tail)
            # Prefer a short human blurb, not the full resume dump
            summary_raw = head

    if not phone:
        phone = extract_phone(resume_raw) or extract_phone(summary_raw)

    if not summary_raw and resume_raw:
        for line in resume_raw.splitlines():
            line = line.strip()
            if len(line) > 12 and not line.lower().startswith("resume"):
                if not _looks_like_email(line) and not looks_like_binary_garbage(line):
                    # skip pure name-only first line if next line is richer
                    summary_raw = line[:240]
                    if len(line) < 40:
                        continue
                    break
        # If we only captured a short name line, try a longer professional line
        if summary_raw and len(summary_raw) < 40:
            for line in resume_raw.splitlines():
                line = line.strip()
                if len(line) >= 40 and not looks_like_binary_garbage(line):
                    summary_raw = line[:240]
                    break

    # Never surface PK / binary in any text field
    if looks_like_binary_garbage(summary_raw):
        summary_raw = ""
    if looks_like_binary_garbage(resume_raw):
        resume_raw = ""

    # STAR bullets from Tailor RT / step materials (honest, already-grounded)
    stars_raw = profile.get("star_bullets") or profile.get("star_examples") or []
    if isinstance(stars_raw, str):
        stars = [stars_raw.strip()] if stars_raw.strip() else []
    elif isinstance(stars_raw, list):
        stars = [str(s).strip() for s in stars_raw if str(s).strip()][:8]
    else:
        stars = []
    star_block = "\n".join(f"• {s}" for s in stars)[:1200]

    return {
        "schema": "astra.autofill.v1",
        "fields": {
            "first_name": first,
            "last_name": last,
            "full_name": full,
            "email": email,
            "phone": phone,
            "linkedin_url": str(profile.get("linkedin_url") or "").strip(),
            "portfolio_url": str(profile.get("portfolio_url") or "").strip(),
            "location": location,
            "city": city or str(profile.get("city") or ""),
            "country": country,
            "work_authorization": str(
                profile.get("work_authorization") or "Authorized to work"
            ),
            "require_sponsorship": bool(profile.get("require_sponsorship", False)),
            "years_experience": str(profile.get("years_experience") or "").strip(),
            "current_title": str(profile.get("target_title") or "").strip(),
            "skills": ", ".join(str(s).strip() for s in skills[:30] if str(s).strip()),
            "summary": summary_raw[:1500],
            "resume_text": resume_raw[:6000],
            # Extra text areas on public ATS often map to "additional" / "comments"
            "additional_info": star_block
            or str(profile.get("cover_note") or "")[:1200],
            "cover_letter": str(profile.get("cover_note") or star_block or "")[:2000],
        },
        "eeo_defaults": {
            "gender": "Prefer not to say",
            "race": "Prefer not to say",
            "veteran": "Prefer not to say",
            "disability": "Prefer not to say",
        },
        "common_answers": {
            "how_did_you_hear": "Company career page / job board",
            "willing_to_relocate": str(
                profile.get("willing_to_relocate") or "Open to discuss"
            ),
            "salary_expectation": str(
                profile.get("salary_expectation") or "Competitive / market"
            ),
            "start_date": str(profile.get("start_date") or "2–4 weeks"),
            "remote_preference": str(profile.get("remote_preference") or "Flexible"),
        },
        "ready": {
            "has_email": bool(email),
            "has_phone": bool(phone),
            "has_name": bool(full) and not _looks_like_email(full) and not _is_placeholder_name(full),
            "has_resume": bool(resume_raw),
            "can_fill": bool(email) and bool(full) and not _looks_like_email(full),
        },
    }
