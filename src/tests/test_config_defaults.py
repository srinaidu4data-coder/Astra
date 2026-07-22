"""Config defaults regressions — product should be general-job friendly."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import (
    LICENSE_ENABLED,
    SILENCE_DURATION,
    MIN_SPEECH_DURATION,
    CLASSIFICATION_CONFIDENCE,
    AUTO_TRANSCRIBE_MAX_SECONDS,
    MANUAL_TRANSCRIBE_MAX_SECONDS,
    get_default_prompts_config,
)


class TestLicenseFlag:
    def test_license_currently_disabled(self):
        # Temporary product setting — flip LICENSE_ENABLED when re-shipping paywall
        assert LICENSE_ENABLED is False


class TestTimingDefaults:
    def test_silence_under_one_second(self):
        assert SILENCE_DURATION <= 1.0

    def test_manual_not_30s(self):
        # Old path used 30s re-STT which destroyed latency
        assert MANUAL_TRANSCRIBE_MAX_SECONDS <= 15
        assert AUTO_TRANSCRIBE_MAX_SECONDS <= 15

    def test_min_speech_reasonable(self):
        assert 0.3 <= MIN_SPEECH_DURATION <= 1.5


class TestPromptDefaults:
    def test_job_context_not_robotics_only(self):
        cfg = get_default_prompts_config()
        job = (cfg.get("job_context") or "").lower()
        assert "ros2" not in job
        assert "gnc" not in job

    def test_no_sap_in_default_script(self):
        cfg = get_default_prompts_config()
        script = cfg["prompts"]["script_system"].lower()
        assert "spro" not in script
        assert "me21n" not in script
        assert "sap" not in script

    def test_classification_covers_highschool_questions(self):
        cfg = get_default_prompts_config()
        c = cfg["prompts"]["classification"].lower()
        assert "strengths" in c or "why do you want" in c
        assert "available" in c or "weekend" in c

    def test_script_length_guidance_short(self):
        cfg = get_default_prompts_config()
        script = cfg["prompts"]["script_system"].lower()
        # Prefer short speakable answers for live interviews
        assert "80-120" in script or "30-45" in script or "120 words" in script
