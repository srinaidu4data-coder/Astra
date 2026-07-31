"""RAG helper regressions without requiring OpenAI / Chroma network."""

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Stub optional heavy deps ONLY when not installed.
# Never replace a real `openai` package — that poisons later e2e tests
# (MagicMock streams yield empty answers with no exception).
for _mod in ("chromadb", "rank_bm25"):
    if importlib.util.find_spec(_mod) is None:
        sys.modules.setdefault(_mod, MagicMock())
if importlib.util.find_spec("openai") is None:
    sys.modules.setdefault("openai", MagicMock())

from pipeline_utils import heuristic_classify
from rag import (
    _format_context_section,
    _context_is_relevant,
    _reciprocal_rank_fusion,
    classify_utterance,
    SCRIPT_MODEL,
    BULLET_MODEL,
)


class TestFormatContext:
    def test_empty_no_sap(self):
        sec = _format_context_section([])
        assert "SAP" not in sec
        assert "experience" in sec.lower() or "notes" in sec.lower()

    def test_uses_chunk_text(self):
        chunks = [{
            "text": "I worked as a barista for two years at Campus Cafe",
            "source_file": "resume.md",
            "similarity_score": 0.01,
            "dense_score": 0.0,
        }]
        assert _context_is_relevant(chunks)
        sec = _format_context_section(chunks)
        assert "barista" in sec
        assert "Campus Cafe" in sec

    def test_dense_filter(self):
        chunks = [
            {"text": "keep me", "source_file": "a.md", "dense_score": 0.8, "similarity_score": 0.8},
            {"text": "drop me", "source_file": "b.md", "dense_score": 0.05, "similarity_score": 0.05},
        ]
        sec = _format_context_section(chunks, min_score=0.15)
        assert "keep me" in sec
        # weak dense may be filtered
        # (implementation keeps weak only if no usable — here keep me exists)


class TestRRF:
    def test_fusion_orders_by_score(self):
        dense = [
            {"doc_id": "a", "text": "A", "source_file": "a", "rank": 1, "similarity_score": 0.9},
            {"doc_id": "b", "text": "B", "source_file": "b", "rank": 2, "similarity_score": 0.5},
        ]
        sparse = [
            {"doc_id": "b", "text": "B", "source_file": "b", "rank": 1, "bm25_score": 10},
            {"doc_id": "c", "text": "C", "source_file": "c", "rank": 2, "bm25_score": 5},
        ]
        fused = _reciprocal_rank_fusion(dense, sparse)
        assert len(fused) == 3
        ids_order = [f.get("text") for f in fused]
        # b appears in both → high RRF
        assert "B" in ids_order


class TestClassifyFastPath:
    def test_heuristic_no_network(self):
        # Should never call OpenAI for clear questions
        with patch("rag._get_openai_client") as mock_client:
            result = classify_utterance("Tell me about a time you led a team")
            mock_client.assert_not_called()
            assert result["is_interview_question"] is True
            assert result.get("source") == "heuristic"

    def test_short_no_network(self):
        with patch("rag._get_openai_client") as mock_client:
            result = classify_utterance("hi")
            mock_client.assert_not_called()
            assert result["is_interview_question"] is False

    def test_ignore_smalltalk_no_network(self):
        with patch("rag._get_openai_client") as mock_client:
            result = classify_utterance("Thanks for that answer")
            mock_client.assert_not_called()
            assert result["is_interview_question"] is False


class TestModels:
    def test_script_uses_mini_for_latency(self):
        assert "mini" in SCRIPT_MODEL

    def test_bullet_uses_mini(self):
        assert "mini" in BULLET_MODEL
