#!/usr/bin/env python3
"""
Hard architect-level SAP BRIM interview audio (SOM, CC, CI, FI-CA, RAR,
Integrations, Enhancements) — designed so candidates must defend trade-offs.

Output: C:\\Users\\King2\\Downloads\\brim.mp3
Also:   C:\\Users\\King2\\Downloads\\brim_questions.txt

Structure:
  - 15 arcs × 4 prompts = 60 questions (≥40)
  - Open: Yes/No or single-word (commitment trap)
  - Follow-ups: multi-constraint architect scenarios; force choose A over B with cost
  - Natural conversational interviewer, no meta labels
  - Base 25s gap; stretch evenly to ~60 minutes wall-clock

Usage:
  venv\\Scripts\\python.exe generate_brim_hard_architect_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# (arc, rung, text) — rung never spoken
QUESTIONS: list[tuple[str, str, str]] = [
    # ── ARC 1 SOM ownership boundary ──
    (
        "1",
        "open",
        "Thanks for coming in. We will go deep — design calls, not buzzwords. "
        "Yes or no only. In a multi-brand subscription landscape, should Subscription "
        "Order Management own product and price master as system of record for rating?",
    ),
    (
        "1",
        "s1",
        "Hold that answer. Brand A sells bundles that rate in Convergent Charging with "
        "partner-funded discounts that Legal says must not appear as order price. Brand B "
        "needs order-level price freeze for audit. Design the ownership split across S O M, "
        "C C charge plans, and commercial master — what you centralize, what you deliberately "
        "duplicate, and what breaks if you flip your yes-or-no. I want failure modes, not a "
        "happy path.",
    ),
    (
        "1",
        "s2",
        "Cutover is six weeks out. C C team says they will hardcode partner discounts in "
        "tables because S O M cannot model them yet. Architect whether you accept that "
        "interim, what reconciliation and sunset criteria you demand, and how you stop an "
        "interim from becoming the permanent architecture while still defending the "
        "system-of-record stance you just took.",
    ),
    (
        "1",
        "s3",
        "A C F O asks why two systems can disagree on 'what the customer bought' after go-live. "
        "Give the one-slide decision framework you put in front of them — options, risks, "
        "who decides — that still forces a single answer to your original yes-or-no.",
    ),
    # ── ARC 2 CC vs CI timing ──
    (
        "2",
        "open",
        "One word only. When billable items are wrong in production — Charging, Invoicing, "
        "Order, or Master-data — which layer do you treat as guilty until proven otherwise?",
    ),
    (
        "2",
        "s1",
        "Night batch: Convergent Charging produces billable items; Convergent Invoicing "
        "aggregates; F I C A posts. Five percent of accounts show correct usage but wrong "
        "invoice tax. Walk the isolation design — what evidence you pull from each layer "
        "in the first hour, what you refuse to 'fix in C I only', and how that maps to "
        "the guilty layer you named.",
    ),
    (
        "2",
        "s2",
        "Product wants same-day re-rating after a price error. Finance wants immutable "
        "invoices once issued. Architect re-rate versus credit-and-rebill versus adjustment "
        "document strategy across C C, C I, and F I C A. Which option do you kill first and "
        "why, given your one-word root-layer bias?",
    ),
    (
        "2",
        "s3",
        "An enhancement in C C changes bit-level item identifiers mid-month. Downstream "
        "C I mappings break silently for one market. Design the contract between layers — "
        "versioning, schema freeze, consumer-driven checks — so this class of defect cannot "
        "ship again without a deliberate trade-off decision.",
    ),
    # ── ARC 3 FI-CA open item truth ──
    (
        "3",
        "open",
        "Yes or no. Should F I C A ever post revenue-relevant documents before Convergent "
        "Invoicing has a finalized bill document in a B R I M stack?",
    ),
    (
        "3",
        "s1",
        "Collections wants early dunning on estimated charges; Billing wants only final "
        "invoices. Design the posting architecture — estimated versus final, clearing "
        "rules, reversal paths — and show how your yes-or-no either enables or blocks "
        "their request without creating unreconciled subledger hell.",
    ),
    (
        "3",
        "s2",
        "Migration brings open items from legacy with partial payments and disputes. "
        "Architect convert-versus-freeze-in-legacy for open A R, including how you protect "
        "cash application and audit. Defend the harder path even if Project Management "
        "wants green status this sprint.",
    ),
    (
        "3",
        "s3",
        "A custom clearing enhancement auto-clears on external payment reference. Two "
        "years later finance finds mis-clears across business partners. Was that a design "
        "smell you would have blocked? Redesign the control points — standard first, "
        "enhancement second — consistent with your posting timing answer.",
    ),
    # ── ARC 4 RAR vs billing ──
    (
        "4",
        "open",
        "One word. Primary owner of revenue schedule truth for multi-element subscriptions — "
        "R A R, Convergent Invoicing, S O M, or Finance-manual?",
    ),
    (
        "4",
        "s1",
        "Contract has device, connectivity, and service S L A with different stand-alone "
        "selling prices and mid-term modifications. Design how performance obligations, "
        "allocation, and billing events flow between S O M, C I, and Revenue Accounting. "
        "Where do you accept temporary mismatch, and where do you hard-stop posting? "
        "Tie it to the owner word you chose.",
    ),
    (
        "4",
        "s2",
        "Audit finds billed amounts that do not reconcilable to R A R recognized revenue "
        "for the same period. Architect the reconciliation topology — grain, keys, timing "
        "differences, known legitimate deltas — and the management assertion you will "
        "not sign if broken. Why not push fix only into R A R configs?",
    ),
    (
        "4",
        "s3",
        "Sales wants ramp deals with free months that billing can invoice as zero but "
        "accounting must still allocate. Design the pattern and the anti-pattern. What "
        "enhancement do you refuse because it creates irreversible revenue debt?",
    ),
    # ── ARC 5 Integration pattern ──
    (
        "5",
        "open",
        "Yes or no only. For partner usage events into Convergent Charging, is near-real-time "
        "event streaming always preferable to controlled batch for architect sign-off?",
    ),
    (
        "5",
        "s1",
        "Partner can only deliver files every four hours with late corrections; Legal needs "
        "billable accuracy for wholesale settlements. Design the integration — ingest, "
        "idempotency, late event handling, reprocess windows — and show when batch beats "
        "streaming even if your industry peers brag about real-time. Align with your yes-or-no.",
    ),
    (
        "5",
        "s2",
        "Middleware maps drop a critical correlation key under load. C C still rates; "
        "downstream dispute fails. Architect fail-closed versus fail-open at each hop — "
        "A P I, queue, C C, C I — and the observability contract you require before go-live.",
    ),
    (
        "5",
        "s3",
        "Two regions, one global C C; data residency blocks raw events leaving region A. "
        "Propose a federated versus centralized rating architecture and the integration "
        "tax you accept. Which principle do you not violate to save project cost?",
    ),
    # ── ARC 6 Enhancement vs standard ──
    (
        "6",
        "open",
        "One word. Default stance on B R I M core enhancements in S slash four — Allow, "
        "Conditional, or Reject — when standard configuration is 'almost enough'?",
    ),
    (
        "6",
        "s1",
        "Business lists twelve 'must have' gaps across S O M order change and C I bill "
        "presentation. Score them with an architecture rubric — upgrade safety, supportability, "
        "process change alternative, data integrity. Show two you reject even under executive "
        "pressure, and how that matches your one-word default stance.",
    ),
    (
        "6",
        "s2",
        "An existing landscape has a decade of user exits in F I C A. You are the new "
        "architect. Design a strangler plan toward standard or released B A d Is — sequencing, "
        "risk, coexistence — without a big-bang rewrite fantasy.",
    ),
    (
        "6",
        "s3",
        "Partner insists on a modification because their prior consultant did it that way. "
        "Walk the conversation and the technical counter-proposal. What evidence package "
        "do you bring so this is not opinion versus opinion?",
    ),
    # ── ARC 7 Order-to-cash consistency ──
    (
        "7",
        "open",
        "Yes or no. Can S O M, C C, and C I go live on different weekends if F I C A is "
        "already live for other products?",
    ),
    (
        "7",
        "s1",
        "Program proposes staggered go-lives to reduce risk. Architect the interim operating "
        "model — what is dual-run, what is frozen, what revenue paths exist — and prove "
        "whether staggered is safer or just deferred integration debt. Your yes-or-no must "
        "survive a board risk question.",
    ),
    (
        "7",
        "s2",
        "During staggered phase, a customer has one legacy product and one B R I M product "
        "on the same contract account. Design master data, invoice presentment, and payments "
        "allocation so cash application does not invent money. What constraint forces you "
        "to reverse your open answer if it was too optimistic?",
    ),
    (
        "7",
        "s3",
        "Define the minimal end-to-end spine you refuse to split across releases — name the "
        "objects and events. If leadership cuts scope below that spine, what do you put in "
        "writing?",
    ),
    # ── ARC 8 Cross-component transaction design ──
    (
        "8",
        "open",
        "One word. For a mid-cycle plan change that affects rating and revenue — "
        "Prospective, Retrospective, or Split-by-obligation — your default?",
    ),
    (
        "8",
        "s1",
        "Customer upgrades mid-period; usage already rated under old plan; R A R already "
        "recognized a portion. Design the change across S O M change order, C C re-rate "
        "policy, C I corrective documents, F I C A adjustments, and R A R contract "
        "modification. Where do you accept customer credit pain to protect accounting "
        "truth? Defend your one-word default under edge cases.",
    ),
    (
        "8",
        "s2",
        "Legal says retrospective re-price is required for a regulatory error. Operations "
        "says re-rate volume will miss the invoice cycle. Architect a controlled "
        "retrospective with caps, sampling, and financial provisioning. What do you "
        "explicitly not automate?",
    ),
    (
        "8",
        "s3",
        "Compare two target architectures: heavy C C re-rate engine versus billing-side "
        "adjustment factory. Give criteria that make one dominate. No 'it depends' without "
        "naming the deciding metric.",
    ),
    # ── ARC 9 Data & performance at scale ──
    (
        "9",
        "open",
        "Yes or no. Should architects approve a design that rates every raw event in C C "
        "when ninety percent of events never affect the invoice line a customer sees?",
    ),
    (
        "9",
        "s1",
        "Volume is hundreds of millions of events monthly. Design aggregation, mediation, "
        "and rating boundaries — what is pre-aggregated, what must stay atomic for dispute, "
        "and how C I still explains the bill. Tie performance cost to your yes-or-no on "
        "rating everything.",
    ),
    (
        "9",
        "s2",
        "A cost-saving proposal moves mediation logic into a custom cloud function outside "
        "S A P. Architect trust boundaries, replay, audit, and support model. When is "
        "out-of-stack mediation acceptable, and when do you veto?",
    ),
    (
        "9",
        "s3",
        "Invoice run exceeds the batch window one day per month. List ordered interventions "
        "from design to operations. Which 'fix' is actually a product of a bad earlier "
        "trade-off you would reverse?",
    ),
    # ── ARC 10 Multi-GAAP / RAR pressure ──
    (
        "10",
        "open",
        "One word. If I F R S and local G A A P recognition diverge for the same B R I M "
        "contract — Dual-ledger-R A R, Parallel-contracts, or Billing-led-manual — pick "
        "your strategic default.",
    ),
    (
        "10",
        "s1",
        "Same subscription, different revenue patterns by book. Design how S O M commercial "
        "terms feed R A R without multiplying S O M orders. What complexity do you push "
        "to accounting rules versus commercial model — and why your one-word strategy "
        "wins over the other two for a multi-country operator?",
    ),
    (
        "10",
        "s2",
        "Local statutory team wants invoice layout to drive recognition. Explain why that "
        "is dangerous and the control architecture you put between C I presentment and "
        "R A R. What enhancement request do you reject on principle?",
    ),
    (
        "10",
        "s3",
        "You inherit a landscape where R A R was implemented after billing with "
        "spreadsheet bridges. Outline a two-wave remediation that does not stop invoicing. "
        "What is wave one's non-negotiable outcome?",
    ),
    # ── ARC 11 Party / partner model ──
    (
        "11",
        "open",
        "Yes or no. In wholesale plus retail B R I M, should payer, user, and contract "
        "holder always be the same business partner for simplification?",
    ),
    (
        "11",
        "s1",
        "Design a three-party model — sold-to, bill-to, ship-to slash user — across S O M "
        "and F I C A, including who owns credit risk and who receives the invoice. Show "
        "where forcing sameness creates fraud or settlement bugs. Align with your yes-or-no.",
    ),
    (
        "11",
        "s2",
        "Partner settlement needs shadow rating of retail events. Architect interaction "
        "between retail C C and wholesale settlement without double recognition in R A R. "
        "Where do you put the Chinese wall in data and in process?",
    ),
    (
        "11",
        "s3",
        "A bank partner wants to own collections while you own billing. Propose integration "
        "and accounting boundaries. What S L A and reversal rules make this safe enough "
        "to sign?",
    ),
    # ── ARC 12 Idempotency & reprocessing ──
    (
        "12",
        "open",
        "One word. After a failed invoice run, preferred recovery — Replay, Reversal-then-replay, "
        "or Rebuild-from-charging?",
    ),
    (
        "12",
        "s1",
        "Half the business partners invoiced; job died; some F I C A docs posted. Design "
        "exactly-once processing across C I and F I C A — keys, status stores, operator "
        "runbooks. Defend your one-word recovery against the nightmare of double invoices.",
    ),
    (
        "12",
        "s2",
        "Charging was correct; invoicing logic had a tax bug. Compare rebuild-from-charging "
        "versus invoice reversal factory for ten million items. Which cost dimension forces "
        "your hand — time, audit, customer comms, or system load?",
    ),
    (
        "12",
        "s3",
        "Specify the test you require in dress rehearsal that proves recovery works. If "
        "that test is skipped, do you still approve go-live? Yes or no inside your answer, "
        "and why architects get fired for the wrong call here.",
    ),
    # ── ARC 13 Clean core / extensibility ──
    (
        "13",
        "open",
        "Yes or no. Is a side-by-side extension on B T P always preferable to an in-stack "
        "B R I M enhancement for long-term clean core?",
    ),
    (
        "13",
        "s1",
        "Use case: complex eligibility during order capture needing sub-second response "
        "and transactional consistency with S O M. Design side-by-side versus in-stack "
        "options including consistency, latency, and failure handling. When does your "
        "yes-or-no on B T P flip?",
    ),
    (
        "13",
        "s2",
        "Another use case: invoice PDF legal text by jurisdiction. Same question — "
        "extension placement. Show that good architecture is contextual, but still pick "
        "a default with explicit exceptions list.",
    ),
    (
        "13",
        "s3",
        "Executives bought 'clean core' as a slogan. Translate it into enforceable "
        "engineering standards for B R I M projects — what is banned, what needs "
        "architecture board, what is free. Make it uncomfortable but usable.",
    ),
    # ── ARC 14 Security & segregation ──
    (
        "14",
        "open",
        "One word. Most dangerous privilege combination in B R I M ops — Config-plus-run, "
        "Run-plus-reverse, or Masterdata-plus-post?",
    ),
    (
        "14",
        "s1",
        "Design segregation of duties across S O M product config, C C catalog, C I billing "
        "runs, F I C A posting, and R A R close. Where do small teams force dual control "
        "instead of ideal So D, and what compensating detection do you require?",
    ),
    (
        "14",
        "s2",
        "A shared technical user runs middleware into C C and also posts F I C A via "
        "interface. Architect the threat and the target pattern. Why is 'but it is "
        "integration' not an acceptable residual risk without controls?",
    ),
    (
        "14",
        "s3",
        "Incident: silent price catalog change in production. Design forensic trail and "
        "preventive architecture — transport, dual maintain, alert. Link back to the "
        "dangerous privilege word you chose.",
    ),
    # ── ARC 15 Program & architect accountability ──
    (
        "15",
        "open",
        "One word. If go-live ships with known revenue leakage under a threshold — "
        "Ship, Slip, or Scope-cut — your recommendation as solution architect?",
    ),
    (
        "15",
        "s1",
        "Leakage is estimated at low single-digit basis points but concentrated in one "
        "customer segment that will notice. Design the decision package for steering "
        "committee — metrics, containment, customer comms, fix timeline. Defend your "
        "Ship, Slip, or Scope-cut under hostile Q and A.",
    ),
    (
        "15",
        "s2",
        "P M O wants a green dashboard; you see red integration contract tests. How do "
        "you escalate without becoming 'the blocker'? What artifact do you refuse to "
        "sign, and what alternative date plan do you offer the same day?",
    ),
    (
        "15",
        "s3",
        "Final question. Across S O M, C C, C I, F I C A, R A R, integrations, and "
        "enhancements — name the single architectural invariant you will not trade for "
        "schedule, and give a war-story-shaped example of how violating it destroys "
        "months of work after go-live. Make me believe you have lived it.",
    ),
]

GAP_SECONDS = 25
TARGET_MINUTES = 60

INTRO = (
    "Good morning. Thanks for joining. This is a senior architecture conversation on "
    "S A P B R I M class capabilities — Subscription Order Management, Convergent Charging, "
    "Convergent Invoicing, F I C A, Revenue Accounting, integrations, and enhancements. "
    "I will open with short yes-no or one-word commitments, then pressure-test you with "
    "messy, multi-constraint scenarios. I am less interested in tool names than in what you "
    "refuse to break and why. After each question you get quiet time to answer — at least "
    "twenty-five seconds, more across this one-hour session when the trade-off is heavy. "
    "Be precise. Defend the hard call. Ready when you are. Let's begin."
)

OUTRO = (
    "That is the full set. Thank you for defending the trade-offs under pressure. "
    "We will compare notes on depth and judgment. This interview is complete."
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
    assert n >= 40, f"Need ≥40 questions, got {n}"

    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)
    print(f"Questions: {n} (hard architect)", flush=True)
    print(f"Base gap: {GAP_SECONDS}s | target: {TARGET_MINUTES} min", flush=True)
    print(f"Output: {OUT_MP3}", flush=True)

    lines = [
        "HARD SAP BRIM Architect Interview — SOM / CC / CI / FI-CA / RAR / Integrations / Enhancements",
        f"Questions: {n} (15 arcs × commitment open + 3 pressure scenarios)",
        f"Base gap: {GAP_SECONDS}s (stretched evenly to ~{TARGET_MINUTES} min session)",
        f"TTS: {engine}",
        "Intent: force defense of design trade-offs; no softballs",
        "",
        "Spoken intro:",
        INTRO,
        "",
    ]
    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        kind = "HARD OPEN" if rung == "open" else "COMPLEX SCENARIO / ARCH TRADE-OFF"
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
    tmp_dir = Path(tempfile.mkdtemp(prefix="brim_hard_tts_"))

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

            # Slightly slower = deliberate senior interviewer pace
            communicate = edge_tts.Communicate(
                text, voice="en-US-GuyNeural", rate="-12%"
            )
            asyncio.run(communicate.save(str(tmp)))
        return AudioSegment.from_file(tmp)

    print("Generating spoken segments...", flush=True)
    intro_seg = tts(INTRO, "intro")
    q_segs: list[AudioSegment] = []
    for i, (arc, rung, text) in enumerate(QUESTIONS, 1):
        cue = hard_beep if rung == "open" else beep
        q_segs.append(
            cue + AudioSegment.silent(duration=200) + tts(text, f"Q{i:02d}_A{arc}_{rung}")
        )
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
    remain = target_ms - speech_ms
    gap_ms = max(base_gap_ms, remain // gaps_count if remain > 0 else base_gap_ms)
    print(
        f"  speech~{speech_ms/1000:.0f}s | gaps={gaps_count} × {gap_ms/1000:.1f}s "
        f"(min {GAP_SECONDS}s) | target {TARGET_MINUTES} min",
        flush=True,
    )

    combined = AudioSegment.silent(duration=500)
    combined += intro_seg + short_pause
    for i, seg in enumerate(q_segs, 1):
        combined += seg
        if i < n:
            print(f"  gap {gap_ms/1000:.1f}s after Q{i}/{n}", flush=True)
            combined += AudioSegment.silent(duration=int(gap_ms))
        else:
            combined += AudioSegment.silent(duration=1500)
    combined += short_pause + outro_seg + AudioSegment.silent(duration=900)

    if len(combined) < target_ms:
        combined += AudioSegment.silent(duration=target_ms - len(combined))

    OUT_MP3.parent.mkdir(parents=True, exist_ok=True)
    print(f"Exporting {OUT_MP3} ...", flush=True)
    combined.export(str(OUT_MP3), format="mp3", bitrate="128k")
    duration_s = len(combined) / 1000.0
    print(f"Wrote {OUT_MP3} ({duration_s:.1f}s / {duration_s/60:.1f} min)", flush=True)

    meta = (
        f"\nEffective answer window: {gap_ms/1000:.1f}s "
        f"(base {GAP_SECONDS}s, stretched for {TARGET_MINUTES}-minute session)\n"
        f"Total duration: {duration_s/60:.1f} minutes\n"
        "Difficulty: architect pressure — multi-constraint trade-offs; force defend.\n"
    )
    OUT_TXT.write_text(OUT_TXT.read_text(encoding="utf-8") + meta, encoding="utf-8")
    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
