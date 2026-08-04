"""
Golden checks: per-login Role/Job grounding — no ambient ATTP, no skill pooling.

Network-free (no live LLM).
"""

from __future__ import annotations

import re

BANNED = re.compile(
    r"\b(p99|kubernetes|k8s|microservice|synergy|pytorch|gradient descent|paradigm)\b",
    re.I,
)


class TestJdLexicon:
    def test_lexicon_from_role_not_disk(self):
        from jd_grounding import lexicon_for_turn

        lex = lexicon_for_turn(
            "How does subscription billing work?",
            "SAP BRIM Data Analysis & Migration Support",
        )
        blob = " ".join(lex).upper()
        assert "BRIM" in blob or "BILLING" in blob or "SUBSCRIPTION" in blob
        assert "ATTP" not in blob and "EPCIS" not in blob

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

    def test_grounding_only_when_role_set(self):
        from jd_grounding import ensure_grounded_job_context, jd_grounding_applies

        assert not jd_grounding_applies("Anything?", "")
        assert jd_grounding_applies("Anything?", "SAP BRIM Consultant")
        assert ensure_grounded_job_context("") == ""
        assert ensure_grounded_job_context("SAP BRIM") == "SAP BRIM"

    def test_brim_role_prompt_has_no_attp(self):
        from answer_engine import _build_user_prompt, _fallback_strategy
        from jd_grounding import lexicon_for_turn

        role = "SAP BRIM Data Analysis & Migration Support"
        q = "How do you design subscription billing and revenue recognition in BRIM?"
        lex = " ".join(lexicon_for_turn(q, role)).upper()
        assert "ATTP" not in lex and "EPCIS" not in lex
        strategy = _fallback_strategy(q, role)
        user = _build_user_prompt(
            q,
            job_context=role,
            tone="confident",
            mode="technical",
            strategy=strategy,
            context_chunks=[],
        )
        low = user.lower()
        assert "brim" in low
        assert "attp" not in low
        assert "epcis" not in low
        assert "pre-session context" not in low
        assert "this login / this interview only" in low or "role / job context" in low

    def test_soft_empty_prompt_not_attp_locked(self):
        from answer_engine import _build_user_prompt, _fallback_strategy

        q = "Tell me about a time you handled conflict on a team."
        strategy = _fallback_strategy(q, "")
        user = _build_user_prompt(
            q,
            job_context="",
            tone="confident",
            mode="star",
            strategy=strategy,
            context_chunks=[],
        )
        low = user.lower()
        assert "pre-session context" not in low
        assert "stay strictly inside sap attp" not in low
        assert "sap attp techno-functional" not in low


class TestJdPromptConstruction:
    def test_user_prompt_includes_role_terms(self):
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
        assert "VOCABULARY + REASONING" not in user
        jar = " ".join(strategy.get("jargon_bank") or []).upper()
        assert any(t in jar for t in ("ATTP", "SAP", "AGGREGATION"))

    def test_ml_question_prompt_does_not_force_attp_role(self):
        from answer_engine import _build_user_prompt, _fallback_strategy

        q = "Explain overfitting and how you detect it in production models."
        strategy = _fallback_strategy(q, "")
        user = _build_user_prompt(
            q,
            job_context="",
            tone="confident",
            mode="technical",
            strategy=strategy,
            context_chunks=[],
        )
        low = user.lower()
        assert "overfitting" in low
        assert "pre-session context" not in low
        assert "sap attp techno-functional" not in low
        assert "role: (use only the question" in low or "do not invent a job title" in low
        jar = " ".join(strategy.get("jargon_bank") or []).upper()
        assert "EPCIS" not in jar
        assert "ATTP" not in jar

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
