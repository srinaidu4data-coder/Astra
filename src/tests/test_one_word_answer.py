"""One-word rule: atomic answer first, period, then explain."""

from answer_engine import (
    _enforce_one_word_first,
    _is_one_word_answer_question,
    _normalize_answer_text,
)


class TestOneWordDetection:
    def test_what_is_term(self):
        assert _is_one_word_answer_question("What is CAPM?")
        assert _is_one_word_answer_question("Define latency.")
        assert _is_one_word_answer_question("In one word, what is this?")
        assert _is_one_word_answer_question("Yes or no: is CAPM still taught?")

    def test_reject_behavioral_what_is_your(self):
        assert not _is_one_word_answer_question("What is your biggest weakness?")
        assert not _is_one_word_answer_question("What's the hardest bug you've owned?")
        assert not _is_one_word_answer_question(
            "What is the difference between TCP and UDP?"
        )

    def test_not_multipart_design(self):
        assert not _is_one_word_answer_question(
            "What is CAPM and how do you apply it in a portfolio construction process with constraints?"
        )
        assert not _is_one_word_answer_question(
            "Walk me through how you would design a serialization system end-to-end for MAH and CMO partners including returns."
        )


class TestOneWordEnforce:
    def test_already_atomic(self):
        out = _enforce_one_word_first(
            "Hook: CAPM.\nApproach: It prices systematic risk.",
            "What is CAPM?",
        )
        assert out.splitlines()[0].strip() == "Hook: CAPM."
        assert "Approach:" in out

    def test_multiword_term(self):
        out = _enforce_one_word_first(
            "Hook: Net Present Value is the discounted value of cash flows.",
            "What is NPV?",
        )
        assert out.splitlines()[0].strip() == "Hook: Net Present Value."

    def test_buried_in_sentence(self):
        out = _enforce_one_word_first(
            "Hook: CAPM is a model that prices systematic risk using beta.",
            "What is CAPM?",
        )
        first = out.splitlines()[0].strip()
        assert first == "Hook: CAPM."
        assert "systematic" in out.lower() or "risk" in out.lower()

    def test_behavioral_not_mutilated(self):
        raw = "Hook: I tend to over-own delivery.\nSituation: On a launch…"
        out = _enforce_one_word_first(raw, "What is your biggest weakness?")
        assert out == raw

    def test_normalize_passes_question(self):
        out = _normalize_answer_text(
            "Hook: Latency is the delay before a transfer begins.",
            "What is latency?",
        )
        assert out.splitlines()[0].strip() == "Hook: Latency."

    def test_non_one_word_unchanged_shape(self):
        raw = "Hook: I start from constraints.\nSituation: Scale mattered."
        out = _enforce_one_word_first(
            raw,
            "Tell me about a time you failed.",
        )
        assert out == raw

    def test_to_bullets_keeps_atomic_hook(self):
        from answer_engine import to_bullets

        bullets = to_bullets("Hook: CAPM.\nApproach: Prices systematic risk.", "star")
        assert any(b.startswith("Hook: CAPM") for b in bullets)
