"""Job catalog: seeded corpus + optional live freehire.me (tech aggregator)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# Curated multi-market seed board (always available offline / localhost)
SEED_JOBS: list[dict[str, Any]] = [
    {
        "id": "seed-1",
        "title": "Staff Frontend / AI Copilot Engineer",
        "company": "InterviewPulse Labs",
        "location": "Remote (US/EU)",
        "remote": True,
        "url": "https://example.com/jobs/staff-frontend-copilot",
        "skills": ["typescript", "react", "websocket", "webrtc", "llm", "electron"],
        "seniority": "staff",
        "text": "Build real-time AI interview copilots. TypeScript React Electron WebSocket streaming LLM UX performance.",
        "source": "seed",
    },
    {
        "id": "seed-2",
        "title": "Senior ML Engineer — Ranking Systems",
        "company": "Northstar Search",
        "location": "Berlin, Germany",
        "remote": False,
        "url": "https://example.com/jobs/ml-ranking",
        "skills": ["python", "pytorch", "ranking", "bm25", "feature-store", "airflow"],
        "seniority": "senior",
        "text": "Own learning-to-rank pipelines, BM25 hybrids, online metrics, feature stores, Airflow, PyTorch.",
        "source": "seed",
    },
    {
        "id": "seed-3",
        "title": "Backend Engineer — Distributed Systems",
        "company": "Queuewright",
        "location": "Remote",
        "remote": True,
        "url": "https://example.com/jobs/backend-dist",
        "skills": ["go", "kafka", "postgresql", "kubernetes", "observability", "grpc"],
        "seniority": "mid",
        "text": "Design idempotent event pipelines, Kafka, Postgres, k8s, OpenTelemetry, gRPC services.",
        "source": "seed",
    },
    {
        "id": "seed-4",
        "title": "Applied AI Engineer",
        "company": "Vertex Notes",
        "location": "Austin, TX",
        "remote": True,
        "url": "https://example.com/jobs/applied-ai",
        "skills": ["python", "langchain", "rag", "embeddings", "fastapi", "evaluation"],
        "seniority": "senior",
        "text": "Ship RAG systems, evaluation harnesses, FastAPI, embeddings, prompt quality gates.",
        "source": "seed",
    },
    {
        "id": "seed-5",
        "title": "Data Scientist — Causal Inference",
        "company": "A/B Foundry",
        "location": "London, UK",
        "remote": False,
        "url": "https://example.com/jobs/causal-ds",
        "skills": ["python", "statistics", "causal", "sql", "experimentation", "bayesian"],
        "seniority": "senior",
        "text": "Causal inference, Bayesian hierarchical models, SQL, experimentation platforms.",
        "source": "seed",
    },
    {
        "id": "seed-6",
        "title": "DevOps / Platform Engineer",
        "company": "SRE Circle",
        "location": "Remote",
        "remote": True,
        "url": "https://example.com/jobs/platform",
        "skills": ["kubernetes", "terraform", "aws", "ci", "prometheus", "python"],
        "seniority": "mid",
        "text": "Kubernetes Terraform AWS CI/CD Prometheus platform reliability Python automation.",
        "source": "seed",
    },
    {
        "id": "seed-7",
        "title": "Product Engineer — Growth",
        "company": "Funnelkit",
        "location": "New York, NY",
        "remote": False,
        "url": "https://example.com/jobs/product-growth",
        "skills": ["typescript", "react", "postgres", "analytics", "ab-testing"],
        "seniority": "mid",
        "text": "Full-stack product growth, React TypeScript Postgres analytics A/B testing.",
        "source": "seed",
    },
    {
        "id": "seed-8",
        "title": "Security Engineer — Application",
        "company": "Shieldpath",
        "location": "Remote",
        "remote": True,
        "url": "https://example.com/jobs/appsec",
        "skills": ["security", "owasp", "python", "sast", "threat-modeling"],
        "seniority": "senior",
        "text": "Application security OWASP threat modeling SAST secure SDLC Python.",
        "source": "seed",
    },
    {
        "id": "seed-9",
        "title": "Mobile Engineer (React Native)",
        "company": "Pulse Mobile",
        "location": "Toronto, CA",
        "remote": True,
        "url": "https://example.com/jobs/rn",
        "skills": ["react-native", "typescript", "ios", "android", "graphql"],
        "seniority": "mid",
        "text": "React Native TypeScript mobile GraphQL performance iOS Android.",
        "source": "seed",
    },
    {
        "id": "seed-10",
        "title": "Research Engineer — Speech / STT",
        "company": "Listen Labs",
        "location": "Remote (EU)",
        "remote": True,
        "url": "https://example.com/jobs/speech",
        "skills": ["python", "whisper", "pytorch", "audio", "latency", "onnx"],
        "seniority": "senior",
        "text": "Speech recognition Whisper PyTorch ONNX low-latency audio streaming.",
        "source": "seed",
    },
    {
        "id": "seed-11",
        "title": "SAP FICO Consultant",
        "company": "Enterprise Grid",
        "location": "Chicago, IL",
        "remote": False,
        "url": "https://example.com/jobs/sap-fico",
        "skills": ["sap", "fico", "s4hana", "tax", "controlling", "finance"],
        "seniority": "senior",
        "text": "SAP FICO S/4HANA tax determination controlling finance integration.",
        "source": "seed",
    },
    {
        "id": "seed-12",
        "title": "Junior Full-Stack Engineer",
        "company": "Starter Studio",
        "location": "Remote",
        "remote": True,
        "url": "https://example.com/jobs/junior-fs",
        "skills": ["javascript", "react", "node", "sql", "git"],
        "seniority": "junior",
        "text": "Junior full stack JavaScript React Node SQL git mentorship-friendly.",
        "source": "seed",
    },
]


def fetch_freehire(query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Optional live tech jobs via freehire.me public API (no key)."""
    q = (query or "").strip() or "software engineer"
    params = urllib.parse.urlencode(
        {
            "q": q,
            "limit": str(min(limit, 40)),
        }
    )
    url = f"https://api.freehire.me/v1/jobs?{params}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "InterviewPulse-JobSearchAI/0.1 (localhost lab)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError):
        return []

    items = data if isinstance(data, list) else data.get("jobs") or data.get("results") or []
    out: list[dict[str, Any]] = []
    for i, it in enumerate(items[:limit]):
        if not isinstance(it, dict):
            continue
        title = it.get("title") or it.get("name") or "Role"
        company = it.get("company") or it.get("company_name") or "Company"
        skills = it.get("skills") or it.get("tags") or []
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.split(",") if s.strip()]
        desc = it.get("description") or it.get("text") or ""
        out.append(
            {
                "id": f"fh-{it.get('id', i)}",
                "title": str(title),
                "company": str(company),
                "location": str(it.get("location") or it.get("region") or "Remote"),
                "remote": bool(it.get("remote") or "remote" in str(it.get("location", "")).lower()),
                "url": str(it.get("url") or it.get("link") or ""),
                "skills": [str(s) for s in skills][:16],
                "seniority": str(it.get("seniority") or it.get("level") or "mid"),
                "text": f"{title} {company} {desc}"[:2000],
                "source": "freehire",
            }
        )
    return out


def load_jobs(*, query: str, use_live: bool = True) -> list[dict[str, Any]]:
    jobs = list(SEED_JOBS)
    if use_live:
        live = fetch_freehire(query, limit=25)
        jobs.extend(live)
    # de-dupe by title+company
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for j in jobs:
        key = f"{j.get('title','').lower()}|{j.get('company','').lower()}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(j)
    return uniq
