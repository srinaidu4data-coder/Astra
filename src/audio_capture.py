#!/usr/bin/env python3
"""
Audio Capture Abstraction Layer for Astra MVP.

Platform-agnostic audio capture interface with implementations for:
- Linux (PulseAudio/PipeWire via parec)
- Windows (WASAPI loopback via PyAudioWPatch)
"""

import subprocess
import sys
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

# Conditional imports for Windows audio
if sys.platform == "win32":
    try:
        import pyaudiowpatch as pyaudio
    except ImportError:
        pyaudio = None
    try:
        import sounddevice as sd
    except ImportError:
        sd = None
else:
    sd = None


# Buffer configuration
MAX_BUFFER_SECONDS = 60
BYTES_PER_SAMPLE = 2  # 16-bit = 2 bytes


class Int16RingBuffer:
    """
    Circular buffer of int16 samples.

    Avoids the old byte-deque design (1 Python int per byte + full list()
    every 100ms), which caused severe UI lag on Windows.
    """

    def __init__(self, max_samples: int):
        self._max = max(1, int(max_samples))
        self._buf = np.zeros(self._max, dtype=np.int16)
        self._write = 0
        self._count = 0
        self._lock = threading.Lock()

    def clear(self) -> None:
        with self._lock:
            self._write = 0
            self._count = 0

    def extend_bytes(self, data: bytes) -> None:
        if not data:
            return
        # Ensure even length for int16
        if len(data) % 2:
            data = data[:-1]
        if not data:
            return
        self.extend_samples(np.frombuffer(data, dtype=np.int16))

    def extend_samples(self, samples: np.ndarray) -> None:
        if samples is None or len(samples) == 0:
            return
        samples = np.asarray(samples, dtype=np.int16).ravel()
        n = len(samples)
        with self._lock:
            if n >= self._max:
                self._buf[:] = samples[-self._max:]
                self._write = 0
                self._count = self._max
                return
            end = self._write + n
            if end <= self._max:
                self._buf[self._write:end] = samples
            else:
                first = self._max - self._write
                self._buf[self._write:] = samples[:first]
                self._buf[: n - first] = samples[first:]
            self._write = (self._write + n) % self._max
            self._count = min(self._max, self._count + n)

    def get_last_n_samples(self, n: int) -> np.ndarray:
        take = max(0, int(n))
        with self._lock:
            take = min(take, self._count)
            if take == 0:
                return np.array([], dtype=np.int16)
            start = (self._write - take) % self._max
            if start + take <= self._max:
                return self._buf[start:start + take].copy()
            first = self._max - start
            return np.concatenate((self._buf[start:], self._buf[: take - first]))

    def get_all_samples(self) -> np.ndarray:
        with self._lock:
            count = self._count
        return self.get_last_n_samples(count)

    def get_level(self, window_samples: int = 1600) -> float:
        """
        UI / VAD level 0..1. Uses peak (more sensitive than RMS alone)
        so quiet YouTube / laptop speakers still register as sound.
        """
        samples = self.get_last_n_samples(window_samples)
        if len(samples) == 0:
            return 0.0
        f = samples.astype(np.float32)
        peak = float(np.max(np.abs(f))) / 32768.0
        rms = float(np.sqrt(np.mean(f ** 2))) / 32768.0
        # Emphasize peaks; boost quiet content for the meter
        level = max(peak * 1.8, rms * 4.0)
        return min(1.0, level)

    def sample_count(self) -> int:
        with self._lock:
            return self._count


@dataclass
class AudioSource:
    """Represents an audio source device."""
    index: str
    name: str
    driver: str
    sample_spec: str
    state: str

    @property
    def is_monitor(self) -> bool:
        return ".monitor" in self.name

    @property
    def is_active(self) -> bool:
        return self.state in ("IDLE", "RUNNING")


class AudioCapture(ABC):
    """
    Abstract base class for platform-specific audio capture.

    Implementations must provide system audio capture functionality
    for their respective platforms.
    """

    @abstractmethod
    def start_capture(self) -> None:
        """Begin capturing system audio."""
        pass

    @abstractmethod
    def stop_capture(self) -> np.ndarray:
        """
        Stop capturing and return audio buffer.

        Returns:
            numpy array of 16-bit audio samples
        """
        pass

    @abstractmethod
    def get_last_n_seconds(self, n: int) -> np.ndarray:
        """
        Get last N seconds of audio without stopping capture.

        Args:
            n: Number of seconds to retrieve

        Returns:
            numpy array of 16-bit audio samples
        """
        pass

    @abstractmethod
    def get_audio_level(self) -> float:
        """
        Get current audio level (RMS) for UI meter.

        Returns:
            Float from 0.0 to 1.0
        """
        pass

    @abstractmethod
    def list_devices(self) -> list[dict]:
        """
        List available audio capture devices.

        Returns:
            List of dicts with 'name' and 'status' keys
        """
        pass

    @property
    @abstractmethod
    def device(self) -> str:
        """Get current device name."""
        pass


class LinuxAudioCapture(AudioCapture):
    """
    Linux audio capture implementation using PulseAudio/PipeWire.

    Uses parec subprocess for capturing and pactl for device listing.
    """

    def __init__(self, device: str = None, sample_rate: int = 16000, channels: int = 1):
        """
        Initialize Linux audio capture.

        Args:
            device: PulseAudio source name. If None, auto-detects.
            sample_rate: Audio sample rate (default 16000 for Whisper)
            channels: Number of audio channels (default 1 for mono)
        """
        self._sample_rate = sample_rate
        self._channels = channels
        self._process = None
        self._ring = Int16RingBuffer(sample_rate * MAX_BUFFER_SECONDS)
        self._capturing = False
        self._read_thread = None
        self._read_chunk_size = int(sample_rate * 0.1 * BYTES_PER_SAMPLE)

        # Determine device
        if device:
            self._device = device
        else:
            # Try to get from config, or auto-detect
            try:
                from config import AUDIO_DEVICE
                self._device = AUDIO_DEVICE
            except ImportError:
                default = get_default_monitor()
                self._device = default if default else ""

        # Validate device exists
        self._validate_device()

    def _validate_device(self):
        """Validate the device exists, or find alternative."""
        monitors = list_monitor_devices()
        monitor_names = [m.name for m in monitors]

        if self._device not in monitor_names:
            if monitors:
                # Use first available monitor
                old_device = self._device
                self._device = monitors[0].name
                print(f"Warning: Device '{old_device}' not found")
                print(f"Using: {self._device}")
            else:
                print("Error: No monitor devices found")
                print("Make sure PipeWire/PulseAudio is running")

    @property
    def device(self) -> str:
        """Get current device name."""
        return self._device

    def list_devices(self) -> list[dict]:
        """
        List all available monitor devices.

        Returns:
            List of dicts with 'name' and 'status' keys
        """
        monitors = list_monitor_devices()
        return [{"name": m.name, "status": m.state} for m in monitors]

    def _read_loop(self):
        """Background thread: read audio data from parec."""
        while self._capturing and self._process:
            try:
                data = self._process.stdout.read(self._read_chunk_size)
                if data:
                    self._ring.extend_bytes(data)
                elif self._process.poll() is not None:
                    # Process ended
                    break
            except Exception as e:
                print(f"Error reading audio: {e}")
                break

    def start_capture(self) -> None:
        """Start capturing system audio."""
        if self._capturing:
            return

        # Clear buffer
        self._ring.clear()

        # Start parec subprocess
        cmd = [
            "parec",
            f"--device={self._device}",
            f"--rate={self._sample_rate}",
            f"--channels={self._channels}",
            "--format=s16le",
            "--raw"
        ]

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
        except FileNotFoundError:
            print("Error: 'parec' command not found")
            print("Install with: sudo apt install pulseaudio-utils")
            raise RuntimeError("parec not found")

        # Check for immediate errors
        try:
            self._process.wait(timeout=0.1)
            stderr = self._process.stderr.read().decode()
            if "does not exist" in stderr or "No such" in stderr:
                print(f"Error: Device not found: {self._device}")
                print("\nAvailable devices:")
                for dev in self.list_devices():
                    print(f"  [{dev['status']:10}] {dev['name']}")
                raise RuntimeError(f"Device not found: {self._device}")
        except subprocess.TimeoutExpired:
            pass  # Process is running, good

        self._capturing = True
        self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._read_thread.start()

    def stop_capture(self) -> np.ndarray:
        """
        Stop capturing and return audio buffer.

        Returns:
            numpy array of 16-bit audio samples
        """
        self._capturing = False

        # Stop process
        if self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None

        # Wait for read thread
        if self._read_thread:
            self._read_thread.join(timeout=1)
            self._read_thread = None

        return self._ring.get_all_samples()

    def get_last_n_seconds(self, n: int) -> np.ndarray:
        """
        Get last N seconds of audio without stopping capture.

        Args:
            n: Number of seconds to retrieve

        Returns:
            numpy array of 16-bit audio samples
        """
        return self._ring.get_last_n_samples(int(self._sample_rate * max(0, n)))

    def get_audio_level(self) -> float:
        """
        Get current audio level (RMS) for UI meter.

        Returns:
            Float from 0.0 to 1.0
        """
        # Last 0.1s only — never copy the full 60s history
        return self._ring.get_level(int(self._sample_rate * 0.1))

    def __del__(self):
        """Cleanup."""
        if self._capturing:
            self.stop_capture()



# Windows implementation: windows_capture.py (Stereo Mix via sounddevice)
# On Linux (Railway/Docker) skip — cloud API only needs Whisper on uploaded/WS audio.
if sys.platform == "win32":
    from windows_capture import WindowsAudioCapture  # noqa: E402
else:
    WindowsAudioCapture = None  # type: ignore[misc, assignment]


# Module-level functions for device listing (platform-specific)

def list_audio_sources() -> list[AudioSource]:
    """
    List all audio sources using pactl (Linux).

    Returns:
        List of AudioSource objects
    """
    if sys.platform != "linux":
        return []

    try:
        result = subprocess.run(
            ["pactl", "list", "sources", "short"],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode != 0:
            print(f"Warning: pactl returned error: {result.stderr}")
            return []

        sources = []
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue

            parts = line.split('\t')
            if len(parts) >= 5:
                sources.append(AudioSource(
                    index=parts[0],
                    name=parts[1],
                    driver=parts[2],
                    sample_spec=parts[3],
                    state=parts[4]
                ))

        return sources

    except FileNotFoundError:
        print("Error: 'pactl' command not found.")
        print("Please install PulseAudio utilities:")
        print("  sudo apt install pulseaudio-utils")
        return []
    except subprocess.TimeoutExpired:
        print("Error: pactl command timed out")
        return []
    except Exception as e:
        print(f"Error listing audio sources: {e}")
        return []


def list_monitor_devices() -> list[AudioSource]:
    """
    List all monitor devices (for capturing system/app audio).

    Monitor devices capture audio output (what you hear from speakers).
    Prefers devices with status "IDLE" or "RUNNING" over "SUSPENDED".

    Returns:
        List of monitor AudioSource objects, sorted by activity status
    """
    sources = list_audio_sources()
    monitors = [s for s in sources if s.is_monitor]

    # Sort: active devices first, then suspended
    monitors.sort(key=lambda s: (not s.is_active, s.name))

    return monitors


def get_default_monitor() -> str | None:
    """
    Get the best available monitor device.

    1. Returns the first non-suspended monitor
    2. Falls back to first monitor if all suspended
    3. Returns None if no monitors found

    Returns:
        Device name string or None
    """
    monitors = list_monitor_devices()

    if not monitors:
        print("=" * 50)
        print("No audio monitor devices found!")
        print()
        print("Monitor devices capture system audio output.")
        print("Possible fixes:")
        print("  1. Check if PipeWire/PulseAudio is running:")
        print("     systemctl --user status pipewire pulseaudio")
        print()
        print("  2. List all audio devices:")
        print("     pactl list sources short")
        print()
        print("  3. If using PipeWire, ensure pipewire-pulse is installed:")
        print("     sudo apt install pipewire-pulse")
        print("=" * 50)
        return None

    # Return first active monitor, or first monitor if all suspended
    for monitor in monitors:
        if monitor.is_active:
            return monitor.name

    # All suspended, return first one
    return monitors[0].name


class BrowserAudioCapture(AudioCapture):
    """
    Capture fed by the browser (mic PCM over WebSocket).

    Used for cloud/web deploys where server-side Stereo Mix / parec is unavailable.
    Client sends little-endian int16 mono PCM (typically 16 kHz).

    Pre-start PCM is buffered so audio arriving before start_capture (common race
    when the client opens the mic first) is not dropped — that was causing 1-word
    STT fragments and a broken listen → answer flow.
    """

    # Keep up to ~4s of pre-roll before session start
    _PREBUF_MAX_SAMPLES = 16000 * 4

    def __init__(self, sample_rate: int = 16000, channels: int = 1):
        self._sample_rate = int(sample_rate) or 16000
        self._channels = int(channels) or 1
        self._ring = Int16RingBuffer(self._sample_rate * MAX_BUFFER_SECONDS)
        self._capturing = False
        self._level = 0.0
        self._raw_level = 0.0
        self._device_name = "browser-mic"
        self._prebuf = bytearray()
        self._prebuf_lock = threading.Lock()

    @property
    def device(self) -> str:
        return self._device_name

    def start_capture(self) -> None:
        self._ring.clear()
        self._level = 0.0
        self._raw_level = 0.0
        # Flush any PCM that arrived before the session thread was ready
        with self._prebuf_lock:
            early = bytes(self._prebuf)
            self._prebuf.clear()
        self._capturing = True
        if early:
            self._ingest_pcm(early)

    def stop_capture(self) -> np.ndarray:
        self._capturing = False
        with self._prebuf_lock:
            self._prebuf.clear()
        samples = self._ring.get_all_samples()
        self._ring.clear()
        return samples

    def push_pcm16(self, data: bytes) -> None:
        """Append raw little-endian int16 mono PCM from the browser."""
        if not data:
            return
        if len(data) % 2:
            data = data[:-1]
        if not data:
            return
        if not self._capturing:
            # Session not ready yet — keep a short pre-roll so we don't drop the
            # first words of the question (browser opens mic before WS "start").
            with self._prebuf_lock:
                self._prebuf.extend(data)
                max_bytes = self._PREBUF_MAX_SAMPLES * 2
                if len(self._prebuf) > max_bytes:
                    self._prebuf[:] = self._prebuf[-max_bytes:]
            return
        self._ingest_pcm(data)

    def _ingest_pcm(self, data: bytes) -> None:
        samples = np.frombuffer(data, dtype=np.int16)
        if self._channels > 1 and len(samples) >= self._channels:
            usable = (len(samples) // self._channels) * self._channels
            samples = samples[:usable].reshape(-1, self._channels)[:, 0].astype(np.int16)
        self._ring.extend_samples(samples)
        # Peak + RMS over recent audio (stable VAD; less flicker between words)
        if len(samples):
            window = self._ring.get_last_n_samples(int(self._sample_rate * 0.35))
            if len(window) == 0:
                window = samples
            f = window.astype(np.float32)
            peak = float(np.max(np.abs(f))) / 32768.0
            rms = float(np.sqrt(np.mean(f ** 2))) / 32768.0
            lvl = min(1.0, max(peak * 1.6, rms * 3.5))
            self._raw_level = (0.5 * self._raw_level) + (0.5 * lvl)
            self._level = (0.65 * self._level) + (0.35 * lvl)

    def get_last_n_seconds(self, n: float) -> np.ndarray:
        """Return last n seconds (float allowed — int truncation was eating clips)."""
        try:
            sec = float(n)
        except (TypeError, ValueError):
            sec = 0.0
        sec = max(0.0, sec)
        return self._ring.get_last_n_samples(int(sec * self._sample_rate + 0.5))

    def keep_only_last_seconds(self, seconds: float = 1.0) -> None:
        """
        Drop older ring audio after a question is processed.

        Critical for long interviews: without this, Q2 STT often re-includes Q1
        tail and produces wrong/merged transcripts.
        """
        try:
            sec = max(0.0, float(seconds))
        except (TypeError, ValueError):
            sec = 1.0
        recent = self.get_last_n_seconds(sec)
        self._ring.clear()
        if recent is not None and len(recent) > 0:
            self._ring.extend_samples(recent)
        # Reset levels so next VAD cycle doesn't stick on old peaks
        self._level *= 0.3
        self._raw_level *= 0.3

    def get_audio_level(self) -> float:
        return float(self._level)

    def get_vad_level(self) -> float:
        # Prefer smoothed peak/RMS so brief mid-word dips don't end the turn
        return float(max(self._raw_level, self._level * 0.9))

    def list_devices(self) -> list[dict]:
        return [{"name": self._device_name, "status": "browser"}]


def get_audio_capture(device: str = None) -> AudioCapture:
    """
    Factory function to get platform-appropriate AudioCapture instance.

    Args:
        device: Device name/identifier. If None, auto-detects.

    Returns:
        AudioCapture implementation for the current platform

    Raises:
        NotImplementedError: If platform is not supported
    """
    if sys.platform == "linux":
        # Import config for sample rate and channels
        try:
            from config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS
            return LinuxAudioCapture(
                device=device,
                sample_rate=AUDIO_SAMPLE_RATE,
                channels=AUDIO_CHANNELS
            )
        except ImportError:
            return LinuxAudioCapture(device=device)

    elif sys.platform == "win32":
        # Windows implementation using PyAudioWPatch WASAPI loopback
        try:
            from config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS
            return WindowsAudioCapture(
                device=device,
                sample_rate=AUDIO_SAMPLE_RATE,
                channels=AUDIO_CHANNELS
            )
        except ImportError:
            return WindowsAudioCapture(device=device)

    elif sys.platform == "darwin":
        raise NotImplementedError(
            "macOS audio capture not yet implemented."
        )

    else:
        raise NotImplementedError(
            f"Platform '{sys.platform}' is not supported for audio capture."
        )


if __name__ == "__main__":
    import time

    print("=== Audio Capture Abstraction Test ===\n")

    # Test factory function
    print(f"Platform: {sys.platform}")

    try:
        capture = get_audio_capture()
        print(f"AudioCapture implementation: {type(capture).__name__}")
        print(f"\nUsing device: {capture.device}")

        print("\nAvailable monitor devices:")
        for dev in capture.list_devices():
            print(f"  [{dev['status']:10}] {dev['name']}")

        print("\n1. Play some audio (YouTube, Spotify, etc.)")
        print("2. Press Enter to start capturing...")
        input()

        capture.start_capture()
        print("Capturing for 5 seconds...\n")

        for i in range(5):
            time.sleep(1)
            level = capture.get_audio_level()
            bar = "\u2588" * int(level * 50)
            print(f"  Level: {bar:50} {level:.2f}")

        print("\nStopping capture...")
        audio = capture.stop_capture()
        print(f"Captured {len(audio)} samples ({len(audio)/16000:.1f} seconds)")

    except NotImplementedError as e:
        print(f"Platform not supported: {e}")
    except Exception as e:
        print(f"Error: {e}")
