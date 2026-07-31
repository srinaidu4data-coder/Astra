#!/usr/bin/env python3
"""STT accuracy test against test_audio ground-truth question banks."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from copilot_api import _load_audio_int16_16k, _segment_by_silence  # noqa: E402
from config import WHISPER_COMPUTE_TYPE, WHISPER_DEVICE, WHISPER_MODEL  # noqa: E402
from transcriber import get_whisper_model, transcribe_audio  # noqa: E402


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # normalize number words lightly
    s = s.replace(" l one ", " l1 ").replace(" l two ", " l2 ")
    s = s.replace(" f one ", " f1 ")
    return s


def _tokens(s: str) -> list[str]:
    return [t for t in _norm(s).split() if t]


def word_overlap(hyp: str, ref: str) -> float:
    ht, rt = set(_tokens(hyp)), set(_tokens(ref))
    if not rt:
        return 0.0
    return len(ht & rt) / len(rt)


def sequence_ratio(hyp: str, ref: str) -> float:
    """Simple bigram+unigram Jaccard-ish quality proxy."""
    ht, rt = _tokens(hyp), _tokens(ref)
    if not rt:
        return 0.0
    # token F1
    hs, rs = set(ht), set(rt)
    inter = len(hs & rs)
    if inter == 0:
        return 0.0
    prec = inter / max(1, len(hs))
    rec = inter / max(1, len(rs))
    return 2 * prec * rec / max(1e-9, prec + rec)


def parse_ai_ml_questions(path: Path) -> list[str]:
    qs: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*\d+\.\s+(.+)$", line.strip())
        if m:
            qs.append(m.group(1).strip())
    return qs


def parse_sap_flat(path: Path) -> list[str]:
    """Prefer flat 60 prompts if present; else extract Originals only."""
    text = path.read_text(encoding="utf-8")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # flat file is numbered lines or plain prompts
    qs: list[str] = []
    for ln in lines:
        if ln.startswith("#") or ln.startswith("=") or ln.startswith("---"):
            continue
        m = re.match(r"^(?:Q?\d+[\).:\-]\s*|Prompt\s+\d+:\s*)(.+)$", ln, re.I)
        if m:
            qs.append(m.group(1).strip())
        elif len(ln.split()) >= 8 and not ln.lower().startswith(
            ("role", "structure", "gap", "difficulty", "sap fico", "follow-up", "original")
        ):
            qs.append(ln)
    # de-dup consecutive
    out: list[str] = []
    for q in qs:
        if not out or _norm(q) != _norm(out[-1]):
            out.append(q)
    return out


def parse_sap_originals(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    qs: list[str] = []
    blocks = re.split(r"\nOriginal:\s*\n", text)
    for b in blocks[1:]:
        # take until Follow-up
        part = re.split(r"\nFollow-up\s*1\s*:", b, maxsplit=1)[0]
        q = " ".join(ln.strip() for ln in part.splitlines() if ln.strip())
        if len(q.split()) >= 6:
            qs.append(q)
    return qs


def best_match(hyp: str, refs: list[str]) -> tuple[int, float, str]:
    best_i, best_s, best_r = -1, -1.0, ""
    for i, r in enumerate(refs):
        s = sequence_ratio(hyp, r)
        if s > best_s:
            best_i, best_s, best_r = i, s, r
    return best_i, best_s, best_r


def run_file(
    audio_path: Path,
    refs: list[str],
    *,
    label: str,
    max_segments: int = 30,
) -> dict:
    print(f"\n{'='*60}\n{label}\nfile={audio_path.name}\nrefs={len(refs)} model={WHISPER_MODEL}\n")
    t0 = time.perf_counter()
    audio = _load_audio_int16_16k(audio_path)
    load_ms = round((time.perf_counter() - t0) * 1000)
    dur = len(audio) / 16000.0
    peak = float(max(abs(int(audio.max())), abs(int(audio.min())))) / 32768.0
    print(f"[load] {dur:.1f}s audio in {load_ms}ms peak={peak:.3f}")

    segs = _segment_by_silence(audio)
    print(f"[vad] {len(segs)} segments")

    rows = []
    used_refs: set[int] = set()
    for i, (start, end) in enumerate(segs[:max_segments]):
        clip = audio[start:end]
        t_stt = time.perf_counter()
        hyp = transcribe_audio(clip)
        stt_ms = round((time.perf_counter() - t_stt) * 1000)
        if not hyp or len(hyp.split()) < 2:
            print(f"  seg{i:02d} {start/16000:6.1f}-{end/16000:6.1f}s empty ({stt_ms}ms)")
            rows.append(
                {
                    "seg": i,
                    "start": round(start / 16000, 2),
                    "end": round(end / 16000, 2),
                    "stt_ms": stt_ms,
                    "hyp": hyp or "",
                    "score": 0.0,
                    "matched": False,
                }
            )
            continue
        idx, score, ref = best_match(hyp, refs)
        matched = score >= 0.45 and idx not in used_refs
        if matched:
            used_refs.add(idx)
        flag = "OK" if score >= 0.55 else ("WEAK" if score >= 0.35 else "BAD")
        print(
            f"  seg{i:02d} {start/16000:6.1f}-{end/16000:6.1f}s {stt_ms:5}ms "
            f"score={score:.2f} {flag} -> Q{idx+1 if idx>=0 else '?'}"
        )
        print(f"    HYP: {hyp[:140]}")
        if score < 0.55:
            print(f"    REF: {ref[:140]}")
        rows.append(
            {
                "seg": i,
                "start": round(start / 16000, 2),
                "end": round(end / 16000, 2),
                "stt_ms": stt_ms,
                "hyp": hyp,
                "ref_idx": idx,
                "ref": ref,
                "score": round(score, 3),
                "matched": matched,
            }
        )

    scores = [r["score"] for r in rows if r.get("hyp")]
    good = sum(1 for s in scores if s >= 0.55)
    weak = sum(1 for s in scores if 0.35 <= s < 0.55)
    bad = sum(1 for s in scores if s < 0.35)
    summary = {
        "label": label,
        "file": str(audio_path),
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
        "compute": WHISPER_COMPUTE_TYPE,
        "duration_sec": round(dur, 1),
        "peak": round(peak, 3),
        "segments": len(segs),
        "transcribed": len(scores),
        "avg_score": round(sum(scores) / len(scores), 3) if scores else 0.0,
        "good_ge_0.55": good,
        "weak_0.35_0.55": weak,
        "bad_lt_0.35": bad,
        "unique_refs_matched": len(used_refs),
        "ref_count": len(refs),
        "rows": rows,
    }
    print(
        f"\n[SUMMARY {label}] avg={summary['avg_score']:.2f} "
        f"good={good} weak={weak} bad={bad} unique_refs={len(used_refs)}/{len(refs)}"
    )
    return summary


def main() -> int:
    print("=== STT ACCURACY TEST ===")
    print(f"model={WHISPER_MODEL} device={WHISPER_DEVICE} compute={WHISPER_COMPUTE_TYPE}")
    t0 = time.perf_counter()
    get_whisper_model()
    print(f"whisper loaded in {round((time.perf_counter()-t0)*1000)}ms")

    results = []

    ai_audio = ROOT / "test_audio" / "ai_ml_interview_20q.wav"
    if not ai_audio.exists():
        ai_audio = ROOT / "test_audio" / "ai_ml_interview_20q.mp3"
    ai_refs = parse_ai_ml_questions(ROOT / "test_audio" / "ai_ml_interview_20q_questions.txt")
    if ai_audio.exists() and ai_refs:
        results.append(run_file(ai_audio, ai_refs, label="AI_ML_20Q", max_segments=25))

    sap_audio = ROOT / "test_audio" / "sap_fico_vertex_interview_20q.mp3"
    sap_flat = ROOT / "test_audio" / "sap_fico_vertex_interview_60_flat.txt"
    sap_bank = ROOT / "test_audio" / "sap_fico_vertex_interview_20q_questions.txt"
    sap_refs = parse_sap_flat(sap_flat) if sap_flat.exists() else []
    if len(sap_refs) < 10:
        sap_refs = parse_sap_originals(sap_bank)
    if sap_audio.exists() and sap_refs:
        # SAP file is long — first ~15 segments is enough for diagnosis
        results.append(run_file(sap_audio, sap_refs, label="SAP_FICO_VERTEX", max_segments=15))

    out = {
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
        "results": [
            {k: v for k, v in r.items() if k != "rows"} | {"sample_rows": r["rows"][:5]}
            for r in results
        ],
        "full": results,
    }
    out_path = ROOT / "_stt_accuracy_result.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}")

    if not results:
        print("FAIL: no audio/tests")
        return 2
    # Pass bar for tiny baseline awareness: report only
    avg = sum(r["avg_score"] for r in results) / len(results)
    print(f"\nOVERALL avg_score={avg:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
