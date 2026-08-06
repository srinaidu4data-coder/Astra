#!/usr/bin/env python3
"""
Natural conversation job-interview audio based on Sri Naidu ATTP resume.

Source: jd and resume/Sri_Naidu_ATTP_Resume.pdf

Design:
  - Warm, conversational interviewer voice (no "Question 1" labels)
  - Grounded in resume roles: McKesson, Moderna, Cynosure, Biogen
  - Exactly 20 seconds of silence between questions (answer time)
  - Soft cue beep before each question

Outputs (under jd and resume/):
  sri_naidu_resume_interview_natural.mp3
  sri_naidu_resume_interview_natural.wav
  sri_naidu_resume_interview_natural_questions.txt

Usage (from src/):
  venv\\Scripts\\python.exe generate_resume_natural_interview_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Conversational prompts — TTS-friendly spacing of acronyms
# No meta labels spoken ("question three", "follow-up", etc.)
QUESTIONS: list[str] = [
    # Warm open — career story
    (
        "Thanks for making the time today. I'd love to start with your story. "
        "Walk me through your path into S A P A T T P and track and trace — "
        "what pulled you into serialization, and what kept you there for more than twelve years?"
    ),
    # Current role — McKesson
    (
        "You're currently at McKesson as an A T T P techno-functional consultant. "
        "In plain terms, what does a good day look like for you on inbound and outbound "
        "serialization — receiving verification, outbound shipping events, and the partners you touch?"
    ),
    # DSCSA / VRS from resume
    (
        "You mentioned saleable returns and the V R S path. "
        "Tell me about a real case where a serial didn't verify against the manufacturer. "
        "What did you check first, who did you pull in, and how did you close it without "
        "blocking the warehouse all afternoon?"
    ),
    # AIF / operations
    (
        "A lot of people say they know A I F — few live in slash A I F slash I F M O N. "
        "When E P C I S messages start failing mid-day, how do you triage? "
        "What do you fix in A T T P yourself, and when do you escalate to middleware?"
    ),
    # Master data
    (
        "Trading partners, G L Ns, G T I Ns, lots — master data is where programs quietly die. "
        "How do you set up and keep partner and location master clean at a distributor scale, "
        "especially when suppliers and three P Ls change faster than I T likes?"
    ),
    # SD / delivery cycle
    (
        "You work the S D side — sales orders, deliveries, P G I. "
        "Where in the delivery cycle should the shipping E P C I S event fire, "
        "and what goes wrong if it fires too early or too late?"
    ),
    # Moderna — CMO/3PL primary contact
    (
        "At Moderna you were the person partners escalated to when an exchange broke. "
        "Paint me a picture of a messy C M O or three P L incident — what broke, "
        "how you sat between business, I T, and partner I T, and what you changed so it didn't repeat."
    ),
    # AS-IS / TO-BE workshops
    (
        "You ran A S-I S and T O-B E workshops on serial requests, commissioning, packing, and shipping. "
        "How do you run those workshops so they stay honest — not a slide deck of wishes — "
        "and still land a design partners can actually implement?"
    ),
    # Implementation Guidelines
    (
        "Implementation Guidelines and E P C I S mapping specs — that is partner contract language, not fluff. "
        "What belongs in a good I G, and how do you hold a C M O accountable when their file drifts "
        "off the agreed fields, business steps, or dispositions?"
    ),
    # Edge cases
    (
        "Partial pallets, re-aggregation, returns — the edge cases partners always bring. "
        "Tell me about a gap you found between standard A T T P and how a three P L really operated. "
        "What did you design around it without pretending standard config covered it?"
    ),
    # Multi-market
    (
        "You rolled out E U F M D to the E M V S hub, then layered Russia, South Korea, and China. "
        "How do you keep market rules from contaminating each other on a shared packaging line, "
        "and what would you refuse if someone asked for one global map for everything?"
    ),
    # Integration stack
    (
        "Middleware — B O O M I, C P I, A S two, S F T P. "
        "Walk me through how you partner with the integration team to stand up a new C M O: "
        "auth, connectivity, test cases, and the moment you say they are ready for production."
    ),
    # Green-field Cynosure
    (
        "At Cynosure you did a green-field A T T P build — empty repository to first live C M O. "
        "If you had to sequence that again next month, what are the first five things you stand up, "
        "and what do you refuse to skip before go-live?"
    ),
    # Validation / GxP
    (
        "Everything has to survive an audit — G A M P five, twenty-one C F R Part eleven, I Q O Q P Q. "
        "How do you write functional and configuration specs and U A T so Quality trusts the trail, "
        "without drowning the project in paperwork theater?"
    ),
    # Biogen foundation
    (
        "Earlier at Biogen you cleaned G T I N and G L N master data and sat between Quality, "
        "Regulatory, and Labeling. How does that foundation still show up in how you work today "
        "when a new product or new market comes online?"
    ),
    # RISE / S/4
    (
        "At McKesson you supported a RISE with S A P discovery for the serialization landscape. "
        "What upgrade impacts to A T T P interfaces and master data would you put in front of "
        "leadership first — and when would you say Conditional or Red instead of Green?"
    ),
    # Behavioral / conflict
    (
        "Give me a time leadership wanted product to ship and serialization integrity was at risk. "
        "What did you say, what control did you put on the table, and how did you keep the relationship "
        "while still protecting the patient and the audit story?"
    ),
    # Strengths / close
    (
        "Last one. For this kind of A T T P techno-functional role — partners, E P C I S, compliance, "
        "and hands-on config — what do you want us to remember about how you work when things get messy? "
        "And what is one question you wish interviewers asked more often?"
    ),
]

GAP_SECONDS = 20

INTRO = (
    "Good morning. Thanks for joining me today. "
    "This will feel like a conversation more than a quiz. "
    "I have read your background in S A P A T T P, track and trace, and partner integration — "
    "McKesson, Moderna, Cynosure, Biogen. "
    "I will ask a question, then give you about twenty seconds of quiet so you can answer fully. "
    "There is a soft tone before each question. Ready when you are. Let's begin."
)

OUTRO = (
    "That is everything I had prepared. Thank you for the thoughtful answers and for walking "
    "through the real operational detail. We will be in touch on next steps. "
    "This interview is complete. Take care."
)

OUT_DIR = Path(__file__).resolve().parent / "jd and resume"
OUT_STEM = "sri_naidu_resume_interview_natural"
RESUME_NOTE = "Sri_Naidu_ATTP_Resume.pdf"


def _load_env() -> None:
    _env = Path(__file__).resolve().parent / ".env"
    if not _env.exists():
        return
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not (os.environ.get("OPENAI_BASE_URL") or "").strip():
        os.environ.pop("OPENAI_BASE_URL", None)


def main() -> int:
    import asyncio

    from pydub import AudioSegment
    from pydub.generators import Sine

    _load_env()

    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)
    print(f"Questions: {len(QUESTIONS)}", flush=True)
    print(f"Gap: {GAP_SECONDS}s silence between questions", flush=True)
    print(f"Resume: {RESUME_NOTE}", flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_mp3 = OUT_DIR / f"{OUT_STEM}.mp3"
    out_wav = OUT_DIR / f"{OUT_STEM}.wav"
    out_txt = OUT_DIR / f"{OUT_STEM}_questions.txt"

    lines = [
        "Natural conversation job interview — based on resume",
        f"Resume: {RESUME_NOTE}",
        f"Questions: {len(QUESTIONS)}",
        f"Gap between questions: {GAP_SECONDS}s exact",
        f"TTS engine: {engine}",
        "Style: warm conversational interviewer; no question numbers spoken",
        "",
        "Spoken intro:",
        INTRO,
        "",
    ]
    for i, text in enumerate(QUESTIONS, 1):
        lines.append(f"{i}. {text}")
        lines.append("")
    lines.append("Spoken outro:")
    lines.append(OUTRO)
    out_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_txt}", flush=True)

    openai_client = None
    if use_openai:
        from openai import OpenAI

        openai_client = OpenAI(api_key=api_key)

    silence = AudioSegment.silent(duration=int(GAP_SECONDS * 1000))
    short_pause = AudioSegment.silent(duration=750)
    # Soft cue before each question (not part of the 20s answer gap)
    beep = Sine(880).to_audio_segment(duration=100).apply_gain(-13)

    combined = AudioSegment.silent(duration=450)
    tmp_dir = Path(tempfile.mkdtemp(prefix="astra_resume_tts_"))

    def tts(text: str, label: str) -> AudioSegment:
        print(f"  TTS: {label}...", flush=True)
        tmp = tmp_dir / f"{label}.mp3"
        if use_openai and openai_client is not None:
            with openai_client.audio.speech.with_streaming_response.create(
                model="tts-1-hd",
                voice="onyx",
                input=text,
            ) as resp:
                resp.stream_to_file(str(tmp))
        else:
            import edge_tts

            # Calm, natural male interviewer voice
            communicate = edge_tts.Communicate(text, voice="en-US-GuyNeural", rate="-5%")
            asyncio.run(communicate.save(str(tmp)))
        return AudioSegment.from_file(tmp)

    print("Generating intro...", flush=True)
    combined += tts(INTRO, "intro")
    combined += short_pause

    for i, text in enumerate(QUESTIONS, 1):
        combined += beep + AudioSegment.silent(duration=200)
        combined += tts(text, f"Q{i:02d}")
        if i < len(QUESTIONS):
            print(f"  gap {GAP_SECONDS}s after Q{i}", flush=True)
            combined += silence
        else:
            # Short breath after last answer window before outro
            combined += AudioSegment.silent(duration=1500)

    combined += short_pause
    combined += tts(OUTRO, "outro")
    combined += AudioSegment.silent(duration=900)

    print(f"Exporting {out_mp3} ...", flush=True)
    combined.export(str(out_mp3), format="mp3", bitrate="128k")
    duration_s = len(combined) / 1000.0
    print(f"Wrote {out_mp3} ({duration_s:.1f}s / {duration_s / 60:.1f} min)", flush=True)
    try:
        combined.export(str(out_wav), format="wav")
        print(f"Wrote {out_wav}", flush=True)
    except Exception as e:
        print(f"WAV export skipped: {e}", flush=True)

    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
