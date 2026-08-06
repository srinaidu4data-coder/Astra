#!/usr/bin/env python3
"""
Natural SAP BRIM Data Analysis & Migration Support interview audio (~1 hour).

Source JD: C:\\Users\\King2\\Downloads\\sriman jd.pdf
Output:    C:\\Users\\King2\\Downloads\\brim.mp3

Design:
  - 15 arcs × 4 prompts = 60 spoken questions
  - Arc open: Yes/No or single-word
  - Follow-ups: scenario / architect design trade-offs re-anchoring the open
  - Conversational interviewer; no meta labels spoken
  - Exactly 25 seconds silence between questions
  - Longer natural scenario prompts so session ≈ 1 hour with answer gaps

Usage:
  venv\\Scripts\\python.exe generate_brim_interview_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# (arc, rung, text)
QUESTIONS: list[tuple[str, str, str]] = [
    # ===== ARC 1 BODS vs EMIGALL transform ownership =====
    (
        "1",
        "open",
        "Thanks for making the time. Let's start simple. Yes or no only — "
        "for enterprise S A P B R I M migration, should business transformation "
        "logic live primarily in B O D S rather than inside E M I G A L L load objects?",
    ),
    (
        "1",
        "s1",
        "Alright, walk me through the real design. Your shop has strong B O D S skills "
        "and a hard cutover weekend. Functional colleagues want subscription and F I C A "
        "rules stuffed into E M I G A L L because that is what they did on older projects. "
        "Architect the boundary: what transforms, cleanses, and enrichments belong in "
        "B O D S jobs, workflows, and scripts; what E M I G A L L should only validate and "
        "load; and why that split still matches the yes-or-no you just gave — not a slide, "
        "the operating model you would defend in a design review.",
    ),
    (
        "1",
        "s2",
        "Same landscape, new pressure. Nightly B O D S for customer and billing master "
        "misses the batch window by several hours. Someone proposes moving heavy joins "
        "into the load step to remove a hop. How do you re-architect performance — "
        "pushdown, staging, parallelism, job splitting — without giving up the "
        "transformation ownership model you just defended?",
    ),
    (
        "1",
        "s3",
        "A senior developer starts coding one-off A B A P conversions 'because B O D S "
        "is slow this week'. What governance and technical trade-off do you put on the "
        "table so emergency code does not become the permanent migration path, and how "
        "does that still honor B O D S as the primary transform layer?",
    ),
    # ===== ARC 2 EMIGALL engine =====
    (
        "2",
        "open",
        "One word only. For F I C A contract accounts and open items into B R I M, "
        "primary load engine — E M I G A L L, B O D S, Migration Cockpit, or Custom?",
    ),
    (
        "2",
        "s1",
        "You must cover master data, transactional history, customer accounts, and "
        "billing related migration objects. Design the E M I G A L L object plan — "
        "sequence, dependencies, restarts, and what you refuse to force through a flat "
        "file — so your one-word engine choice survives a full mock conversion with "
        "finance watching the balances.",
    ),
    (
        "2",
        "s2",
        "Dress rehearsal: masters look fine, open items fail reconciliation to legacy. "
        "Architect the recovery — full reload versus delta, which objects freeze, what "
        "validation gates re-run — without casually switching engines unless evidence "
        "forces you to change that one word.",
    ),
    (
        "2",
        "s3",
        "Production cutover is twelve hours. At hour six an E M I G A L L object aborts "
        "at sixty percent. Walk the decision tree with BASIS and functional: restart, "
        "partial accept, or abort. What evidence do you need, and how does that "
        "discipline connect to choosing E M I G A L L in the first place?",
    ),
    # ===== ARC 3 Golden customer =====
    (
        "3",
        "open",
        "Yes or no. With C R M, legacy billing, and S slash four in play, should there "
        "be one golden customer master source before B R I M load?",
    ),
    (
        "3",
        "s1",
        "Legacy has three customer keys, C R M another, billing another. Design the "
        "identity and cross-reference approach in B O D S — match rules, survivorship, "
        "reject queues, and how keys land in B R I M and F I C A — so 'golden source' is "
        "not a slogan but an enforceable pipeline.",
    ),
    (
        "3",
        "s2",
        "Business wants dual maintenance in C R M and B R I M during hypercare. Do you "
        "accept it? If yes, what reconciliation architecture; if no, what interim "
        "control? Either way, show how it still respects your yes-or-no on a single "
        "golden customer source.",
    ),
    (
        "3",
        "s3",
        "U A T finds merged customers that should have stayed separate. How do you "
        "design unmerge, audit trail, and re-migration rules without poisoning already "
        "posted F I C A items?",
    ),
    # ===== ARC 4 SOM =====
    (
        "4",
        "open",
        "One word. Historical Subscription Order Management orders — Migrate, Rebuild, "
        "or Hybrid?",
    ),
    (
        "4",
        "s1",
        "Catalog and prices changed twice last year. Leadership wants every historical "
        "S O M order for analytics. Architect migrate versus rebuild-from-active "
        "contracts, including what history stays in a warehouse or archive. Defend your "
        "one-word choice against both C F O reporting and operational simplicity.",
    ),
    (
        "4",
        "s2",
        "Dispute process still needs closed-order references for eighteen months. Design "
        "crosswalks, selective migrate, or read-only legacy access so operations work "
        "without abandoning Migrate, Rebuild, or Hybrid.",
    ),
    (
        "4",
        "s3",
        "Active subscriptions must rate correctly on day one in Convergent Charging. "
        "How do S O M migration design choices constrain C C and C I cutover, and what "
        "trade-off do you escalate if timelines conflict?",
    ),
    # ===== ARC 5 Convergent Charging =====
    (
        "5",
        "open",
        "Yes or no only. Should rating and charging setup be migrated as data into "
        "Convergent Charging, or mostly re-implemented clean for go-live?",
    ),
    (
        "5",
        "s1",
        "Legacy rating has years of special-case tables, poorly documented. Design what "
        "you convert as data versus rebuild as C C configuration, how workshops feed "
        "B O D S mappings, and why that split matches your yes-or-no — including what "
        "you explicitly will not automate.",
    ),
    (
        "5",
        "s2",
        "Performance test: a migrated charge path is much slower at volume. Which levers "
        "first — data shape, batch design, config simplification, or infrastructure — "
        "and how do you avoid silently flipping the migrate-versus-rebuild decision?",
    ),
    (
        "5",
        "s3",
        "Product wants a new price plan two weeks before cutover. Architect the change "
        "path across master data, C C config, and migration deltas so you do not freeze "
        "innovation but also do not destabilize conversion.",
    ),
    # ===== ARC 6 Convergent Invoicing =====
    (
        "6",
        "open",
        "One word. Open invoices at cutover — Convert, Freeze-in-legacy, or Dual-run?",
    ),
    (
        "6",
        "s1",
        "Cash application cannot stop. Design convergent invoicing cutover for open "
        "invoices, payments on account, and disputes. Compare your one-word strategy "
        "to the other two on risk to revenue, customer experience, and reconciliation "
        "effort.",
    ),
    (
        "6",
        "s2",
        "Dress rehearsal: invoice counts match, amounts drift a fraction of a percent. "
        "Architect reconciliation — tolerances, root-cause paths, go-or-no-go — so "
        "nobody says 'load now, adjust in production'.",
    ),
    (
        "6",
        "s3",
        "Some bill documents depend on legacy tax engines not yet in S slash four. "
        "How do you design interim calculation, data staging, and later true-up without "
        "breaking the open-invoice strategy you chose?",
    ),
    # ===== ARC 7 FI-CA quality gates =====
    (
        "7",
        "open",
        "Yes or no. Will you allow partial F I C A open-item migration if master data "
        "quality is still red two weeks before dress rehearsal?",
    ),
    (
        "7",
        "s1",
        "Business says ship partial and cleanse later; compliance wants full integrity. "
        "Design quality gates — thresholds, blockers, which domains may lag — so your "
        "yes-or-no on partial open items is an architecture decision, not a hope.",
    ),
    (
        "7",
        "s2",
        "Balances match in aggregate but not at business-partner level. Walk triage "
        "across extract, B O D S transform, E M I G A L L object, and posting logic. "
        "What do you refuse to paper over with a manual journal?",
    ),
    (
        "7",
        "s3",
        "You must write migration test scenarios for F I C A objects. What minimal set "
        "of positive, negative, and boundary cases do you insist on before mock two, "
        "and who signs them?",
    ),
    # ===== ARC 8 Mapping ownership =====
    (
        "8",
        "open",
        "One word. Who signs source-to-target mapping complete before mock one — "
        "Business, Functional, Data, or Integration?",
    ),
    (
        "8",
        "s1",
        "Mappings for customer, contract account, subscription, and invoice structures "
        "are incomplete. Define done for a mapping pack — rules, defaults, rejects, "
        "reconciliation keys, samples — so the signer you named cannot rubber-stamp "
        "green status.",
    ),
    (
        "8",
        "s2",
        "After mock two a legacy field meaning changes. Design change control through "
        "B O D S jobs, E M I G A L L, validation scripts, and re-test scope without "
        "losing the accountability in your one-word answer.",
    ),
    (
        "8",
        "s3",
        "Offshore builders implement transforms from incomplete specs. How do you "
        "structure reviews, pair sessions, and defect SLAs so quality holds under "
        "schedule pressure?",
    ),
    # ===== ARC 9 Reconciliation =====
    (
        "9",
        "open",
        "Yes or no only. Is aggregate financial reconciliation enough to sign a B R I M "
        "mock without record-level checks?",
    ),
    (
        "9",
        "s1",
        "Design the reconciliation stack you would actually run: counts, amounts, status "
        "distributions, hash or checksum samples, exception queues, and who clears them. "
        "Show where aggregate helps and where record-level is mandatory — consistent "
        "with your yes-or-no.",
    ),
    (
        "9",
        "s2",
        "S Q L says green; U A T finds wrong bill cycles on a slice of accounts. How do "
        "you redesign validation scripts and test scenarios so that defect class is "
        "caught before the next dress rehearsal?",
    ),
    (
        "9",
        "s3",
        "Finance wants a single reconciliation dashboard. What do you build versus "
        "defer, and how do you avoid a pretty report that hides broken keys between "
        "S O M, C I, and F I C A?",
    ),
    # ===== ARC 10 Mocks and cutover =====
    (
        "10",
        "open",
        "One word. Minimum mock conversions before production cutover — One, Two, "
        "Three, or Four?",
    ),
    (
        "10",
        "s1",
        "P M O wants one mock and a short dress. Design mock-and-dress scope, success "
        "criteria, data refresh rules, and freeze points for B O D S and E M I G A L L "
        "that still respect the minimum count you gave.",
    ),
    (
        "10",
        "s2",
        "Cutover weekend load fails mid-billing objects. Architect restart versus abort "
        "with communication to business and BASIS. What will you not do that would "
        "bypass mock discipline?",
    ),
    (
        "10",
        "s3",
        "Post-load hypercare: defect flood in first forty-eight hours. How do you "
        "prioritize data fixes versus process workarounds, and when do you call a "
        "migration rollback conversation?",
    ),
    # ===== ARC 11 Integration decoupling =====
    (
        "11",
        "open",
        "Yes or no. Must B R I M migration loads wait until all C R M and S slash four "
        "interfaces are production-ready?",
    ),
    (
        "11",
        "s1",
        "Integration is late; conversion must move. Design decoupling — staging, "
        "stubs, temporary crosswalks, later interface cut-in — so migration and "
        "middleware can progress without corrupting B R I M masters. Tie it to your "
        "yes-or-no.",
    ),
    (
        "11",
        "s2",
        "Middleware drops a tax attribute silently. Design detection across B O D S "
        "reconciliation, E M I G A L L logs, and interface monitoring so it fails closed "
        "before U A T sign-off.",
    ),
    (
        "11",
        "s3",
        "External data sources arrive as daily files with late-arriving corrections. "
        "Architect late-data handling for conversion week without double-posting "
        "F I C A documents.",
    ),
    # ===== ARC 12 Performance =====
    (
        "12",
        "open",
        "One word. B O D S job too slow at volume — Scale-out, Rewrite, Partition, or "
        "Tune-D B — what do you try first?",
    ),
    (
        "12",
        "s1",
        "Multi-million row customer and invoice extracts. Walk performance design for "
        "B O D S workflows: pushdown, parallelism, commit sizes, error handling, "
        "restartability. Why is your first lever the word you chose?",
    ),
    (
        "12",
        "s2",
        "Intermittent failures at peak. BASIS blames network; devs blame source locks. "
        "Architect troubleshooting method and the operational runbook you leave for "
        "two-a-m support.",
    ),
    (
        "12",
        "s3",
        "Scheduling and automation across B O D S and E M I G A L L must fit a tight "
        "batch calendar. Design job dependency graph and alerting so one failure does "
        "not silently skip reconciliation.",
    ),
    # ===== ARC 13 Governance =====
    (
        "13",
        "open",
        "Yes or no. Will you load production B R I M from a mapping that never passed "
        "formal change control?",
    ),
    (
        "13",
        "s1",
        "Legal change hits three days before cutover. Design an accelerated but still "
        "governed path for mapping updates, B O D S changes, E M I G A L L config, and "
        "re-validation — options, not chaos versus hard no.",
    ),
    (
        "13",
        "s2",
        "Auditors want lineage from legacy field to B R I M table for customer and "
        "F I C A. What documentation pack do you keep — mappings, E T L specs, migration "
        "procedures, runbooks — to prove control aligned with your yes-or-no?",
    ),
    (
        "13",
        "s3",
        "Enterprise data governance wants new quality rules mid-program. How do you "
        "absorb them into the pipeline without missing milestones, and what do you "
        "negotiate as phase two?",
    ),
    # ===== ARC 14 Testing pyramid =====
    (
        "14",
        "open",
        "One word. Highest risk test phase if underfunded — Unit, S I T, U A T, or "
        "Performance?",
    ),
    (
        "14",
        "s1",
        "You participate across unit, system integration, U A T, and performance testing "
        "for migration. Design what 'done' means for a B O D S job and an E M I G A L L "
        "object before each phase, and why underfunding your one-word phase hurts most.",
    ),
    (
        "14",
        "s2",
        "Performance testing is scheduled after U A T sign-off. Do you accept that "
        "sequence? Architect the risk and the minimum performance proof you demand "
        "before production load.",
    ),
    (
        "14",
        "s3",
        "Defect found in U A T traces to wrong transformation default. How do you "
        "improve shift-left checks so the next cycle catches it in unit or S I T?",
    ),
    # ===== ARC 15 Role judgment =====
    (
        "15",
        "open",
        "One word. Stuck defect between B R I M functional and B O D S — who drives "
        "triage end to end — You, Functional, Architect, or BASIS?",
    ),
    (
        "15",
        "s1",
        "This role is mid-level analyst developer: years in S A P data migration, deep "
        "B O D S, solid E M I G A L L, B R I M and F I C A exposure. Design how you work "
        "with data architects, functional consultants, BASIS, and business in workshops "
        "so requirements become loadable mappings and testable reconciliation without "
        "waiting for perfect specs.",
    ),
    (
        "15",
        "s2",
        "Week one production: wrong billable items on a segment of accounts. Walk your "
        "first day — analysis path through B O D S and E M I G A L L, communication, "
        "fix versus workaround, and when you escalate. Show the judgment this team "
        "should hire.",
    ),
    (
        "15",
        "s3",
        "Closing thought. For Mechanicsburg onsite B R I M data migration support, what "
        "is one trade-off you will not compromise on — quality gate, ownership boundary, "
        "or cutover safety — and why that protects the business more than speed?",
    ),
]

# Base answer window between every question (user requirement).
# If spoken content + base gaps are under 60 minutes, remaining time is
# distributed evenly into those gaps so the full file is a 1-hour session.
GAP_SECONDS = 25
TARGET_MINUTES = 60

INTRO = (
    "Good morning. Thanks for joining me. This will feel like a real working session "
    "on S A P B R I M data analysis and migration support — Subscription Order Management, "
    "Convergent Charging, Convergent Invoicing, F I C A, customer and billing master data, "
    "B O D S, and E M I G A L L. "
    "I will open several topics with a short yes-no or one-word question, then push into "
    "design trade-offs — why one architecture over another. "
    "After each question I leave quiet time so you can answer fully — at least twenty-five "
    "seconds, and a bit more on the heavier design questions across this one-hour session. "
    "Speak as you would with the delivery team. Ready when you are. Let's begin."
)

OUTRO = (
    "That covers the ground I wanted on B R I M migration architecture, data quality, "
    "and delivery judgment. Thank you for the thoughtful answers. We will follow up on "
    "next steps. This interview is complete. Take care."
)

OUT_MP3 = Path(r"C:\Users\King2\Downloads\brim.mp3")
OUT_TXT = Path(r"C:\Users\King2\Downloads\brim_questions.txt")


def _load_env() -> None:
    for p in (
        Path(__file__).resolve().parent / ".env",
        Path(r"C:\Users\King2\Desktop\Astra\src\.env"),
    ):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        break
    if not (os.environ.get("OPENAI_BASE_URL") or "").strip():
        os.environ.pop("OPENAI_BASE_URL", None)


def main() -> int:
    import asyncio

    from pydub import AudioSegment
    from pydub.generators import Sine

    _load_env()

    n = len(QUESTIONS)
    assert n >= 40, f"Need at least 40 questions, got {n}"

    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)
    print(f"Questions: {n}", flush=True)
    print(f"Base gap: {GAP_SECONDS}s | target: {TARGET_MINUTES} min", flush=True)
    print(f"Output: {OUT_MP3}", flush=True)

    lines = [
        "SAP BRIM Data Analysis & Migration Support — natural interview (~1 hr)",
        "Source JD: sriman jd.pdf (SOM, CC, CI, FI-CA, BODS, EMIGALL, reconciliation)",
        f"Questions: {n} (15 arcs × hard open + 3 architect scenarios)",
        f"Base gap between questions: {GAP_SECONDS}s (expanded evenly if needed for {TARGET_MINUTES} min file)",
        f"TTS engine: {engine}",
        "Style: real interview; opens are yes/no or one-word; follow-ups are trade-offs",
        "",
        "Spoken intro:",
        INTRO,
        "",
    ]
    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        kind = "HARD OPEN" if rung == "open" else "SCENARIO / ARCH TRADE-OFF"
        lines.append(f"{i}. [arc {arc} | {kind}]")
        lines.append(f"   {text}")
        lines.append("")
    lines.append("Spoken outro:")
    lines.append(OUTRO)
    OUT_TXT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_TXT}", flush=True)

    openai_client = None
    if use_openai:
        from openai import OpenAI

        openai_client = OpenAI(api_key=api_key)

    short_pause = AudioSegment.silent(duration=800)
    beep = Sine(880).to_audio_segment(duration=90).apply_gain(-14)
    hard_beep = (
        Sine(660).to_audio_segment(duration=70).apply_gain(-11)
        + AudioSegment.silent(duration=50)
        + Sine(990).to_audio_segment(duration=70).apply_gain(-11)
    )

    # Build spoken segments first, then insert equal gaps (base 25s, stretch to 60 min)
    tmp_dir = Path(tempfile.mkdtemp(prefix="brim_tts_"))

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

            communicate = edge_tts.Communicate(
                text, voice="en-US-GuyNeural", rate="-10%"
            )
            asyncio.run(communicate.save(str(tmp)))
        return AudioSegment.from_file(tmp)

    print("Generating spoken segments...", flush=True)
    intro_seg = tts(INTRO, "intro")
    q_segs: list[AudioSegment] = []
    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        cue = hard_beep if rung == "open" else beep
        q_segs.append(cue + AudioSegment.silent(duration=200) + tts(text, f"Q{i:02d}_A{arc}_{rung}"))
    outro_seg = tts(OUTRO, "outro")

    speech_ms = (
        500
        + len(intro_seg)
        + 800
        + sum(len(s) for s in q_segs)
        + 1500
        + 800
        + len(outro_seg)
        + 900
    )
    gaps_count = max(1, n - 1)
    target_ms = TARGET_MINUTES * 60 * 1000
    base_gap_ms = GAP_SECONDS * 1000
    # Remaining time after speech distributed across inter-question gaps
    remain = target_ms - speech_ms
    gap_ms = max(base_gap_ms, remain // gaps_count if remain > 0 else base_gap_ms)
    print(
        f"  speech~{speech_ms/1000:.0f}s | gaps={gaps_count} × {gap_ms/1000:.1f}s "
        f"(min {GAP_SECONDS}s) | target {TARGET_MINUTES} min",
        flush=True,
    )

    combined = AudioSegment.silent(duration=500)
    combined += intro_seg
    combined += short_pause
    for i, seg in enumerate(q_segs, 1):
        combined += seg
        if i < n:
            print(f"  gap {gap_ms/1000:.1f}s after Q{i}/{n}", flush=True)
            combined += AudioSegment.silent(duration=int(gap_ms))
        else:
            combined += AudioSegment.silent(duration=1500)
    combined += short_pause
    combined += outro_seg
    combined += AudioSegment.silent(duration=900)

    # Final trim/pad to exact target if off by a few seconds
    if len(combined) < target_ms:
        combined += AudioSegment.silent(duration=target_ms - len(combined))
    elif len(combined) > target_ms + 5000:
        # only trim if wildly over; keep content intact otherwise
        pass

    OUT_MP3.parent.mkdir(parents=True, exist_ok=True)
    print(f"Exporting {OUT_MP3} ...", flush=True)
    combined.export(str(OUT_MP3), format="mp3", bitrate="128k")
    duration_s = len(combined) / 1000.0
    print(
        f"Wrote {OUT_MP3} ({duration_s:.1f}s / {duration_s / 60:.1f} min)",
        flush=True,
    )
    # Update questions file with effective gap
    meta = (
        f"\nEffective answer window between questions: {gap_ms/1000:.1f}s "
        f"(base {GAP_SECONDS}s, stretched for {TARGET_MINUTES}-minute session)\n"
        f"Total duration: {duration_s/60:.1f} minutes\n"
    )
    OUT_TXT.write_text(OUT_TXT.read_text(encoding="utf-8") + meta, encoding="utf-8")
    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
