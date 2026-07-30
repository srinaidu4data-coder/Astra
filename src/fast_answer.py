"""
Ultra-low-latency interview answer stack.

Research-backed techniques combined for sub-second first paint:

1. Exact LRU cache — classic memoization (O(1) hit)
2. Character n-gram cosine similarity — local near-duplicate retrieval
   (no embedding API round-trip; related to string kernels / bag-of-n-grams IR)
3. SimHash-style fingerprint banding — Charikar (2002) near-dup detection
4. Pattern-route templates — anytime algorithm: always return a usable answer
   immediately, refine if LLM arrives (Horvitz anytime systems / cascade models)
5. Speculative cascade — small draft first (template), optional stronger stream
   (speculative / draft-then-verify style serving literature)
6. Single-shot nano completion — minimal prefill, low max_tokens, connection reuse

The goal is not fake math theater: first *usable* answer <100ms from cache/template;
LLM stream upgrades quality when the network allows.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Generator, Optional

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CACHE_MAX = int(os.environ.get("ASTRA_ANSWER_CACHE_SIZE", "256") or "256")
# Cosine over char n-grams (local semantic-ish cache). 0.88 ≈ paraphrase-friendly.
NGRAM_SIM_THRESHOLD = float(os.environ.get("ASTRA_CACHE_SIM", "0.88") or "0.88")
# SimHash Hamming distance threshold (bits that may differ on 64-bit hash)
SIMHASH_MAX_DIST = int(os.environ.get("ASTRA_SIMHASH_DIST", "8") or "8")
ENABLE_TEMPLATE_FIRST = os.environ.get("ASTRA_TEMPLATE_FIRST", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
ENABLE_LLM_REFINE = os.environ.get("ASTRA_LLM_REFINE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Text normalization + fingerprints
# ---------------------------------------------------------------------------

_STOP = frozenset(
    "a an the and or but if then to of in on for with about as at by from is are was were be been being i you we they it this that what how why when where which tell me your can could would should please".split()
)


def normalize_question(q: str) -> str:
    t = (q or "").lower().strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s\-\+%]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def question_key(q: str, mode: str = "star", job: str = "") -> str:
    base = normalize_question(q)
    job_n = re.sub(r"\s+", " ", (job or "").lower())[:60]
    return f"{mode}|{job_n}|{base}"


def _tokens(q: str) -> list[str]:
    return [w for w in normalize_question(q).split() if w and w not in _STOP]


def _char_ngrams(s: str, n: int = 3) -> dict[str, int]:
    s = f"  {normalize_question(s)}  "
    counts: dict[str, int] = {}
    for i in range(max(0, len(s) - n + 1)):
        g = s[i : i + n]
        counts[g] = counts.get(g, 0) + 1
    return counts


def cosine_ngram(a: str, b: str, n: int = 3) -> float:
    """Cosine similarity of character n-gram TF vectors (local IR kernel)."""
    va, vb = _char_ngrams(a, n), _char_ngrams(b, n)
    if not va or not vb:
        return 0.0
    # Dot over intersection
    keys = set(va) & set(vb)
    if not keys:
        return 0.0
    dot = sum(va[k] * vb[k] for k in keys)
    na = math.sqrt(sum(v * v for v in va.values()))
    nb = math.sqrt(sum(v * v for v in vb.values()))
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (na * nb)


def simhash64(text: str) -> int:
    """
    64-bit SimHash (Charikar 2002): weighted feature hashing over tokens + n-grams.
    Hamming distance ≈ semantic near-duplication for short questions.
    """
    feats: dict[str, float] = {}
    for t in _tokens(text):
        feats[f"w:{t}"] = feats.get(f"w:{t}", 0.0) + 1.0
    for g, c in _char_ngrams(text, 3).items():
        feats[f"g:{g}"] = feats.get(f"g:{g}", 0.0) + float(c)
    if not feats:
        return 0
    bits = [0.0] * 64
    for feat, w in feats.items():
        h = int(hashlib.md5(feat.encode("utf-8")).hexdigest()[:16], 16)
        for i in range(64):
            if h & (1 << i):
                bits[i] += w
            else:
                bits[i] -= w
    out = 0
    for i, v in enumerate(bits):
        if v >= 0:
            out |= 1 << i
    return out


def hamming64(a: int, b: int) -> int:
    return (a ^ b).bit_count()


# ---------------------------------------------------------------------------
# LRU exact cache + approximate store
# ---------------------------------------------------------------------------


class _AnswerCache:
    def __init__(self, maxsize: int = CACHE_MAX) -> None:
        self.maxsize = max(16, maxsize)
        self._exact: OrderedDict[str, str] = OrderedDict()
        # approx: list of (norm_q, simhash, answer, mode)
        self._approx: list[tuple[str, int, str, str]] = []
        self._approx_max = self.maxsize

    def get_exact(self, key: str) -> Optional[str]:
        with _lock:
            if key not in self._exact:
                return None
            self._exact.move_to_end(key)
            return self._exact[key]

    def put(self, key: str, answer: str, question: str, mode: str) -> None:
        ans = (answer or "").strip()
        if not ans or not key:
            return
        with _lock:
            self._exact[key] = ans
            self._exact.move_to_end(key)
            while len(self._exact) > self.maxsize:
                self._exact.popitem(last=False)
            nq = normalize_question(question)
            sh = simhash64(nq)
            self._approx.append((nq, sh, ans, mode))
            if len(self._approx) > self._approx_max:
                self._approx = self._approx[-self._approx_max :]

    def get_similar(self, question: str, mode: str) -> Optional[tuple[str, float, str]]:
        """Return (answer, score, method) if near-dup found."""
        nq = normalize_question(question)
        if len(nq) < 8:
            return None
        sh = simhash64(nq)
        best: Optional[tuple[str, float, str]] = None
        with _lock:
            # Reverse: newest first
            for prev_q, prev_sh, ans, m in reversed(self._approx):
                if m != mode:
                    continue
                # Fast band: SimHash
                dist = hamming64(sh, prev_sh)
                if dist <= SIMHASH_MAX_DIST:
                    # Confirm with n-gram cosine
                    sim = cosine_ngram(nq, prev_q)
                    if sim >= NGRAM_SIM_THRESHOLD:
                        score = sim * (1.0 - dist / 64.0)
                        if best is None or score > best[1]:
                            best = (ans, score, f"simhash+ngram d={dist} cos={sim:.2f}")
                elif dist <= SIMHASH_MAX_DIST + 4:
                    sim = cosine_ngram(nq, prev_q)
                    if sim >= min(0.93, NGRAM_SIM_THRESHOLD + 0.04):
                        score = sim * 0.9
                        if best is None or score > best[1]:
                            best = (ans, score, f"ngram cos={sim:.2f}")
        return best


_CACHE = _AnswerCache()


# ---------------------------------------------------------------------------
# Pattern router + anytime templates (instant draft)
# ---------------------------------------------------------------------------

# (regex, type_id, weight)
_PATTERNS: list[tuple[re.Pattern[str], str, float]] = [
    (re.compile(r"\b(tell me about a time|describe a (time|situation)|give an example|walk me through a time)\b", re.I), "behavioral", 1.0),
    (re.compile(r"\b(conflict|disagreement|pushback|difficult (stakeholder|coworker|manager))\b", re.I), "conflict", 1.1),
    (re.compile(r"\b(fail|mistake|went wrong|postmortem|incident|outage)\b", re.I), "failure", 1.0),
    (re.compile(r"\b(lead|mentor|coached|managed|ownership|influence without authority)\b", re.I), "leadership", 1.0),
    (re.compile(r"\b(design|architect|scale|system design|distributed|high.?availability)\b", re.I), "system_design", 1.2),
    (re.compile(r"\b(latency|throughput|qps|p99|performance|optimize|bottleneck)\b", re.I), "performance", 1.1),
    (re.compile(r"\b(debug|troubleshoot|root cause|investigate|rca)\b", re.I), "debug", 1.1),
    (re.compile(r"\b(code|algorithm|complexity|leetcode|implement|data structure)\b", re.I), "coding", 1.0),
    (re.compile(r"\b(trade.?off|pros and cons|compare|difference between|vs\.?)\b", re.I), "tradeoff", 1.0),
    (re.compile(r"\b(strength|weakness|greatest strength|improve)\b", re.I), "self", 0.9),
    (re.compile(r"\b(why (this|our|the) (company|role|team)|why us)\b", re.I), "why_us", 0.9),
    (re.compile(r"\b(sap|fico|vertex|tax|erp|s/4)\b", re.I), "domain_sap", 1.2),
    (re.compile(r"\b(ml|model|training|inference|feature|llm|embedding)\b", re.I), "ml", 1.1),
    (re.compile(r"\b(api|microservice|kafka|queue|cache|redis|postgres|sql)\b", re.I), "backend", 1.0),
    (re.compile(r"\b(what is|explain|how does|how would you|how do you)\b", re.I), "explain", 0.8),
]


def classify_pattern(question: str) -> tuple[str, float]:
    """Return (pattern_id, confidence) via weighted regex vote."""
    q = question or ""
    scores: dict[str, float] = {}
    for rx, pid, w in _PATTERNS:
        if rx.search(q):
            scores[pid] = scores.get(pid, 0.0) + w
    if not scores:
        return "general", 0.4
    best = max(scores.items(), key=lambda x: x[1])
    total = sum(scores.values()) or 1.0
    return best[0], min(1.0, best[1] / total + 0.25)


def _job_bit(job_context: str) -> str:
    j = (job_context or "senior engineer").strip()
    return j[:70] if j else "senior engineer"


def template_answer(question: str, *, job_context: str = "", mode: str = "star") -> str:
    """
    Anytime draft: always produces a speakable structured answer in <1ms.
    Slot-fills role + pattern; no network.
    """
    role = _job_bit(job_context)
    pid, _ = classify_pattern(question)
    q_short = re.sub(r"\s+", " ", (question or "").strip())[:140]

    if mode == "shorter":
        return _template_shorter(pid, role, q_short)
    if mode == "code":
        return _template_code(pid, role, q_short)
    if mode == "technical":
        return _template_technical(pid, role, q_short)
    return _template_star(pid, role, q_short)


def _template_star(pid: str, role: str, q: str) -> str:
    bank = {
        "behavioral": (
            "I treat this as a ownership story with a measurable outcome.",
            "In a prior role as a {role}, a high-stakes delivery had a clear risk of missing a reliability or timeline bar.",
            "Success meant shipping without regressions, with clear SLOs and stakeholder trust.",
            "I framed the problem, instrumented the critical path, cut scope to the highest-leverage fix, aligned stakeholders on tradeoffs, and owned validation end-to-end.",
            "We hit the target with roughly 30–40% better signal on the key metric and zero sev-1 fallout in the following week.",
            "I default to mechanism + metrics over narratives when the interview pressure is on.",
        ),
        "conflict": (
            "I handle conflict by aligning on the user/system metric, not egos.",
            "As a {role}, I disagreed with a proposed approach that would have increased operational risk.",
            "The bar was a decision we could reverse cheaply with data within one cycle.",
            "I restated their goals, proposed a spike with success criteria, shared data, and offered a reversible path that protected both velocity and reliability.",
            "We chose the lower-risk path, shipped, and the metric moved the right way within two sprints.",
            "I keep disagreements technical and time-boxed.",
        ),
        "failure": (
            "I own failures with a blameless RCA and a permanent control.",
            "As a {role}, an incident hit customer-facing latency/error budgets.",
            "Success was restore service fast, then prevent class-of-bug recurrence.",
            "I led triage, mitigated blast radius, wrote the timeline, fixed the root cause, and added monitors + regression tests.",
            "MTTR dropped on the next similar event; we closed the action items within a week.",
            "I treat incidents as system design feedback.",
        ),
        "leadership": (
            "I lead by setting a crisp problem frame and unblocking others.",
            "As a {role}, the team needed direction under ambiguous requirements.",
            "Success meant a shared plan, clear owners, and a measurable milestone.",
            "I decomposed work, paired on the hardest interface, wrote the decision record, and removed cross-team blockers daily.",
            "We delivered the milestone with fewer handoff defects and higher review throughput.",
            "Influence without authority is mostly clarity + follow-through.",
        ),
        "system_design": (
            "I design for failure modes and measurable SLOs first.",
            "For a system like this, constraints are consistency, latency, and operability at scale.",
            "Success is p99 latency under budget, durable writes, and debuggable pipelines.",
            "I'd split read/write paths, use an idempotent queue for fanout, cache hot keys, and put explicit backpressure + retries with jitter on every dependency.",
            "I'd validate with load tests, chaos on dependency loss, and dashboards on queue lag and error rate.",
            "I'd call the biggest tradeoff early: consistency vs. fanout latency.",
        ),
        "performance": (
            "I optimize from measurement, not intuition.",
            "As a {role}, p99 latency or cost was over budget on a critical path.",
            "Success was a concrete reduction (e.g. 30–50% on the hot span) without correctness loss.",
            "I profiled end-to-end, fixed the top span (N+1, lock, GC, overfetch), added caching with TTL/invalidation, and gated the change behind metrics.",
            "p99 improved materially and the regression suite stayed green.",
            "I always keep a rollback and a before/after dashboard.",
        ),
        "debug": (
            "I debug with a hypothesis tree and evidence at each layer.",
            "As a {role}, production showed elevated errors or latency with incomplete symptoms.",
            "Success was a verified root cause and a durable fix, not a one-off reboot.",
            "I correlated logs/metrics/traces, bisected recent deploys, reproduced in staging, and landed a fix with a probe for early detection.",
            "Error rate returned to baseline; we added an alert on the precursor signal.",
            "I document the path so the next person is faster.",
        ),
        "coding": (
            "I start from invariants, complexity targets, and edge cases.",
            "For this problem, I'd clarify inputs/outputs and constraints first.",
            "Success is correct, testable code with known time/space bounds.",
            "I'd pick the simplest structure that hits the complexity bar, write tests for empty/dup/overflow cases, then tighten.",
            "I'd state Big-O honestly and call residual risks (concurrency, memory).",
            "I narrate tradeoffs while coding so the interviewer can steer.",
        ),
        "tradeoff": (
            "I frame tradeoffs as constraints on SLOs, cost, and operability.",
            "As a {role}, the decision hinged on two viable designs with different failure modes.",
            "Success was an explicit choice we could revisit with data.",
            "I listed axes (latency, consistency, cost, complexity), scored options, ran a short spike, and documented the decision.",
            "We picked the option that protected the user-facing SLO with reversible complexity.",
            "I avoid false dichotomies; sometimes a hybrid with a clear default wins.",
        ),
        "domain_sap": (
            "I ground SAP/tax answers in determination, postings, and controls.",
            "As a {role} around SAP FICO / Vertex-style tax, the issue was incorrect determination or reconciliation break.",
            "Success meant correct tax results, auditable postings, and clean reconciliation.",
            "I traced condition records / tax procedure, validated master data, fixed the determination path, and added recon checks.",
            "Exception rate dropped and audit samples passed.",
            "I always separate config root cause from transactional noise.",
        ),
        "ml": (
            "I treat ML systems as data + evaluation + serving, not just a model file.",
            "As a {role}, we needed better quality or latency on an inference path.",
            "Success was a lift on the offline metric that held online, within latency budget.",
            "I fixed labels/leakage, established a baseline, ran ablations, shipped behind a gate, and monitored drift + p99.",
            "We saw a clear metric lift with stable latency.",
            "I default to simple models until the eval says otherwise.",
        ),
        "backend": (
            "I design APIs and data paths for idempotency and backpressure.",
            "As a {role}, we needed a reliable service boundary under load.",
            "Success was correct contracts, safe retries, and operable dashboards.",
            "I defined schemas, made handlers idempotent, bounded queues, and added timeouts/retries with jitter.",
            "Error budgets stabilized and on-call noise dropped.",
            "I treat every dependency as unreliable until proven otherwise.",
        ),
        "explain": (
            "I explain mechanisms, then tradeoffs, then how I'd validate.",
            "In the context of a {role} interview, the core idea is the mechanism—not a slogan.",
            "A good answer shows when it works and when it fails.",
            "I'd define the concept, walk the data/control path, name failure modes, and give a concrete example.",
            "I'd close with how I'd measure correctness in production.",
            "I keep jargon precise and tied to the question.",
        ),
        "self": (
            "I pick strengths that map to the role's real work.",
            "As a {role}, my strength is turning ambiguous problems into measurable systems work.",
            "A growth edge is deliberate pacing under interview pressure.",
            "I show it with a short example: problem frame → mechanism → metric.",
            "Interviewers get signal from specificity, so I keep numbers and tradeoffs.",
            "I can go deeper on any section you want.",
        ),
        "why_us": (
            "I connect the company's problems to work I've already done.",
            "As a {role} candidate, I care about impact on systems users feel.",
            "Success is joining a team where my experience shortens the path to production value.",
            "I'd bring ownership on reliability, clear design writing, and fast iteration with metrics.",
            "I'm looking for a place where high standards and shipping coexist.",
            "Happy to map this to a concrete team problem you care about.",
        ),
        "general": (
            "I answer with a clear frame, a mechanism, and a metric.",
            "As a {role}, I treat interview questions as design problems with constraints.",
            "Success is a complete answer the interviewer can probe.",
            "I restate the goal, outline the approach, go deep on one mechanism, and name a tradeoff + validation plan.",
            "I leave a crisp close and invite a follow-up on the hardest part.",
            "I can expand any section with more technical depth.",
        ),
    }
    hook, sit, task, action, result, close = bank.get(pid, bank["general"])
    sit = sit.format(role=role)
    return (
        f"Hook: {hook}\n"
        f"Situation: {sit}\n"
        f"Task: {task}\n"
        f"Action: {action}\n"
        f"Result: {result}\n"
        f"Close: {close}\n"
        f"(Anchored to: {q})"
    )


def _template_shorter(pid: str, role: str, q: str) -> str:
    return (
        f"1) As a {role}, I'd reframe this around a measurable outcome.\n"
        f"2) Core mechanism: instrument → fix the top lever → validate.\n"
        f"3) Tradeoff: speed of ship vs. risk; I'd pick the reversible path.\n"
        f"4) Close: happy to go deeper on the critical path for: {q[:80]}"
    )


def _template_technical(pid: str, role: str, q: str) -> str:
    return (
        f"Hook: I'd answer this as a {role} with mechanism + failure modes.\n"
        f"Approach: define constraints (latency, correctness, cost), then the simplest design that hits them.\n"
        f"Mechanism: control path + data path, with explicit retries, timeouts, and idempotency.\n"
        f"Tradeoff: consistency vs. latency — pick based on user-visible SLO.\n"
        f"Close: validate with metrics and a rollback plan. (Q: {q[:90]})"
    )


def _template_code(pid: str, role: str, q: str) -> str:
    return (
        f"Approach: clarify I/O and constraints, choose the simplest structure meeting complexity, "
        f"then test edge cases. Role lens: {role}.\n"
        f"Code:\n"
        f"```text\n"
        f"// sketch: parse → validate → core loop/structure → return\n"
        f"// complexity: state Big-O; tests: empty, dup, overflow\n"
        f"```\n"
        f"Tradeoff: clarity first, micro-opts only if measured. (Q: {q[:80]})"
    )


# ---------------------------------------------------------------------------
# Public cascade API
# ---------------------------------------------------------------------------


def cache_lookup(
    question: str, *, mode: str = "star", job_context: str = ""
) -> Optional[tuple[str, str]]:
    """Return (answer, source) if cache hit."""
    key = question_key(question, mode, job_context)
    hit = _CACHE.get_exact(key)
    if hit:
        return hit, "exact_cache"
    sim = _CACHE.get_similar(question, mode)
    if sim:
        return sim[0], f"approx_cache:{sim[2]}"
    return None


def cache_store(question: str, answer: str, *, mode: str = "star", job_context: str = "") -> None:
    key = question_key(question, mode, job_context)
    _CACHE.put(key, answer, question, mode)


def instant_answer(
    question: str, *, job_context: str = "", mode: str = "star"
) -> tuple[str, str, float]:
    """
    Sub-millisecond path: cache or template.
    Returns (answer, source, elapsed_ms).
    """
    t0 = time.perf_counter()
    cached = cache_lookup(question, mode=mode, job_context=job_context)
    if cached:
        ans, src = cached
        return ans, src, (time.perf_counter() - t0) * 1000
    if ENABLE_TEMPLATE_FIRST:
        ans = template_answer(question, job_context=job_context, mode=mode)
        return ans, "template", (time.perf_counter() - t0) * 1000
    return "", "none", (time.perf_counter() - t0) * 1000


def iter_cascade_answer(
    question: str,
    *,
    job_context: str = "",
    tone: str = "confident",
    mode: str = "star",
    answer_model: Optional[str] = None,
    fallback_model: Optional[str] = None,
    user_answer_model: Optional[str] = None,
    user_fallback_model: Optional[str] = None,
    llm_streamer: Optional[Callable[..., Generator[str, None, None]]] = None,
) -> Generator[tuple[str, dict[str, Any]], None, None]:
    """
    Yields (text_so_far, meta) where meta includes:
      source, first_paint_ms, streaming, final

    Cascade order (anytime):
      1) exact/approx cache → full answer immediately
      2) template draft → immediate paint
      3) optional LLM stream upgrade (replaces draft when better/longer)
    """
    t0 = time.perf_counter()
    mode = (mode or "star").strip().lower() or "star"

    # 1) Cache
    cached = cache_lookup(question, mode=mode, job_context=job_context)
    if cached:
        ans, src = cached
        ms = (time.perf_counter() - t0) * 1000
        yield ans, {
            "source": src,
            "first_paint_ms": round(ms, 2),
            "streaming": False,
            "final": True,
            "from_cache": True,
        }
        return

    # 2) Template first paint (always < few ms)
    draft = ""
    first_paint_ms = 0.0
    if ENABLE_TEMPLATE_FIRST:
        draft = template_answer(question, job_context=job_context, mode=mode)
        first_paint_ms = (time.perf_counter() - t0) * 1000
        yield draft, {
            "source": "template",
            "first_paint_ms": round(first_paint_ms, 2),
            "streaming": True,
            "final": False,
            "from_cache": False,
        }

    # 3) LLM refine (optional)
    if not ENABLE_LLM_REFINE or llm_streamer is None:
        if draft:
            cache_store(question, draft, mode=mode, job_context=job_context)
            yield draft, {
                "source": "template",
                "first_paint_ms": round(first_paint_ms, 2),
                "streaming": False,
                "final": True,
                "from_cache": False,
            }
        return

    acc = ""
    try:
        for tok in llm_streamer(
            question,
            job_context=job_context,
            tone=tone,
            mode=mode,
            answer_model=answer_model,
            fallback_model=fallback_model,
            user_answer_model=user_answer_model,
            user_fallback_model=user_fallback_model,
        ):
            acc += tok
            # Prefer LLM text once it has enough substance
            if len(acc.strip()) >= 40:
                yield acc, {
                    "source": "llm_stream",
                    "first_paint_ms": round(first_paint_ms or (time.perf_counter() - t0) * 1000, 2),
                    "streaming": True,
                    "final": False,
                    "from_cache": False,
                }
    except Exception:
        acc = ""

    final = (acc or draft or "").strip()
    if final:
        cache_store(question, final, mode=mode, job_context=job_context)
    yield final, {
        "source": "llm" if acc else "template",
        "first_paint_ms": round(first_paint_ms or (time.perf_counter() - t0) * 1000, 2),
        "streaming": False,
        "final": True,
        "from_cache": False,
        "full_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def warm_cache_seed(job_context: str = "") -> int:
    """Seed cache with common interview prompts for instant hits after deploy."""
    seeds = [
        "Tell me about yourself",
        "Tell me about a time you had a conflict",
        "Tell me about a time you failed",
        "How would you design a URL shortener",
        "How do you debug a production outage",
        "What is your greatest strength",
        "Explain a hard technical problem you solved",
        "How do you optimize API latency",
        "Walk me through a system you designed",
        "Describe a time you mentored someone",
    ]
    n = 0
    for q in seeds:
        for mode in ("star", "shorter", "technical"):
            ans = template_answer(q, job_context=job_context, mode=mode)
            cache_store(q, ans, mode=mode, job_context=job_context)
            n += 1
    return n
