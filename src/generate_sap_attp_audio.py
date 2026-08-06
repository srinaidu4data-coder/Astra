#!/usr/bin/env python3
"""
Generate SAP ATTP high-pressure practice interview audio.

10 themes × (main + 4 follow-ups) = 50 spoken prompts.
Follow-ups 3–4 are deliberate Yes/No or single-word traps.

Outputs (under test_audio/):
  sap_attp_interview_50.mp3
  sap_attp_interview_50.wav  (if ffmpeg available via pydub)
  sap_attp_interview_50_flat.txt
  sap_attp_interview_bank.txt  (human bank; written if missing)

Usage (from src/):
  venv\\Scripts\\python.exe generate_sap_attp_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Spoken prompts (TTS-friendly: spell out acronyms lightly, dramatic cadence)
# Order: Main, F1, F2, F3 (yes/no), F4 (single-word)
# ---------------------------------------------------------------------------

QUESTIONS: list[tuple[str, str, str]] = [
    # (theme_label, rung_label, text)
    # THEME 1
    (
        "1",
        "main",
        "Theme one, main scenario. You walk into a serialization program where the marketing authorization holder, two contract manufacturers, and one third-party logistics provider all claim A T T P is already live. Shipping works for full pallets, but partial pallets, rework, and returns create orphan serial numbers. How do you run discovery to map as-is event flows and design a to-be process that A T T P can actually enforce?",
    ),
    (
        "1",
        "follow1",
        "Theme one, follow-up one. Business wants the to-be signed this Friday. C M O I T refuses workshops. The three P L only shares a P D F from twenty twenty-one. Compliance says the D S C S A timeline is non-negotiable. What do you deliver by Friday that is not fiction, and what do you explicitly refuse to sign?",
    ),
    (
        "1",
        "follow2",
        "Theme one, follow-up two. A V P says standard A T T P covers this, stop over-engineering. You believe partial-pallet deaggregation at the three P L is a real gap. How do you prove the gap with evidence, and how do you present decision options to leadership without looking political?",
    ),
    (
        "1",
        "follow3",
        "Theme one, follow-up three. Yes or no only. Will you sign the to-be process as complete without a live C M O workshop?",
    ),
    (
        "1",
        "follow4",
        "Theme one, follow-up four. One word only. Approve, Conditional, or Reject — for the program go-live gate this sprint.",
    ),
    # THEME 2
    (
        "2",
        "main",
        "Theme two, main scenario. Define end-to-end how serial number requests, commissioning, packing, shipping, and receiving events should flow between the M A H, C M O, and three P L on SAP A T T P, including who owns G T I N, G L N, S S C C, and business partner master data.",
    ),
    (
        "2",
        "follow1",
        "Theme two, follow-up one. The C M O commissions under their G L N but ships under M A H branding. The three P L receives against a different G L N than A T T P expects. Serials land as unknown location. Walk the failure path event by event and show the corrected ownership model.",
    ),
    (
        "2",
        "follow2",
        "Theme two, follow-up two. Production already ran. Ten thousand serials are commissioned with wrong parent S S C C aggregation. Shipping starts in six hours. What is your recovery sequence, and what do you tell Quality if patient-impact risk is non-zero?",
    ),
    (
        "2",
        "follow3",
        "Theme two, follow-up three. Yes or no. Should shipping be blocked when parent-child aggregation is incomplete?",
    ),
    (
        "2",
        "follow4",
        "Theme two, follow-up four. One word only. Who is accountable if those ten thousand serials ship broken — M A H, C M O, three P L, or Integration?",
    ),
    # THEME 3
    (
        "3",
        "main",
        "Theme three, main scenario. How do you systematically identify gaps between standard SAP A T T P capabilities and partner operational realities: partial pallets, late aggregation, returns, rework, and mixed-lot handling? Give me your gap matrix method.",
    ),
    (
        "3",
        "follow1",
        "Theme three, follow-up one. The three P L can only send daily flat files, not real-time E P C I S. Legal still wants D S C S A-grade traceability. Design the interim control and the A T T P configuration boundaries you will not cross.",
    ),
    (
        "3",
        "follow2",
        "Theme three, follow-up two. A partner closes the gap with a manual spreadsheet upload by warehouse clerks. Validation and Part eleven teams call it a compliance bomb. Do you allow it for ninety days? Defend your position with G A M P five language.",
    ),
    (
        "3",
        "follow3",
        "Theme three, follow-up three. Yes or no. Is a manual spreadsheet upload an acceptable E P C I S substitute in production?",
    ),
    (
        "3",
        "follow4",
        "Theme three, follow-up four. One word. Risk rating for that interim — Low, Medium, High, or Critical.",
    ),
    # THEME 4
    (
        "4",
        "main",
        "Theme four, main scenario. Your M A H ships U S and E U packs through shared C M Os. Explain how A T T P design must differ for U S D S C S A versus E U F M D, and where a single global process will fail if forced.",
    ),
    (
        "4",
        "follow1",
        "Theme four, follow-up one. A C M O wants one E P C I S map for both markets to save cost. You suspect that collapses required fields and dispositions. How do you refute them with concrete message-level examples, not slogans?",
    ),
    (
        "4",
        "follow2",
        "Theme four, follow-up two. An E U affiliate says a U S-only design is already live and works. A recall drill fails to reconstruct pedigree across borders. Who failed — A T T P config, process, partner, or requirements — and what is your forty-eight hour containment plan?",
    ),
    (
        "4",
        "follow3",
        "Theme four, follow-up three. Yes or no. Can one E P C I S Implementation Guideline fully cover D S C S A and F M D for this network without market-specific variants?",
    ),
    (
        "4",
        "follow4",
        "Theme four, follow-up four. One word. Primary root cause of the failed recall drill — Data, Design, Partner, or Process.",
    ),
    # THEME 5
    (
        "5",
        "main",
        "Theme five, main scenario. Walk me through how you configure A T T P repository master data for C M Os and three P Ls: business partners, locations with G L Ns, G T I Ns, and S S C C rules. What is mandatory before the first commissioning event?",
    ),
    (
        "5",
        "follow1",
        "Theme five, follow-up one. Two plants share a G L N by mistake. Commissioning succeeds; shipping events misroute. How do you detect, correct historical events if possible, and prevent recurrence with governance?",
    ),
    (
        "5",
        "follow2",
        "Theme five, follow-up two. Master data steward is on leave. Middleware is ready. Business wants to hardcode G L Ns in Boomi mappings temporarily. Your call as A T T P techno-functional lead?",
    ),
    (
        "5",
        "follow3",
        "Theme five, follow-up three. Yes or no. Will you allow G L Ns hardcoded in Boomi for go-live?",
    ),
    (
        "5",
        "follow4",
        "Theme five, follow-up four. One word. If you refuse and go-live slips, who do you escalate first — Business, I T, Compliance, or Program?",
    ),
    # THEME 6
    (
        "6",
        "main",
        "Theme six, main scenario. Design the standard G S one E P C I S message set for a C M O and a three P L integrating to A T T P. Which business steps and dispositions are mandatory for commissioning, packing, shipping, and receiving in your Implementation Guideline?",
    ),
    (
        "6",
        "follow1",
        "Theme six, follow-up one. Partner returns events with missing event time, wrong business step, and disposition active on destroy scenarios. A T T P rejects half the feed. How do you triage config versus mapping versus partner process in one working session?",
    ),
    (
        "6",
        "follow2",
        "Theme six, follow-up two. Partner claims your Implementation Guideline is non-standard and not G S one. You know your guideline is a constrained profile. How do you run the standards argument without losing the onboarding timeline?",
    ),
    (
        "6",
        "follow3",
        "Theme six, follow-up three. Yes or no. Is a missing event time always a hard reject?",
    ),
    (
        "6",
        "follow4",
        "Theme six, follow-up four. Answer with one word only. For destroy events, the correct disposition should be… what?",
    ),
    # THEME 7
    (
        "7",
        "main",
        "Theme seven, main scenario. How do you configure A T T P rules, system schemas, and authentication so only authorized partners can exchange serialization data with specific locations and products?",
    ),
    (
        "7",
        "follow1",
        "Theme seven, follow-up one. A rogue test certificate from a C M O still works in production and posts events against a live G T I N. Security is furious. Reconstruct how this was possible and the permanent control stack you implement.",
    ),
    (
        "7",
        "follow2",
        "Theme seven, follow-up two. Business wants a break-glass shared technical user for all three P Ls during peak season. Refuse or accept? Justify under Part eleven and operational reality.",
    ),
    (
        "7",
        "follow3",
        "Theme seven, follow-up three. Yes or no. Shared technical users across partners — allowed in production?",
    ),
    (
        "7",
        "follow4",
        "Theme seven, follow-up four. One word. Maximum acceptable authentication model for partners — Certificate, Basic, Token, or Mutual T L S.",
    ),
    # THEME 8
    (
        "8",
        "main",
        "Theme eight, main scenario. Collaborate with middleware. How do you design secure partner connections for A T T P traffic using A S two, S F T P, and web services, and what does the A T T P consultant own versus the Dell Boomi team?",
    ),
    (
        "8",
        "follow1",
        "Theme eight, follow-up one. A S two works in lower environments; production A S two fails intermittently with partner timeouts. Serialization backlog grows. How do you run triage across network, Boomi, A T T P, and partner — and what interim business process do you authorize?",
    ),
    (
        "8",
        "follow2",
        "Theme eight, follow-up two. Boomi lead says A T T P is rejecting good messages. Your logs show schema violations. How do you run a joint war room so the partner trusts the diagnosis?",
    ),
    (
        "8",
        "follow3",
        "Theme eight, follow-up three. Yes or no. Should business shipping continue if A T T P event posting is delayed by more than four hours?",
    ),
    (
        "8",
        "follow4",
        "Theme eight, follow-up four. One word. Preferred production connectivity for regulated event exchange with a mature three P L — A S two, S F T P, or A P I.",
    ),
    # THEME 9
    (
        "9",
        "main",
        "Theme nine, main scenario. You are the primary technical contact guiding C M O and three P L I T through testing and onboarding. Describe the pipeline from Implementation Guideline sign-off to production cutover, including end-to-end tests that simulate automated C M O production runs and three P L fulfillment.",
    ),
    (
        "9",
        "follow1",
        "Theme nine, follow-up one. Partner passes unit tests but fails end-to-end when volumes hit ten thousand serials per hour. Where do you look first — A T T P, Boomi, partner, network — and what performance evidence do you demand before go-live?",
    ),
    (
        "9",
        "follow2",
        "Theme nine, follow-up two. U A T sign-off is green, but a shadow production pilot shows two percent event loss. Program wants to go live anyway. What is your recommendation, and how do you document residual risk?",
    ),
    (
        "9",
        "follow3",
        "Theme nine, follow-up three. Yes or no. Do you approve go-live with two percent event loss?",
    ),
    (
        "9",
        "follow4",
        "Theme nine, follow-up four. One word. Your go-live vote — Go, No Go, or Defer.",
    ),
    # THEME 10
    (
        "10",
        "main",
        "Theme ten, main scenario. Author validation deliverables for A T T P integration: Functional Spec, Configuration Spec, and U A T scripts under G A M P five and twenty-one C F R Part eleven. What must be testable, and what is out of scope for electronic signature controls?",
    ),
    (
        "10",
        "follow1",
        "Theme ten, follow-up one. Auditor challenges that partner-facing configuration changes lack adequate audit trail and dual control. How do you remediate without freezing all partner onboarding?",
    ),
    (
        "10",
        "follow2",
        "Theme ten, follow-up two. Leadership asks you to lead discovery for RISE with SAP impact on A T T P, interfaces, and validation. What risks do you put on the first slide for executives, and what will you not estimate in week one?",
    ),
    (
        "10",
        "follow3",
        "Theme ten, follow-up three. Yes or no. Does moving to RISE automatically re-validate all A T T P partner interfaces?",
    ),
    (
        "10",
        "follow4",
        "Theme ten, follow-up four. One word. Biggest RISE risk to A T T P — Connectivity, Validation, Master Data, or Timeline.",
    ),
]

GAP_SECONDS = 12
INTRO = (
    "Welcome to your SAP A T T P techno-functional interview simulation. "
    "This is a high-pressure session for a long-term contract role. "
    "There are ten themes. Each theme has one main scenario and four follow-ups. "
    "Follow-ups three and four demand yes-no or single-word answers. "
    "After every prompt you get twelve seconds of silence. "
    "Do not expect soft coaching. Begin."
)
OUTRO = (
    "That was the final prompt. This SAP A T T P pressure interview simulation is complete. "
    "Review where short answers trapped you. Thank you."
)


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
    # Empty OPENAI_BASE_URL breaks the OpenAI SDK
    if not (os.environ.get("OPENAI_BASE_URL") or "").strip():
        os.environ.pop("OPENAI_BASE_URL", None)


def main() -> int:
    import asyncio

    from pydub import AudioSegment
    from pydub.generators import Sine

    _load_env()

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)
    print(f"Prompts: {len(QUESTIONS)}", flush=True)

    out_dir = Path(__file__).resolve().parent / "test_audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_mp3 = out_dir / "sap_attp_interview_50.mp3"
    out_wav = out_dir / "sap_attp_interview_50.wav"
    out_flat = out_dir / "sap_attp_interview_50_flat.txt"

    # Flat human-readable list for STT tests / scoring
    lines = [
        "SAP ATTP Techno-Functional — 50 spoken prompts (10 themes × 5)",
        "Structure: Main → F1 scenario → F2 corner → F3 Yes/No → F4 single-word",
        f"Gap between questions: {GAP_SECONDS}s",
        f"TTS engine: {engine}",
        "Psych: commitment traps, cognitive load, status challenge, anchoring, compliance pressure",
        "",
    ]
    for i, (theme, rung, text) in enumerate(QUESTIONS, 1):
        lines.append(f"{i}. [Theme {theme} | {rung}] {text}")
    out_flat.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_flat}", flush=True)

    openai_client = None
    if use_openai:
        from openai import OpenAI

        openai_client = OpenAI(api_key=api_key)

    silence = AudioSegment.silent(duration=int(GAP_SECONDS * 1000))
    short_pause = AudioSegment.silent(duration=700)
    beep = Sine(880).to_audio_segment(duration=100).apply_gain(-14)
    # Sharper double-beep before trap questions (F3/F4)
    trap_beep = (
        Sine(660).to_audio_segment(duration=80).apply_gain(-10)
        + AudioSegment.silent(duration=60)
        + Sine(990).to_audio_segment(duration=80).apply_gain(-10)
    )

    combined = AudioSegment.silent(duration=400)
    tmp_dir = Path(tempfile.mkdtemp(prefix="astra_attp_tts_"))

    def tts(text: str, label: str) -> AudioSegment:
        print(f"  TTS: {label}...", flush=True)
        tmp = tmp_dir / f"{label}.mp3"
        if use_openai and openai_client is not None:
            with openai_client.audio.speech.with_streaming_response.create(
                model="tts-1",
                voice="onyx",  # firmer interview voice
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

    for i, (theme, rung, text) in enumerate(QUESTIONS, 1):
        is_trap = rung in ("follow3", "follow4")
        if is_trap:
            combined += trap_beep + AudioSegment.silent(duration=200)
        else:
            combined += beep + AudioSegment.silent(duration=150)
        combined += tts(text, f"Q{i:02d}_T{theme}_{rung}")
        if i < len(QUESTIONS):
            print(f"  gap {GAP_SECONDS}s after Q{i}", flush=True)
            combined += silence

    combined += short_pause
    combined += tts(OUTRO, "outro")
    combined += AudioSegment.silent(duration=800)

    print(f"Exporting {out_mp3} ...", flush=True)
    combined.export(str(out_mp3), format="mp3", bitrate="128k")
    print(f"Wrote {out_mp3} ({len(combined) / 1000:.1f}s)", flush=True)
    try:
        combined.export(str(out_wav), format="wav")
        print(f"Wrote {out_wav}", flush=True)
    except Exception as e:
        print(f"WAV export skipped: {e}", flush=True)

    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
