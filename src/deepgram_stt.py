"""
Deepgram Nova-3 streaming STT for live interviews.

Two modes:
  1) DeepgramLiveStream — continuous WebSocket during a session
     (interim + final transcripts while the interviewer speaks)
  2) transcribe_pcm_nova3 — one-shot stream of a VAD clip
     (used when continuous stream has no final yet / system path)

Falls back is handled by callers (transcriber.transcribe_best → Whisper).
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from typing import Any, Callable, Optional

import numpy as np

try:
    import websocket  # websocket-client
except ImportError:  # pragma: no cover
    websocket = None  # type: ignore

from config import (
    DEEPGRAM_ENDPOINTING_MS,
    DEEPGRAM_MODEL,
    DEEPGRAM_UTTERANCE_END_MS,
    get_deepgram_api_key,
)

EmitFn = Callable[[str, dict[str, Any]], None]

DG_WS_BASE = "wss://api.deepgram.com/v1/listen"
DG_REST_BASE = "https://api.deepgram.com/v1/listen"


def deepgram_available() -> bool:
    return bool(get_deepgram_api_key()) and websocket is not None


def deepgram_status() -> dict[str, Any]:
    key = get_deepgram_api_key()
    return {
        "configured": bool(key),
        "key_len": len(key) if key else 0,
        "websocket_client": websocket is not None,
        "model": DEEPGRAM_MODEL,
        "ready": bool(key) and websocket is not None,
        "endpointing_ms": DEEPGRAM_ENDPOINTING_MS,
    }


def _auth_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Token {key}"}


def _stream_query(
    *,
    sample_rate: int = 16000,
    interim: bool = True,
    endpointing_ms: int | None = None,
) -> str:
    ep = endpointing_ms if endpointing_ms is not None else DEEPGRAM_ENDPOINTING_MS
    params = {
        "model": DEEPGRAM_MODEL or "nova-3",
        "encoding": "linear16",
        "sample_rate": str(int(sample_rate)),
        "channels": "1",
        "punctuate": "true",
        "smart_format": "true",
        "interim_results": "true" if interim else "false",
        "endpointing": str(int(ep)),
        "utterance_end_ms": str(int(DEEPGRAM_UTTERANCE_END_MS)),
        "vad_events": "true",
        "language": "en",
    }
    # Keep keywords for interview jargon (optional, free-form)
    keywords = os.environ.get("ASTRA_DEEPGRAM_KEYWORDS", "").strip()
    if keywords:
        # Deepgram accepts repeated key=; we pass as comma and let API ignore unknowns
        params["keywords"] = keywords
    return urllib.parse.urlencode(params)


def _extract_transcript(msg: dict[str, Any]) -> tuple[str, bool, bool]:
    """
    Returns (text, is_final, speech_final).
    Deepgram Results: channel.alternatives[0].transcript
    """
    if (msg.get("type") or "") not in ("Results", "results", ""):
        # Some events have no type field
        if "channel" not in msg and "channel_index" not in msg:
            return "", False, False
    channel = msg.get("channel") or {}
    alts = channel.get("alternatives") or []
    text = ""
    if alts:
        text = (alts[0].get("transcript") or "").strip()
    is_final = bool(msg.get("is_final"))
    speech_final = bool(msg.get("speech_final"))
    return text, is_final, speech_final


class DeepgramLiveStream:
    """
    Continuous Deepgram Nova-3 listen WebSocket.

    Thread-safe: send_pcm from audio threads; pop finals for answer jobs.
    """

    def __init__(
        self,
        *,
        sample_rate: int = 16000,
        emit: Optional[EmitFn] = None,
        api_key: Optional[str] = None,
    ) -> None:
        self.sample_rate = int(sample_rate)
        self._emit = emit
        self._api_key = (api_key or get_deepgram_api_key() or "").strip()
        self._ws: Any = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._connected = threading.Event()
        self._error: Optional[str] = None
        self._interim = ""
        self._finals: deque[str] = deque(maxlen=32)
        self._current_final_parts: list[str] = []
        self._bytes_sent = 0
        self._last_final_at = 0.0
        self._last_msg_at = 0.0

    @property
    def ready(self) -> bool:
        return self._connected.is_set() and not self._stop.is_set()

    @property
    def error(self) -> Optional[str]:
        return self._error

    def start(self, timeout: float = 6.0) -> bool:
        if websocket is None:
            self._error = "websocket-client not installed"
            return False
        if not self._api_key:
            self._error = "DEEPGRAM_API_KEY missing"
            return False
        if self._thread and self._thread.is_alive():
            return self._connected.is_set()

        self._stop.clear()
        self._connected.clear()
        self._error = None
        self._thread = threading.Thread(
            target=self._run, name="deepgram-live", daemon=True
        )
        self._thread.start()
        ok = self._connected.wait(timeout=timeout)
        if not ok and not self._error:
            self._error = "Deepgram connect timeout"
        return ok

    def stop(self) -> None:
        self._stop.set()
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                ws.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
            try:
                ws.close()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        self._connected.clear()

    def send_pcm(self, pcm: bytes | bytearray | memoryview) -> None:
        if not pcm or self._stop.is_set():
            return
        ws = self._ws
        if ws is None or not self._connected.is_set():
            return
        try:
            raw = bytes(pcm)
            if not raw:
                return
            ws.send(raw, opcode=websocket.ABNF.OPCODE_BINARY)
            self._bytes_sent += len(raw)
        except Exception as e:
            self._error = f"send failed: {type(e).__name__}"

    def send_pcm_int16(self, audio: np.ndarray) -> None:
        if audio is None or len(audio) == 0:
            return
        if audio.dtype != np.int16:
            # assume float [-1,1]
            a = np.clip(audio.astype(np.float32), -1.0, 1.0)
            pcm = (a * 32767.0).astype(np.int16).tobytes()
        else:
            pcm = np.ascontiguousarray(audio).tobytes()
        self.send_pcm(pcm)

    def get_interim(self) -> str:
        with self._lock:
            return self._interim

    def pop_final(self, *, wait_s: float = 0.0) -> str:
        """Pop next finalized utterance; optionally wait briefly for one."""
        deadline = time.time() + max(0.0, wait_s)
        while True:
            with self._lock:
                if self._finals:
                    return self._finals.popleft()
                # Flush assembled parts if speech_final already closed a turn
                if self._current_final_parts and time.time() - self._last_final_at > 0.35:
                    text = " ".join(self._current_final_parts).strip()
                    self._current_final_parts = []
                    if text:
                        return text
            if time.time() >= deadline:
                return ""
            time.sleep(0.03)

    def drain_finals(self) -> str:
        """Join all queued finals + current parts (utterance end)."""
        with self._lock:
            parts = list(self._finals)
            self._finals.clear()
            if self._current_final_parts:
                parts.append(" ".join(self._current_final_parts).strip())
                self._current_final_parts = []
            interim = self._interim
            self._interim = ""
        text = " ".join(p for p in parts if p).strip()
        if not text and interim:
            return interim
        return text

    def finalize_turn(self, *, wait_s: float = 0.45) -> str:
        """
        After local VAD ends, wait briefly for Deepgram finals then drain.
        """
        # Nudge: Finalize message (supported on listen v1)
        ws = self._ws
        if ws is not None:
            try:
                ws.send(json.dumps({"type": "Finalize"}))
            except Exception:
                pass
        time.sleep(max(0.05, wait_s))
        return self.drain_finals()

    def _run(self) -> None:
        key = self._api_key
        url = f"{DG_WS_BASE}?{_stream_query(sample_rate=self.sample_rate, interim=True)}"

        def on_open(ws: Any) -> None:
            self._ws = ws
            self._connected.set()
            if self._emit:
                try:
                    self._emit(
                        "status",
                        {
                            "message": f"Deepgram {DEEPGRAM_MODEL} streaming connected",
                            "stt_provider": "deepgram",
                            "listening": True,
                        },
                    )
                except Exception:
                    pass

        def on_message(ws: Any, message: str) -> None:
            self._last_msg_at = time.time()
            try:
                msg = json.loads(message)
            except Exception:
                return
            mtype = (msg.get("type") or "").strip()
            if mtype == "UtteranceEnd":
                with self._lock:
                    if self._current_final_parts:
                        text = " ".join(self._current_final_parts).strip()
                        self._current_final_parts = []
                        if text:
                            self._finals.append(text)
                            self._last_final_at = time.time()
                            self._interim = ""
                if self._emit:
                    try:
                        self._emit(
                            "transcript_partial",
                            {
                                "text": self.get_interim(),
                                "final": False,
                                "stt_provider": "deepgram",
                                "event": "utterance_end",
                            },
                        )
                    except Exception:
                        pass
                return
            if mtype in ("Metadata", "SpeechStarted"):
                return
            if mtype == "Error" or msg.get("error"):
                self._error = str(msg.get("message") or msg.get("error") or "Deepgram error")
                return

            text, is_final, speech_final = _extract_transcript(msg)
            if not text and not is_final:
                return
            with self._lock:
                if is_final:
                    if text:
                        self._current_final_parts.append(text)
                    self._interim = " ".join(self._current_final_parts).strip()
                    self._last_final_at = time.time()
                    if speech_final:
                        full = " ".join(self._current_final_parts).strip()
                        self._current_final_parts = []
                        if full:
                            self._finals.append(full)
                        self._interim = ""
                else:
                    # Interim: show assembled finals + current partial
                    base = " ".join(self._current_final_parts).strip()
                    self._interim = f"{base} {text}".strip() if base else text

            if self._emit and text:
                try:
                    self._emit(
                        "transcript_partial",
                        {
                            "text": self.get_interim() or text,
                            "final": bool(is_final and speech_final),
                            "is_final": is_final,
                            "speech_final": speech_final,
                            "stt_provider": "deepgram",
                        },
                    )
                except Exception:
                    pass

        def on_error(ws: Any, error: Exception) -> None:
            self._error = str(error)
            self._connected.clear()

        def on_close(ws: Any, *args: Any) -> None:
            self._connected.clear()
            self._ws = None

        try:
            self._ws_app = websocket.WebSocketApp(
                url,
                header=[f"Authorization: Token {key}"],
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
            )
            # run_forever blocks this thread
            self._ws_app.run_forever(ping_interval=20, ping_timeout=10)
        except Exception as e:
            self._error = f"{type(e).__name__}: {e}"
            self._connected.clear()


def transcribe_pcm_nova3(
    audio: np.ndarray,
    *,
    sample_rate: int = 16000,
    api_key: Optional[str] = None,
    timeout: float = 20.0,
) -> tuple[str, dict[str, Any]]:
    """
    Stream a single PCM clip over Deepgram live WebSocket (Nova-3).
    Returns (transcript, meta).
    """
    t0 = time.perf_counter()
    key = (api_key or get_deepgram_api_key() or "").strip()
    meta: dict[str, Any] = {
        "provider": "deepgram",
        "model": DEEPGRAM_MODEL,
        "mode": "stream_clip",
    }
    if not key:
        meta["error"] = "no_key"
        return "", meta
    if websocket is None:
        # REST fallback if websocket-client missing
        return _transcribe_rest(audio, sample_rate=sample_rate, api_key=key, t0=t0)

    if audio is None or len(audio) == 0:
        meta["error"] = "empty_audio"
        return "", meta

    if audio.dtype != np.int16:
        a = np.clip(audio.astype(np.float32), -1.0, 1.0)
        pcm = (a * 32767.0).astype(np.int16)
    else:
        pcm = np.ascontiguousarray(audio)

    url = f"{DG_WS_BASE}?{_stream_query(sample_rate=sample_rate, interim=False)}"
    finals: list[str] = []
    err_holder: list[str] = []
    done = threading.Event()

    def on_open(ws: Any) -> None:
        try:
            raw = pcm.tobytes()
            # ~100ms chunks at 16k mono int16 = 3200 bytes
            chunk = max(3200, int(sample_rate * 2 * 0.1))
            for i in range(0, len(raw), chunk):
                ws.send(raw[i : i + chunk], opcode=websocket.ABNF.OPCODE_BINARY)
            ws.send(json.dumps({"type": "CloseStream"}))
        except Exception as e:
            err_holder.append(str(e))
            done.set()

    def on_message(ws: Any, message: str) -> None:
        try:
            msg = json.loads(message)
        except Exception:
            return
        text, is_final, _sf = _extract_transcript(msg)
        if text and is_final:
            finals.append(text)
        if msg.get("type") == "Metadata" and finals:
            # keep collecting until close
            pass

    def on_error(ws: Any, error: Exception) -> None:
        err_holder.append(str(error))
        done.set()

    def on_close(ws: Any, *args: Any) -> None:
        done.set()

    try:
        ws_app = websocket.WebSocketApp(
            url,
            header=[f"Authorization: Token {key}"],
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        th = threading.Thread(
            target=lambda: ws_app.run_forever(ping_interval=None),
            daemon=True,
            name="dg-clip",
        )
        th.start()
        done.wait(timeout=timeout)
        try:
            ws_app.close()
        except Exception:
            pass
        th.join(timeout=1.0)
    except Exception as e:
        err_holder.append(str(e))

    text = " ".join(finals).strip()
    text = " ".join(text.split())
    meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
    meta["ok"] = bool(text)
    if err_holder and not text:
        meta["error"] = err_holder[0]
        # REST fallback
        return _transcribe_rest(audio, sample_rate=sample_rate, api_key=key, t0=t0)
    return text, meta


def _transcribe_rest(
    audio: np.ndarray,
    *,
    sample_rate: int = 16000,
    api_key: str,
    t0: float | None = None,
) -> tuple[str, dict[str, Any]]:
    """Pre-recorded listen REST (Nova-3) — backup when WS fails."""
    t0 = t0 or time.perf_counter()
    meta: dict[str, Any] = {
        "provider": "deepgram",
        "model": DEEPGRAM_MODEL,
        "mode": "rest",
    }
    if audio is None or len(audio) == 0:
        meta["error"] = "empty_audio"
        return "", meta
    if audio.dtype != np.int16:
        a = np.clip(audio.astype(np.float32), -1.0, 1.0)
        pcm = (a * 32767.0).astype(np.int16)
    else:
        pcm = np.ascontiguousarray(audio)

    # Minimal WAV wrapper so REST accepts the payload without encoding params issues
    wav = _pcm16_to_wav_bytes(pcm, sample_rate=sample_rate)
    q = urllib.parse.urlencode(
        {
            "model": DEEPGRAM_MODEL or "nova-3",
            "smart_format": "true",
            "punctuate": "true",
            "language": "en",
        }
    )
    req = urllib.request.Request(
        f"{DG_REST_BASE}?{q}",
        data=wav,
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": "audio/wav",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        results = body.get("results") or {}
        channels = results.get("channels") or []
        text = ""
        if channels:
            alts = (channels[0].get("alternatives") or [])
            if alts:
                text = (alts[0].get("transcript") or "").strip()
        text = " ".join(text.split())
        meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        meta["ok"] = bool(text)
        return text, meta
    except urllib.error.HTTPError as e:
        meta["error"] = f"HTTP {e.code}"
        meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return "", meta
    except Exception as e:
        meta["error"] = f"{type(e).__name__}: {e}"
        meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return "", meta


def _pcm16_to_wav_bytes(pcm: np.ndarray, *, sample_rate: int = 16000) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(np.ascontiguousarray(pcm).astype(np.int16).tobytes())
    return buf.getvalue()
