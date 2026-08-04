"""
Golden checks: ATTP JD grounding — answers/prompts stay on-JD, no SWE/ML buzz.

Network-free (no live LLM). Validates lexicon, strip, and prompt construction.
"""

from __future__ import annotations

import os
import re

import pytest

# Practice disk JD is opt-in in production; tests that exercise jd.txt need it on.
os.environ["ASTRA_PRACTICE_JD"] = "1"

BANNED = re.compile(
    r"\b(p99|kubernetes|k8s|microservice|synergy|pytorch|gradient descent|paradigm)\b",
    re.I,
)


@pytest.fixture(autouse=True)
def _practice_jd_on():
    os.environ["ASTRA_PRACTICE_JD"] = "1"
    yield


class TestJdLexicon:
    def test_jd_loads_and_has_attp_terms(self):
        from jd_grounding import extract_lexicon, load_jd_text

        jd = load_jd_text()
        assert jd, "jd and resume/jd.txt must exist (ASTRA_PRACTICE_JD=1)"
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

    def test_bootstrap_loads_jd_without_default_role(self):
        from jd_grounding import bootstrap_session_from_jd_resume
        from session_context import clear_pack, get_pack

        clear_pack()
        info = bootstrap_session_from_jd_resume(force=True)
        assert info.get("ok")
        pack = get_pack()
        # Role stays empty unless explicitly hinted — no JD Role: auto-fill
        assert (pack.role or "") == ""
        assert pack.job_description

    def test_off_domain_question_does_not_apply_attp_grounding(self):
        from jd_grounding import bootstrap_session_from_jd_resume, jd_grounding_applies
        from session_context import clear_pack

        clear_pack()
        bootstrap_session_from_jd_resume(force=True)
        assert not jd_grounding_applies(
            "Explain overfitting and how gradient descent can make it worse.",
            "",
        )
        assert not jd_grounding_applies(
            "What is the time complexity of binary search?",
            "",
        )
        # On-domain ATTP questions still ground
        assert jd_grounding_applies(
            "How do you configure EPCIS commissioning for CMO partners?",
            "SAP ATTP Techno-Functional Consultant",
        )

    def test_ensure_grounded_empty_for_off_domain(self):
        from jd_grounding import bootstrap_session_from_jd_resume, ensure_grounded_job_context
        from session_context import clear_pack

        clear_pack()
        bootstrap_session_from_jd_resume(force=True)
        job = ensure_grounded_job_context(
            "",
            question="Explain overfitting and regularization in neural networks.",
        )
        assert job == ""
        assert "ATTP" not in job.upper()

    def test_ensure_grounded_does_not_bootstrap_on_answer_path(self):
        from jd_grounding import ensure_grounded_job_context
        from session_context import clear_pack, get_pack

        clear_pack()
        assert get_pack().is_empty()
        job = ensure_grounded_job_context(
            "",
            question="Tell me about a time you handled conflict on a team.",
        )
        assert job == ""
        # Must not silently load disk JD into pack during answer prep
        assert not (get_pack().job_description or "").strip()

    def test_practice_jd_off_hides_disk(self, monkeypatch):
        monkeypatch.setenv("ASTRA_PRACTICE_JD", "0")
        from jd_grounding import load_jd_text

        assert load_jd_text() == ""

    def test_brim_role_never_gets_attp_lexicon(self):
        from answer_engine import _build_user_prompt, _fallback_strategy
        from jd_grounding import lexicon_for_turn
        from session_context import clear_pack, session_scope, update_pack, drop_session

        role = "SAP BRIM Data Analysis & Migration Support"
        q = "How do you design subscription billing and revenue recognition in BRIM?"
        drop_session("brim_test")
        with session_scope("brim_test"):
            clear_pack()
            # Poison pack with ATTP practice JD text
            update_pack(
                role=role,
                job_description=(
                    "SAP ATTP Techno-Functional EPCIS GTIN SSCC DSCSA "
                    "serialization commissioning aggregation"
                ),
                keywords=["ATTP", "EPCIS", "GTIN", "SSCC"],
            )
            lex = " ".join(lexicon_for_turn(q, role)).upper()
            assert "ATTP" not in lex and "EPCIS" not in lex
            assert "BRIM" in lex or "BILLING" in lex or "SUBSCRIPTION" in lex
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
            # Practice ATTP JD must not appear as source material
            assert "job description excerpt" not in low
            assert "prefer these role terms" in low
            pref = low.split("prefer these role terms")[1].split("\n")[0]
            assert "attp" not in pref and "epcis" not in pref and "gtin" not in pref
            assert "brim" in low
            # Domain must be BRIM, not ATTP serialization
            assert "sap brim" in low or "subscription billing" in low
            assert "track-and-trace serialization" not in low
        drop_session("brim_test")

    def test_soft_empty_prompt_not_attp_locked(self):
        from answer_engine import _build_user_prompt, _fallback_strategy
        from jd_grounding import bootstrap_session_from_jd_resume
        from session_context import clear_pack, update_pack

        clear_pack()
        bootstrap_session_from_jd_resume(force=True)
        update_pack(role="SAP ATTP Techno-Functional Consultant")
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
        # Domain lock must not force ATTP when Role is empty
        assert "stay strictly inside sap attp" not in low
        assert "domain: sap attp" not in low
        assert "sap attp techno-functional" not in low


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

    def test_ml_question_prompt_does_not_force_attp_role(self):
        from answer_engine import _build_user_prompt, _fallback_strategy
        from jd_grounding import bootstrap_session_from_jd_resume
        from session_context import clear_pack

        clear_pack()
        bootstrap_session_from_jd_resume(force=True)
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
        # Must not inject ATTP session pack / role as the answer persona
        assert "pre-session context" not in low
        assert "sap attp techno-functional" not in low
        assert "role: (use only the question" in low or "do not invent a job title" in low
        assert "topic rule" in low or "do not reframe as sap attp" in low
        # Ban-list may name EPCIS as forbidden; it must not appear as preferred jargon
        jar = " ".join(strategy.get("jargon_bank") or []).upper()
        assert "EPCIS" not in jar
        assert "ATTP" not in jar
        # Prefer-terms line must not push ATTP vocabulary
        if "prefer these role terms" in low:
            pref = low.split("prefer these role terms")[1].split("\n")[0]
            assert "epcis" not in pref and "attp" not in pref

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
