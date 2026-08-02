"""
Golden checks: ATTP JD grounding — answers/prompts stay on-JD, no SWE/ML buzz.

Network-free (no live LLM). Validates lexicon, strip, and prompt construction.
"""

from __future__ import annotations

import re

BANNED = re.compile(
    r"\b(p99|kubernetes|k8s|microservice|synergy|pytorch|gradient descent|paradigm)\b",
    re.I,
)


class TestJdLexicon:
    def test_jd_loads_and_has_attp_terms(self):
        from jd_grounding import extract_lexicon, load_jd_text

        jd = load_jd_text()
        assert jd, "jd and resume/jd.txt must exist"
        assert "ATTP" in jd.upper() or "attp" in jd.lower()
        lex = extract_lexicon(jd, max_terms=40)
        blob = " ".join(lex).upper()
        assert any(t in blob for t in ("ATTP", "EPCIS", "GTIN", "GS1", "DSCSA"))

    def test_strip_removes_banned_buzz(self):
        from jd_grounding import strip_off_domain_filler

        raw = (
            "Hook: Yes.\n"
            "Approach: We optimized p99 with kubernetes microservices synergy "
            "and pytorch for commissioning aggregation."
        )
        out = strip_off_domain_filler(
            raw,
            question="Should shipping be blocked when aggregation is incomplete?",
            job_context="SAP ATTP Techno-Functional Consultant",
        )
        assert "p99" not in out.lower()
        assert "kubernetes" not in out.lower()
        assert "synergy" not in out.lower()
        assert "pytorch" not in out.lower()
        # Domain terms may remain
        assert "commissioning" in out.lower() or "aggregation" in out.lower() or "Yes" in out

    def test_bootstrap_sets_role(self):
        from jd_grounding import bootstrap_session_from_jd_resume
        from session_context import clear_pack, get_pack

        clear_pack()
        info = bootstrap_session_from_jd_resume(force=True)
        assert info.get("ok")
        pack = get_pack()
        assert "ATTP" in (pack.role or "").upper() or "SAP" in (pack.role or "").upper()
        assert pack.job_description


class TestJdPromptConstruction:
    def test_user_prompt_includes_role_terms_not_banned_essay(self):
        from answer_engine import _build_user_prompt, _fallback_strategy

        q = "Should shipping be blocked when parent-child aggregation is incomplete?"
        role = "SAP ATTP Techno-Functional Consultant"
        strategy = _fallback_strategy(q, role)
        user = _build_user_prompt(
            q,
            job_context=role,
            tone="confident",
            mode="technical",
            strategy=strategy,
            context_chunks=[],
        )
        assert "Role:" in user
        assert q[:40] in user
        # Prefer JD terms list or session context — not the removed VOCAB essay
        assert "VOCABULARY + REASONING" not in user
        assert "JD GROUNDING (REASONING — MANDATORY)" not in user
        # Jargon bank should surface ATTP family terms when JD present
        jar = " ".join(strategy.get("jargon_bank") or []).upper()
        assert any(t in jar for t in ("ATTP", "EPCIS", "GTIN", "SAP"))

    def test_normalize_strips_banned_from_model_output(self):
        from answer_engine import _normalize_answer_text

        raw = (
            "Hook: Yes.\n"
            "Approach: Use kubernetes and p99 latency with synergy for EPCIS shipping."
        )
        out = _normalize_answer_text(
            raw,
            "Yes or no: block incomplete aggregation?",
            "SAP ATTP Techno-Functional Consultant",
        )
        assert not BANNED.search(out) or "EPCIS" in out
        assert "p99" not in out.lower()
        assert "kubernetes" not in out.lower()
        assert "synergy" not in out.lower()
