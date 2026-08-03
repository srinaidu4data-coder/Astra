#!/usr/bin/env python3
"""
Common-sense domain lock for live interview answers.

Problem this solves
-------------------
Answers (and the speak UI) were freely mixing unrelated domains — e.g. ML/robotics
jargon when the question is SAP ATTP — and surfacing psych/math "skills" theater
while the candidate is trying to read a speakable answer.

Rules (domain-agnostic)
-----------------------
1. Infer the *active* domain only from the question + job/resume context.
2. Never inject a second domain's jargon into the answer.
3. Drop RAG chunks that belong to a different domain family.
4. STT vocabulary bias follows the active domain only (no kitchen-sink ML+FICO).
5. Post-check answers; strip or flag hard cross-domain contamination.

No hard-coded "always answer as X role" — only *block cross-domain mischief*.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# Domain families + lexicons (signal words for detection / contamination)
# ---------------------------------------------------------------------------

# Each family: detection terms (any domain) + exclusive terms (strong identity)
_DOMAIN_LEXICONS: dict[str, dict[str, frozenset[str]]] = {
    "sap_attp": {
        "detect": frozenset(
            {
                "attp",
                "serialization",
                "serialisation",
                "epcis",
                "gs1",
                "gtin",
                "gln",
                "sscc",
                "sgtin",
                "dscsa",
                "fmd",
                "emvs",
                "mah",
                "cmo",
                "3pl",
                "three pl",
                "commissioning",
                "aggregation",
                "deaggregation",
                "decommissioning",
                "tracelink",
                "vrs",
                "saleable returns",
                "datamatrix",
                "track and trace",
                "track-and-trace",
                "serial number",
            }
        ),
        "exclusive": frozenset(
            {
                "attp",
                "epcis",
                "dscsa",
                "emvs",
                "sscc",
                "sgtin",
                "tracelink",
                "saleable returns",
            }
        ),
    },
    "sap_fico": {
        "detect": frozenset(
            {
                "fico",
                "controlling",
                "cost center",
                "profit center",
                "gl account",
                "general ledger",
                "asset accounting",
                "accounts payable",
                "accounts receivable",
                "copa",
                "vertex",
                "o series",
                "tax engine",
                "new gl",
                "document splitting",
            }
        ),
        "exclusive": frozenset(
            {"fico", "copa", "vertex o", "document splitting", "new gl"}
        ),
    },
    "sap_general": {
        "detect": frozenset(
            {
                "sap",
                "s/4hana",
                "s4hana",
                "s/4",
                "rise with sap",
                "idoc",
                "ale",
                "aif",
                "ewm",
                "mm module",
                "sd module",
                "boomi",
                "cpi",
                "pi/po",
                "gamp",
                "21 cfr",
                "part 11",
            }
        ),
        "exclusive": frozenset({"s/4hana", "rise with sap", "aif", "gamp 5"}),
    },
    "ml_ai": {
        "detect": frozenset(
            {
                "machine learning",
                "deep learning",
                "neural network",
                "neural net",
                "gradient descent",
                "backpropagation",
                "overfitting",
                "underfitting",
                "pytorch",
                "tensorflow",
                "sklearn",
                "scikit-learn",
                "xgboost",
                "transformer model",
                "llm fine-tun",
                "embedding model",
                "feature engineering",
                "hyperparameter",
                "cross validation",
                "cross-validation",
                "confusion matrix",
                "precision recall",
                "f1 score",
                "relu",
                "softmax layer",
                "cnn",
                "rnn",
                "lstm",
                "gpu training",
                "mlops",
                "model training",
                "supervised learning",
                "unsupervised learning",
                "reinforcement learning",
            }
        ),
        "exclusive": frozenset(
            {
                "pytorch",
                "tensorflow",
                "gradient descent",
                "backpropagation",
                "overfitting",
                "xgboost",
                "sklearn",
                "scikit-learn",
                "hyperparameter",
                "mlops",
            }
        ),
    },
    "robotics": {
        "detect": frozenset(
            {
                "ros2",
                "ros 2",
                "robot operating system",
                "slam",
                "odometry",
                "lidar",
                "kalman filter",
                "extended kalman",
                "ukf",
                "tf2",
                "urdf",
                "moveit",
                "path planning",
                "a* algorithm",
                "gnc",
                "imu fusion",
                "base_link",
                "point cloud",
            }
        ),
        "exclusive": frozenset(
            {"ros2", "ros 2", "slam", "moveit", "urdf", "tf2", "base_link"}
        ),
    },
    "software": {
        "detect": frozenset(
            {
                "microservices",
                "kubernetes",
                "k8s",
                "distributed system",
                "rest api",
                "graphql",
                "postgres",
                "redis cache",
                "message queue",
                "kafka",
                "cicd",
                "ci/cd",
                "load balancer",
                "p99 latency",
                "horizontal scaling",
            }
        ),
        "exclusive": frozenset(
            {"kubernetes", "kafka", "graphql", "microservices"}
        ),
    },
}

# Soft ML theater / psych jargon that must never appear as "skills" in speakable
# answers (UI labels are stripped separately on the frontend).
_PSYCH_ML_THEATER = frozenset(
    {
        "softmax attention",
        "zipf budget",
        "von restorff",
        "serial-position curve",
        "cognitive load theory",
        "implementation intention",
        "peak-end rule",
        "primacy effect",
        "recency effect",
        "psych-math",
        "psych math",
        "attention temperature",
    }
)

# Friendly labels for prompts
_DOMAIN_LABELS = {
    "sap_attp": "SAP ATTP / pharmaceutical track-and-trace serialization",
    "sap_fico": "SAP Finance / FICO / tax",
    "sap_general": "SAP techno-functional / enterprise ERP",
    "ml_ai": "machine learning / AI engineering",
    "robotics": "robotics / ROS / autonomy",
    "software": "software engineering / systems",
    "general": "general professional (use only the question + job context)",
}


@dataclass
class DomainLock:
    """Resolved active domain for one question turn."""

    domain: str = "general"
    confidence: float = 0.0
    signals: list[str] = field(default_factory=list)
    secondary: list[str] = field(default_factory=list)
    label: str = "general professional (use only the question + job context)"

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "confidence": round(self.confidence, 3),
            "signals": self.signals[:12],
            "secondary": self.secondary[:6],
            "label": self.label,
        }


def _norm(text: str) -> str:
    t = (text or "").lower()
    t = t.replace("a t t p", "attp").replace("e p c i s", "epcis")
    t = t.replace("d s c s a", "dscsa").replace("g t i n", "gtin")
    t = t.replace("g l n", "gln").replace("s s c c", "sscc")
    t = t.replace("three p l", "3pl").replace("3 p l", "3pl")
    t = re.sub(r"\s+", " ", t)
    return t


def _score_domain(blob: str) -> dict[str, tuple[float, list[str]]]:
    """Return domain → (score, hit terms)."""
    out: dict[str, tuple[float, list[str]]] = {}
    for dom, packs in _DOMAIN_LEXICONS.items():
        hits: list[str] = []
        score = 0.0
        for term in packs["detect"]:
            if term in blob:
                hits.append(term)
                # Longer / exclusive terms weigh more
                w = 1.0 + min(2.0, len(term) / 12.0)
                if term in packs["exclusive"]:
                    w += 2.5
                score += w
        if hits:
            out[dom] = (score, hits)
    return out


def domains_compatible(a: str, b: str) -> bool:
    """True when two domain ids can share one answer without cross-wiring."""
    if not a or not b:
        return True
    if a == b:
        return True
    if a == "general" or b == "general":
        return True
    # SAP family is compatible with itself (ATTP/FICO/general)
    if a.startswith("sap_") and b.startswith("sap_"):
        # ATTP vs FICO are different product families — not compatible
        if {a, b} == {"sap_attp", "sap_fico"}:
            return False
        return True
    return False


def infer_domain(
    question: str = "",
    job_context: str = "",
    resume_or_pack: str = "",
) -> DomainLock:
    """
    Infer the active interview domain from question + role context only.

    Question signals dominate. Pack/JD must not re-label a clear off-topic
    question as SAP ATTP (or any other stored role domain).
    """
    q = _norm(question)
    job = _norm(job_context)
    pack = _norm(resume_or_pack)

    q_scores = _score_domain(q) if q.strip() else {}
    # Strong question-only signal → ignore pack/job for domain choice
    if q_scores:
        q_ranked = sorted(q_scores.items(), key=lambda x: -x[1][0])
        q_top_dom, (q_top_sc, q_hits) = q_ranked[0]
        q_second = q_ranked[1][1][0] if len(q_ranked) > 1 else 0.0
        exclusive_hit = any(
            t in _DOMAIN_LEXICONS.get(q_top_dom, {}).get("exclusive", frozenset())
            for t in q_hits
        )
        # Clear topical question (e.g. ML terms) wins over stored ATTP pack
        if exclusive_hit or (q_top_sc >= 2.5 and q_top_sc >= q_second + 1.0):
            conf = min(1.0, q_top_sc / 6.0)
            if q_top_dom == "sap_general":
                for specialized in ("sap_attp", "sap_fico"):
                    if specialized in q_scores and q_scores[specialized][0] >= q_top_sc * 0.45:
                        q_top_dom = specialized
                        q_hits = q_scores[specialized][1]
                        break
            return DomainLock(
                domain=q_top_dom,
                confidence=conf,
                signals=q_hits[:12],
                secondary=[d for d, _ in q_ranked[1:4]],
                label=_DOMAIN_LABELS.get(q_top_dom, _DOMAIN_LABELS["general"]),
            )

    # Weight: question 1.2, job 0.75, pack 0.35 (pack is weakest — bootstrap residue)
    combined_scores: dict[str, float] = {}
    all_hits: dict[str, list[str]] = {}

    for weight, blob in ((1.2, q), (0.75, job), (0.35, pack)):
        if not blob.strip():
            continue
        for dom, (sc, hits) in _score_domain(blob).items():
            combined_scores[dom] = combined_scores.get(dom, 0.0) + sc * weight
            all_hits.setdefault(dom, [])
            for h in hits:
                if h not in all_hits[dom]:
                    all_hits[dom].append(h)

    if not combined_scores:
        return DomainLock(domain="general", confidence=0.0, label=_DOMAIN_LABELS["general"])

    ranked = sorted(combined_scores.items(), key=lambda x: -x[1])
    top_dom, top_sc = ranked[0]
    second_sc = ranked[1][1] if len(ranked) > 1 else 0.0
    # Confidence: absolute signal + separation from runner-up
    conf = min(1.0, top_sc / 8.0) * (0.55 + 0.45 * min(1.0, (top_sc - second_sc + 0.5) / 4.0))

    # Prefer specialized SAP family over generic sap when both fire
    if top_dom == "sap_general":
        for specialized in ("sap_attp", "sap_fico"):
            if specialized in combined_scores and combined_scores[specialized] >= top_sc * 0.45:
                top_dom = specialized
                top_sc = combined_scores[specialized]
                break

    secondary = [d for d, _ in ranked[1:4] if combined_scores[d] >= top_sc * 0.35]
    return DomainLock(
        domain=top_dom,
        confidence=conf,
        signals=all_hits.get(top_dom, [])[:12],
        secondary=secondary,
        label=_DOMAIN_LABELS.get(top_dom, _DOMAIN_LABELS["general"]),
    )


def _foreign_exclusive_hits(text: str, active: str) -> list[tuple[str, str]]:
    """Return (domain, term) for exclusive terms from domains other than active."""
    blob = _norm(text)
    bad: list[tuple[str, str]] = []
    for dom, packs in _DOMAIN_LEXICONS.items():
        if dom == active:
            continue
        # sap_general is soft when active is sap_attp/fico
        if active.startswith("sap_") and dom == "sap_general":
            continue
        if active == "sap_general" and dom.startswith("sap_"):
            continue
        for term in packs["exclusive"]:
            if term in blob:
                bad.append((dom, term))
    for term in _PSYCH_ML_THEATER:
        if term in blob:
            bad.append(("psych_theater", term))
    return bad


def contamination_report(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> dict[str, Any]:
    """Analyze whether an answer wandered into a foreign domain."""
    lock = lock or infer_domain(question, job_context)
    if lock.domain == "general" or lock.confidence < 0.28:
        # Low lock confidence → only flag psych theater
        theater = [t for t in _PSYCH_ML_THEATER if t in _norm(answer)]
        return {
            "ok": not theater,
            "lock": lock.to_dict(),
            "foreign": [("psych_theater", t) for t in theater],
            "severity_hits": 0,
            "severity_hits": len(theater),
        }

    foreign = _foreign_exclusive_hits(answer, lock.domain)
    # Count how many active-domain exclusive/detect terms appear (grounding)
    blob = _norm(answer)
    packs = _DOMAIN_LEXICONS.get(lock.domain, {})
    native = [t for t in packs.get("detect", frozenset()) if t in blob]

    return {
        "ok": len(foreign) == 0,
        "lock": lock.to_dict(),
        "foreign": foreign,
        "native_hits": len(native),
        "foreign_hits": len(foreign),
    }


def sanitize_answer(
    answer: str,
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> str:
    """
    Soft cleanup: strip psych-theater phrases and obvious off-domain asides.

    Does not rewrite the whole answer — only removes known mischief patterns.
    """
    text = (answer or "").strip()
    if not text:
        return text
    lock = lock or infer_domain(question, job_context)

    # Drop whole lines that are pure psych/ML theater
    cleaned_lines: list[str] = []
    for line in text.splitlines():
        low = _norm(line)
        if any(t in low for t in _PSYCH_ML_THEATER):
            continue
        if re.search(
            r"\b(softmax|zipf budget|von restorff|psych-?math|serial.?position)\b",
            low,
        ):
            continue
        cleaned_lines.append(line)
    text = "\n".join(cleaned_lines).strip() or answer.strip()

    # If high-confidence domain lock and answer is pure foreign exclusive spam, append guard note for regen paths
    report = contamination_report(
        text, question=question, job_context=job_context, lock=lock
    )
    if (
        lock.confidence >= 0.45
        and report["foreign_hits"] >= 2
        and report["native_hits"] == 0
        and len(text.split()) > 40
    ):
        # Prefix a silent internal marker is useless in TTS; strip foreign exclusive tokens as last resort
        for _dom, term in report["foreign"]:
            # Only remove multi-word or highly specific terms to avoid nuking common English
            if len(term) >= 6:
                text = re.sub(re.escape(term), "", text, flags=re.I)
        text = re.sub(r"\s{2,}", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

    return text


def filter_context_chunks(
    chunks: list[dict],
    *,
    question: str = "",
    job_context: str = "",
    lock: Optional[DomainLock] = None,
) -> list[dict]:
    """Drop RAG chunks that are clearly from a different domain family."""
    if not chunks:
        return []
    lock = lock or infer_domain(question, job_context)
    if lock.domain == "general" or lock.confidence < 0.3:
        # Still drop pure robotics/ML when question is not that domain
        q_lock = infer_domain(question, "", "")
        if q_lock.domain in ("ml_ai", "robotics") and q_lock.confidence >= 0.35:
            lock = q_lock
        else:
            # Filter out chunks that are ONLY foreign exclusive domains
            kept: list[dict] = []
            for c in chunks:
                t = c.get("text") or c.get("document") or ""
                blob = _norm(t)
                exclusive_hits = []
                for dom, packs in _DOMAIN_LEXICONS.items():
                    for term in packs["exclusive"]:
                        if term in blob:
                            exclusive_hits.append(dom)
                            break
                # Keep if no exclusive hit, or hits match question soft domain
                if not exclusive_hits:
                    kept.append(c)
                    continue
                # Drop robotics/ml knowledge when Q is not those domains
                if all(d in ("ml_ai", "robotics") for d in exclusive_hits):
                    continue
                kept.append(c)
            return kept

    kept = []
    for c in chunks:
        t = c.get("text") or c.get("document") or ""
        blob = _norm(t)
        # Chunk must not be dominated by foreign exclusive terms
        foreign = _foreign_exclusive_hits(blob, lock.domain)
        packs = _DOMAIN_LEXICONS.get(lock.domain, {})
        native = sum(1 for term in packs.get("detect", frozenset()) if term in blob)
        if foreign and native == 0:
            continue
        if len(foreign) >= 2 and native < len(foreign):
            continue
        kept.append(c)
    return kept


def stt_initial_prompt(
    job_context: str = "",
    resume_or_pack: str = "",
    question_hint: str = "",
) -> str:
    """
    Domain-scoped Whisper initial_prompt. Never kitchen-sink ML+FICO+robotics.
    """
    lock = infer_domain(question_hint, job_context, resume_or_pack)
    prompts = {
        "sap_attp": (
            "Interview about SAP ATTP serialization, EPCIS, GS1, GTIN, GLN, SSCC, "
            "DSCSA, EU FMD, MAH, CMO, 3PL, commissioning, aggregation, GAMP 5."
        ),
        "sap_fico": (
            "Interview about SAP S/4HANA Finance, FICO, general ledger, cost centers, "
            "profit centers, controlling, Vertex tax, accounts payable and receivable."
        ),
        "sap_general": (
            "Interview about SAP consulting, S/4HANA, integration, IDoc, AIF, "
            "master data, validation, and business process design."
        ),
        "ml_ai": (
            "Interview about machine learning, model training, evaluation metrics, "
            "and ML system design. Use standard ML vocabulary only when asked."
        ),
        "robotics": (
            "Interview about robotics, ROS 2, state estimation, planning, and controls."
        ),
        "software": (
            "Interview about software engineering, system design, APIs, and reliability."
        ),
        "general": (
            "Professional job interview. Transcribe the interviewer's question accurately. "
            "Do not invent technical jargon from unrelated fields."
        ),
    }
    return prompts.get(lock.domain, prompts["general"])[:224]


def prompt_guardrails(lock: DomainLock) -> str:
    """Block of rules injected into the answer LLM user prompt."""
    if lock.domain == "general" or lock.confidence < 0.25:
        return (
            "COMMON SENSE DOMAIN LOCK:\n"
            "- Answer ONLY the topic in the interviewer's question.\n"
            "- Do NOT drag in machine learning, robotics, random SAP modules, "
            "SAP ATTP/EPCIS/serialization, FICO, or other domains that were not asked.\n"
            "- If Role/context is for a different job than the question, IGNORE that Role "
            "and answer the question on its own terms.\n"
            "- Do NOT mention psychology techniques, softmax, Zipf, peak-end, "
            "or coaching meta-commentary — only speakable interview content.\n"
            "- Use jargon only when it appears in the question or a matching Role."
        )

    foreign_names = {
        "sap_attp": "ML, robotics, pure FICO tax deep-dives, or unrelated cloud slang",
        "sap_fico": "ML, robotics, ATTP serialization, or unrelated SWE frameworks",
        "sap_general": "ML model training, robotics/ROS, or non-SAP consumer app stacks",
        "ml_ai": "SAP modules, robotics hardware stacks, or unrelated ERP jargon",
        "robotics": "ML interview clichés, SAP, or web-app stacks unless asked",
        "software": "ML paper jargon, SAP modules, or robotics unless asked",
    }
    ban = foreign_names.get(lock.domain, "unrelated domains")
    return (
        f"COMMON SENSE DOMAIN LOCK (active: {lock.label}; confidence={lock.confidence:.2f}):\n"
        f"- Stay strictly inside {lock.label}.\n"
        f"- FORBIDDEN unless the question explicitly asks: {ban}.\n"
        "- Do NOT mention psychology techniques, softmax, Zipf, von Restorff, "
        "peak-end, primacy/recency labels, or 'psych-math' — those are UI internals, "
        "not interview answers.\n"
        "- Do NOT switch product families mid-answer (e.g. answering ATTP with FICO "
        "or ML with Kubernetes fluff).\n"
        "- Prefer precise terms from the question + Role context only.\n"
        f"- Domain signals seen: {', '.join(lock.signals[:8]) or 'context-derived'}."
    )


def system_suffix(lock: DomainLock) -> str:
    """Short suffix appended to system prompts."""
    if lock.domain == "general":
        return (
            " Stay on the asked topic only. Never inject ML, robotics, or other "
            "domains. No psych/meta coaching labels in the answer body."
        )
    return (
        f" Active domain: {lock.label}. Answer only in that domain. "
        "Never cross-wire unrelated skills. No psych/meta labels in the answer body."
    )


def resolve_pack_blob() -> str:
    """Best-effort resume/JD text from session pack for domain inference."""
    try:
        from session_context import format_for_prompt, get_pack

        pack = get_pack()
        bits = [
            pack.role,
            pack.company,
            pack.job_description[:800] if pack.job_description else "",
            pack.resume_text[:800] if pack.resume_text else "",
            " ".join(pack.keywords[:20]),
        ]
        blob = " ".join(b for b in bits if b)
        if blob.strip():
            return blob
        return format_for_prompt(1200)
    except Exception:
        return ""


def lock_for_turn(
    question: str = "",
    job_context: str = "",
    extra_context: str = "",
) -> DomainLock:
    """
    One-call helper used by answer_engine / rag / STT.

    Pack context is only attached when the question is compatible with the
    stored role/JD — prevents leftover ATTP bootstrap from locking ML questions.
    """
    q_only = infer_domain(question, "", "")
    pack = extra_context if extra_context is not None and extra_context != "" else resolve_pack_blob()
    if not pack:
        return infer_domain(question, job_context, "")

    pack_lock = infer_domain("", job_context, pack)
    if (
        q_only.domain not in ("general",)
        and q_only.confidence >= 0.28
        and pack_lock.domain not in ("general",)
        and not domains_compatible(q_only.domain, pack_lock.domain)
    ):
        # Off-topic for stored pack: answer the question domain only
        return q_only

    return infer_domain(question, job_context, pack)
