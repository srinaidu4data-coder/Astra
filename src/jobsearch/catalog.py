"""
Multi-source job catalog for Job Search AI lab.

Sources (best-effort, graceful degrade):
  1) freehire.me agent search  — live ATS aggregator (correct path /api/v1/agent/jobs/search)
  2) remotive.com              — remote roles
  3) arbeitnow.com             — EU / global board API
  4) combinatorial seed market — always-on local corpus (hundreds of SAP/tech variants)

Filters: remote | hybrid | onsite | all
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

_UA = "InterviewPulse-JobSearchAI/0.2 (localhost lab; +https://jobinterviewcracker.com)"


def _get_json(url: str, timeout: float = 12.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _strip_html(html: str) -> str:
    t = re.sub(r"<[^>]+>", " ", html or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t[:2500]


_US_HINTS = (
    "usa",
    "u.s.",
    "u.s.a",
    "united states",
    " us ",
    " us,",
    ", us",
    "remote (us)",
    "remote us",
    "nationwide",
    "new york",
    "ny,",
    "california",
    "texas",
    "chicago",
    "dallas",
    "houston",
    "atlanta",
    "seattle",
    "austin",
    "boston",
    "denver",
    "miami",
    "san francisco",
    "los angeles",
    "washington",
    "americas",
)


def infer_country(
    location: str = "",
    countries: list[str] | None = None,
    text: str = "",
) -> str:
    """
    Return ISO-ish code: us | eu | in | ca | uk | latam | other | unknown.

    Important: use *location* + country codes only. Full JD text often mentions
    US cities/markets and must not force country=us for Cairo/Heidelberg roles.
    """
    loc = f" {location or ''} ".lower()
    cc = {str(c).lower().strip() for c in (countries or []) if str(c).strip()}

    def _from_loc_non_us() -> str | None:
        if not loc.strip():
            return None
        if any(
            x in loc
            for x in (
                "germany",
                "deutschland",
                "berlin",
                "frankfurt",
                "heidelberg",
                "munich",
                "münchen",
                "freiburg",
                "hamburg",
                "europe",
                "netherlands",
                "paris",
                "amsterdam",
                "france",
                "spain",
                "italy",
                "poland",
                "sweden",
                "switzerland",
                "austria",
                "belgium",
                "dublin",
                "ireland",
                "athens",
                "greece",
            )
        ):
            return "eu"
        if any(
            x in loc
            for x in (
                "india",
                "bangalore",
                "bengaluru",
                "hyderabad",
                "mumbai",
                "chennai",
                "pune",
                "delhi",
            )
        ):
            return "in"
        if any(
            x in loc
            for x in (
                "toronto",
                "vancouver",
                "montreal",
                "ontario",
                "british columbia",
                "canada",
            )
        ):
            return "ca"
        if any(
            x in loc
            for x in ("london", "united kingdom", " england", "scotland", "wales", "manchester")
        ):
            return "uk"
        if any(
            x in loc
            for x in (
                "latam",
                "méxico",
                "mexico",
                "argentina",
                "buenos aires",
                "brazil",
                "brasil",
                "colombia",
                "chile",
                "peru",
                "são paulo",
                "sao paulo",
            )
        ):
            return "latam"
        if any(
            x in loc
            for x in (
                "egypt",
                "cairo",
                "uae",
                "dubai",
                "saudi",
                "pakistan",
                "nigeria",
                "south africa",
                "philippines",
                "singapore",
                "australia",
                "japan",
                "china",
                "israel",
                "turkey",
                "korea",
            )
        ):
            return "other"
        return None

    # Location non-US always wins (Cairo + countries=['us'] → other)
    hit = _from_loc_non_us()
    if hit:
        return hit

    # freehire "Remote, Remote, ca" — before countries=['us'] soft tags
    if loc.strip():
        m_iso = re.search(r"\bremote\b.*\bremote\b[,\s]+([a-z]{2})\s*$", loc.strip())
        if not m_iso:
            m_iso = re.search(r"\bremote\b[,\s]+([a-z]{2})\s*$", loc.strip())
        if m_iso:
            code = m_iso.group(1)
            if code in ("us",):
                return "us"
            if code == "ca":
                return "ca"
            if code in ("gb", "uk"):
                return "uk"
            if code in ("de", "fr", "nl", "es", "it", "se", "pl", "ie", "at", "ch", "be", "gr"):
                return "eu"
            if code in ("in",):
                return "in"
            if code in ("mx", "ar", "br", "cl", "co", "pe"):
                return "latam"
            if code in ("eg", "ae", "sa", "pk", "au", "jp", "sg"):
                return "other"
            return "unknown"

    # Explicit ISO codes (prefer non-US when mixed)
    if cc:
        if cc & {
            "de",
            "fr",
            "nl",
            "es",
            "it",
            "se",
            "pl",
            "ie",
            "at",
            "ch",
            "be",
            "pt",
            "dk",
            "fi",
            "no",
            "cz",
            "ro",
            "hu",
            "gr",
            "el",
        }:
            return "eu"
        if cc & {"gb", "uk"}:
            return "uk"
        if "ca" in cc and "us" not in cc:
            return "ca"
        if "in" in cc:
            return "in"
        if cc & {"mx", "ar", "br", "cl", "co", "pe", "uy", "cr"}:
            return "latam"
        if cc & {
            "eg",
            "ae",
            "sa",
            "pk",
            "ng",
            "za",
            "ph",
            "sg",
            "au",
            "jp",
            "cn",
            "il",
            "tr",
            "kr",
            "nz",
        }:
            return "other"
        if "us" in cc or "usa" in cc:
            return "us"

    # Location US markers
    if loc.strip():
        if any(h in loc for h in _US_HINTS):
            return "us"
        # US state only when not a bare remote+ISO trail
        if re.search(
            r"[A-Za-z]{3,},\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b",
            location or "",
            re.I,
        ):
            return "us"
        if re.search(r"\b(united states|u\.s\.a\.?|usa)\b", loc):
            return "us"
        if re.search(r"(,\s*us\b|\bus\s*$)", loc.strip()):
            return "us"
        if "remote" in loc:
            return "unknown"

    _ = text  # signature compat — never scan full JD for country
    return "unknown"


def is_linkedin_job(job: dict[str, Any]) -> bool:
    """True if posting is LinkedIn-sourced or only has a LinkedIn apply path."""
    src = str(job.get("source") or "").lower()
    if "linkedin" in src:
        return True
    for key in ("url", "apply_url"):
        u = str(job.get(key) or "").lower()
        if "linkedin.com" in u:
            return True
    return False


def _norm_job(
    *,
    id_: str,
    title: str,
    company: str,
    location: str = "",
    remote: bool = False,
    work_mode: str = "",
    url: str = "",
    skills: list[str] | None = None,
    seniority: str = "mid",
    text: str = "",
    source: str = "unknown",
    countries: list[str] | None = None,
) -> dict[str, Any]:
    loc = location or ""
    mode = (work_mode or "").lower()
    is_remote = remote or mode == "remote" or "remote" in loc.lower()
    if is_remote:
        mode = mode or "remote"
    elif "hybrid" in loc.lower() or mode == "hybrid":
        mode = "hybrid"
        is_remote = False
    else:
        mode = mode or "onsite"
    skills = [str(s).strip() for s in (skills or []) if str(s).strip()][:20]
    body = text or f"{title} {company} {loc} {' '.join(skills)}"
    title_s = title.strip() or "Role"
    company_s = company.strip() or "Company"
    apply_url = (url or "").strip()
    # Clean title for search links (drop seniority tags like "(senior)")
    title_search = re.sub(r"\s*\([^)]*\)\s*", " ", title_s).strip()
    q = urllib.parse.quote_plus(f"{title_search} {company_s}")
    linkedin_url = f"https://www.linkedin.com/jobs/search/?keywords={q}"
    google_url = f"https://www.google.com/search?q={urllib.parse.quote_plus(title_search + ' ' + company_s + ' careers apply')}"
    indeed_url = f"https://www.indeed.com/jobs?q={q}&l=United+States"
    if not apply_url or "example.com" in apply_url:
        # Prefer non-LinkedIn discovery for lab "non-LinkedIn" filter
        apply_url = indeed_url
        apply_kind = "search"
    else:
        apply_kind = "direct"
    country = infer_country(loc, countries, body)
    return {
        "id": id_,
        "title": title_s,
        "company": company_s,
        "location": loc or ("Remote" if is_remote else "Unspecified"),
        "remote": is_remote,
        "work_mode": mode,  # remote | hybrid | onsite
        "country": country,
        "countries": countries or ([country] if country not in ("unknown",) else []),
        "url": url or apply_url,
        "apply_url": apply_url,
        "apply_kind": apply_kind,  # direct | search
        "linkedin_url": linkedin_url,
        "google_url": google_url,
        "indeed_url": indeed_url,
        "is_linkedin": "linkedin.com" in (url or "").lower() or "linkedin" in source.lower(),
        "skills": skills,
        "seniority": seniority or "mid",
        "text": body[:2500],
        "source": source,
    }


# ---------------------------------------------------------------------------
# Live sources
# ---------------------------------------------------------------------------


def fetch_freehire(query: str, limit: int = 50, *, remote_only: bool = False) -> list[dict[str, Any]]:
    """freehire.me agent search — full descriptions, multi-market ATS."""
    q = (query or "").strip() or "software"
    out: list[dict[str, Any]] = []
    pages = max(1, min(6, (limit + 24) // 25))
    for page in range(1, pages + 1):
        params: dict[str, str] = {
            "q": q,
            "limit": "25",
            "page": str(page),
        }
        if remote_only:
            params["work_mode"] = "remote"
        url = "https://freehire.me/api/v1/agent/jobs/search?" + urllib.parse.urlencode(params)
        try:
            data = _get_json(url, timeout=14.0)
        except Exception:
            break
        rows = []
        if isinstance(data, dict):
            rows = data.get("data") or data.get("results") or data.get("jobs") or []
        elif isinstance(data, list):
            rows = data
        if not rows:
            break
        for it in rows:
            if not isinstance(it, dict):
                continue
            slug = str(it.get("public_slug") or it.get("id") or len(out))
            skills = it.get("skills") or []
            if isinstance(skills, str):
                skills = [s.strip() for s in skills.split(",") if s.strip()]
            wm = str(it.get("work_mode") or "")
            countries = it.get("countries") or []
            if not isinstance(countries, list):
                countries = []
            out.append(
                _norm_job(
                    id_=f"fh-{slug}",
                    title=str(it.get("title") or "Role"),
                    company=str(it.get("company") or "Company"),
                    location=str(it.get("location") or ""),
                    remote=wm == "remote",
                    work_mode=wm,
                    url=str(it.get("url") or f"https://freehire.me/jobs/{slug}"),
                    skills=[str(s) for s in skills],
                    seniority=str(
                        (it.get("enrichment") or {}).get("seniority")
                        or it.get("seniority")
                        or "mid"
                    ),
                    text=_strip_html(str(it.get("description") or "")),
                    source="freehire",
                    countries=[str(c) for c in countries],
                )
            )
            if len(out) >= limit:
                return out
    return out


def fetch_remotive(query: str, limit: int = 40) -> list[dict[str, Any]]:
    q = (query or "").strip()
    params = urllib.parse.urlencode({"search": q, "limit": str(min(limit, 50))})
    url = f"https://remotive.com/api/remote-jobs?{params}"
    try:
        data = _get_json(url, timeout=12.0)
    except Exception:
        return []
    jobs = data.get("jobs") if isinstance(data, dict) else []
    out: list[dict[str, Any]] = []
    for it in jobs or []:
        if not isinstance(it, dict):
            continue
        tags = it.get("tags") or []
        out.append(
            _norm_job(
                id_=f"rm-{it.get('id')}",
                title=str(it.get("title") or "Role"),
                company=str(it.get("company_name") or it.get("company") or "Company"),
                location=str(it.get("candidate_required_location") or "Remote"),
                remote=True,
                work_mode="remote",
                url=str(it.get("url") or ""),
                skills=[str(t) for t in tags][:16],
                seniority="mid",
                text=_strip_html(str(it.get("description") or "")),
                source="remotive",
            )
        )
        if len(out) >= limit:
            break
    return out


def fetch_arbeitnow(query: str, limit: int = 40) -> list[dict[str, Any]]:
    # Arbeitnow returns a large page; filter client-side
    url = "https://www.arbeitnow.com/api/job-board-api"
    try:
        data = _get_json(url, timeout=14.0)
    except Exception:
        # try without www
        try:
            data = _get_json("https://arbeitnow.com/api/job-board-api", timeout=14.0)
        except Exception:
            return []
    rows = data.get("data") if isinstance(data, dict) else []
    qtoks = set(re.findall(r"[a-z0-9\+\#]+", (query or "").lower()))
    out: list[dict[str, Any]] = []
    for it in rows or []:
        if not isinstance(it, dict):
            continue
        blob = " ".join(
            [
                str(it.get("title") or ""),
                str(it.get("company_name") or ""),
                str(it.get("description") or ""),
                " ".join(it.get("tags") or []),
            ]
        ).lower()
        if qtoks and not any(t in blob for t in qtoks if len(t) > 2):
            continue
        tags = it.get("tags") or []
        out.append(
            _norm_job(
                id_=f"an-{it.get('slug') or it.get('url') or len(out)}",
                title=str(it.get("title") or "Role"),
                company=str(it.get("company_name") or "Company"),
                location=str(it.get("location") or ""),
                remote=bool(it.get("remote")),
                work_mode="remote" if it.get("remote") else "onsite",
                url=str(it.get("url") or ""),
                skills=[str(t) for t in tags][:16],
                seniority="mid",
                text=_strip_html(str(it.get("description") or "")),
                source="arbeitnow",
            )
        )
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------------------
# Combinatorial seed market (always online offline) — hundreds of variants
# ---------------------------------------------------------------------------

_SAP_TITLES = [
    "SAP FICO Consultant",
    "SAP FI Consultant",
    "SAP CO Consultant",
    "SAP S/4HANA Finance Lead",
    "SAP FICO Analyst",
    "SAP Tax / Vertex Specialist",
    "SAP FI-AR/AP Consultant",
    "SAP Controlling Specialist",
    "SAP FICO Solution Architect",
    "SAP Finance Functional Lead",
    "SAP Treasury Consultant",
    "SAP FICO Migration Specialist",
    "SAP S/4 Finance Implementation",
    "SAP FICO Support Analyst",
    "SAP Integration Finance (BTP)",
]
_SAP_COMPANIES = [
    "Deloitte", "Accenture", "IBM", "Capgemini", "Infosys", "TCS", "Wipro",
    "Cognizant", "EY", "KPMG", "PwC", "SAP America", "HCLTech", "Tech Mahindra",
    "LTIMindtree", "NTT Data", "DXC", "Atos", "Vertex Inc", "Workday Partner Co",
    "Northstar ERP", "LedgerGrid", "Apex Controllers", "BlueLine Finance Systems",
]
_LOCATIONS = [
    ("Remote (US)", True, "remote"),
    ("Remote (Global)", True, "remote"),
    ("Hybrid - New York, NY", False, "hybrid"),
    ("Hybrid - Chicago, IL", False, "hybrid"),
    ("Hybrid - Dallas, TX", False, "hybrid"),
    ("Onsite - Houston, TX", False, "onsite"),
    ("Onsite - Atlanta, GA", False, "onsite"),
    ("Remote (EU)", True, "remote"),
    ("Hybrid - London, UK", False, "hybrid"),
    ("Onsite - Frankfurt, DE", False, "onsite"),
    ("Remote (India)", True, "remote"),
    ("Hybrid - Bangalore, IN", False, "hybrid"),
    ("Onsite - Toronto, CA", False, "onsite"),
    ("Remote (LATAM)", True, "remote"),
]
_SAP_SKILL_SETS = [
    ["sap", "fico", "s4hana", "gl", "ar", "ap"],
    ["sap", "fico", "controlling", "copa", "cost-center"],
    ["sap", "fico", "tax", "vertex", "indirect-tax"],
    ["sap", "fico", "treasury", "cash-management"],
    ["sap", "fico", "s4hana", "migration", "brownfield"],
    ["sap", "fi", "bank-accounting", "electronic-bank-statement"],
    ["sap", "fico", "integration", "mm", "sd"],
    ["sap", "fico", "group-reporting", "consolidation"],
]
_SEN = ["junior", "mid", "senior", "staff", "lead"]


def generate_seed_market(query: str = "", *, target: int = 280) -> list[dict[str, Any]]:
    """Deterministic combinatorial postings so lab always has volume."""
    q = (query or "").lower()
    jobs: list[dict[str, Any]] = []
    # Base general tech seeds (compact)
    general_titles = [
        "Software Engineer", "Backend Engineer", "Frontend Engineer", "Full Stack Engineer",
        "Data Engineer", "ML Engineer", "DevOps Engineer", "Platform Engineer",
        "Product Manager", "QA Automation Engineer", "Security Engineer", "Mobile Engineer",
    ]
    gen_skills = [
        ["python", "fastapi", "sql"],
        ["typescript", "react", "node"],
        ["java", "spring", "kafka"],
        ["go", "kubernetes", "grpc"],
        ["python", "pytorch", "ml"],
        ["aws", "terraform", "ci"],
    ]
    n = 0
    # Prefer SAP-heavy generation when query smells SAP/FICO/ERP/finance
    sap_mode = any(k in q for k in ("sap", "fico", "s/4", "s4", "erp", "vertex", "controlling", "finance consultant"))
    if sap_mode or not q:
        for ti, title in enumerate(_SAP_TITLES):
            for ci, company in enumerate(_SAP_COMPANIES):
                for li, (loc, remote, mode) in enumerate(_LOCATIONS):
                    skills = _SAP_SKILL_SETS[(ti + ci + li) % len(_SAP_SKILL_SETS)]
                    sen = _SEN[(ti + ci) % len(_SEN)]
                    raw = f"{title}|{company}|{loc}|{n}"
                    hid = hashlib.md5(raw.encode()).hexdigest()[:10]
                    # Tag US seeds with country for consistent filtering
                    us_countries = ["us"] if (
                        "us" in loc.lower()
                        or "ny" in loc.lower()
                        or "tx" in loc.lower()
                        or "il" in loc.lower()
                        or "ga" in loc.lower()
                        or "nationwide" in loc.lower()
                    ) else None
                    jobs.append(
                        _norm_job(
                            id_=f"seed-sap-{hid}",
                            title=f"{title}" + (f" ({sen})" if sen in ("senior", "staff", "lead") else ""),
                            company=company,
                            location=loc,
                            remote=remote,
                            work_mode=mode,
                            url=f"https://example.com/jobs/sap/{hid}",
                            skills=skills,
                            seniority=sen,
                            text=(
                                f"{title} at {company}. {loc}. "
                                f"Modules: {', '.join(skills)}. "
                                f"S/4HANA finance, month-end close, tax determination, "
                                f"integration with MM/SD, stakeholder workshops, cutover."
                            ),
                            source="seed_market",
                            countries=us_countries,
                        )
                    )
                    n += 1
                    if n >= target:
                        return jobs
    # Always add general tech volume
    for ti, title in enumerate(general_titles * 8):
        company = _SAP_COMPANIES[ti % len(_SAP_COMPANIES)]
        loc, remote, mode = _LOCATIONS[ti % len(_LOCATIONS)]
        skills = gen_skills[ti % len(gen_skills)]
        raw = f"gen|{title}|{company}|{loc}|{ti}"
        hid = hashlib.md5(raw.encode()).hexdigest()[:10]
        jobs.append(
            _norm_job(
                id_=f"seed-gen-{hid}",
                title=title,
                company=f"{company} Digital",
                location=loc,
                remote=remote,
                work_mode=mode,
                url=f"https://example.com/jobs/gen/{hid}",
                skills=skills,
                seniority=_SEN[ti % len(_SEN)],
                text=f"{title} building products with {', '.join(skills)}. {loc}.",
                source="seed_market",
            )
        )
        if len(jobs) >= target + 80:
            break
    return jobs


def apply_filters(
    jobs: list[dict[str, Any]],
    *,
    remote: str = "all",  # all | remote | hybrid | onsite
    keyword: str = "",
    min_score: float | None = None,
    location: str = "all",  # all | us | free-text
    exclude_linkedin: bool = False,
) -> list[dict[str, Any]]:
    remote = (remote or "all").lower()
    loc_f = (location or "all").strip().lower()
    # Normalize common country aliases so Custom "United States" == Only US
    if loc_f in (
        "united states",
        "united states of america",
        "u.s.",
        "u.s.a.",
        "usa",
        "us only",
        "only us",
        "america",
    ):
        loc_f = "us"
    kw = (keyword or "").strip().lower()
    out: list[dict[str, Any]] = []
    for j in jobs:
        mode = (j.get("work_mode") or ("remote" if j.get("remote") else "onsite")).lower()
        if remote == "remote" and mode != "remote" and not j.get("remote"):
            continue
        if remote == "hybrid" and mode != "hybrid":
            continue
        if remote == "onsite" and mode not in ("onsite", "") and j.get("remote"):
            continue
        if exclude_linkedin and is_linkedin_job(j):
            continue
        # Always re-infer from location + country codes (never trust cached country alone)
        country = infer_country(
            str(j.get("location") or ""),
            j.get("countries") if isinstance(j.get("countries"), list) else None,
            "",  # never scan full JD text
        ).lower()
        j["country"] = country
        loc_blob = f"{j.get('location','')}".lower()
        if loc_f in ("us", "usa", "united states", "u.s."):
            # Strict US-only: keep country=us; soft-pass only generic Remote (unknown)
            if country == "us":
                pass
            elif country == "unknown":
                # generic Remote / Worldwide — soft keep for US remote seekers
                if any(
                    x in loc_blob
                    for x in (
                        "remote (eu)",
                        "remote (india)",
                        "remote (latam)",
                        "europe only",
                        "emea",
                        "deutschland",
                        "germany",
                        "egypt",
                        "argentina",
                        "india only",
                    )
                ):
                    continue
                if not any(h in f" {loc_blob} " for h in _US_HINTS) and "remote" not in loc_blob:
                    continue
            else:
                # eu | in | ca | uk | latam | other — drop
                continue
        elif loc_f and loc_f not in ("all", "any", ""):
            if loc_f not in loc_blob and loc_f not in country:
                continue
        if kw:
            blob = f"{j.get('title','')} {j.get('company','')} {j.get('text','')} {' '.join(j.get('skills') or [])}".lower()
            if kw not in blob and not all(t in blob for t in kw.split() if len(t) > 2):
                # soft: any token match
                toks = [t for t in re.findall(r"[a-z0-9\+/\#]+", kw) if len(t) > 1]
                if toks and not any(t in blob for t in toks):
                    continue
        if min_score is not None:
            sc = float((j.get("scores") or {}).get("ensemble") or 0)
            if sc < min_score:
                continue
        # When excluding LinkedIn, prefer Indeed/direct apply over LinkedIn fallback
        if exclude_linkedin and j.get("apply_url") and "linkedin.com" in str(j.get("apply_url")).lower():
            j = dict(j)
            j["apply_url"] = j.get("indeed_url") or j.get("google_url") or j["apply_url"]
            j["apply_kind"] = "search"
        out.append(j)
    return out


def dedupe(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for j in jobs:
        key = re.sub(r"\s+", " ", f"{j.get('title','')}|{j.get('company','')}".lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(j)
    return uniq


_STOP_Q = frozenset(
    "a an the and or for with of to in on at by from job jobs role roles engineer consultant specialist remote us usa united states senior junior staff lead principal manager director ii iii iv sr".split()
)

# Domain anchors that must appear in the job TITLE (not only body text)
_DOMAIN_TITLE_RULES: list[tuple[frozenset[str], frozenset[str], frozenset[str]]] = [
    # (query triggers, required ANY in title, forbidden ANY in title unless also has required)
    (
        frozenset({"sap", "fico", "s4hana", "s/4hana", "s/4"}),
        frozenset({"sap", "fico", "s/4", "s4hana", "s4", "fi/co", "fi-co", "s/4hana"}),
        frozenset({"oracle ebs", "oracle cloud", "oracle erp", "netsuite", "workday financials"}),
    ),
    (
        frozenset({"react", "frontend", "front-end"}),
        frozenset({"react", "frontend", "front-end", "front end", "ui engineer", "javascript", "typescript"}),
        frozenset({"sap", "mainframe", "cobol"}),
    ),
    (
        frozenset({"kubernetes", "devops", "sre"}),
        frozenset({"kubernetes", "k8s", "devops", "sre", "platform engineer", "infra"}),
        frozenset(),
    ),
    (
        frozenset({"python", "django", "fastapi"}),
        frozenset({"python", "django", "fastapi", "backend", "data engineer", "ml engineer"}),
        frozenset(),
    ),
    (
        frozenset({"data scientist", "machine learning", "ml engineer"}),
        frozenset({"data scientist", "machine learning", "ml ", "ai engineer", "deep learning"}),
        frozenset(),
    ),
]


def relevance_tokens(query: str) -> list[str]:
    toks = re.findall(r"[a-z0-9][a-z0-9\+/\#\.]{1,20}", (query or "").lower())
    out = [t for t in toks if t not in _STOP_Q and len(t) > 1]
    if any(t in out for t in ("sap", "fico", "s4hana", "s/4hana", "fi", "co")):
        for extra in ("sap", "fico", "s4hana"):
            if extra not in out:
                out.append(extra)
    return out[:16]


def title_core_tokens(title: str) -> list[str]:
    """Meaningful title tokens (drop seniority fluff)."""
    t = (title or "").lower()
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[/|–—,-]+", " ", t)
    toks = re.findall(r"[a-z0-9][a-z0-9\+\#\.]{1,20}", t)
    return [x for x in toks if x not in _STOP_Q and len(x) > 1]


def domain_title_ok(job_title: str, query: str) -> bool:
    """
    Hard title check for specialized domains.
    SAP FICO search must have SAP/FICO/S4 in the *title* — body-only mentions fail.
    """
    q = (query or "").lower()
    title = (job_title or "").lower()
    if not title.strip():
        return False

    for triggers, required, forbidden in _DOMAIN_TITLE_RULES:
        if any(tr in q for tr in triggers):
            # Wrong ecosystem titles (Oracle when seeking SAP, etc.)
            if forbidden and any(f in title for f in forbidden):
                # Allow only if required domain still present (e.g. "SAP and Oracle")
                if not any(r in title for r in required):
                    return False
            if not any(r in title for r in required):
                return False
            return True
    return True  # no domain rule → fall through to generic title match


def title_matches_query(job_title: str, query: str, *, min_overlap: int = 1) -> bool:
    """
    Title-first relevance: job title must share core tokens with the target query.
    Prevents 'Senior BI Consultant' / 'AP Clerk' when searching 'SAP FICO Consultant'.
    """
    if not domain_title_ok(job_title, query):
        return False

    q_toks = [t for t in relevance_tokens(query) if t not in ("finance",)]  # too broad alone
    if not q_toks:
        return True
    title = (job_title or "").lower()
    # Prefer multi-token / compound matches in title
    strong = [t for t in q_toks if len(t) >= 3]
    hits = [t for t in strong if t in title]
    if hits:
        return True

    # Generic roles: require overlap of core title words
    q_core = title_core_tokens(query)
    j_core = set(title_core_tokens(job_title))
    if not q_core:
        return True
    overlap = [t for t in q_core if t in j_core or any(t in jc or jc in t for jc in j_core)]
    # Need at least min_overlap distinctive tokens (not just "consultant")
    distinctive = [t for t in overlap if t not in ("consultant", "engineer", "analyst", "developer", "manager")]
    if distinctive:
        return True
    if len(overlap) >= max(min_overlap + 1, 2):
        return True
    return False


def passes_query_gate(job: dict[str, Any], query: str, *, min_hits: int = 1) -> bool:
    """
    Drop off-topic board noise. Title must match domain; body-only keyword hits are not enough.
    """
    title = str(job.get("title") or "")
    if not title_matches_query(title, query):
        return False

    toks = relevance_tokens(query)
    if not toks:
        return True
    # Title already matched — light body/skills confirmation for non-seed
    title_l = title.lower()
    skills_blob = " ".join(job.get("skills") or []).lower()
    blob = f"{title_l} {skills_blob} {str(job.get('text') or '')[:800].lower()}"
    if job.get("source") in ("seed_market", "seed") or job.get("is_synthetic"):
        return True
    strong = [t for t in toks if t in ("sap", "fico", "s4hana", "abap", "vertex", "hana", "react", "python", "kubernetes")]
    if strong:
        # At least one strong token in title (already required by domain rule) or skills
        return any(t in title_l or t in skills_blob for t in strong) or any(t in title_l for t in strong)
    hits = sum(1 for t in toks if t in blob)
    return hits >= min_hits


def filter_relevant_jobs(
    jobs: list[dict[str, Any]],
    query: str,
    *,
    strict_title: bool = True,
) -> list[dict[str, Any]]:
    """Product filter: keep only title-relevant openings."""
    if not strict_title or not (query or "").strip():
        return jobs
    return [j for j in jobs if title_matches_query(str(j.get("title") or ""), query)]


def load_jobs(
    *,
    query: str,
    use_live: bool = True,
    remote: str = "all",
    limit: int = 400,
    queries: list[str] | None = None,
    location: str = "all",
    exclude_linkedin: bool = False,
    include_seed: bool = False,
) -> dict[str, Any]:
    """
    Multi-source harvest. Returns {jobs, diagnostics}.

    Product default: live boards only (include_seed=False).
    Synthetic seed market is opt-in practice data — never silent padding.
    """
    qlist = [q for q in (queries or [query]) if q and str(q).strip()]
    if not qlist:
        qlist = ["software engineer"]
    primary = qlist[0]
    # US-focused query boost
    loc_f = (location or "all").strip().lower()
    if loc_f in ("us", "usa", "united states"):
        extra = [f"{primary} USA", f"{primary} United States"]
        for e in extra:
            if e not in qlist:
                qlist.append(e)

    warnings: list[str] = []
    diagnostics: dict[str, Any] = {
        "queries": qlist,
        "sources_ok": {},
        "sources_error": {},
        "counts": {},
        "location": location,
        "exclude_linkedin": exclude_linkedin,
        "include_seed": include_seed,
        "soft_recovery": None,
        "warnings": warnings,
        "product_mode": True,
    }

    collected: list[dict[str, Any]] = []

    if include_seed:
        seed = generate_seed_market(primary, target=min(200, max(80, limit // 3)))
        for j in seed:
            j["is_synthetic"] = True
        collected.extend(seed)
        diagnostics["counts"]["seed_market"] = len(seed)
        diagnostics["sources_ok"]["seed_market"] = True
        warnings.append(
            "Practice market (synthetic) is ON — scores are for ranking drills, not real openings."
        )
    else:
        diagnostics["counts"]["seed_market"] = 0

    if use_live:
        remote_only = remote == "remote"

        def _safe(name: str, fn, *args, **kwargs):
            try:
                rows = fn(*args, **kwargs)
                diagnostics["sources_ok"][name] = True
                diagnostics["counts"][name] = len(rows)
                return rows
            except Exception as e:
                diagnostics["sources_error"][name] = str(e)[:160]
                diagnostics["counts"][name] = 0
                return []

        tasks = []
        with ThreadPoolExecutor(max_workers=6) as ex:
            for q in qlist[:5]:
                tasks.append(
                    ex.submit(
                        _safe,
                        f"freehire:{q[:40]}",
                        fetch_freehire,
                        q,
                        80,
                        remote_only=remote_only,
                    )
                )
                tasks.append(
                    ex.submit(_safe, f"remotive:{q[:40]}", fetch_remotive, q, 40)
                )
            tasks.append(ex.submit(_safe, "arbeitnow", fetch_arbeitnow, primary, 60))
            for fut in as_completed(tasks):
                collected.extend(fut.result() or [])
    else:
        warnings.append("Live boards off — only practice market data (if enabled).")

    jobs = dedupe(collected)
    before = len(jobs)
    # Hard title relevance — never recover into off-title jobs
    gated = [j for j in jobs if passes_query_gate(j, primary)]
    diagnostics["counts"]["after_query_gate"] = len(gated)
    diagnostics["counts"]["dropped_irrelevant"] = before - len(gated)

    strict = apply_filters(
        gated,
        remote=remote,
        keyword="",
        location=location,
        exclude_linkedin=exclude_linkedin,
    )
    jobs = strict
    diagnostics["counts"]["after_strict_filters"] = len(strict)

    # Soft recovery: work-mode only — never drop title relevance / location / LinkedIn
    if len(jobs) < 6 and remote != "all":
        relaxed = apply_filters(
            gated,
            remote="all",
            keyword="",
            location=location,
            exclude_linkedin=exclude_linkedin,
        )
        if len(relaxed) > len(jobs):
            jobs = relaxed
            diagnostics["soft_recovery"] = "work_mode"
            warnings.append(
                f"Few matches for work mode “{remote}” — showing all work modes in this location."
            )

    # Final title pass (belt + suspenders)
    jobs = filter_relevant_jobs(jobs, primary, strict_title=True)
    diagnostics["counts"]["after_title_filter"] = len(jobs)

    for j in jobs:
        if j.get("source") in ("seed_market", "seed") or j.get("is_synthetic"):
            j["is_synthetic"] = True
            j["product_label"] = "practice"
        else:
            j["is_synthetic"] = False
            j["product_label"] = "live"
        j["title_relevant"] = True

    if not jobs:
        warnings.append(
            "No title-relevant openings matched. Broaden location or work mode, "
            "or check the target title spelling. Practice market can be used for drills only."
        )
    elif not any(not j.get("is_synthetic") for j in jobs):
        warnings.append("Only practice (synthetic) roles matched — no live board hits.")

    qtoks = relevance_tokens(primary)

    def rel(j: dict[str, Any]) -> tuple[int, int, int]:
        title_l = (j.get("title") or "").lower()
        title_hits = sum(1 for t in qtoks if t in title_l)
        body_hits = sum(1 for t in qtoks if t in f"{title_l} {j.get('text','')}".lower())
        live_bonus = 0 if j.get("is_synthetic") else 5
        return (live_bonus, title_hits * 5 + body_hits, title_hits)

    jobs.sort(key=rel, reverse=True)
    jobs = jobs[:limit]
    diagnostics["total_before_filters"] = before
    diagnostics["total_after_filters"] = len(jobs)
    diagnostics["live_after_filters"] = sum(1 for j in jobs if not j.get("is_synthetic"))
    diagnostics["seed_after_filters"] = sum(1 for j in jobs if j.get("is_synthetic"))
    return {"jobs": jobs, "diagnostics": diagnostics}
