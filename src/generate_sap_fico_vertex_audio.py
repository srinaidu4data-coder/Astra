#!/usr/bin/env python3
"""
Generate practice interview audio: SAP FICO + Vertex scenarios.

20 originals × 2 follow-ups = 60 spoken questions, 10s silence between each.

Outputs:
  test_audio/sap_fico_vertex_interview_20q.mp3
  test_audio/sap_fico_vertex_interview_20q_questions.txt  (human-readable bank already exists;
      this also writes a flat TTS list)

Usage (from src/):
  venv\\Scripts\\python.exe generate_sap_fico_vertex_audio.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_env = Path(__file__).resolve().parent / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# Flat list: each original followed by 2 harder follow-ups (ladder).
QUESTIONS: list[str] = [
    # Q1
    "A US company runs SAP S/4HANA Finance with Vertex O Series for sales and use tax. On month-end, A P posts a large multi-state vendor invoice that posts in F I but tax looks wrong versus Vertex. Walk me through your FICO investigation.",
    "Finance must close G L by 6 P M. Vertex reconciliation still runs: two company codes are under five hundred dollars off, one is forty-eight thousand off. What blocks close, what do you park, what do you escalate, and how do you document for audit?",
    "Audit finds the forty-eight thousand gap came from a Vertex jurisdiction update not reflected in SAP tax codes for one plant. Design the end-to-end control so this is detected before the next close.",
    # Q2
    "A sales order ships from Texas to California with mixed taxable and non-taxable items. Explain how SAP and Vertex determine tax on the billing document and what FICO sees in the accounting document.",
    "The customer is partially exempt with a multi-jurisdiction certificate, but two lines still tax fully. How do you troubleshoot certificate, customer tax class, material tax class, and Vertex exemption mapping?",
    "California audits under-collection. Vertex and SAP disagree on historical rates for that ship-from ship-to pair. How do you reconstruct determination for one invoice and build a defense package?",
    # Q3
    "Illinois plant buys capital equipment from an out-of-state vendor who charges no sales tax. How do SAP FICO and Vertex handle use tax accrual, and what F I postings do you expect?",
    "The asset capitalizes to a different cost center and profit center than the P O, and use tax hits the wrong C O object. How do you correct open and closed postings without breaking depreciation already run?",
    "Tax wants monthly use-tax self-assessment from Vertex; Controllers want G L tax accounts to match Vertex before filing. Design the monthly reconciliation using SAP reports and Vertex outputs.",
    # Q4
    "You add a new US company code that must go live with Vertex on day one. What FICO configuration and master data must be ready before the first invoice?",
    "Cutover migrates open A R and A P without tax lines, but returns may need history. What is your tax continuity cutover approach?",
    "Intercompany billings between the new and old company codes double-tax or zero-tax inconsistently. How do you diagnose tax determination across company codes, plants, and Vertex taxpayer profiles?",
    # Q5
    "Vertex-linked tax expense posts to a default cost center and distorts department P and L. Business wants tax to follow the underlying expense cost center. How do you approach this in F I and C O with Vertex?",
    "Pure tax adjustment journals from Vertex have no underlying expense; Finance wants allocation by statistical key figure. How do you design that without double-counting invoice tax?",
    "After allocation, profit center reports still do not match legal entity Vertex filings. Explain the gap to a C F O in under five minutes.",
    # Q6
    "Vertex is down during peak billing. What should SAP do, fail open or fail closed, and how should FICO respond operationally?",
    "Leadership forces estimated tax billing to hit revenue. Vertex returns next day. How do you re-rate, reverse, and repost tax cleanly?",
    "During re-rate, two percent of invoices cannot reprocess due to locks or cleared payments. Design the exception factory and accounting treatment for residual risk.",
    # Q7
    "A customer returns goods two months later; original tax came from Vertex. Explain the credit memo flow in SAP and Vertex and the F I impact.",
    "The return is partial, price changed, and the customer moved states; credit tax does not mirror the original. How do you investigate and correct?",
    "The original invoice is cleared with a write-off of a small underpayment. How do you post tax-only adjustments after clearing without reopening the receivable mess?",
    # Q8
    "The company moves determination to Vertex and wants fewer SAP tax codes. What tax code and account key design do you recommend for F I, and why?",
    "Controllers still need jurisdiction detail in the G L; Vertex has it, SAP G L does not. How do you satisfy both Controllers and Tax?",
    "Auditors want a map from every Vertex tax type and jurisdiction to SAP G L accounts. What control matrix do you own?",
    # Q9
    "Project System W B S milestone billing mixes taxable and exempt services. How should FICO and Vertex keep project P and L and tax aligned?",
    "Milestones were reversed and rebilled after a contract change; W B S actuals no longer match billing. How do you clean this up?",
    "The project spans three states with remote workers and nexus changes mid-project. How do you handle taxability change for open and future milestones?",
    # Q10
    "Explain the SAP to Vertex integration pattern you expect, and what a FICO consultant owns versus Basis and Tax I T.",
    "A non-standard e-commerce interface posts billings that bypass tax exits and hit F I with zero tax. How do you detect and stop this?",
    "Architecture will replace the Vertex connector with custom B T P integration in six months. What FICO regression pack and cutover checklist do you demand?",
    # Q11
    "A US company code invoices a Canadian customer in Canadian dollars while company code currency is U S dollars. What FICO risks exist with Vertex, and how do you validate postings?",
    "Exchange rate differences appear on tax lines after payment. Should tax base revalue? What do you recommend and how do you test it?",
    "Vertex returns tax in one currency while a rush SAP document uses another. How do you detect, reverse, and prevent this with controls?",
    # Q12
    "Tax posts a manual journal to true-up sales tax payable to the Vertex return. What controls protect subledger integrity?",
    "The journal hit P and L tax expense instead of balance sheet tax payable and prior periods are closed. How do you find and correct it?",
    "Management wants no manual tax journals within twelve months. Design the automation and exception-only workflow, including SAP and Vertex roles.",
    # Q13
    "Drop-ship: supplier ships to end customer; you have a purchase order and a customer billing. How should Vertex tax work, and what FICO postings do you validate?",
    "Supplier tax on the A P invoice is wrong and customer billing tax is also wrong. How do you untangle A P tax, A R tax, and cost of goods impacts?",
    "Legal fears double taxation across two states on one economic sale. How do you model it in SAP and Vertex, and what evidence do you retain?",
    # Q14
    "A material tax classification changes from taxable to exempt mid-year. What master data and open transaction impacts do you manage?",
    "Open sales orders still use old tax after the change; some deliveries already happened. What is your wave plan for orders, billing blocks, and communication?",
    "Returns of the old product version still need old tax treatment. How do you support dual taxability safely?",
    # Q15
    "With document splitting, tax lines do not split as Controllers expect. How do you trace one billing document’s tax lines into universal journal actuals?",
    "A shared service cost center absorbs all tax differences and breaks segment E B I T D A. Propose a sustainable design under document splitting.",
    "After S/4 migration, historical tax balances in a reconciliation account lack profit center split. Auditors flag it. What is your remediation plan?",
    # Q16
    "Walk through a monthly sales tax return cycle: Vertex outputs, SAP match points, and FICO activities before filing.",
    "Filing is tomorrow; Vertex is ready but SAP tax payable is short twelve thousand four hundred dollars and invoices are missing. What is your hour-by-hour plan?",
    "After filing, an amended Vertex return increases liability and cash already moved. How do you book the amendment and explain it to F P and A?",
    # Q17
    "Capex on an investment order settles to an asset; vendor invoices may include tax or need use tax. How do you ensure correct asset value and tax with Vertex?",
    "Settlement ran with tax wrongly in acquisition cost and two depreciation periods posted. How do you correct asset value, tax accounts, and depreciation?",
    "A tax authority challenges soft-cost capitalization taxed differently from hard costs. How do you reclass asset, expense, and tax with full audit trail?",
    # Q18
    "Two hundred thousand billing lines are slow; teams blame Vertex. How do you separate tax integration issues from sales and distribution, F I posting, or job design?",
    "Business wants real-time tax on every simulation and invoice; infrastructure says it will not scale. What compromise architecture and controls do you propose?",
    "Intermittent outages caused silent zero-tax on a small percent of posted invoices. How do you detect them and auto-block going forward?",
    # Q19
    "SaaS subscriptions bill from a US company code across many states with no physical shipment. What Vertex determination and FICO master data must be right?",
    "Monthly recurring billing continues after a mid-cycle billing address change. How should tax on credits and new charges behave?",
    "Counsel reclassifies a product from SaaS to data processing with new taxability in five states. Build the change plan across master data, contracts, Vertex, and customers.",
    # Q20
    "Tax wants max Vertex automation; Controllership wants simple G L and fast close; I T wants fewer exits. As FICO lead, how do you drive the design decision?",
    "No agreement, go-live in six weeks. What interim operating model lets you invoice legally and still close the books?",
    "A severity-one production tax issue hits; teams blame each other. How do you run the war room, and what permanent ownership model and monitoring do you install afterward?",
]

GAP_SECONDS = 10
INTRO = (
    "Welcome to your SAP FICO with Vertex practice interview. "
    "There are twenty scenario themes. Each theme has one main question and two harder follow-ups. "
    "After every question, you will have ten seconds of silence to begin your answer, "
    "then the next question will start. Let's begin."
)
OUTRO = (
    "That was the last question. Thank you for your time. "
    "This SAP FICO Vertex practice interview is complete."
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


def main() -> int:
    import asyncio

    from pydub import AudioSegment
    from pydub.generators import Sine

    _load_env()

    # Prefer OpenAI TTS when a real key is present; otherwise Edge TTS (free).
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    use_openai = bool(api_key) and len(api_key) > 20 and api_key.startswith("sk-")
    engine = "openai" if use_openai else "edge-tts"
    print(f"TTS engine: {engine}", flush=True)

    out_dir = Path(__file__).resolve().parent / "test_audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_mp3 = out_dir / "sap_fico_vertex_interview_20q.mp3"
    out_flat = out_dir / "sap_fico_vertex_interview_60_flat.txt"

    lines = [
        "SAP FICO + Vertex — 60 spoken prompts (20 × 3 ladder)",
        f"Gap between questions: {GAP_SECONDS}s",
        f"TTS engine: {engine}",
        "",
    ]
    for i, q in enumerate(QUESTIONS, 1):
        theme = (i - 1) // 3 + 1
        step = (i - 1) % 3
        label = ["Original", "Follow-up 1", "Follow-up 2 (hardest)"][step]
        lines.append(f"{i}. [Theme {theme} | {label}] {q}")
    out_flat.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_flat}")

    openai_client = None
    if use_openai:
        from openai import OpenAI

        openai_client = OpenAI(api_key=api_key)

    silence = AudioSegment.silent(duration=int(GAP_SECONDS * 1000))
    short_pause = AudioSegment.silent(duration=800)
    beep = Sine(880).to_audio_segment(duration=120).apply_gain(-12)
    gap_with_beep = silence[: max(0, len(silence) - 200)] + beep + AudioSegment.silent(duration=400)

    combined = AudioSegment.silent(duration=500)
    tmp_dir = Path(tempfile.mkdtemp(prefix="astra_sap_tts_"))

    def tts(text: str, label: str) -> AudioSegment:
        print(f"  TTS: {label}...", flush=True)
        tmp = tmp_dir / f"{label}.mp3"
        if use_openai and openai_client is not None:
            with openai_client.audio.speech.with_streaming_response.create(
                model="tts-1",
                voice="alloy",
                input=text,
            ) as resp:
                resp.stream_to_file(str(tmp))
        else:
            import edge_tts

            # Clear US English voice for interview practice
            communicate = edge_tts.Communicate(text, voice="en-US-GuyNeural")
            asyncio.run(communicate.save(str(tmp)))
        return AudioSegment.from_file(tmp)

    print("Generating intro...", flush=True)
    combined += tts(INTRO, "intro")
    combined += short_pause

    for i, q in enumerate(QUESTIONS, 1):
        theme = (i - 1) // 3 + 1
        step = (i - 1) % 3
        if step == 0:
            spoken = f"Theme {theme}, main question. {q}"
        elif step == 1:
            spoken = f"Theme {theme}, follow-up one. {q}"
        else:
            spoken = f"Theme {theme}, follow-up two, hardest. {q}"
        combined += tts(spoken, f"Q{i:02d}")
        if i < len(QUESTIONS):
            print(f"  gap {GAP_SECONDS}s after Q{i}", flush=True)
            combined += gap_with_beep
        else:
            combined += short_pause

    print("Generating outro...", flush=True)
    combined += tts(OUTRO, "outro")

    print(f"Exporting {out_mp3} ...", flush=True)
    combined.export(str(out_mp3), format="mp3")
    # Cleanup temp clips
    try:
        for p in tmp_dir.glob("*"):
            p.unlink(missing_ok=True)
        tmp_dir.rmdir()
    except Exception:
        pass
    print(f"Done. Duration ~{len(combined) / 1000 / 60:.1f} min → {out_mp3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
