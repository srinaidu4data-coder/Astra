"""
Golden eval scaffold (OpenAI ask) — small fixed JD×resume set for CI.

Expand to 50 JDs when you have real resume fixtures. Gate: no fabrication, names clean.
"""

from __future__ import annotations

from jobsearch.tailor_rt import run_tailor_rt

_GOLDEN = [
    {
        "profile": {
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "phone": "5550001111",
            "skills": ["python", "math"],
            "resume_text": "Ada Lovelace\nPython engineer. Built numerical systems.",
        },
        "job": {
            "title": "Python Engineer",
            "company": "NumCo",
            "skills": ["python"],
            "text": "Need python and math skills.",
        },
    },
    {
        "profile": {
            "name": "Sri Naidu",
            "email": "sri@example.com",
            "phone": "5550002222",
            "skills": ["SAP", "ABAP"],
            "resume_text": "Sri Naidu\nSAP ABAP consultant with HANA projects.",
            "resume_filename": "Sri_Naidu_SAP.docx",
        },
        "job": {
            "title": "SAP ABAP Consultant",
            "company": "ErpCo",
            "skills": ["SAP", "ABAP"],
            "text": "SAP ABAP HANA role.",
        },
    },
]


def test_golden_no_fabrication_phrases():
    banned = ("ex-google", "ex-meta", "nobel", "15 years at")
    for case in _GOLDEN:
        r = run_tailor_rt(case["profile"], case["job"], max_rounds=1)
        text = (r.get("forged_resume") or "").lower()
        for b in banned:
            assert b not in text, f"fabrication {b} in forge for {case['job']['title']}"


def test_golden_contact_ready_when_email_present():
    for case in _GOLDEN:
        r = run_tailor_rt(case["profile"], case["job"], max_rounds=1)
        v = (r.get("agents") or {}).get("validator") or {}
        contact = v.get("contact") or {}
        assert contact.get("email") is True
