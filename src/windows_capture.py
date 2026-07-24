"""
Windows system-audio capture (what you hear).

Priority:
1) Stereo Mix / What U Hear (most reliable for YouTube on this machine)
2) sounddevice default input (mic) as last-resort room pickup
3) PyAudioWPatch WASAPI loopback if available
"""

from __future__ import annotations

import sys
import threading
from typing import Any

import numpy as np

from audio_capture import AudioCapture, Int16RingBuffer, MAX_BUFFER_SECONDS

try:
    import sounddevice as sd
except Exception:
    # ImportError, or OSError when PortAudio is missing (Linux cloud images)
    sd = None

try:
    import pyaudiowpatch as pyaudio
except Exception:
    pyaudio = None


def _is_system_mix_name(name: str) -> bool:
    n = (name or "").lower()
    return any(
        k in n
        for k in (
            "stereo mix",
            "what u hear",
            "wave out mix",
            "mixed output",
            "loopback",
            "system virtual line",
        )
    )


class WindowsAudioCapture(AudioCapture):
    """Capture PC playback audio for interview copilots on Windows."""

    def __init__(self, device: str = None, sample_rate: int = 16000, channels: int = 1):
        if sys.platform != "win32":
            raise RuntimeError("Windows only")
        if sd is None and pyaudio is None:
            raise ImportError("Install sounddevice or PyAudioWPatch for Windows audio")

        self._target_sample_rate = sample_rate
        self._target_channels = channels
        self._ring = Int16RingBuffer(sample_rate * MAX_BUFFER_SECONDS)
        self._capturing = False
        self._stream = None
        self._backend = "none"  # sounddevice | pyaudio
        self._device = ""
        self._device_index: Any = None
        self._actual_sample_rate = 44100
        self._actual_channels = 2
        self._using_microphone = False
        self._bytes_received = 0
        self._raw_level = 0.0  # pre-gain peak for VAD (0..1)
        self._lock = threading.Lock()
        self._preferred_name = device
        self._devices_cache: list[dict] = []

        self._select_device(device)

    # ---- device selection -------------------------------------------------

    def _sd_input_devices(self) -> list[dict]:
        if sd is None:
            return []
        out = []
        for i, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                out.append({
                    "index": i,
                    "name": d.get("name", f"Device {i}"),
                    "channels": int(d["max_input_channels"]),
                    "rate": float(d.get("default_samplerate", 44100)),
                    "hostapi": d.get("hostapi"),
                    "backend": "sounddevice",
                    "is_mix": _is_system_mix_name(d.get("name", "")),
                })
        return out

    def _select_device(self, device_name: str | None) -> None:
        devices = self._sd_input_devices()
        self._devices_cache = devices

        chosen = None
        if device_name:
            for d in devices:
                if device_name == d["name"] or device_name in d["name"] or d["name"] in device_name:
                    chosen = d
                    break

        if chosen is None:
            # Prefer Stereo Mix / system virtual line
            mixes = [d for d in devices if d["is_mix"]]
            if mixes:
                # Prefer names containing stereo mix
                stereo = [d for d in mixes if "stereo mix" in d["name"].lower()]
                chosen = stereo[0] if stereo else mixes[0]
                self._using_microphone = "mic" in chosen["name"].lower() and "mix" not in chosen["name"].lower()
            else:
                # Default input (often mic array)
                if sd is not None:
                    try:
                        di = sd.default.device[0]
                        for d in devices:
                            if d["index"] == di:
                                chosen = d
                                self._using_microphone = True
                                break
                    except Exception:
                        pass
                if chosen is None and devices:
                    chosen = devices[0]
                    self._using_microphone = not chosen["is_mix"]

        if chosen is None:
            # Last chance: pyaudiowpatch loopback name only
            if pyaudio is not None:
                self._backend = "pyaudio"
                self._device = device_name or "WASAPI Loopback"
                self._device_index = None
                print("[audio] sounddevice has no inputs; will try PyAudioWPatch at start")
                return
            raise RuntimeError(
                "No recording devices found. Enable Stereo Mix in Windows "
                "Sound settings → Recording, or plug in a microphone."
            )

        self._backend = "sounddevice"
        self._device = chosen["name"]
        self._device_index = chosen["index"]
        self._actual_sample_rate = int(chosen["rate"] or 44100)
        self._actual_channels = min(2, max(1, chosen["channels"]))
        self._using_microphone = (not chosen["is_mix"]) and (
            "mic" in chosen["name"].lower() or "microphone" in chosen["name"].lower()
        )
        print(
            f"[audio] Selected: {self._device} "
            f"(idx={self._device_index}, mix={chosen['is_mix']}, mic={self._using_microphone})",
            flush=True,
        )

    # ---- AudioCapture API -------------------------------------------------

    @property
    def device(self) -> str:
        return self._device or ""

    def list_devices(self) -> list[dict]:
        devices = self._sd_input_devices()
        # Put mix devices first
        devices.sort(key=lambda d: (not d["is_mix"], d["name"]))
        return [
            {
                "name": d["name"],
                "status": "MIX" if d["is_mix"] else "MIC",
            }
            for d in devices
        ]

    def try_next_loopback(self) -> str | None:
        devices = self._sd_input_devices()
        if len(devices) < 2:
            return None
        # rotate among devices
        names = [d["name"] for d in devices]
        try:
            cur = names.index(self._device) if self._device in names else -1
        except ValueError:
            cur = -1
        nxt = devices[(cur + 1) % len(devices)]
        was = self._capturing
        if was:
            self.stop_capture()
        self._select_device(nxt["name"])
        if was:
            self.start_capture()
        return self._device

    def _sd_callback(self, indata, frames, time_info, status):
        if not self._capturing:
            return
        try:
            # indata: float32 shape (frames, channels)
            self._bytes_received += int(indata.nbytes)
            mono = indata
            if mono.ndim == 2:
                mono = mono.mean(axis=1)
            else:
                mono = mono.reshape(-1)
            # resample to target
            if self._actual_sample_rate != self._target_sample_rate and len(mono) > 1:
                ratio = self._target_sample_rate / float(self._actual_sample_rate)
                new_len = max(1, int(len(mono) * ratio))
                x_old = np.linspace(0, 1, len(mono), endpoint=False)
                x_new = np.linspace(0, 1, new_len, endpoint=False)
                mono = np.interp(x_new, x_old, mono.astype(np.float64))
            # Pre-gain peak for speech endpointing (must not use post-gain for VAD)
            peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
            self._raw_level = peak
            # Stereo Mix is often very quiet — boost only what we store for STT/meter
            gain = 1.0
            p = peak + 1e-9
            if p < 0.05:
                gain = min(12.0, 0.2 / p)  # milder than 40x so meters stay honest
            mono_g = np.clip(mono * gain, -1.0, 1.0)
            samples = np.clip(mono_g * 32768.0, -32768, 32767).astype(np.int16)
            self._ring.extend_samples(samples)
        except Exception:
            pass

    def start_capture(self) -> None:
        if self._capturing:
            return
        self._ring.clear()
        self._bytes_received = 0

        if self._backend == "sounddevice" and sd is not None and self._device_index is not None:
            try:
                self._stream = sd.InputStream(
                    device=self._device_index,
                    channels=self._actual_channels,
                    samplerate=self._actual_sample_rate,
                    dtype="float32",
                    blocksize=1024,
                    callback=self._sd_callback,
                )
                self._stream.start()
                self._capturing = True
                print(
                    f"[audio] sounddevice capture ON device={self._device} "
                    f"rate={self._actual_sample_rate} ch={self._actual_channels}",
                    flush=True,
                )
                return
            except Exception as e:
                print(f"[audio] sounddevice open failed: {e}", flush=True)
                # fall through to mic default / pyaudio

        # Fallback: default sounddevice input
        if sd is not None:
            try:
                di = sd.default.device[0]
                info = sd.query_devices(di)
                self._device_index = di
                self._device = info.get("name", "Default Input")
                self._actual_sample_rate = int(info.get("default_samplerate", 44100))
                self._actual_channels = min(2, max(1, int(info.get("max_input_channels", 1))))
                self._using_microphone = True
                self._stream = sd.InputStream(
                    device=self._device_index,
                    channels=self._actual_channels,
                    samplerate=self._actual_sample_rate,
                    dtype="float32",
                    blocksize=1024,
                    callback=self._sd_callback,
                )
                self._stream.start()
                self._capturing = True
                print(f"[audio] Using default microphone: {self._device}", flush=True)
                return
            except Exception as e:
                print(f"[audio] default mic failed: {e}", flush=True)

        raise RuntimeError(
            "Couldn't start listening. Enable Stereo Mix in Windows Sound → Recording "
            "(right-click empty area → Show Disabled Devices → enable Stereo Mix), "
            "or allow microphone access."
        )

    def stop_capture(self) -> np.ndarray:
        self._capturing = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        return self._ring.get_all_samples()

    def get_last_n_seconds(self, n: int) -> np.ndarray:
        return self._ring.get_last_n_samples(int(self._target_sample_rate * max(0, n)))

    def get_audio_level(self) -> float:
        """UI meter (post-gain ring) — lively bar."""
        return self._ring.get_level(int(self._target_sample_rate * 0.15))

    def get_vad_level(self) -> float:
        """True acoustic peak before gain — use for speech start/stop."""
        return float(self._raw_level)

    def diagnostics(self) -> dict:
        return {
            "device": self._device,
            "bytes_received": self._bytes_received,
            "samples_buffered": self._ring.sample_count(),
            "level": self.get_audio_level(),
            "vad_level": self.get_vad_level(),
            "using_microphone": self._using_microphone,
            "backend": self._backend,
            "rate": self._actual_sample_rate,
            "channels": self._actual_channels,
        }

    def __del__(self):
        try:
            if self._capturing:
                self.stop_capture()
        except Exception:
            pass
