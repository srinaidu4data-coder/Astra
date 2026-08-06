#!/usr/bin/env python3
"""
Evidence-safe candidate fact model + anti-fabrication guards.

Rules
-----
1. Candidate personal claims must derive from resume/JD materials.
2. A supported percentage (e.g. "30% reduction") must NEVER become invented
   baseline/final numbers (e.g. "10 days to 7 days").
3. Never invent secondary metrics, training, workshops, or actions not in materials.
4. When evidence is missing, force hypothetical framing ("I would approach…").
5. Layer-1 constraints run before generation; Layer-2 sanitizes streamed text
   without blocking first paint.
"""

from __future__ import annotations

import hashlib
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Typed evidence model
# ---------------------------------------------------------------------------

FACT_TYPES = frozenset(
    {
        "role",
        "employer",
        "duration",
        "technology",
        "responsibility",
        "action",
        "metric",
        "outcome",
        "certification",
        "education",
    }
)

ANSWER_MODES = frozenset(
    {
        "verified_experience",
        "partially_supported",
        "hypothetical_approach",
        "knowledge_answer",
    }
)

# Personal-action phrases that require resume support
_PERSONAL_ACTION_RE = re.compile(
    r"\b(I\s+(?:implemented|conducted|led|ran|trained|facilitated|organized|"
    r"automated|configured|deployed|built|created|designed|reduced|improved|"
    r"fixed|eliminated|standardized|streamlined|owned|drove|delivered|"
    r"migrated|cut|saved|achieved|established|introduced))\b",
    re.I,
)

# Numbered claims that look like personal metrics
_METRIC_CLAIM_RE = re.compile(
    r"(?P<full>"
    r"(?:from\s+)?(?P<a>\d+(?:\.\d+)?)\s*(?P<u1>days?|hours?|weeks?|months?|%|percent|x)?"
    r"\s*(?:to|→|->)\s*"
    r"(?P<b>\d+(?:\.\d+)?)\s*(?P<u2>days?|hours?|weeks?|months?|%|percent|x)?"
    r"|"
    r"(?P<pct>\d+(?:\.\d+)?)\s*(?:%|percent)"
    r"|"
    r"(?P<mult>\d+(?:\.\d+)?)\s*x\b"
    r"|"
    r"(?:by|of)\s+(?P<by_n>\d+(?:\.\d+)?)\s*(?P<by_u>days?|hours?|weeks?|months?)"
    r")",
    re.I,
)

# Forbidden invented patterns for the month-end close regression case
_FABRICATION_PATTERNS = [
    re.compile(r"\bfrom\s+\d+\s*days?\s+to\s+\d+\s*days?\b", re.I),
    re.compile(r"\b\d+\s*days?\s+(?:down\s+)?to\s+\d+\s*days?\b", re.I),
    re.compile(r"\bdiscrepanc(?:y|ies)\s+(?:by\s+)?\d+\s*%", re.I),
    re.compile(r"\b\d+\s*%\s*(?:fewer|less|reduction in)\s+discrepanc", re.I),
    re.compile(r"\bconducted\s+training\b", re.I),
    re.compile(r"\btraining\s+sessions?\b", re.I),
    re.compile(r"\bmanual[- ](?:data[- ]?)?entr(?:y|ies)\s+errors?\b", re.I),
    re.compile(r"\bstakeholder\s+workshops?\b", re.I),
]

_HYPOTHETICAL_PREFIXES = (
    "I would approach this by",
    "A strong approach would be",
    "Based on my related experience",
    "In a situation like this I would",
)


@dataclass
class MetricFact:
    """A single measurable outcome extracted from materials."""

    fact_id: str
    value: float
    unit: str  # %, days, hours, x, count
    direction: str = ""  # reduction | increase | absolute
    baseline: Optional[float] = None
    final_value: Optional[float] = None
    timeframe: str = ""
    source_text: str = ""
    confidence: float = 0.8
    approved: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def display(self) -> str:
        if self.unit in ("%", "percent"):
            d = self.direction or "change"
            return f"{self.value:g}% {d}".strip()
        if self.baseline is not None and self.final_value is not None:
            return f"{self.baseline:g} → {self.final_value:g} {self.unit}".strip()
        return f"{self.value:g} {self.unit}".strip()


@dataclass
class CandidateFact:
    fact_id: str
    source_document: str  # resume | jd | role | story
    source_location: str
    evidence_text: str
    normalized_fact: str
    confidence: float
    fact_type: str
    approved: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvidenceBundle:
    """Versioned precomputed evidence for one interview kit."""

    bundle_id: str = ""
    materials_hash: str = ""
    facts: list[CandidateFact] = field(default_factory=list)
    metrics: list[MetricFact] = field(default_factory=list)
    technologies: list[str] = field(default_factory=list)
    employers: list[str] = field(default_factory=list)
    role_summary: str = ""
    compact_prompt_block: str = ""
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "bundle_id": self.bundle_id,
            "materials_hash": self.materials_hash,
            "facts": [f.to_dict() for f in self.facts],
            "metrics": [m.to_dict() for m in self.metrics],
            "technologies": self.technologies,
            "employers": self.employers,
            "role_summary": self.role_summary,
            "compact_prompt_block": self.compact_prompt_block,
            "created_at": self.created_at,
        }

    def allowed_numbers(self) -> set[str]:
        """Canonical string forms of numbers the model may use as personal metrics."""
        out: set[str] = set()
        for m in self.metrics:
            if not m.approved:
                continue
            out.add(_num_key(m.value))
            if m.baseline is not None:
                out.add(_num_key(m.baseline))
            if m.final_value is not None:
                out.add(_num_key(m.final_value))
        return out

    def allowed_pct_values(self) -> set[float]:
        return {
            float(m.value)
            for m in self.metrics
            if m.approved and m.unit in ("%", "percent")
        }


def _num_key(v: float | int | str) -> str:
    try:
        f = float(v)
        if abs(f - round(f)) < 1e-9:
            return str(int(round(f)))
        return f"{f:g}"
    except (TypeError, ValueError):
        return str(v).strip()


def materials_hash(text: str) -> str:
    blob = (text or "").strip().encode("utf-8", errors="replace")
    return hashlib.sha256(blob).hexdigest()[:20]


def _fid(prefix: str, text: str) -> str:
    h = hashlib.sha1((text or "").encode("utf-8", errors="replace")).hexdigest()[:10]
    return f"{prefix}_{h}"


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

_PCT_RE = re.compile(
    r"(?P<pre>(?:reduced?|improved?|cut|saved?|increased?|decreased?|grew|dropped|"
    r"boosted|lowered|raised|achieved|delivered|drove|by)\s+)?"
    r"(?P<val>\d+(?:\.\d+)?)\s*(?:%|percent)"
    r"(?P<post>\s+(?:reduction|improvement|increase|decrease|faster|slower|"
    r"savings?|gain|drop|cut))?",
    re.I,
)

_BASELINE_FINAL_RE = re.compile(
    r"(?:from\s+)?(?P<a>\d+(?:\.\d+)?)\s*(?P<u>days?|hours?|weeks?|months?)"
    r"\s*(?:to|→|->|down\s+to)\s*"
    r"(?P<b>\d+(?:\.\d+)?)\s*(?:days?|hours?|weeks?|months?)?",
    re.I,
)

_TECH_HINTS = re.compile(
    r"\b(SAP\s+[A-Z0-9/]+|S/4HANA|FICO|FI-CO|FI-CA|BRIM|Vertex|HANA|"
    r"Python|Java|React|TypeScript|Kubernetes|AWS|Azure|GCP|"
    r"PostgreSQL|Kafka|Spark|dbt|Airflow|Terraform)\b",
    re.I,
)

_EMPLOYER_RE = re.compile(
    r"(?:at|@|for)\s+([A-Z][A-Za-z0-9&.,'\- ]{2,40}?)(?:\s*[|,;\n]|\s+as\s+|\s+where\b|$)",
)


def extract_metrics_from_text(text: str, *, source: str = "resume") -> list[MetricFact]:
    """Pull supported metrics; preserve % without inventing baseline/final."""
    t = text or ""
    metrics: list[MetricFact] = []
    seen: set[str] = set()

    # Explicit baseline → final (only when materials state both)
    for m in _BASELINE_FINAL_RE.finditer(t):
        a, b = float(m.group("a")), float(m.group("b"))
        unit = (m.group("u") or "days").lower().rstrip("s") + "s"
        key = f"{a}->{b}:{unit}"
        if key in seen:
            continue
        seen.add(key)
        direction = "reduction" if b < a else "increase"
        metrics.append(
            MetricFact(
                fact_id=_fid("m", key),
                value=abs(a - b),
                unit=unit,
                direction=direction,
                baseline=a,
                final_value=b,
                source_text=m.group(0).strip(),
                confidence=0.9,
            )
        )

    for m in _PCT_RE.finditer(t):
        val = float(m.group("val"))
        pre = (m.group("pre") or "").lower()
        post = (m.group("post") or "").lower()
        blob = f"{pre} {post}"
        direction = "change"
        if any(w in blob for w in ("reduc", "cut", "drop", "lower", "decreas", "sav")):
            direction = "reduction"
        elif any(w in blob for w in ("improv", "increas", "boost", "grew", "gain", "faster")):
            direction = "improvement"
        key = f"{val}%:{direction}"
        if key in seen:
            continue
        seen.add(key)
        # Window for source sentence
        start = max(0, m.start() - 80)
        end = min(len(t), m.end() + 80)
        metrics.append(
            MetricFact(
                fact_id=_fid("m", key + t[start:end][:40]),
                value=val,
                unit="%",
                direction=direction,
                baseline=None,  # CRITICAL: do not invent
                final_value=None,
                source_text=t[start:end].strip(),
                confidence=0.85,
            )
        )

    return metrics


def extract_facts_from_materials(
    *,
    resume_text: str = "",
    job_description: str = "",
    role: str = "",
    stories: Optional[list[str]] = None,
) -> EvidenceBundle:
    """Parse materials once into a versioned evidence bundle."""
    stories = stories or []
    parts = [
        f"role:{role or ''}",
        f"jd:{job_description or ''}",
        f"resume:{resume_text or ''}",
        f"stories:{'|'.join(stories)}",
    ]
    blob = "\n".join(parts)
    h = materials_hash(blob)
    bundle = EvidenceBundle(
        bundle_id=uuid.uuid4().hex[:12],
        materials_hash=h,
    )

    if role.strip():
        bundle.facts.append(
            CandidateFact(
                fact_id=_fid("role", role),
                source_document="role",
                source_location="session.role",
                evidence_text=role.strip()[:400],
                normalized_fact=role.strip()[:200],
                confidence=1.0,
                fact_type="role",
            )
        )
        bundle.role_summary = role.strip()[:200]

    resume = (resume_text or "").strip()
    if resume:
        # Bullet-ish lines as actions/outcomes
        for i, line in enumerate(resume.splitlines()):
            ln = line.strip(" •-\t")
            if len(ln) < 20:
                continue
            ftype = "outcome" if re.search(r"\d+\s*%|\d+\s*x\b", ln, re.I) else "action"
            if re.search(
                r"\b(led|built|implemented|improved|reduced|designed|owned|migrated|"
                r"configured|automated|standardized|delivered)\b",
                ln,
                re.I,
            ):
                ftype = "action" if ftype != "outcome" else "outcome"
            bundle.facts.append(
                CandidateFact(
                    fact_id=_fid("r", f"{i}:{ln[:60]}"),
                    source_document="resume",
                    source_location=f"resume:L{i+1}",
                    evidence_text=ln[:500],
                    normalized_fact=ln[:240],
                    confidence=0.8,
                    fact_type=ftype,
                )
            )
            if len(bundle.facts) > 48:
                break

        bundle.metrics.extend(extract_metrics_from_text(resume, source="resume"))
        for m in _TECH_HINTS.finditer(resume):
            tok = m.group(0).strip()
            if tok and tok not in bundle.technologies:
                bundle.technologies.append(tok)
            if len(bundle.technologies) >= 24:
                break
        for m in _EMPLOYER_RE.finditer(resume):
            emp = m.group(1).strip().rstrip(".,")
            if emp and emp not in bundle.employers and len(emp) > 2:
                bundle.employers.append(emp[:60])

    jd = (job_description or "").strip()
    if jd:
        for m in extract_metrics_from_text(jd, source="jd"):
            # JD metrics are requirements, not candidate claims — lower confidence
            m.confidence = 0.4
            m.approved = False  # do not treat JD metrics as candidate history
            bundle.metrics.append(m)
        for m in _TECH_HINTS.finditer(jd):
            tok = m.group(0).strip()
            if tok and tok not in bundle.technologies:
                bundle.technologies.append(tok)

    for i, s in enumerate(stories[:12]):
        s = (s or "").strip()
        if not s:
            continue
        bundle.facts.append(
            CandidateFact(
                fact_id=_fid("s", s[:80]),
                source_document="story",
                source_location=f"stories[{i}]",
                evidence_text=s[:500],
                normalized_fact=s[:240],
                confidence=0.9,
                fact_type="action",
            )
        )
        bundle.metrics.extend(extract_metrics_from_text(s, source="story"))

    # Dedupe metrics by display key
    uniq: dict[str, MetricFact] = {}
    for m in bundle.metrics:
        k = f"{m.value}:{m.unit}:{m.direction}:{m.baseline}:{m.final_value}"
        if k not in uniq or m.confidence > uniq[k].confidence:
            uniq[k] = m
    bundle.metrics = list(uniq.values())

    bundle.compact_prompt_block = format_evidence_for_prompt(bundle)
    return bundle


def format_evidence_for_prompt(bundle: EvidenceBundle, *, max_facts: int = 12) -> str:
    """Compact structured evidence block for LLM prompts."""
    if not bundle.facts and not bundle.metrics:
        return (
            "VERIFIED CANDIDATE EVIDENCE: none extracted.\n"
            "Answer mode must be hypothetical_approach or knowledge_answer.\n"
            "Do NOT write personal 'I implemented/led/reduced…' claims.\n"
            "Use: 'I would approach this by…' or 'A strong approach would be…'."
        )
    lines = [
        "VERIFIED CANDIDATE EVIDENCE (use ONLY these personal facts):",
        "UNSUPPORTED-CLAIM POLICY:",
        "- Never invent baseline/final numbers from a percentage alone.",
        "- A '30% reduction' stays '30% reduction' unless baseline AND final appear below.",
        "- Never invent secondary metrics (e.g. 40% fewer discrepancies).",
        "- Never claim training, workshops, or actions not listed.",
        "- Missing evidence → hypothetical framing, not personal history.",
    ]
    if bundle.role_summary:
        lines.append(f"Role: {bundle.role_summary}")
    if bundle.technologies:
        lines.append("Technologies: " + ", ".join(bundle.technologies[:16]))
    if bundle.employers:
        lines.append("Employers: " + ", ".join(bundle.employers[:8]))
    approved_metrics = [m for m in bundle.metrics if m.approved]
    if approved_metrics:
        lines.append("Allowed personal metrics (exact forms only):")
        for m in approved_metrics[:10]:
            lines.append(f"  - [{m.fact_id}] {m.display()} · src: {m.source_text[:100]}")
    else:
        lines.append("Allowed personal metrics: none")
    lines.append("Resume actions / outcomes:")
    for f in bundle.facts[:max_facts]:
        if f.fact_type in ("action", "outcome", "responsibility", "metric"):
            lines.append(f"  - [{f.fact_id}] {f.normalized_fact}")
    return "\n".join(lines)


def select_relevant_evidence(
    bundle: EvidenceBundle,
    question: str,
    *,
    max_facts: int = 8,
) -> EvidenceBundle:
    """Keyword overlap retrieval — no LLM, sub-ms."""
    q_tokens = set(re.findall(r"[a-z0-9]{3,}", (question or "").lower()))
    if not q_tokens:
        return bundle

    scored: list[tuple[float, CandidateFact]] = []
    for f in bundle.facts:
        ft = set(re.findall(r"[a-z0-9]{3,}", f.normalized_fact.lower()))
        overlap = len(q_tokens & ft)
        if overlap:
            scored.append((overlap + f.confidence, f))
    scored.sort(key=lambda x: -x[0])
    top = [f for _, f in scored[:max_facts]]
    if not top:
        top = list(bundle.facts[:max_facts])

    # Metrics that co-occur with question terms in source_text
    mets: list[MetricFact] = []
    for m in bundle.metrics:
        if not m.approved:
            continue
        st = set(re.findall(r"[a-z0-9]{3,}", m.source_text.lower()))
        if q_tokens & st or not mets:
            mets.append(m)
    if not mets:
        mets = [m for m in bundle.metrics if m.approved][:4]

    out = EvidenceBundle(
        bundle_id=bundle.bundle_id,
        materials_hash=bundle.materials_hash,
        facts=top,
        metrics=mets,
        technologies=bundle.technologies,
        employers=bundle.employers,
        role_summary=bundle.role_summary,
        created_at=bundle.created_at,
    )
    out.compact_prompt_block = format_evidence_for_prompt(out, max_facts=max_facts)
    return out


def classify_answer_mode(
    question: str,
    bundle: EvidenceBundle,
) -> str:
    """Deterministic answer mode — no LLM."""
    q = (question or "").lower()
    has_evidence = bool(bundle.facts) or any(m.approved for m in bundle.metrics)
    behavioral = bool(
        re.search(
            r"\b(tell me about a time|describe a time|give an example|"
            r"when did you|how did you|what did you do|your experience|"
            r"have you ever|walk me through a time)\b",
            q,
        )
    )
    knowledge = bool(
        re.search(
            r"\b(what is|how does|explain|difference between|compare|"
            r"walk me through how|define)\b",
            q,
        )
    ) and not behavioral

    if knowledge and not behavioral:
        return "knowledge_answer"
    if not has_evidence:
        return "hypothetical_approach" if behavioral else "knowledge_answer"

    # Overlap score
    q_tokens = set(re.findall(r"[a-z0-9]{3,}", q))
    best = 0
    for f in bundle.facts:
        ft = set(re.findall(r"[a-z0-9]{3,}", f.normalized_fact.lower()))
        best = max(best, len(q_tokens & ft))
    for m in bundle.metrics:
        if m.approved:
            st = set(re.findall(r"[a-z0-9]{3,}", m.source_text.lower()))
            best = max(best, len(q_tokens & st))

    if best >= 3:
        return "verified_experience"
    if best >= 1:
        return "partially_supported"
    if behavioral:
        return "hypothetical_approach"
    return "knowledge_answer"


def evidence_policy_block(mode: str, bundle: EvidenceBundle) -> str:
    """Short instruction block for prompts."""
    lines = [
        f"ANSWER_MODE: {mode}",
        format_evidence_for_prompt(bundle, max_facts=8),
    ]
    if mode == "hypothetical_approach":
        lines.append(
            "MODE RULE: No personal history claims. Start with "
            "'I would approach this by…' or 'A strong approach would be…'."
        )
    elif mode == "partially_supported":
        lines.append(
            "MODE RULE: Only claim facts listed above as personal. "
            "For gaps, say 'Based on my related experience…' then framework."
        )
    elif mode == "verified_experience":
        lines.append(
            "MODE RULE: Personal claims only from evidence IDs above. "
            "Metrics must match allowed forms exactly — no invented baselines."
        )
    else:
        lines.append(
            "MODE RULE: Knowledge answer — no fabricated personal project metrics."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Layer-2 stream verification / sanitization
# ---------------------------------------------------------------------------


@dataclass
class GroundingViolation:
    kind: str
    span: str
    reason: str
    replacement: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GroundingResult:
    text: str
    mode: str
    violations: list[GroundingViolation] = field(default_factory=list)
    modified: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "mode": self.mode,
            "violations": [v.to_dict() for v in self.violations],
            "modified": self.modified,
            "violation_count": len(self.violations),
        }


def _replace_span(text: str, span: str, replacement: str) -> str:
    if not span:
        return text
    return text.replace(span, replacement, 1)


def sanitize_answer_against_evidence(
    answer: str,
    bundle: EvidenceBundle,
    *,
    question: str = "",
    mode: Optional[str] = None,
) -> GroundingResult:
    """
    Strip unsupported personal metrics and known fabrication patterns.

    Safe for final answers and late-stream revision. Does not block first paint
    if called only on final or when a violation is detected mid-stream.
    """
    text = answer or ""
    mode = mode or classify_answer_mode(question, bundle)
    violations: list[GroundingViolation] = []
    allowed_pct = bundle.allowed_pct_values()
    allowed_nums = bundle.allowed_numbers()

    # 1) Hard fabrication patterns (month-end regression + similar)
    for pat in _FABRICATION_PATTERNS:
        for m in list(pat.finditer(text)):
            span = m.group(0)
            # Allow if the exact span appears in evidence source text
            ground = " ".join(m_.source_text for m_ in bundle.metrics if m_.approved)
            ground += " " + " ".join(f.evidence_text for f in bundle.facts)
            if span.lower() in ground.lower():
                continue
            # Prefer rewriting baseline→final to approved % if we have one
            if re.search(r"days?", span, re.I) and allowed_pct:
                pct = sorted(allowed_pct)[0]
                rep = f"by {pct:g}%"
            elif re.search(r"discrepanc|training|manual", span, re.I):
                rep = ""
            else:
                rep = ""
            violations.append(
                GroundingViolation(
                    kind="fabrication_pattern",
                    span=span,
                    reason="Unsupported fabricated claim pattern",
                    replacement=rep,
                )
            )
            if rep:
                text = _replace_span(text, span, rep)
            else:
                # Remove the clause containing the span
                text = _scrub_clause_containing(text, span)

    # 2) from X to Y day/hour inventions when materials only have %
    for m in list(_BASELINE_FINAL_RE.finditer(text)):
        a, b = float(m.group("a")), float(m.group("b"))
        unit = (m.group("u") or "days").lower()
        # Allowed only if some approved metric has same baseline/final
        ok = False
        for mf in bundle.metrics:
            if not mf.approved:
                continue
            if (
                mf.baseline is not None
                and mf.final_value is not None
                and abs(mf.baseline - a) < 0.01
                and abs(mf.final_value - b) < 0.01
            ):
                ok = True
                break
            # Also allow if both numbers appear as approved absolute values
            if (
                _num_key(a) in allowed_nums
                and _num_key(b) in allowed_nums
                and mf.baseline is not None
            ):
                ok = True
                break
        if ok:
            continue
        span = m.group(0)
        if allowed_pct:
            pct = sorted(allowed_pct)[0]
            rep = f"by {pct:g}%"
        else:
            rep = "materially"
        violations.append(
            GroundingViolation(
                kind="invented_baseline_final",
                span=span,
                reason=f"Baseline/final {a}→{b} {unit} not in evidence",
                replacement=rep,
            )
        )
        text = _replace_span(text, span, rep)

    # 3) Percentage claims not in allowed set
    for m in list(re.finditer(r"(?P<val>\d+(?:\.\d+)?)\s*(?:%|percent)", text, re.I)):
        val = float(m.group("val"))
        # Allow small domain constants sometimes (e.g. 100%) if clearly not personal?
        # Strict rule: personal-looking context only
        start = max(0, m.start() - 40)
        ctx = text[start : m.end() + 20].lower()
        personal_ctx = bool(
            re.search(
                r"\b(i|we|my|our|reduced|improved|cut|saved|achieved|decreased|"
                r"increased|close|month-end|discrepanc|error|latency|cost)\b",
                ctx,
            )
        )
        if not personal_ctx:
            continue
        if any(abs(val - a) < 0.05 for a in allowed_pct):
            continue
        # No approved metrics at all + knowledge answer → strip personal %
        if not allowed_pct and mode in (
            "hypothetical_approach",
            "knowledge_answer",
            "partially_supported",
            "verified_experience",
        ):
            span = m.group(0)
            violations.append(
                GroundingViolation(
                    kind="unsupported_percentage",
                    span=span,
                    reason=f"{val}% not in approved evidence metrics",
                    replacement="a measurable amount",
                )
            )
            text = _replace_span(text, span, "a measurable amount")

    # 4) Known secondary fabrications near month-end theme
    if re.search(r"month[- ]?end|close process", question + " " + text, re.I):
        for pat, reason in (
            (
                re.compile(
                    r"[^.]*\b(?:discrepanc(?:y|ies)|manual[- ]entry|training sessions?)"
                    r"[^.]*\.",
                    re.I,
                ),
                "Unsupported month-end side claim",
            ),
        ):
            for m in list(pat.finditer(text)):
                span = m.group(0)
                # Keep if evidence supports
                ground = " ".join(f.evidence_text for f in bundle.facts).lower()
                if any(
                    tok in ground
                    for tok in ("discrepanc", "training", "manual")
                    if tok in span.lower()
                ):
                    # only keep if the specific token is in evidence
                    if re.search(r"discrepanc", span, re.I) and "discrepanc" not in ground:
                        pass
                    elif re.search(r"training", span, re.I) and "training" not in ground:
                        pass
                    elif re.search(r"manual", span, re.I) and "manual" not in ground:
                        pass
                    else:
                        continue
                ground_all = ground
                if re.search(r"discrepanc", span, re.I) and "discrepanc" not in ground_all:
                    violations.append(
                        GroundingViolation(
                            kind="unsupported_side_claim",
                            span=span.strip(),
                            reason=reason,
                            replacement="",
                        )
                    )
                    text = text.replace(span, " ", 1)
                elif re.search(r"training", span, re.I) and "training" not in ground_all:
                    violations.append(
                        GroundingViolation(
                            kind="unsupported_side_claim",
                            span=span.strip(),
                            reason=reason,
                            replacement="",
                        )
                    )
                    text = text.replace(span, " ", 1)
                elif re.search(r"manual", span, re.I) and "manual" not in ground_all:
                    violations.append(
                        GroundingViolation(
                            kind="unsupported_side_claim",
                            span=span.strip(),
                            reason=reason,
                            replacement="",
                        )
                    )
                    text = text.replace(span, " ", 1)

    # 5) Hypothetical mode: demote unsupported personal actions
    if mode == "hypothetical_approach":
        if re.search(r"\bI\s+(implemented|conducted|led|reduced|fixed)\b", text, re.I):
            # Soft rewrite first sentence if it claims personal history
            text2 = re.sub(
                r"\bI\s+implemented\b",
                "I would implement",
                text,
                count=2,
                flags=re.I,
            )
            text2 = re.sub(
                r"\bI\s+conducted\b",
                "I would conduct",
                text2,
                count=2,
                flags=re.I,
            )
            text2 = re.sub(
                r"\bI\s+led\b",
                "I would lead",
                text2,
                count=2,
                flags=re.I,
            )
            if text2 != text:
                violations.append(
                    GroundingViolation(
                        kind="personal_without_evidence",
                        span="personal past tense",
                        reason="Hypothetical mode demoted personal claims",
                        replacement="would …",
                    )
                )
                text = text2

    # Cleanup whitespace
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = text.strip()

    return GroundingResult(
        text=text,
        mode=mode,
        violations=violations,
        modified=bool(violations) or text != (answer or "").strip(),
    )


def _scrub_clause_containing(text: str, span: str) -> str:
    """Remove the sentence containing span when replacement is empty."""
    if not span or span not in text:
        return text
    # Sentence split (simple)
    parts = re.split(r"(?<=[.!?])\s+", text)
    kept = [p for p in parts if span not in p]
    if len(kept) == len(parts):
        return text.replace(span, "", 1)
    return " ".join(kept).strip()


def detect_stream_violations(
    partial: str,
    bundle: EvidenceBundle,
) -> list[GroundingViolation]:
    """Fast check for mid-stream numbers not in allowlist (Layer 2)."""
    violations: list[GroundingViolation] = []
    allowed_pct = bundle.allowed_pct_values()
    for m in re.finditer(
        r"from\s+\d+\s*days?\s+to\s+\d+\s*days?", partial or "", re.I
    ):
        # only flag if no baseline/final in evidence
        has_bf = any(
            mf.baseline is not None and mf.final_value is not None
            for mf in bundle.metrics
            if mf.approved
        )
        if not has_bf:
            violations.append(
                GroundingViolation(
                    kind="invented_baseline_final",
                    span=m.group(0),
                    reason="Streaming invented day counts",
                    replacement="",
                )
            )
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*%", partial or ""):
        val = float(m.group(1))
        if allowed_pct and not any(abs(val - a) < 0.05 for a in allowed_pct):
            # only flag clear personal metric context nearby
            start = max(0, m.start() - 30)
            ctx = (partial or "")[start : m.end() + 10].lower()
            if re.search(r"discrepanc|reduced|improved|error|close", ctx):
                violations.append(
                    GroundingViolation(
                        kind="unsupported_percentage",
                        span=m.group(0),
                        reason=f"{val}% not allowed",
                        replacement="",
                    )
                )
    return violations


def stage_a_hook_from_evidence(
    question: str,
    bundle: EvidenceBundle,
    *,
    mode: str = "star",
) -> str:
    """
    Immediate speakable Stage-A answer (40–80 words) from evidence only.
    Never invents metrics. Used for first paint when outline is too generic.
    """
    ans_mode = classify_answer_mode(question, bundle)
    rel = select_relevant_evidence(bundle, question, max_facts=4)
    metric_line = ""
    for m in rel.metrics:
        if m.approved and m.unit == "%":
            # Use only the percentage form
            metric_line = f"by {m.value:g}%"
            # Prefer source phrasing if short
            if "month-end" in m.source_text.lower() or "close" in m.source_text.lower():
                metric_line = f"month-end close time by {m.value:g}%"
            break

    action_bits = []
    for f in rel.facts:
        if f.fact_type in ("action", "outcome"):
            # Pull standardization / automation keywords if present
            low = f.normalized_fact.lower()
            if "reconcil" in low or "automat" in low or "standard" in low:
                action_bits.append(f.normalized_fact[:120])
            elif len(action_bits) < 1:
                action_bits.append(f.normalized_fact[:120])
        if len(action_bits) >= 2:
            break

    if ans_mode in ("verified_experience", "partially_supported") and (
        metric_line or action_bits
    ):
        act = ""
        if action_bits:
            # Compress to key verbs
            joined = " ".join(action_bits).lower()
            bits = []
            if "standard" in joined or "reconcil" in joined:
                bits.append("standardizing reconciliation")
            if "automat" in joined:
                bits.append("automation")
            act = " and ".join(bits) if bits else "process discipline"
        else:
            act = "process discipline"

        if metric_line:
            hook = (
                f"Hook: I helped reduce {metric_line} through {act}.\n"
                f"Proof: The work stayed inside the close controls we already owned — "
                f"no invented day counts, only the measured improvement on the resume.\n"
                f"Close: Happy to walk the before/after controls if useful."
            )
        else:
            hook = (
                f"Hook: I improved a painful close process by {act}.\n"
                f"Proof: {action_bits[0][:160] if action_bits else 'I focused on the bottleneck I owned.'}\n"
                f"Close: I can expand on the controls if you want detail."
            )
        return hook

    # Hypothetical / knowledge Stage A
    q_short = (question or "").strip()[:100]
    return (
        f"Hook: I would approach this by clarifying the bottleneck, "
        f"standardizing the critical path, and measuring one outcome.\n"
        f"Proof: Start with the failure mode in the process, pick the highest-leverage "
        f"control, and validate with a before/after metric you can defend.\n"
        f"Close: I can tailor this to your environment — re: {q_short}."
    )


# ---------------------------------------------------------------------------
# Session-level cache helpers
# ---------------------------------------------------------------------------

_BUNDLE_CACHE: dict[str, EvidenceBundle] = {}


def get_or_build_bundle(
    *,
    session_key: str = "default",
    resume_text: str = "",
    job_description: str = "",
    role: str = "",
    stories: Optional[list[str]] = None,
    force: bool = False,
) -> EvidenceBundle:
    stories = stories or []
    parts = [role or "", job_description or "", resume_text or "", "|".join(stories)]
    h = materials_hash("\n".join(parts))
    cached = _BUNDLE_CACHE.get(session_key)
    if not force and cached and cached.materials_hash == h:
        return cached
    bundle = extract_facts_from_materials(
        resume_text=resume_text,
        job_description=job_description,
        role=role,
        stories=stories,
    )
    _BUNDLE_CACHE[session_key] = bundle
    return bundle


def clear_bundle_cache(session_key: Optional[str] = None) -> None:
    if session_key is None:
        _BUNDLE_CACHE.clear()
    else:
        _BUNDLE_CACHE.pop(session_key, None)


def bundle_from_session_pack(job_context: str = "") -> EvidenceBundle:
    """Build/load evidence from active session_context pack."""
    try:
        from session_context import get_pack, get_session_id, interview_materials

        pack = get_pack()
        m = interview_materials(job_context=job_context)
        return get_or_build_bundle(
            session_key=get_session_id(),
            resume_text=m.get("resume_text") or pack.resume_text,
            job_description=m.get("job_description") or pack.job_description,
            role=m.get("role") or pack.role or job_context,
            stories=list(pack.stories or []),
        )
    except Exception:
        return extract_facts_from_materials(role=job_context or "")

