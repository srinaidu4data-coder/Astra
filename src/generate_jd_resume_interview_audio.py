#!/usr/bin/env python3
"""
Generate JD + Resume practice interview audio for SAP ATTP Techno-Functional.

Source of truth:
  - src/jd and resume/jd.txt
  - src/jd and resume/Sri_Naidu_ATTP_Resume.pdf

Design:
  - 5 commitment arcs × 5 spoken prompts = 25 questions
  - Each arc opens with a hard Yes/No or single-word trap (psych: commitment-consistency)
  - Next 4 are scenario / architect trade-off pressure tests that re-anchor the opener
  - Conversational voice — no "follow-up", "theme", or "question number" labels
  - Exactly 18 seconds of silence between spoken prompts (within 15–20s ask)

Outputs (under jd and resume/):
  sri_naidu_attp_jd_interview_25q.mp3
  sri_naidu_attp_jd_interview_25q.wav   (if export succeeds)
  sri_naidu_attp_jd_interview_25q_questions.txt

Usage (from src/):
  venv\\Scripts\\python.exe generate_jd_resume_interview_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Interview prompts — conversational, TTS-friendly spelling of acronyms
# Psych techniques: commitment-consistency, anchoring, scarcity, authority,
# status challenge, sunk-cost pressure, peak-end, cognitive load, reciprocity
# ---------------------------------------------------------------------------

# (arc_id, rung, text) — rung is metadata only (never spoken)
QUESTIONS: list[tuple[str, str, str]] = [
    # ------------------------------------------------------------------
    # ARC 1 — Ship-block on incomplete aggregation (commitment: Yes)
    # JD: serial flow MAH/CMO/3PL, partial pallets, gaps vs standard ATTP
    # Resume: Moderna edge cases, McKesson outbound shipping events
    # ------------------------------------------------------------------
    (
        "1",
        "open",
        "Thanks for coming in. Let's start simple. Yes or no only — "
        "should shipping be blocked when parent-child aggregation is incomplete?",
    ),
    (
        "1",
        "s1",
        "Picture this. Your marketing authorization holder has a contract manufacturer "
        "that commissions twenty thousand serials on time, but the third-party logistics "
        "provider can only send partial-pallet deaggregation once a day as a flat file — "
        "not real-time E P C I S. Leadership wants product to leave the dock tonight. "
        "Walk me through the architecture you would actually ship: where do you hold the "
        "serial state, what do you refuse to fake in A T T P, and how does that choice "
        "still honor a hard ship-block when aggregation is incomplete?",
    ),
    (
        "1",
        "s2",
        "Same network, new pressure. Quality says patient-impact risk is non-zero if "
        "orphaned children leave under a parent S S C C that never existed. Operations "
        "says blocking ships burns two million dollars of inventory this week. Design "
        "the trade-off you put in front of leadership — including the control that "
        "replaces a soft warning — and tell me why that design still treats incomplete "
        "aggregation as a hard stop, not a soft flag.",
    ),
    (
        "1",
        "s3",
        "A V P claims standard A T T P already covers partial pallets and you are "
        "over-engineering. You have seen three P L rework and returns create unknown "
        "locations and broken parent-child links. How do you prove the capability gap "
        "with event-level evidence — G T I N, G L N, S S C C, business step, disposition — "
        "and still defend the same ship-block posture without looking political?",
    ),
    (
        "1",
        "s4",
        "Cutover night. Ten thousand serials already commissioned with the wrong parent "
        "S S C C. Shipping starts in six hours. Sequence the recovery — A T T P, "
        "middleware, partner file, Quality communication — and show me which steps you "
        "will not take because they would re-open the incomplete-aggregation loophole "
        "you refused earlier.",
    ),
    # ------------------------------------------------------------------
    # ARC 2 — Master-data ownership (commitment: MAH)
    # JD: configure partners/GLNs/GTINs; resume: McKesson + Moderna ownership
    # ------------------------------------------------------------------
    (
        "2",
        "open",
        "One word only. Who owns the golden G T I N and serial-number range authority "
        "in a multi-C M O, multi-three-P L network — M A H, C M O, three P L, or "
        "Integration?",
    ),
    (
        "2",
        "s1",
        "A C M O commissions under their own G L N but ships under M A H branding. "
        "The three P L receives against a G L N A T T P never saw. Serials land as "
        "unknown location. Design the to-be ownership model event by event — serial "
        "request, commissioning, packing, shipping, receiving — and show how that "
        "model still keeps golden G T I N and range authority where you just put it.",
    ),
    (
        "2",
        "s2",
        "Two C M Os want independent range pools so they never wait on M A H I T. "
        "Compliance wants one auditable chain for U S D S C S A saleable returns. "
        "What architecture do you choose for range management and partner auth in "
        "A T T P, what do you give the C M Os so they can still run production, and "
        "why does that not surrender the ownership word you used a moment ago?",
    ),
    (
        "2",
        "s3",
        "During an S slash four migration you reconcile historical serials and partner "
        "records. Some G L Ns in A T T P disagree with E W M and S D. Walk the master-data "
        "cutover design — what is system of record, what is derived, what fails closed — "
        "and how you keep trading-partner authorization from drifting while ranges stay "
        "owned the way you said.",
    ),
    (
        "2",
        "s4",
        "A partner I T team rewrites their mapping and starts sending commissioning "
        "under a new company prefix you never authorized. A I F is flooding. How do "
        "you design the containment — repository rules, authentication settings, "
        "B O O M I or C P I gate, onboarding freeze — so production can recover without "
        "silently reassigning who owns the golden identifiers?",
    ),
    # ------------------------------------------------------------------
    # ARC 3 — One map vs market-specific EPCIS (commitment: No)
    # JD: DSCSA vs EU FMD; resume: EMVS, multi-market Moderna
    # ------------------------------------------------------------------
    (
        "3",
        "open",
        "Yes or no only. Will you accept one global E P C I S map for both U S D S C S A "
        "and E U F M D to save partner cost?",
    ),
    (
        "3",
        "s1",
        "The C M O's integration lead says one map cuts three months off the program. "
        "Legal still wants D S C S A transaction statements and E U hub reporting that "
        "survive an inspection. Design the message architecture — shared core versus "
        "market-specific extensions — and explain the trade-off you refuse so your "
        "no on a single global map still stands.",
    ),
    (
        "3",
        "s2",
        "Russia, South Korea, and China are joining the same packaging line after "
        "E U F M D is live. How do you structure A T T P configuration, notification "
        "rules, and partner I Gs so markets do not contaminate each other, and how "
        "does that structure stay consistent with rejecting one flattened global map?",
    ),
    (
        "3",
        "s3",
        "A three P L can only support daily batch files for one market and near-real-time "
        "A S two for another. Middleware is Dell B O O M I into A T T P. Draw the "
        "integration pattern — protocols, retries, reconciliation, A I F monitoring — "
        "and show where you accept latency versus where you refuse to collapse the "
        "regulatory event model into one partner convenience format.",
    ),
    (
        "3",
        "s4",
        "U A T is tomorrow. A tester finds a disposition that is valid for E U but "
        "dangerous if reused on a U S saleable-return path through V R S. How do you "
        "re-architect the test matrix and the configuration boundary overnight, and "
        "what do you tell the program manager when they ask to 'just share the map'?",
    ),
    # ------------------------------------------------------------------
    # ARC 4 — Manual spreadsheet interim (commitment: No / Reject)
    # JD: GAMP 5, Part 11, validation; resume: FS/CS/UAT, IQ/OQ/PQ
    # ------------------------------------------------------------------
    (
        "4",
        "open",
        "One word only — Approve, Conditional, or Reject. A three P L proposes that "
        "warehouse clerks upload a spreadsheet of serial events into production for "
        "ninety days while A S two is built. Your gate decision?",
    ),
    (
        "4",
        "s1",
        "Compliance just quoted G A M P five and twenty-one C F R Part eleven. "
        "The business still needs an interim because the partner cannot meet the "
        "go-live date. Design an interim that is not a spreadsheet free-for-all — "
        "or defend why no interim is safer — and show how that design still matches "
        "the gate word you just used.",
    ),
    (
        "4",
        "s2",
        "You must author Functional Spec, Configuration Spec, and U A T under a "
        "validated landscape. Where does partner onboarding testing end and regulated "
        "system change begin? Walk the validation boundary for E P C I S exchanges "
        "with C M Os and three P Ls, including what evidence you keep for audit when "
        "someone later claims the spreadsheet was 'temporary but approved'.",
    ),
    (
        "4",
        "s3",
        "Green-field cutover. Empty A T T P repository to first live C M O connection. "
        "How do you sequence repository config, trading partners, G L Ns, G T I N and "
        "S S C C master data, E two E simulation of a production run, and hypercare "
        "so you never rely on uncontrolled manual loads to fake readiness?",
    ),
    (
        "4",
        "s4",
        "A senior director says if you reject the spreadsheet, they will run it outside "
        "I T and 'reconcile later'. Architect your escalation path — risk language, "
        "who signs, what you put in writing, what you monitor in A I F afterward — "
        "so your Reject decision does not become a silent shadow process.",
    ),
    # ------------------------------------------------------------------
    # ARC 5 — RISE / transformation (commitment: Conditional)
    # JD: RISE discovery; resume: McKesson RISE impact to ATTP interfaces
    # ------------------------------------------------------------------
    (
        "5",
        "open",
        "One word only. For a RISE with SAP discovery on a live serialization landscape — "
        "Green, Conditional, or Red — what is your leadership recommendation if A T T P "
        "interfaces and partner maps have not been impact-assessed?",
    ),
    (
        "5",
        "s1",
        "Leadership wants a two-slide answer by Friday. You have S slash four, A T T P, "
        "E W M, S D, and a web of A S two and S F T P partners. Design the discovery "
        "method you actually run — what you inventory, what you spike, what you refuse "
        "to guess — so a Conditional or Red call is evidence-based, not fear-based.",
    ),
    (
        "5",
        "s2",
        "During upgrade impact analysis you find serial history, partner auth settings, "
        "and A I F error queues that may not migrate cleanly. Trade off big-bang versus "
        "strangler patterns for serialization. Why does your pattern protect the "
        "recommendation word you gave leadership, and what would force you to flip it?",
    ),
    (
        "5",
        "s3",
        "Distribution is live on D S C S A receiving verification and outbound shipping "
        "events. A RISE cutover window collides with peak shipping week. Architect the "
        "go / no-go criteria that keep patient-safety and trading-partner continuity "
        "above project optics — and show how those criteria still honor the one-word "
        "posture you took on unassessed interfaces.",
    ),
    (
        "5",
        "s4",
        "Last one. You are the primary point between business, I T, and external partner "
        "I T. A C M O refuses workshops, a three P L only has a twenty twenty-one P D F, "
        "and RISE timelines are locked. What do you put in writing this week that is "
        "not fiction, what do you explicitly not sign, and how does that close the "
        "loop on treating unassessed serialization interfaces with the caution you "
        "named at the start of this arc?",
    ),
]

GAP_SECONDS = 18  # exactly 18s between questions (within 15–20s)

INTRO = (
    "Good morning. Thanks for joining me. Today I want to go deep on your "
    "S A P A T T P work — track and trace, partner integration, and the design "
    "calls that do not show up in a slide deck. I will pause after each question "
    "so you can answer fully. Ready when you are. Let's begin."
)

OUTRO = (
    "That is all I have for you today. Thank you for walking the trade-offs with me. "
    "We will follow up on next steps. This interview is complete."
)

OUT_DIR = Path(__file__).resolve().parent / "jd and resume"
OUT_STEM = "sri_naidu_attp_jd_interview_25q"


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

    assert len(QUESTIONS) >= 25, f"Need at least 25 questions, got {len(QUESTIONS)}"

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)
    print(f"Prompts: {len(QUESTIONS)}", flush=True)
    print(f"Gap: {GAP_SECONDS}s exact silence between questions", flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_mp3 = OUT_DIR / f"{OUT_STEM}.mp3"
    out_wav = OUT_DIR / f"{OUT_STEM}.wav"
    out_txt = OUT_DIR / f"{OUT_STEM}_questions.txt"

    lines = [
        "SAP ATTP Techno-Functional — JD + Resume interview",
        f"Sources: jd and resume/jd.txt + Sri_Naidu_ATTP_Resume.pdf",
        f"Questions: {len(QUESTIONS)} (5 arcs × hard open + 4 architect scenarios)",
        f"Gap between questions: {GAP_SECONDS}s exact",
        f"TTS engine: {engine}",
        "Psych: commitment-consistency, anchoring, scarcity, authority, status challenge,",
        "       sunk-cost, peak-end, cognitive load — conversational, no meta labels",
        "",
        "Spoken intro:",
        INTRO,
        "",
    ]
    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        kind = "HARD OPEN (yes/no or one-word)" if rung == "open" else "SCENARIO / ARCH TRADE-OFF"
        lines.append(f"{i}. [arc {arc} | {kind}]")
        lines.append(f"   {text}")
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
    short_pause = AudioSegment.silent(duration=700)
    # Soft cue before each prompt (not counted as the 18s answer gap)
    beep = Sine(880).to_audio_segment(duration=90).apply_gain(-14)
    hard_beep = (
        Sine(660).to_audio_segment(duration=70).apply_gain(-11)
        + AudioSegment.silent(duration=50)
        + Sine(990).to_audio_segment(duration=70).apply_gain(-11)
    )

    combined = AudioSegment.silent(duration=400)
    tmp_dir = Path(tempfile.mkdtemp(prefix="astra_jd_tts_"))

    def tts(text: str, label: str) -> AudioSegment:
        print(f"  TTS: {label}...", flush=True)
        tmp = tmp_dir / f"{label}.mp3"
        if use_openai and openai_client is not None:
            with openai_client.audio.speech.with_streaming_response.create(
                model="tts-1",
                voice="onyx",
                input=text,
            ) as resp:
                resp.stream_to_file(str(tmp))
        else:
            import edge_tts

            communicate = edge_tts.Communicate(text, voice="en-US-GuyNeural")
            asyncio.run(communicate.save(str(tmp)))
        return AudioSegment.from_file(tmp)

    print("Generating intro...", flush=True)
    combined += tts(INTRO, "intro")
    combined += short_pause

    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        cue = hard_beep if rung == "open" else beep
        combined += cue + AudioSegment.silent(duration=180)
        combined += tts(text, f"Q{i:02d}_A{arc}_{rung}")
        if i < len(QUESTIONS):
            print(f"  gap {GAP_SECONDS}s after Q{i}", flush=True)
            combined += silence

    combined += short_pause
    combined += tts(OUTRO, "outro")
    combined += AudioSegment.silent(duration=800)

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
