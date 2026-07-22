"""Rate-limit pure logic tests (no FastAPI / sqlmodel required)."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.rate_limit import (
    enforce_limit,
    RateLimitExceeded,
    reset_rate_limits_for_tests,
)


@pytest.fixture(autouse=True)
def _clear():
    reset_rate_limits_for_tests()
    yield
    reset_rate_limits_for_tests()


class TestBucketIsolation:
    def test_completions_and_embeddings_separate(self):
        for _ in range(5):
            enforce_limit("completions", 1, 5)
        with pytest.raises(RateLimitExceeded) as ei:
            enforce_limit("completions", 1, 5)
        assert ei.value.bucket == "completions"

        # Embeddings still free
        enforce_limit("embeddings", 1, 5)

    def test_per_key_isolation(self):
        for _ in range(3):
            enforce_limit("completions", 1, 3)
        with pytest.raises(RateLimitExceeded):
            enforce_limit("completions", 1, 3)
        enforce_limit("completions", 2, 3)

    def test_zero_limit_always_blocks(self):
        with pytest.raises(RateLimitExceeded):
            enforce_limit("completions", 9, 0)

    def test_retry_after_positive(self):
        for _ in range(2):
            enforce_limit("completions", 7, 2)
        with pytest.raises(RateLimitExceeded) as ei:
            enforce_limit("completions", 7, 2)
        assert ei.value.retry_after >= 1


class TestInterviewCapacity:
    def test_interview_session_budget(self):
        """10 questions × 3 completion calls should fit under 90 RPM."""
        limit_c = 90
        for _ in range(10 * 3):
            enforce_limit("completions", 42, limit_c)
        remaining_ok = 0
        for _ in range(5):
            try:
                enforce_limit("completions", 42, limit_c)
                remaining_ok += 1
            except RateLimitExceeded:
                break
        assert remaining_ok >= 1
