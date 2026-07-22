#!/usr/bin/env python3
"""
Generate a practice interview audio file: 20 AI/ML questions with gaps.

Saves to: test_audio/ai_ml_interview_20q.mp3 (and .txt list)

Usage:
  python generate_interview_audio.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Load .env
_env = Path(__file__).resolve().parent / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

QUESTIONS = [
    "Tell me about yourself and why you're interested in AI and machine learning.",
    "What is the difference between supervised and unsupervised learning?",
    "Explain overfitting, and how would you prevent it?",
    "What is the bias variance tradeoff?",
    "How does a decision tree make predictions?",
    "Explain gradient descent in simple terms.",
    "What is the difference between L one and L two regularization?",
    "How would you handle missing values in a dataset?",
    "What is cross validation, and why is it useful?",
    "Explain precision, recall, and the F one score.",
    "What is a confusion matrix, and when would you use it?",
    "How does a neural network learn from data?",
    "What is the vanishing gradient problem?",
    "What is the difference between bagging and boosting?",
    "What is transfer learning, and when would you use it?",
    "How do you choose evaluation metrics for a classification problem?",
    "What is an embedding in natural language processing?",
    "Explain at a high level how transformer models work.",
    "How would you deploy a machine learning model to production?",
    "Tell me about a machine learning project you worked on end to end.",
]

GAP_SECONDS = 12  # silence between questions (interviewer pause)
INTRO = (
    "Welcome to your practice A I and machine learning interview. "
    "I will ask twenty questions. After each question, you will have time to answer. "
    "Let's begin."
)
OUTRO = (
    "That was the last question. Thank you for your time. "
    "This practice interview is complete."
)


def main() -> int:
    from openai import OpenAI
    from pydub import AudioSegment
    from pydub.generators import Sine

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("ERROR: Set OPENAI_API_KEY in environment or .env")
        return 1

    out_dir = Path(__file__).resolve().parent / "test_audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_mp3 = out_dir / "ai_ml_interview_20q.mp3"
    out_txt = out_dir / "ai_ml_interview_20q_questions.txt"

    # Save question list for humans
    lines = ["AI/ML Practice Interview — 20 questions", f"Gap between questions: {GAP_SECONDS}s", ""]
    for i, q in enumerate(QUESTIONS, 1):
        lines.append(f"{i}. {q}")
    out_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_txt}")

    client = OpenAI(api_key=api_key)
    silence = AudioSegment.silent(duration=int(GAP_SECONDS * 1000))
    short_pause = AudioSegment.silent(duration=800)
    # Optional soft beep before each question
    beep = Sine(880).to_audio_segment(duration=120).apply_gain(-12)
    gap_with_beep = silence[: max(0, len(silence) - 200)] + beep + AudioSegment.silent(duration=400)

    combined = AudioSegment.silent(duration=500)

    def tts(text: str, label: str) -> AudioSegment:
        print(f"  TTS: {label}...", flush=True)
        tmp = Path(tempfile.gettempdir()) / f"astra_q_{abs(hash(label)) % 10**8}.mp3"
        with client.audio.speech.with_streaming_response.create(
            model="tts-1",
            voice="alloy",
            input=text,
        ) as resp:
            resp.stream_to_file(str(tmp))
        seg = AudioSegment.from_file(tmp)
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return seg

    print("Generating intro...", flush=True)
    combined += tts(INTRO, "intro")
    combined += short_pause

    for i, q in enumerate(QUESTIONS, 1):
        spoken = f"Question {i}. {q}"
        combined += tts(spoken, f"Q{i}")
        if i < len(QUESTIONS):
            print(f"  gap {GAP_SECONDS}s after Q{i}", flush=True)
            combined += gap_with_beep
        else:
            combined += short_pause

    print("Generating outro...", flush=True)
    combined += tts(OUTRO, "outro")

    # Export
    combined.export(out_mp3, format="mp3", bitrate="128k")
    # Also WAV for apps that prefer wav
    out_wav = out_dir / "ai_ml_interview_20q.wav"
    combined.export(out_wav, format="wav")

    mins = len(combined) / 1000 / 60
    print(f"\nDone.")
    print(f"  MP3: {out_mp3}  ({mins:.1f} min)")
    print(f"  WAV: {out_wav}")
    print(f"  TXT: {out_txt}")
    print(f"\nPlay the MP3/WAV while Astra is in Start Session to test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
