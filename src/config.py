#!/usr/bin/env python3
"""
Astra Interview Copilot - Configuration

Configuration constants and default values.
Audio device management moved to audio_capture.py.
License key, proxy URL, and hardware ID management with cross-platform user config directory.
"""

import hashlib
import os
import platform
import subprocess
from functools import lru_cache
from pathlib import Path

import yaml
from platformdirs import user_config_dir


# ---------------------------------------------------------------------------
# Licensing (temporarily OFF — flip to True to restore license + proxy mode)
# ---------------------------------------------------------------------------
LICENSE_ENABLED = False


def get_config_dir() -> Path:
    """Get cross-platform user config directory for Astra."""
    config_dir = Path(user_config_dir("astra"))
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


# ---------------------------------------------------------------------------
# .env file helpers (KEY=value format)
# ---------------------------------------------------------------------------


def _read_env_file() -> dict[str, str]:
    """Read all key-value pairs from the .env config file."""
    config_file = get_config_dir() / ".env"
    data: dict[str, str] = {}

    if not config_file.exists():
        return data

    with open(config_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip().strip('"').strip("'")

    return data


def _write_env_file(data: dict[str, str]) -> bool:
    """Write key-value pairs to the .env config file."""
    config_file = get_config_dir() / ".env"
    try:
        with open(config_file, "w", encoding="utf-8") as f:
            for key, value in data.items():
                f.write(f"{key}={value}\n")
        return True
    except IOError:
        return False


# ---------------------------------------------------------------------------
# License key management
# ---------------------------------------------------------------------------


def get_license_key() -> str | None:
    """
    Load license key from user config directory.

    Config location:
    - Linux: ~/.config/astra/.env
    - Windows: %APPDATA%/astra/.env
    - macOS: ~/Library/Application Support/astra/.env

    Returns None if not found.
    """
    data = _read_env_file()
    return data.get("LICENSE_KEY") or None


def get_openai_api_key() -> str | None:
    """
    Resolve OpenAI API key for direct (no-license) mode.

    Order: process env → user config dir .env → project-local .env next to this file.
    """
    env_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if env_key:
        return env_key

    data = _read_env_file()
    if data.get("OPENAI_API_KEY"):
        return data["OPENAI_API_KEY"]

    # Project .env (dev convenience)
    project_env = Path(__file__).resolve().parent / ".env"
    if project_env.exists():
        try:
            for line in project_env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "OPENAI_API_KEY":
                    val = v.strip().strip('"').strip("'")
                    if val:
                        return val
        except OSError:
            pass
    return None


def save_license_key(key: str) -> bool:
    """Write LICENSE_KEY to the .env file, preserving other entries."""
    data = _read_env_file()
    data["LICENSE_KEY"] = key
    return _write_env_file(data)


def clear_license_key() -> bool:
    """Remove the LICENSE_KEY line from the .env file."""
    data = _read_env_file()
    data.pop("LICENSE_KEY", None)
    return _write_env_file(data)


# ---------------------------------------------------------------------------
# Proxy URL management
# ---------------------------------------------------------------------------

_DEFAULT_PROXY_URL = "https://astra-proxy.up.railway.app/v1"


def get_proxy_url() -> str:
    """
    Read PROXY_URL from the .env file.

    Returns the configured URL or the production default if not set.
    For local dev, set PROXY_URL=http://localhost:8000/v1 in the .env file.
    """
    data = _read_env_file()
    return data.get("PROXY_URL") or _DEFAULT_PROXY_URL


def save_proxy_url(url: str) -> bool:
    """Write PROXY_URL to the .env file, preserving other entries."""
    data = _read_env_file()
    data["PROXY_URL"] = url
    return _write_env_file(data)


# ---------------------------------------------------------------------------
# Hardware ID
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def get_hardware_id() -> str:
    """
    Generate a stable machine identifier (32-char hex string).

    Strategy:
    - Linux: SHA-256 hash of /etc/machine-id
    - Windows: SHA-256 hash of wmic csproduct UUID
    - Fallback: SHA-256 hash of MAC address via uuid.getnode()

    Cached per process (computed once).
    """
    system = platform.system()

    try:
        if system == "Linux":
            machine_id_path = Path("/etc/machine-id")
            if machine_id_path.exists():
                raw = machine_id_path.read_text().strip()
                return hashlib.sha256(raw.encode()).hexdigest()[:32]

        elif system == "Windows":
            result = subprocess.run(
                ["wmic", "csproduct", "get", "uuid"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if line and line.upper() != "UUID":
                    return hashlib.sha256(line.encode()).hexdigest()[:32]
    except Exception:
        pass

    # Fallback: MAC address
    import uuid
    return hashlib.sha256(str(uuid.getnode()).encode()).hexdigest()[:32]


def get_config_path() -> Path:
    """Get path to .env config file for display to user (license key, proxy URL)."""
    return get_config_dir() / ".env"


def get_prompts_config_path() -> Path:
    """Get path to prompts YAML config file."""
    return get_config_dir() / "prompts.yaml"


def get_default_prompts_config() -> dict:
    """Return default prompts for general job interviews (any role, any age)."""
    return {
        "job_context": "",
        "default_tone": "casual",  # friendliest default for younger users
        "tones": {
            "professional": "Use clear, polite, simple language a student could say out loud. Short sentences.",
            "casual": "Use friendly, everyday words. Sound natural and kind. Easy for a middle-schooler to say.",
            "confident": "Use short, upbeat sentences. Sound sure of yourself without big fancy words."
        },
        "prompts": {
            "classification": """You are an interview question classifier for ANY job (retail, food service, office, internship, tech, school interviews). Given text from an interviewer, determine:
1. Is this a question that needs a real answer from the candidate?
2. What type of question is it?

ANSWER THESE:
- 'Tell me about yourself'
- 'Tell me about a time when...'
- 'Why do you want this job / this company?'
- 'What are your strengths / weaknesses?'
- 'How would you handle...'
- 'What's your experience with...'
- 'Walk me through...'
- 'Are you available / can you work weekends?'
- Technical or skill questions for the role
- Behavioral and situational questions

IGNORE THESE:
- 'Thanks for that'
- 'Can you hear me?'
- 'Let me tell you about the role...'
- 'Let's move on'
- Pure small talk with no question
- Statements that are not asking the candidate anything

Respond ONLY with valid JSON (no markdown): {"is_interview_question": true/false, "question_type": "behavioral"|"technical"|"situational"|"other"|"not_a_question", "confidence": 0.0-1.0, "cleaned_question": "the question cleaned up"}""",
            "bullet_system": """Generate exactly 3 ultra-short bullet points. Quick glance while speaking.

STRICT FORMAT:
- Exactly 3 bullets
- 12 words MAX per bullet
- Start with bullet character
- Plain language for any job

EXAMPLE:
- Stay calm when it gets busy — use a simple checklist
- Confirm with the customer before finishing
- Own mistakes quickly and fix them""",
            "script_system": """You help a young person (about middle school / early high school) answer interview questions out loud.

## TONE:
{tone_instruction}

## RULES:
- Write words they can READ OUT LOUD (first person: I, me, my)
- Keep it SHORT: 40–80 words (about 20–30 seconds of talking)
- Use SIMPLE everyday words a 5th–8th grader knows
- Short sentences. No big vocabulary. No jargon.
- No bullet points, no headers, no "In conclusion"
- Match the job if given (babysitter, cashier, camp, retail, etc.)
- Never invent employers, grades, or awards not in the notes
- If no notes, use honest ideas: school, chores, sports, clubs, helping family, "what I would do"

## EXAMPLE:
"I stay calm when things get busy. When I help at home during a big dinner, I make a little list so I don't forget anything. If I make a mistake, I say sorry and fix it. I'd do the same here."
"""
        }
    }


def load_prompts_config() -> dict:
    """
    Load prompts config from YAML file.
    Creates default config if file doesn't exist.
    Falls back to defaults on parse error.
    """
    config_path = get_prompts_config_path()
    defaults = get_default_prompts_config()

    if not config_path.exists():
        # Create default config file
        save_prompts_config(defaults)
        return defaults

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
            if config is None:
                return defaults
            # Merge with defaults for any missing keys
            merged = defaults.copy()
            merged.update(config)
            # Ensure nested dicts are merged
            if "tones" in config:
                merged["tones"] = {**defaults["tones"], **config["tones"]}
            if "prompts" in config:
                merged["prompts"] = {**defaults["prompts"], **config["prompts"]}
            return merged
    except (yaml.YAMLError, IOError) as e:
        print(f"Warning: Failed to load prompts config: {e}")
        print("Using default prompts.")
        return defaults


def save_prompts_config(config: dict) -> bool:
    """
    Save prompts config to YAML file.
    Returns True on success, False on failure.
    """
    config_path = get_prompts_config_path()
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        return True
    except IOError as e:
        print(f"Warning: Failed to save prompts config: {e}")
        return False


# Audio Configuration
# Change this to match your audio output's monitor device
# Run: pactl list sources short | grep monitor
# Pick the one for your speakers (usually without _3, _4, _5 suffix - those are HDMI)
AUDIO_DEVICE = "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__hw_sofhdadsp__sink.monitor"
AUDIO_SAMPLE_RATE = 16000  # Whisper expects 16kHz
AUDIO_CHANNELS = 1  # Mono

# Whisper Configuration
WHISPER_MODEL = "tiny.en"
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"

# RAG Configuration
EMBEDDING_MODEL = "text-embedding-3-small"
LLM_MODEL = "gpt-4o"
CLASSIFICATION_MODEL = "gpt-4o-mini"  # Fast model for question classification
COLLECTION_NAME = "astra_docs"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
CONTEXT_RELEVANCE_THRESHOLD = 0.3  # Below this, consider context not relevant
MIN_CONTEXT_RELEVANCE = 0.2  # Filter out chunks below this threshold

# Auto-Answer Mode Configuration
# Silence is pure dead time before STT — keep short for live interviews
# Peak-boosted meter — Stereo Mix is often very quiet; keep threshold low
SILENCE_THRESHOLD = 0.002       # Floor absolute silence (legacy / fallback)
SILENCE_DURATION = 0.65         # Seconds of relative silence to end an utterance
MIN_SPEECH_DURATION = 0.7       # Ignore very short blips
# If speech never "ends" (noisy room / continuous audio), force process after this
MAX_UTTERANCE_SECONDS = 14.0
# Adaptive VAD: speech if level > noise_floor * factor + offset
VAD_NOISE_FACTOR = 2.8
VAD_NOISE_OFFSET = 0.012
VAD_SILENCE_FACTOR = 1.6        # back under noise*factor for silence
CLASSIFICATION_CONFIDENCE = 0.55  # slightly looser for live auto path
MIN_WORDS_FOR_CLASSIFICATION = 3  # Skip LLM if fewer words than this
# Audio window for Whisper (seconds); actual window uses speech duration when known
AUTO_TRANSCRIBE_MAX_SECONDS = 14
MANUAL_TRANSCRIBE_MAX_SECONDS = 14


def get_default_monitor() -> str | None:
    """
    Get the best available monitor device.

    Delegates to audio_capture module.

    Returns:
        Device name string or None
    """
    from audio_capture import get_default_monitor as _get_default_monitor
    return _get_default_monitor()


def print_audio_config():
    """Print current audio configuration and available devices."""
    from audio_capture import list_monitor_devices

    print("Audio Configuration")
    print("=" * 50)
    print(f"Sample Rate: {AUDIO_SAMPLE_RATE} Hz")
    print(f"Channels: {AUDIO_CHANNELS} (mono)")
    print(f"Configured Device: {AUDIO_DEVICE}")
    print()

    print("Available Monitor Devices:")
    print("-" * 50)
    monitors = list_monitor_devices()

    if not monitors:
        print("  (none found)")
    else:
        for m in monitors:
            status = "active" if m.is_active else "suspended"
            print(f"  [{m.index}] {m.name}")
            print(f"      State: {status}, Driver: {m.driver}")

    print()
    default = get_default_monitor()
    if default:
        print(f"Recommended Device: {default}")
    print("=" * 50)


if __name__ == "__main__":
    print_audio_config()
