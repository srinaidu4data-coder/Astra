#!/usr/bin/env python3
"""
RAG retrieval module for Astra MVP.
Searches ChromaDB for relevant document chunks.
Supports hybrid search (dense + sparse) with Reciprocal Rank Fusion.
"""

from collections.abc import Generator
import os
import re
import threading

import chromadb
from openai import OpenAI
import json

from config import (
    LICENSE_ENABLED,
    get_license_key,
    get_openai_api_key,
    get_proxy_url,
    load_prompts_config,
)
from pipeline_utils import heuristic_classify, context_is_relevant as _context_is_relevant_pure

# Cross-platform path for ChromaDB (writable even under PyInstaller)
def _resolve_chroma_path() -> str:
    try:
        from platformdirs import user_data_dir
        base = user_data_dir("astra", ensure_exists=True)
        return os.path.join(base, "chroma_db")
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")


CHROMA_DB_PATH = _resolve_chroma_path()

COLLECTION_NAME = "astra_docs"
EMBEDDING_MODEL = "text-embedding-3-small"
def _script_models() -> tuple[str, str, str]:
    try:
        from config import get_llm_provider

        if get_llm_provider() == "groq":
            m = "llama-3.3-70b-versatile"
            return m, m, "llama-3.1-8b-instant"
    except Exception:
        pass
    return "gpt-4.1-mini", "gpt-4.1-mini", "gpt-4.1-mini"


CLASSIFICATION_MODEL, SCRIPT_MODEL, BULLET_MODEL = _script_models()

# Hybrid search settings
HYBRID_SEARCH_ENABLED = True  # Toggle hybrid search on/off
RRF_K = 60  # RRF constant (standard value, higher = more weight to lower ranks)
DENSE_WEIGHT = 0.5  # Weight for dense (embedding) results in fusion
SPARSE_WEIGHT = 0.5  # Weight for sparse (BM25) results in fusion

# Config cache
_prompts_config = None
_openai_client = None
_openai_client_key = None  # (license, proxy) cache key
_openai_lock = threading.Lock()
_chroma_client = None
_chroma_collection = None
_chroma_lock = threading.Lock()


def _get_openai_client() -> OpenAI:
    """
    Create (or reuse) OpenAI client.

    - LICENSE_ENABLED=False (current): direct OpenAI with OPENAI_API_KEY
    - LICENSE_ENABLED=True: license key + backend proxy (production path)
    """
    global _openai_client, _openai_client_key

    if not LICENSE_ENABLED:
        from config import get_openai_base_url, get_llm_provider

        api_key = get_openai_api_key()
        if not api_key:
            raise RuntimeError(
                "LLM API key not found. Set GROQ_API_KEY or OPENAI_API_KEY in the "
                "process environment (prefer not committing secrets to .env)."
            )
        # Groq / xAI / custom: OpenAI-compatible base URL
        base_url = get_openai_base_url()
        provider = get_llm_provider()
        cache_key = ("direct", provider, api_key[:8], base_url or "default")
        with _openai_lock:
            if _openai_client is None or _openai_client_key != cache_key:
                # Low retries + tight timeout: fail fast, cascade to template
                # Clear empty OPENAI_BASE_URL so the SDK does not build a broken URL
                for _env_name in ("OPENAI_BASE_URL", "GROQ_BASE_URL"):
                    _v = os.environ.get(_env_name)
                    if _v is not None and not str(_v).strip():
                        os.environ.pop(_env_name, None)
                kwargs = {
                    "api_key": api_key,
                    "timeout": float(os.environ.get("OPENAI_TIMEOUT", "45") or "45"),
                    "max_retries": 1,
                }
                if base_url and str(base_url).strip().lower().startswith(
                    ("http://", "https://")
                ):
                    kwargs["base_url"] = str(base_url).strip().rstrip("/")
                _openai_client = OpenAI(**kwargs)
                _openai_client_key = cache_key
            return _openai_client

    # --- Licensed / proxy mode (restore when LICENSE_ENABLED=True) ---
    license_key = get_license_key()
    if not license_key:
        raise RuntimeError(
            "Activate your license to get AI answers. Tap Activate on the start screen."
        )
    proxy_url = get_proxy_url()
    cache_key = (license_key, proxy_url)
    with _openai_lock:
        if _openai_client is None or _openai_client_key != cache_key:
            _openai_client = OpenAI(
                api_key=license_key,
                base_url=proxy_url,
                timeout=45.0,
                max_retries=1,
            )
            _openai_client_key = cache_key
        return _openai_client


def _get_chroma_collection():
    """Reuse a process-level Chroma collection handle."""
    global _chroma_client, _chroma_collection
    if not os.path.exists(CHROMA_DB_PATH):
        return None
    with _chroma_lock:
        try:
            if _chroma_client is None:
                _chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
            if _chroma_collection is None:
                _chroma_collection = _chroma_client.get_collection(name=COLLECTION_NAME)
            return _chroma_collection
        except Exception:
            _chroma_client = None
            _chroma_collection = None
            return None


def _context_is_relevant(context_chunks: list[dict], min_score: float = 0.2) -> bool:
    """True if we should personalize with retrieved chunks."""
    return _context_is_relevant_pure(context_chunks, min_score=min_score)


def _format_context_section(context_chunks: list[dict], min_score: float = 0.15) -> str:
    """Build the experience section for answer prompts."""
    if not _context_is_relevant(context_chunks, min_score=min_score):
        return (
            "CANDIDATE'S EXPERIENCE: No matching notes found.\n"
            "Use honest general knowledge for the job. Frame as "
            "\"In my experience...\" or \"What I'd do is...\". "
            "Do NOT invent employers, metrics, or tools the candidate never used."
        )

    # Prefer dense score for filtering when available; keep hybrid top-k otherwise
    usable = []
    for chunk in context_chunks:
        dense = chunk.get("dense_score")
        sim = float(chunk.get("similarity_score", 0) or 0)
        if dense is not None:
            if dense >= min_score:
                usable.append(chunk)
        elif sim > 0.05:
            usable.append(chunk)
        else:
            # Pure RRF tiny scores — keep (already top-k)
            usable.append(chunk)

    if not usable:
        usable = context_chunks[:3]

    context_text = "\n\n".join(
        f"[{chunk.get('source_file', 'notes')}]:\n{chunk['text']}"
        for chunk in usable
    )
    return f"CANDIDATE'S EXPERIENCE (personalize with this only — never invent):\n{context_text}"

# BM25 index cache
_bm25_index = None
_bm25_documents = None
_bm25_doc_ids = None
_bm25_metadatas = None


def _tokenize(text: str) -> list[str]:
    """
    Simple tokenizer for BM25.
    Lowercases, removes punctuation, splits on whitespace.
    Preserves technical terms like 'tf2', 'ROS2', 'gpt-4o'.
    """
    # Lowercase and replace punctuation with spaces (except hyphens in words)
    text = text.lower()
    # Keep alphanumeric, hyphens, underscores (common in technical terms)
    text = re.sub(r'[^\w\s\-]', ' ', text)
    # Split and filter empty strings
    tokens = [t.strip() for t in text.split() if t.strip()]
    return tokens


def _load_bm25_index():
    """
    Load or rebuild BM25 index from ChromaDB documents.
    Caches the index for subsequent queries.
    """
    global _bm25_index, _bm25_documents, _bm25_doc_ids, _bm25_metadatas

    # Check if already loaded
    if _bm25_index is not None:
        return _bm25_index, _bm25_documents, _bm25_doc_ids, _bm25_metadatas

    # Check if chroma_db exists
    if not os.path.exists(CHROMA_DB_PATH):
        return None, None, None, None

    try:
        chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        collection = chroma_client.get_collection(name=COLLECTION_NAME)
    except Exception:
        return None, None, None, None

    if collection.count() == 0:
        return None, None, None, None

    # Load all documents from ChromaDB
    all_docs = collection.get(include=["documents", "metadatas"])

    if not all_docs["documents"]:
        return None, None, None, None

    _bm25_documents = all_docs["documents"]
    _bm25_doc_ids = all_docs["ids"]
    _bm25_metadatas = all_docs["metadatas"]

    # Tokenize documents for BM25
    tokenized_docs = [_tokenize(doc) for doc in _bm25_documents]

    # Build BM25 index
    try:
        from rank_bm25 import BM25Okapi
        _bm25_index = BM25Okapi(tokenized_docs)
    except ImportError:
        print("Warning: rank_bm25 not installed. Falling back to dense-only search.")
        return None, None, None, None

    return _bm25_index, _bm25_documents, _bm25_doc_ids, _bm25_metadatas


def invalidate_bm25_cache():
    """
    Invalidate BM25 cache. Call this after ingesting new documents.
    """
    global _bm25_index, _bm25_documents, _bm25_doc_ids, _bm25_metadatas
    global _chroma_client, _chroma_collection
    _bm25_index = None
    _bm25_documents = None
    _bm25_doc_ids = None
    _bm25_metadatas = None
    with _chroma_lock:
        _chroma_client = None
        _chroma_collection = None


def _search_bm25(query: str, top_k: int = 20) -> list[dict]:
    """
    Search using BM25 (sparse retrieval).
    Returns list of {text, source_file, bm25_score, doc_id, rank}.
    """
    bm25, documents, doc_ids, metadatas = _load_bm25_index()

    if bm25 is None:
        return []

    # Tokenize query
    query_tokens = _tokenize(query)

    if not query_tokens:
        return []

    # Get BM25 scores for all documents
    scores = bm25.get_scores(query_tokens)

    # Get top-k indices
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

    results = []
    for rank, idx in enumerate(top_indices):
        if scores[idx] > 0:  # Only include documents with non-zero score
            results.append({
                "text": documents[idx],
                "source_file": metadatas[idx].get("source_file", "unknown"),
                "bm25_score": float(scores[idx]),
                "doc_id": doc_ids[idx],
                "rank": rank + 1  # 1-indexed rank
            })

    return results


def _search_dense(query: str, top_k: int = 20) -> list[dict]:
    """
    Search using dense embeddings (original method).
    Returns list of {text, source_file, similarity_score, doc_id, rank}.
    """
    collection = _get_chroma_collection()
    if collection is None:
        return []

    try:
        if collection.count() == 0:
            return []
    except Exception:
        return []

    openai_client = _get_openai_client()

    # Embed the query
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=query
    )
    query_embedding = response.data[0].embedding

    # Search ChromaDB
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"]
    )

    formatted_results = []
    if results["documents"] and results["documents"][0]:
        for rank, (doc, metadata, distance, doc_id) in enumerate(zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            results["ids"][0]
        )):
            similarity_score = 1 - distance
            formatted_results.append({
                "text": doc,
                "source_file": metadata.get("source_file", "unknown"),
                "similarity_score": similarity_score,
                "doc_id": doc_id,
                "rank": rank + 1  # 1-indexed rank
            })

    return formatted_results


def _reciprocal_rank_fusion(
    dense_results: list[dict],
    sparse_results: list[dict],
    k: int = RRF_K,
    dense_weight: float = DENSE_WEIGHT,
    sparse_weight: float = SPARSE_WEIGHT
) -> list[dict]:
    """
    Combine dense and sparse results using Reciprocal Rank Fusion (RRF).

    RRF score = sum(weight / (k + rank)) for each result list

    Args:
        dense_results: Results from dense (embedding) search
        sparse_results: Results from sparse (BM25) search
        k: RRF constant (default 60)
        dense_weight: Weight for dense results
        sparse_weight: Weight for sparse results

    Returns:
        Fused and re-ranked results
    """
    # Build score map by doc_id
    scores = {}  # doc_id -> {rrf_score, text, source_file, dense_score, sparse_score}

    # Add dense results
    for result in dense_results:
        doc_id = result["doc_id"]
        rrf_score = dense_weight / (k + result["rank"])

        if doc_id not in scores:
            scores[doc_id] = {
                "text": result["text"],
                "source_file": result["source_file"],
                "rrf_score": 0,
                "dense_score": result.get("similarity_score", 0),
                "sparse_score": 0
            }

        scores[doc_id]["rrf_score"] += rrf_score
        scores[doc_id]["dense_score"] = result.get("similarity_score", 0)

    # Add sparse results
    for result in sparse_results:
        doc_id = result["doc_id"]
        rrf_score = sparse_weight / (k + result["rank"])

        if doc_id not in scores:
            scores[doc_id] = {
                "text": result["text"],
                "source_file": result["source_file"],
                "rrf_score": 0,
                "dense_score": 0,
                "sparse_score": result.get("bm25_score", 0)
            }

        scores[doc_id]["rrf_score"] += rrf_score
        scores[doc_id]["sparse_score"] = result.get("bm25_score", 0)

    # Sort by RRF score and format results
    sorted_results = sorted(scores.items(), key=lambda x: x[1]["rrf_score"], reverse=True)

    formatted_results = []
    for doc_id, data in sorted_results:
        formatted_results.append({
            "text": data["text"],
            "source_file": data["source_file"],
            "similarity_score": data["rrf_score"],  # Use RRF score as similarity
            "dense_score": data["dense_score"],
            "sparse_score": data["sparse_score"],
            "search_type": "hybrid"
        })

    return formatted_results


def search_context(query: str, top_k: int = 5, use_hybrid: bool = None) -> list[dict]:
    """
    Search for relevant document chunks based on a query.

    Uses hybrid search (dense + sparse with RRF fusion) by default for better
    retrieval accuracy, especially for technical terms and keywords.

    Args:
        query: The search query
        top_k: Number of results to return
        use_hybrid: Override hybrid search setting. If None, uses HYBRID_SEARCH_ENABLED.

    Returns:
        List of {text, source_file, similarity_score} dicts.
        Returns empty list if no documents ingested.
    """
    # Determine if we should use hybrid search
    hybrid = use_hybrid if use_hybrid is not None else HYBRID_SEARCH_ENABLED

    if hybrid:
        return search_context_hybrid(query, top_k)
    else:
        return search_context_dense(query, top_k)


def search_context_dense(query: str, top_k: int = 5) -> list[dict]:
    """
    Search using only dense (embedding) retrieval.
    Original search method - good for semantic similarity.
    """
    results = _search_dense(query, top_k)

    # Format for compatibility (remove internal fields)
    return [
        {
            "text": r["text"],
            "source_file": r["source_file"],
            "similarity_score": r["similarity_score"]
        }
        for r in results
    ]


def search_context_hybrid(query: str, top_k: int = 5) -> list[dict]:
    """
    Search using hybrid retrieval (dense + sparse with RRF fusion).

    Combines:
    - Dense search: Semantic similarity via embeddings (good for meaning)
    - Sparse search: BM25 keyword matching (good for exact terms like 'tf2', 'EKF')

    Results are fused using Reciprocal Rank Fusion for best of both worlds.
    """
    # Get more candidates than needed for better fusion
    candidate_k = max(top_k * 4, 20)

    # Run both searches
    dense_results = _search_dense(query, candidate_k)
    sparse_results = _search_bm25(query, candidate_k)

    # If sparse search fails (no BM25 index), fall back to dense only
    if not sparse_results:
        return [
            {
                "text": r["text"],
                "source_file": r["source_file"],
                "similarity_score": r["similarity_score"]
            }
            for r in dense_results[:top_k]
        ]

    # If dense search fails, fall back to sparse only
    if not dense_results:
        return [
            {
                "text": r["text"],
                "source_file": r["source_file"],
                "similarity_score": r["bm25_score"] / 100  # Normalize BM25 score
            }
            for r in sparse_results[:top_k]
        ]

    # Fuse results using RRF
    fused_results = _reciprocal_rank_fusion(dense_results, sparse_results)

    # Return top_k results.
    # IMPORTANT: keep dense_score for relevance thresholds. Raw RRF is ~0.016 max
    # and must NOT be used as cosine similarity.
    return [
        {
            "text": r["text"],
            "source_file": r["source_file"],
            "similarity_score": (
                r.get("dense_score")
                if r.get("dense_score", 0)
                else min(1.0, float(r.get("similarity_score", 0)) * (RRF_K + 1))
            ),
            "dense_score": r.get("dense_score", 0),
            "sparse_score": r.get("sparse_score", 0),
        }
        for r in fused_results[:top_k]
    ]


DEFAULT_CLASSIFICATION_PROMPT = """You are an interview question classifier. Given text from an interviewer, determine:
1. Is this a question that requires the candidate to give a substantive answer?
2. What type of question is it?

ANSWER THESE (behavioral, situational, tell-me-about):
- 'Tell me about a time when you...'
- 'Describe a situation where...'
- 'How would you handle...'
- 'What's your experience with...'
- 'Walk me through...'
- 'Give me an example of...'
- Technical questions about skills, tools, or concepts

IGNORE THESE (small talk, transitions, statements):
- 'Thanks for that answer'
- 'Let me tell you about our team'
- 'That's great'
- 'Can you hear me okay?'
- 'Let's move on to the next topic'
- 'Interesting, tell me more' (follow-up, wait for more context)
- Statements about the company or role

Respond ONLY with valid JSON (no markdown): {"is_interview_question": true/false, "question_type": "behavioral"|"technical"|"situational"|"other"|"not_a_question", "confidence": 0.0-1.0, "cleaned_question": "the question cleaned up"}"""


def classify_utterance(text: str, min_words: int = 3, *, force_llm: bool = False) -> dict:
    """
    Classify if text is an interview question.

    Uses a local heuristic first (no network) for clear questions / non-questions.
    Falls back to GPT-4o-mini via the proxy for ambiguous cases.

    Args:
        text: The transcribed text to classify
        min_words: Skip LLM classification if fewer words than this
        force_llm: Always call the LLM (tests / debugging)

    Returns:
        {
            "is_interview_question": bool,
            "question_type": "...",
            "confidence": float (0-1),
            "cleaned_question": str,
            "source": "heuristic" | "llm" | "error"
        }
    """
    # Fast path: local heuristic (skip ~400-1200ms proxy RTT when possible)
    if not force_llm:
        quick = heuristic_classify(text, min_words=min_words)
        if quick is not None:
            return quick

    openai_client = _get_openai_client()

    try:
        response = openai_client.chat.completions.create(
            model=CLASSIFICATION_MODEL,
            messages=[
                {"role": "system", "content": get_prompt("classification")},
                {"role": "user", "content": f"Classify this: \"{text}\""}
            ],
            max_tokens=100,
            temperature=0,
            timeout=20.0,
        )

        result_text = response.choices[0].message.content.strip()
        # Strip markdown fences if model wraps JSON
        if result_text.startswith("```"):
            result_text = re.sub(r"^```(?:json)?\s*", "", result_text)
            result_text = re.sub(r"\s*```$", "", result_text)
        result = json.loads(result_text)

        return {
            "is_interview_question": result.get("is_interview_question", False),
            "question_type": result.get("question_type", "not_a_question"),
            "confidence": float(result.get("confidence", 0.5)),
            "cleaned_question": result.get("cleaned_question", text),
            "source": "llm",
        }

    except (json.JSONDecodeError, KeyError) as e:
        print(f"Classification parse error: {e}")
        # Ambiguous parse — if it looks like a question mark, answer anyway
        fallback = heuristic_classify(text, min_words=1)
        if fallback and fallback.get("is_interview_question"):
            fallback["confidence"] = min(fallback.get("confidence", 0.7), 0.7)
            fallback["source"] = "heuristic_fallback"
            return fallback
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 0.0,
            "cleaned_question": text,
            "source": "error",
        }
    except Exception as e:
        print(f"Classification error: {e}")
        fallback = heuristic_classify(text, min_words=1)
        if fallback and fallback.get("is_interview_question"):
            fallback["source"] = "heuristic_fallback"
            return fallback
        return {
            "is_interview_question": False,
            "question_type": "not_a_question",
            "confidence": 0.0,
            "cleaned_question": text,
            "source": "error",
        }


DEFAULT_STAR_SYSTEM_PROMPT = """You are an AI interview copilot for any professional role. Help the candidate answer live interview questions in real time.

## YOUR ROLE
- Give impressive, technically accurate answers grounded in the question and the candidate's role/context
- Speak with calm authority — assume a senior interviewer; skip baby definitions unless asked
- Make answers SPEAKABLE — the candidate may say them out loud

## ANSWER STRUCTURE
**Opening Hook** (1 line): confident, on-topic thesis for THIS question only
**Core** (3–5 short spoken beats): mechanism, decisions, evidence — use real jargon from the domain of the question
**Tradeoff / what breaks** (1 line) when relevant
**Result / validation** (1 line): metric only if real from resume/context
**Close** (1 line): invite a deeper follow-up on the hardest part

## RULES
1. Stay on the topic asked. Do not substitute a different product, module family, or industry stack.
2. Use precise terms from the question, job context, and resume/knowledge context when provided.
3. Never invent products, modules, transaction codes, APIs, client names, or metrics.
4. Write spoken sentences, not telegraphic bullet dumps.
5. Prefer first person ownership ("I led", "I designed") when storytelling.

## TONE
Confident, not arrogant. Technical but conversational. Peer to peer.

## WHAT NOT TO DO
- Generic HR fluff ("I'm a team player")
- Over-explaining basics the interviewer already knows
- Uncertain hedging ("I think maybe…")
- Dragging in unrelated domain knowledge (e.g. finance postings when asked about track-and-trace)
"""


DEFAULT_BULLET_SYSTEM_PROMPT = """Generate exactly 3 ultra-short bullet points. Quick glance only while speaking.

STRICT FORMAT:
- Exactly 3 bullets
- 12 words MAX per bullet
- Start with "•"
- Plain language, not jargon dumps

EXAMPLE:
• Stay calm in rush — checklist so nothing is missed
• Double-check with the customer before finishing
• Own mistakes fast and fix them
"""


DEFAULT_SCRIPT_SYSTEM_PROMPT = """You are a live interview coach. Write words the candidate will say out loud.

## TONE:
{tone_instruction}

## RULES:
- Sound like a real person talking, not an essay or LinkedIn post
- 80-120 words (about 30-45 seconds of speech)
- First person ("I...", "In my experience...")
- No bullet points, no numbered lists, no section headers
- Simple everyday language; explain jargon only if the job needs it
- One clear opening, 1-2 concrete points, a short wrap-up
- Never invent employers, grades, metrics, or tools not in the notes
- Works for any job: retail, food service, internship, office, tech, etc.

## GOOD EXAMPLE:
"I'd say my biggest strength is staying calm when things get busy. At my last job I covered the front during rush hour — I kept a simple checklist so orders didn't get missed, and I always double-checked with the customer before closing out. If something went wrong I'd own it and fix it fast instead of making excuses. That same approach is how I'd show up on day one here."

## BAD:
Long textbook answers, fake companies, bullet dumps, corporate buzzwords only.
"""


DEFAULT_TONE_INSTRUCTIONS = {
    "professional": "Use formal but warm language. Sound composed and authoritative. Speak as a senior consultant to a peer.",
    "casual": "Use relaxed, friendly language. Sound approachable and conversational. Speak as if chatting with a colleague.",
    "confident": "Use assertive, direct language. Sound self-assured and commanding. Speak with energy and conviction."
}


# Config helper functions
def _get_config() -> dict:
    """Get cached prompts config, loading if needed."""
    global _prompts_config
    if _prompts_config is None:
        _prompts_config = load_prompts_config()
    return _prompts_config


def reload_prompts_config() -> None:
    """Force reload prompts config from YAML file."""
    global _prompts_config
    _prompts_config = load_prompts_config()


def get_prompt(name: str) -> str:
    """Get prompt by name from config with fallback to default."""
    config = _get_config()
    prompts = config.get("prompts", {})

    # Map config names to default constants
    defaults = {
        "classification": DEFAULT_CLASSIFICATION_PROMPT,
        "bullet_system": DEFAULT_BULLET_SYSTEM_PROMPT,
        "script_system": DEFAULT_SCRIPT_SYSTEM_PROMPT,
        "star_system": DEFAULT_STAR_SYSTEM_PROMPT,
    }

    return prompts.get(name, defaults.get(name, ""))


def get_tone_instruction(tone: str) -> str:
    """Get tone instruction text from config."""
    config = _get_config()
    tones = config.get("tones", DEFAULT_TONE_INSTRUCTIONS)
    return tones.get(tone, tones.get("professional", DEFAULT_TONE_INSTRUCTIONS["professional"]))


def get_default_job_context() -> str:
    """Get default job context from config."""
    config = _get_config()
    return config.get("job_context", "")


def get_default_tone() -> str:
    """Get default tone from config."""
    config = _get_config()
    return config.get("default_tone", "professional")


def get_available_tones() -> list[str]:
    """Get list of available tone names from config."""
    config = _get_config()
    tones = config.get("tones", DEFAULT_TONE_INSTRUCTIONS)
    return list(tones.keys())


def generate_star_response(question: str, context_chunks: list[dict], job_context: str = "") -> Generator[str, None, None]:
    """
    Generate an interview response using retrieved context.
    Falls back to honest general knowledge if context is not relevant.
    """
    openai_client = _get_openai_client()
    context_section = _format_context_section(context_chunks)

    job_section = ""
    if job_context:
        job_section = f"""
JOB / ROLE (align answer to this):
{job_context}
"""

    user_message = f"""{context_section}
{job_section}

INTERVIEW QUESTION: {question}

Give a confident, natural answer the candidate can speak out loud verbatim. Keep it under 150 words."""

    stream = openai_client.chat.completions.create(
        model=SCRIPT_MODEL,
        messages=[
            {"role": "system", "content": get_prompt("star_system") or DEFAULT_STAR_SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ],
        stream=True,
        temperature=0.7,
        max_tokens=320,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def ask(question: str, job_context: str = "") -> Generator[str, None, None]:
    """Search context and generate streaming response."""
    chunks = search_context(question)
    return generate_star_response(question, chunks, job_context)


def generate_bullet_response(question: str, context_chunks: list[dict], job_context: str = "") -> Generator[str, None, None]:
    """
    Generate a concise 2-3 bullet point response using retrieved context.
    Uses gpt-4o-mini for speed since bullets are simple.
    """
    openai_client = _get_openai_client()
    context_section = _format_context_section(context_chunks)

    job_section = ""
    if job_context:
        job_section = f"""
JOB / ROLE:
{job_context}
"""

    user_message = f"""{context_section}
{job_section}

INTERVIEW QUESTION: {question}

Generate exactly 2-3 short bullet points. Simple words. Quick glance only."""

    stream = openai_client.chat.completions.create(
        model=BULLET_MODEL,
        messages=[
            {"role": "system", "content": get_prompt("bullet_system") or DEFAULT_BULLET_SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ],
        stream=True,
        temperature=0.3,
        max_tokens=120,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def ask_bullet(question: str, job_context: str = "", context_chunks: list[dict] | None = None) -> Generator[str, None, None]:
    """Search context (unless provided) and generate bullet point response."""
    chunks = context_chunks if context_chunks is not None else search_context(question)
    return generate_bullet_response(question, chunks, job_context)


def generate_script_response(question: str, context_chunks: list[dict], job_context: str = "", tone: str = "professional") -> Generator[str, None, None]:
    """
    Generate a humanized, speakable interview script using retrieved context.
    Uses gpt-4o-mini on the live path for fast first-token latency.
    """
    openai_client = _get_openai_client()

    # Get tone instruction from config
    tone_instruction = get_tone_instruction(tone)

    # Format the prompt with tone
    script_prompt = get_prompt("script_system") or DEFAULT_SCRIPT_SYSTEM_PROMPT
    system_prompt = script_prompt.format(tone_instruction=tone_instruction)

    context_section = _format_context_section(context_chunks)

    job_section = ""
    if job_context:
        job_section = f"""
JOB / ROLE (align answer to this):
{job_context}
"""

    user_message = f"""{context_section}
{job_section}

INTERVIEW QUESTION: {question}

Write a natural spoken answer (80-120 words, about 30-45 seconds to say).
First person. No bullet points. No section headers. Sound like a real person,
not a textbook. Skip the forced "I can go deeper" closer unless it fits."""

    stream = openai_client.chat.completions.create(
        model=SCRIPT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        stream=True,
        temperature=0.7,
        max_tokens=280,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def ask_script(
    question: str,
    job_context: str = "",
    tone: str = "professional",
    context_chunks: list[dict] | None = None,
) -> Generator[str, None, None]:
    """Search context (unless provided) and generate script response with tone."""
    chunks = context_chunks if context_chunks is not None else search_context(question)
    return generate_script_response(question, chunks, job_context, tone)


if __name__ == "__main__":
    for token in ask("Tell me about a time you led a difficult project"):
        print(token, end="", flush=True)
    print()
