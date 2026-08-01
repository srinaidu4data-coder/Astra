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

from jobsearch.job_model import is_synthetic_job

_UA = "InterviewPulse-JobSearchAI/2.0 (enterprise lab; +https://jobinterviewcracker.com)"


def sanitize_url(url: str | None, *, fallback: str = "") -> str:
    """
    Normalize board URLs so Apply links are not broken:
    - HTML entities (&amp; → &)
    - protocol-relative (//host → https://host)
    - whitespace / bare schemes
    - trailing junk from scrapes
    """
    u = (url or "").strip()
    if not u or u.lower() in ("none", "null", "n/a", "#"):
        return fallback
    # common HTML entity / unicode pollution
    u = (
        u.replace("&amp;", "&")
        .replace("&quot;", "")
        .replace("&#39;", "'")
        .replace("&lt;", "")
        .replace("&gt;", "")
        .replace("\u00a0", " ")
        .strip()
    )
    u = re.sub(r"\s+", "", u)  # spaces break links
    if u.startswith("//"):
        u = "https:" + u
    if u.startswith("www."):
        u = "https://" + u
    # LinkedIn job id only
    m = re.search(r"linkedin\.com/jobs/view/(\d+)", u, re.I)
    if m:
        u = f"https://www.linkedin.com/jobs/view/{m.group(1)}/"
    # drop tracking noise that sometimes corrupts
    if "linkedin.com/jobs/view/" in u.lower():
        u = re.sub(r"\?.*$", "", u)
        if not u.endswith("/"):
            u += "/"
    if not re.match(r"^https?://", u, re.I):
        # reject javascript: data: etc.
        if ":" in u.split("/")[0]:
            return fallback
        u = "https://" + u.lstrip("/")
    # freehire / ATS: ensure no double-encoding artifacts
    if "%" in u:
        try:
            # only unquote if clearly double-encoded once
            once = urllib.parse.unquote(u)
            if once != u and " " not in once and once.startswith("http"):
                # re-quote path carefully — leave as original if already valid
                pass
        except Exception:
            pass
    if "example.com" in u.lower():
        return fallback
    return u


def linkedin_job_view_url(job_id: str | int) -> str:
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


def indeed_search_url(title: str, company: str = "", location: str = "United States") -> str:
    clean_t = re.sub(r"\s*\([^)]*\)\s*", " ", title or "").strip()
    q = urllib.parse.quote_plus(f"{clean_t} {company or ''}".strip())
    loc = urllib.parse.quote_plus(location or "United States")
    return f"https://www.indeed.com/jobs?q={q}&l={loc}"


def linkedin_search_url(title: str, company: str = "") -> str:
    clean_t = re.sub(r"\s*\([^)]*\)\s*", " ", title or "").strip()
    q = urllib.parse.quote_plus(f"{clean_t} {company or ''}".strip())
    return f"https://www.linkedin.com/jobs/search/?keywords={q}"


def _get_json(url: str, timeout: float = 12.0, *, retries: int = 1) -> Any:
    """
    GET JSON with one retry on timeout / 5xx / transient URLError.
    Retries are intentional: boards flake; double-hit only on failure.
    """
    last: Exception | None = None
    attempts = max(1, retries + 1)
    for i in range(attempts):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": _UA, "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            last = e
            # retry only server errors
            if e.code < 500 or i + 1 >= attempts:
                raise
        except (TimeoutError, urllib.error.URLError, OSError) as e:
            last = e
            if i + 1 >= attempts:
                raise
        # brief backoff (no sleep heavy — 50ms-ish via busy loop avoid; use time.sleep)
        import time as _time

        _time.sleep(0.15 * (i + 1))
    if last:
        raise last
    raise RuntimeError("unreachable")


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


# Non-US signals in title/location (EU/LATAM/APAC postings freehire mis-tags)
_NON_US_TITLE_MARKERS = (
    "m/w/d",
    "m/f/d",
    "(w/m/d)",
    " latam",
    "latam only",
    "latam ***",
    "remote only latam",
    "emea",
    "apac",
    "deutschland",
    "germany only",
    "india only",
    "eu only",
    "europe only",
    "uk only",
    "canada only",
    "hungary",
    "romania",
    "greece",
    "spain",
    "portugal",
    "poland",
    "netherlands",
    "belgium",
    "sweden",
    "norway",
    "denmark",
    "finland",
    "austria",
    "switzerland",
    "italy",
    "france",
    "czech",
    "slovakia",
    "bulgaria",
    "serbia",
    "croatia",
    "ukraine",
    "ireland",
    "scotland",
    "england",
    "united kingdom",
    "u.k.",
    "mexico",
    "brazil",
    "argentina",
    "colombia",
    "chile",
    "philippines",
    "singapore",
    "australia",
    "new zealand",
    "japan",
    "korea",
    "china",
    "taiwan",
    "israel",
    "uae",
    "dubai",
    "egypt",
    "pakistan",
    "bangladesh",
    "nigeria",
    "south africa",
)

# Cities that must never be treated as US (even if freehire injects ", OR" noise)
_NON_US_CITIES = (
    "budapest",
    "bucharest",
    "athens",
    "madrid",
    "barcelona",
    "lisbon",
    "porto",
    "warsaw",
    "krakow",
    "amsterdam",
    "rotterdam",
    "brussels",
    "stockholm",
    "oslo",
    "copenhagen",
    "helsinki",
    "vienna",
    "zurich",
    "geneva",
    "milan",
    "rome",
    "paris",
    "lyon",
    "prague",
    "bratislava",
    "sofia",
    "belgrade",
    "zagreb",
    "kyiv",
    "kiev",
    "dublin",
    "london",
    "manchester",
    "berlin",
    "munich",
    "münchen",
    "frankfurt",
    "hamburg",
    "cologne",
    "stuttgart",
    "heidelberg",
    "toronto",
    "vancouver",
    "montreal",
    "mexico city",
    "são paulo",
    "sao paulo",
    "buenos aires",
    "bogota",
    "santiago",
    "manila",
    "singapore",
    "sydney",
    "melbourne",
    "tokyo",
    "seoul",
    "shanghai",
    "beijing",
    "taipei",
    "tel aviv",
    "dubai",
    "cairo",
    "bangalore",
    "bengaluru",
    "hyderabad",
    "mumbai",
    "pune",
    "chennai",
    "delhi",
)

# ISO-3166 alpha-2 that are NOT the United States (freehire trails: "City, XX, hu")
_NON_US_ISO2 = frozenset(
    "hu ro gr es pt pl nl be se no dk fi at ch it fr cz sk bg rs hr ua ie gb uk de "
    "ca mx br ar co cl pe uy cr in ph sg au nz jp kr cn tw il ae eg pk bd ng za "
    "lt lv ee si lu mt cy is".split()
)


def looks_non_us_listing(job: dict[str, Any]) -> bool:
    """Extra signals that a listing is not US-based despite vague location text."""
    title = str(job.get("title") or "")
    title_l = title.lower()
    loc = str(job.get("location") or "").lower()
    blob = f" {title_l} {loc} "
    if any(m in blob for m in _NON_US_TITLE_MARKERS):
        return True
    if any(c in blob for c in _NON_US_CITIES):
        return True
    # Non-Latin titles (e.g. Russian «Консультант») are almost never US postings
    if re.search(r"[\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u3040-\u30FF\uac00-\ud7af]", title):
        return True
    if "baden-württemberg" in loc or "nordrhein" in loc or "bayern" in loc:
        return True
    # freehire style "Budapest, OR, hu" — trailing ISO2 country
    m_iso = re.search(r",\s*([a-z]{2})\s*$", loc.strip())
    if m_iso and m_iso.group(1) in _NON_US_ISO2:
        return True
    # countries list from board (ignore lying multi-tags when sole tag is non-US)
    cc = {str(c).lower().strip() for c in (job.get("countries") or []) if str(c).strip()}
    if cc and "us" not in cc and "usa" not in cc and (cc & _NON_US_ISO2):
        return True
    if re.search(r"\b(deutschland|germany|berlin|munich|münchen|frankfurt|hamburg)\b", loc):
        return True
    return False


def _location_has_us_text(location: str) -> bool:
    """True only when location *string* proves US — never trust board country tags alone."""
    loc_raw = location or ""
    loc = f" {loc_raw.lower()} "
    loc_stripped = loc_raw.strip().lower()

    # Explicit non-US city / country name in location → never US
    if any(c in loc for c in _NON_US_CITIES):
        return False
    if any(
        m in loc
        for m in (
            "hungary",
            "romania",
            "greece",
            "spain",
            "germany",
            "deutschland",
            "france",
            "poland",
            "india",
            "canada",
            "mexico",
            "brazil",
            "united kingdom",
            "england",
            "scotland",
            "ireland",
        )
    ):
        return False

    # freehire "City, ST, hu" or "..., hu" — ISO country trail wins over false US state
    m_iso = re.search(r",\s*([a-z]{2})\s*$", loc_stripped)
    if m_iso:
        code = m_iso.group(1)
        if code in _NON_US_ISO2:
            return False
        if code == "us":
            return True

    # freehire "Remote, Remote, ca" is ISO Canada — NOT California
    if re.search(r"\bremote\b.*\bremote\b[,\s]+([a-z]{2})\s*$", loc_stripped):
        code = re.search(r"\bremote\b.*\bremote\b[,\s]+([a-z]{2})\s*$", loc_stripped)
        if code and code.group(1) != "us":
            return False
    if re.search(r"\bremote\b[,\s]+([a-z]{2})\s*$", loc_stripped):
        code = re.search(r"\bremote\b[,\s]+([a-z]{2})\s*$", loc_stripped)
        if code and code.group(1) not in ("us",):
            return False

    if any(h in loc for h in _US_HINTS):
        return True
    if re.search(r"\b(united states|u\.s\.a\.?|usa)\b", loc):
        return True
    if re.search(r"(,\s*us\b|\bus\s*$)", loc_stripped):
        return True

    # "City, ST" US state — only if NOT followed by another ISO country code
    # Reject "Budapest, OR, hu" (state-like token then non-US ISO)
    if re.search(
        r",\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*,\s*[a-z]{2}\s*$",
        loc_raw,
        re.I,
    ):
        trail = re.search(r",\s*([a-z]{2})\s*$", loc_stripped)
        if trail and trail.group(1) in _NON_US_ISO2:
            return False

    # US state after a city name (e.g. "Fort Lee, NJ") — not "Remote, CA" alone
    state_m = re.search(
        r"[A-Za-z]{3,},\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b",
        loc_raw,
        re.I,
    )
    if state_m:
        if re.match(r"^\s*remote\s*,\s*[A-Z]{2}\s*$", loc_raw, re.I):
            return False
        # If location ends with non-US ISO after the state, reject (Budapest, OR, hu)
        if re.search(r",\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*,\s*([a-z]{2})\s*$", loc_raw, re.I):
            code = re.search(
                r",\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*,\s*([a-z]{2})\s*$",
                loc_raw,
                re.I,
            )
            if code and code.group(1).lower() in _NON_US_ISO2:
                return False
        return True

    if re.search(
        r"\b(austin|dallas|houston|seattle|denver|atlanta|chicago|boston|miami|phoenix|"
        r"portland|minneapolis|detroit|wixom|sandy springs|charlotte|sunnyvale|andover|"
        r"fort lee|hoboken|novi|katy|cary|charleston|san diego)\b",
        loc,
    ):
        return True
    return False


def _is_bare_remote_location(location: str) -> bool:
    s = re.sub(r"\s+", " ", (location or "").strip().lower())
    return s in (
        "",
        "remote",
        "remote job",
        "remote only",
        "worldwide",
        "anywhere",
        "global",
        "unspecified",
        "work from home",
        "wfh",
        "remote, remote",
    ) or re.fullmatch(r"remote([\s,-]+remote)?", s) is not None


def is_strict_us_job(job: dict[str, Any]) -> bool:
    """
    Strict US-only for product mode.

    freehire often tags non-US remote roles with countries=['us'] — **ignore that**.
    Require US evidence in the location string (state, city, United States, etc.).
    """
    if looks_non_us_listing(job):
        return False

    loc_raw = str(job.get("location") or "")
    if _is_bare_remote_location(loc_raw):
        return False

    # Location text must prove US. Board country codes are untrusted for remote roles.
    if _location_has_us_text(loc_raw):
        # Still drop if countries explicitly non-US only
        cc = {str(c).lower() for c in (job.get("countries") or []) if str(c).strip()}
        if cc and "us" not in cc and "usa" not in cc:
            # e.g. location text noise + countries=['de']
            if cc & {"de", "fr", "in", "eg", "mx", "br", "pl", "gb", "uk", "ca", "ae"}:
                return False
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
    raw_url = sanitize_url(url)
    title_search = re.sub(r"\s*\([^)]*\)\s*", " ", title_s).strip()
    indeed_url = indeed_search_url(title_search, company_s)
    google_url = (
        "https://www.google.com/search?q="
        + urllib.parse.quote_plus(f"{title_search} {company_s} careers apply")
    )
    is_li_src = "linkedin" in (source or "").lower() or "linkedin.com" in raw_url.lower()

    apply_url = raw_url
    # Real LinkedIn job post URL (view/ID) vs keyword search fallback
    if "linkedin.com/jobs/view/" in raw_url.lower():
        linkedin_url = raw_url
        apply_url = raw_url
        apply_kind = "direct"
    elif is_li_src and re.search(r"/jobs/view/(\d+)", raw_url):
        m = re.search(r"/jobs/view/(\d+)", raw_url)
        linkedin_url = linkedin_job_view_url(m.group(1))  # type: ignore[union-attr]
        apply_url = linkedin_url
        apply_kind = "direct"
    else:
        linkedin_url = linkedin_search_url(title_search, company_s)
        if not apply_url:
            apply_url = indeed_url
            apply_kind = "search"
        else:
            apply_kind = "direct"

    apply_url = sanitize_url(apply_url, fallback=indeed_url)
    final_url = sanitize_url(raw_url or apply_url, fallback=apply_url)
    linkedin_url = sanitize_url(linkedin_url, fallback=linkedin_search_url(title_search, company_s))

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
        "url": final_url,
        "apply_url": apply_url,
        "apply_kind": apply_kind,  # direct | search
        "linkedin_url": linkedin_url,
        "google_url": google_url,
        "indeed_url": indeed_url,
        "is_linkedin": is_li_src,
        "skills": skills,
        "seniority": seniority or "mid",
        "text": body[:2500],
        "source": source,
    }


# ---------------------------------------------------------------------------
# Live sources
# ---------------------------------------------------------------------------


def _freehire_page(query: str, page: int, *, remote_only: bool) -> list[dict[str, Any]]:
    """One freehire page — used for parallel page fetch (latency)."""
    params: dict[str, str] = {
        "q": query,
        "limit": "25",
        "page": str(page),
    }
    if remote_only:
        params["work_mode"] = "remote"
    url = "https://freehire.me/api/v1/agent/jobs/search?" + urllib.parse.urlencode(params)
    try:
        data = _get_json(url, timeout=8.0, retries=0)  # retries handled at page level once
    except Exception:
        return []
    rows = []
    if isinstance(data, dict):
        rows = data.get("data") or data.get("results") or data.get("jobs") or []
    elif isinstance(data, list):
        rows = data
    out: list[dict[str, Any]] = []
    for it in rows or []:
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
        raw_u = (
            it.get("url")
            or it.get("apply_url")
            or it.get("application_url")
            or it.get("external_url")
            or ""
        )
        raw_u = sanitize_url(str(raw_u))
        if not raw_u:
            raw_u = f"https://freehire.me/jobs/{slug}"
        # Latency: keep description short for rank (full text not needed for scoring)
        desc = _strip_html(str(it.get("description") or ""))[:1200]
        out.append(
            _norm_job(
                id_=f"fh-{slug}",
                title=str(it.get("title") or "Role"),
                company=str(it.get("company") or "Company"),
                location=str(it.get("location") or ""),
                remote=wm == "remote",
                work_mode=wm,
                url=raw_u,
                skills=[str(s) for s in skills],
                seniority=str(
                    (it.get("enrichment") or {}).get("seniority")
                    or it.get("seniority")
                    or "mid"
                ),
                text=desc,
                source="freehire",
                countries=[str(c) for c in countries],
            )
        )
    return out


def fetch_freehire(query: str, limit: int = 50, *, remote_only: bool = False) -> list[dict[str, Any]]:
    """freehire.me agent search — pages fetched in parallel for lower wall latency."""
    q = (query or "").strip() or "software"
    # Latency budget: max 2 pages (50 rows) per query
    pages = max(1, min(2, (limit + 24) // 25))
    out: list[dict[str, Any]] = []
    if pages == 1:
        out = _freehire_page(q, 1, remote_only=remote_only)
    else:
        with ThreadPoolExecutor(max_workers=pages) as ex:
            futs = [
                ex.submit(_freehire_page, q, p, remote_only=remote_only)
                for p in range(1, pages + 1)
            ]
            for fut in as_completed(futs):
                out.extend(fut.result() or [])
    # preserve some page order by id stability; truncate
    return out[:limit]


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
        rm_url = sanitize_url(str(it.get("url") or ""))
        out.append(
            _norm_job(
                id_=f"rm-{it.get('id')}",
                title=str(it.get("title") or "Role"),
                company=str(it.get("company_name") or it.get("company") or "Company"),
                location=str(it.get("candidate_required_location") or "Remote"),
                remote=True,
                work_mode="remote",
                url=rm_url,
                skills=[str(t) for t in tags][:16],
                seniority="mid",
                text=_strip_html(str(it.get("description") or "")),
                source="remotive",
            )
        )
        if len(out) >= limit:
            break
    return out


def fetch_linkedin_guest(
    query: str,
    *,
    location: str = "United States",
    limit: int = 40,
    remote_only: bool = False,
) -> list[dict[str, Any]]:
    """
    LinkedIn public jobs-guest search (HTML). Localhost lab only — low volume.
    Used when exclude_linkedin is False so users can see LinkedIn openings.
    """
    q = (query or "").strip() or "software"
    loc = (location or "United States").strip() or "United States"
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    # Latency: ≤2 pages for typical limit≤20
    pages = max(1, min(2, (limit + 9) // 10))

    def _li_page(start: int) -> str:
        params: dict[str, str] = {
            "keywords": q,
            "location": loc,
            "start": str(start),
        }
        if remote_only:
            params["f_WT"] = "2"
        url = (
            "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
            + urllib.parse.urlencode(params)
        )
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            with urllib.request.urlopen(req, timeout=8.0) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception:
            return ""

    # Parallel LI pages when >1
    html_pages: list[str] = []
    if pages == 1:
        html_pages = [_li_page(0)]
    else:
        with ThreadPoolExecutor(max_workers=pages) as ex:
            futs = [ex.submit(_li_page, p * 10) for p in range(pages)]
            for fut in as_completed(futs):
                html_pages.append(fut.result() or "")

    for html in html_pages:
        if not html:
            continue

        # Global extract (card split is brittle — class attributes wrap newlines)
        ids = re.findall(r"urn:li:jobPosting:(\d+)", html)
        # preserve order, unique
        ordered_ids: list[str] = []
        for jid in ids:
            if jid not in seen_ids:
                seen_ids.add(jid)
                ordered_ids.append(jid)
        titles = [
            re.sub(r"\s+", " ", t).strip()
            for t in re.findall(
                r'class="base-search-card__title"[^>]*>\s*([^<]+)', html, flags=re.I
            )
        ]
        companies = [
            re.sub(r"\s+", " ", t).strip()
            for t in re.findall(
                r'class="base-search-card__subtitle"[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)',
                html,
                flags=re.I,
            )
        ]
        locs = [
            re.sub(r"\s+", " ", t).strip()
            for t in re.findall(
                r'class="job-search-card__location"[^>]*>\s*([^<]+)', html, flags=re.I
            )
        ]
        if not ordered_ids:
            break
        for i, jid in enumerate(ordered_ids):
            title = titles[i] if i < len(titles) else ""
            company = companies[i] if i < len(companies) else "Company"
            jloc = locs[i] if i < len(locs) else loc
            if not title:
                continue
            jl = jloc.lower()
            countries: list[str] | None = None
            if (
                any(x in jl for x in ("united states", "usa"))
                or re.search(r",\s*[A-Z]{2}\b", jloc)
                or loc.lower() in ("united states", "usa", "us")
            ):
                # Guest search scoped to US location → treat as us when state/city present
                countries = ["us"]
            # Decode HTML entities in scraped titles (e.g. &amp;)
            title = (
                title.replace("&amp;", "&")
                .replace("&quot;", '"')
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
            )
            company = (
                company.replace("&amp;", "&")
                .replace("&quot;", '"')
                .replace("&#39;", "'")
            )
            apply_url = linkedin_job_view_url(jid)
            out.append(
                _norm_job(
                    id_=f"li-{jid}",
                    title=title,
                    company=company,
                    location=jloc or loc,
                    remote="remote" in jl,
                    work_mode="remote" if "remote" in jl else "onsite",
                    url=apply_url,
                    skills=[],
                    text=f"{title} at {company} — {jloc}. Source: LinkedIn.",
                    source="linkedin",
                    countries=countries,
                )
            )
            if len(out) >= limit:
                return out
    return out[:limit]


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
            # Strict US-only — no generic Remote / unknown soft-pass
            if not is_strict_us_job(j):
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

    # TITLE_MIN_DOMAIN_SCORE: SAP FICO queries need finance signal, not bare SAP/MM/dev
    ql = (query or "").lower()
    tl = (job_title or "").lower()
    if any(x in ql for x in ("fico", "fi/co", "s4hana", "s/4")) or (
        "sap" in ql and "fico" in ql
    ):
        finance_signal = any(
            x in tl
            for x in (
                "fico",
                "fi/co",
                "fi-co",
                "fi co",
                "finance",
                "controlling",
                "treasury",
                "tax",
                "vertex",
                "rar",
                "lease",
                "fi ",
                " co ",
                "fi-",
                "s/4hana finance",
                "s4hana finance",
                "financial",
            )
        )
        # Explicit non-finance SAP modules / pure tech roles
        non_finance = any(
            re.search(p, tl)
            for p in (
                r"\babap\b",
                r"\bbasis\b",
                r"\bsecurity\b",
                r"\bmm\b",
                r"\bsd\b",
                r"\bewm\b",
                r"\bwm\b",
                r"\bhcm\b",
                r"\bsuccessfactors\b",
                r"\bdeveloper\b",
                r"\bdevelopment\b",
                r"\binfrastructure\b",
                r"\bdelivery executive\b",
                r"\btm consultant\b",
                r"\btransport",
            )
        )
        if "sap" in tl and non_finance and not finance_signal:
            return False
        # Bare "SAP Consultant / Specialist" without finance keywords — weak for FICO search
        if re.search(r"\bsap\b", tl) and not finance_signal:
            if re.search(
                r"\b(consultant|specialist|architect|analyst|manager|lead|developer)\b",
                tl,
            ) and not re.search(
                r"\b(fi|co|fico|finance|controlling|treasury|tax|s/4|s4)\b", tl
            ):
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

        # Enterprise: per-board circuit breakers + graceful degrade
        try:
            from jobsearch.enterprise import breakers, protected_fetch
        except Exception:  # pragma: no cover — always present in package
            breakers = None  # type: ignore
            protected_fetch = None  # type: ignore

        def _safe(name: str, board: str, fn, *args, **kwargs):
            """Harvest one board under circuit breaker; never raise."""
            if protected_fetch is not None:
                rows = protected_fetch(board, fn, *args, **kwargs)
                if breakers is not None:
                    br = breakers().get(board)
                    if br.state.value == "open":
                        diagnostics["sources_error"][name] = (
                            f"circuit_open:{board}:{br.last_error or 'cooling down'}"
                        )
                        diagnostics["counts"][name] = 0
                        diagnostics.setdefault("circuit", {})[board] = br.snapshot()
                        return []
                if isinstance(rows, list):
                    if rows:
                        diagnostics["sources_ok"][name] = True
                    diagnostics["counts"][name] = len(rows)
                    return rows
                diagnostics["counts"][name] = 0
                return []
            # Fallback without enterprise module
            try:
                rows = fn(*args, **kwargs)
                diagnostics["sources_ok"][name] = True
                diagnostics["counts"][name] = len(rows)
                return rows
            except Exception as e:
                diagnostics["sources_error"][name] = str(e)[:160]
                diagnostics["counts"][name] = 0
                return []

        # LinkedIn guest harvest when user allows LinkedIn (exclude_linkedin=False)
        li_location = "United States"
        if loc_f in ("us", "usa", "united states"):
            li_location = "United States"
        elif location and str(location).lower() not in ("all", "any", ""):
            li_location = str(location)

        # Latency-first fan-out:
        #   freehire: primary + 1 expansion
        #   remotive: primary only
        #   arbeitnow: skip when US-only (EU board, high noise / wasted RTT)
        #   linkedin: primary only, fewer pages
        q_live: list[str] = []
        for q in qlist:
            q = " ".join(str(q).split())
            if q and q.lower() not in {x.lower() for x in q_live}:
                q_live.append(q)
            if len(q_live) >= 2:
                break
        if not q_live:
            q_live = [primary]

        us_only = loc_f in ("us", "usa", "united states")
        tasks = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            for q in q_live:
                tasks.append(
                    ex.submit(
                        _safe,
                        f"freehire:{q[:40]}",
                        "freehire",
                        fetch_freehire,
                        q,
                        50,
                        remote_only=remote_only,
                    )
                )
            # Remotive once on primary — multi-query rarely helps US SAP
            tasks.append(
                ex.submit(
                    _safe,
                    f"remotive:{primary[:40]}",
                    "remotive",
                    fetch_remotive,
                    primary,
                    40,
                )
            )
            if not us_only:
                tasks.append(
                    ex.submit(_safe, "arbeitnow", "arbeitnow", fetch_arbeitnow, primary, 40)
                )
            if not exclude_linkedin:
                # 1 LI query, 20 results (~2 pages) — largest latency win
                tasks.append(
                    ex.submit(
                        _safe,
                        f"linkedin:{primary[:40]}",
                        "linkedin",
                        fetch_linkedin_guest,
                        primary,
                        location=li_location,
                        limit=20,
                        remote_only=remote_only,
                    )
                )
            for fut in as_completed(tasks):
                collected.extend(fut.result() or [])
        if not exclude_linkedin:
            li_n = sum(1 for j in collected if str(j.get("source") or "") == "linkedin")
            diagnostics["counts"]["linkedin"] = li_n
            if li_n == 0:
                li_err = diagnostics.get("sources_error", {}).get(
                    f"linkedin:{primary[:40]}", ""
                )
                if "circuit_open" in str(li_err):
                    warnings.append(
                        "LinkedIn circuit open (recent failures) — skipped this run; "
                        "other boards still searched."
                    )
                else:
                    warnings.append(
                        "LinkedIn allowed but guest search returned 0 rows "
                        "(rate-limit or network). Other boards still searched."
                    )
            else:
                diagnostics["sources_ok"]["linkedin"] = True
        # Surface breaker states in diagnostics
        if breakers is not None:
            diagnostics["circuit_breakers"] = {
                b: breakers().get(b).snapshot()
                for b in ("freehire", "remotive", "arbeitnow", "linkedin")
            }
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
        synth = is_synthetic_job(j)
        j["is_synthetic"] = synth
        j["product_label"] = "practice" if synth else "live"
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
