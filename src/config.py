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


_PLACEHOLDER_OPENAI_KEYS = frozenset(
    {
        "",
        "sk-...",
        "sk-xxx",
        "sk-your-key",
        "sk-your-key-here",
        "your-openai-key",
        "changeme",
        "change-me",
        "<your-openai-key>",
        "OPENAI_API_KEY",
    }
)


def is_usable_openai_api_key(key: str | None) -> bool:
    """
    True for keys usable with OpenAI-compatible chat APIs (OpenAI sk- / Groq gsk_).

    Rejects empty values and common .env placeholders (e.g. sk-...) so health
    and answer routes do not claim the LLM is ready when it will 401.
    """
    if not key:
        return False
    k = str(key).strip().strip('"').strip("'")
    if not k or k in _PLACEHOLDER_OPENAI_KEYS:
        return False
    low = k.lower()
    if "your" in low and "key" in low:
        return False
    if low.startswith("sk-...") or low.endswith("..."):
        return False
    # Groq keys
    if low.startswith("gsk_") and len(k) >= 20:
        return True
    # OpenAI project/user keys are long; refuse obviously truncated values
    if low.startswith("sk-") and len(k) < 20:
        return False
    if len(k) < 16:
        return False
    return True


_project_env_loaded = False


def _ensure_project_env_loaded() -> None:
    """
    Load src/.env into os.environ once (override=False).

    Ensures GROQ_API_KEY / ASTRA_LLM_PROVIDER work when only present in the file
    (not already exported in the process).
    """
    global _project_env_loaded
    if _project_env_loaded:
        return
    _project_env_loaded = True
    project_env = Path(__file__).resolve().parent / ".env"
    if not project_env.exists():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(project_env, override=False)
    except Exception:
        # Fallback: pull LLM-related keys only
        try:
            for line in project_env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k in (
                    "GROQ_API_KEY",
                    "OPENAI_API_KEY",
                    "DEEPGRAM_API_KEY",
                    "ASTRA_DEEPGRAM_KEY",
                    "ASTRA_STT_PROVIDER",
                    "ASTRA_LLM_PROVIDER",
                    "LLM_PROVIDER",
                    "OPENAI_BASE_URL",
                    "GROQ_BASE_URL",
                    "ASTRA_ANSWER_MODEL",
                    "ASTRA_FALLBACK_MODEL",
                    "ASTRA_FAST_MODEL",
                    "ASTRA_FAST_FALLBACK",
                    "ASTRA_ANSWER_PROFILE",
                    "DEFAULT_ANSWER_MODEL",
                    "DEFAULT_FALLBACK_MODEL",
                ) and k not in os.environ:
                    os.environ[k] = v
        except OSError:
            pass


def get_llm_provider() -> str:
    """openai | groq — from env or inferred from key prefix."""
    _ensure_project_env_loaded()
    p = (os.environ.get("ASTRA_LLM_PROVIDER") or os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if p in ("groq", "openai", "xai", "deepseek"):
        return p
    # Infer from process keys only (do not read secrets from disk for inference)
    for name in ("GROQ_API_KEY", "OPENAI_API_KEY"):
        raw = (os.environ.get(name) or "").strip()
        if raw.lower().startswith("gsk_"):
            return "groq"
        if raw.lower().startswith("sk-") and is_usable_openai_api_key(raw):
            return "openai"
    return "openai"


def get_openai_base_url() -> str | None:
    """OpenAI-compatible base URL. Groq default when provider is groq."""
    # Empty OPENAI_BASE_URL= in .env breaks the OpenAI SDK
    # (UnsupportedProtocol: URL missing http:// or https://).
    for name in ("OPENAI_BASE_URL", "GROQ_BASE_URL"):
        raw = os.environ.get(name)
        if raw is not None and not str(raw).strip():
            os.environ.pop(name, None)
    explicit = (os.environ.get("OPENAI_BASE_URL") or os.environ.get("GROQ_BASE_URL") or "").strip()
    if explicit:
        # Require absolute URL
        if not explicit.lower().startswith(("http://", "https://")):
            explicit = "https://" + explicit.lstrip("/")
        return explicit.rstrip("/")
    if get_llm_provider() == "groq":
        return "https://api.groq.com/openai/v1"
    if get_llm_provider() == "xai":
        return "https://api.x.ai/v1"
    return None


# OpenAI / legacy IDs → Groq chat models (admin still may have gpt-4o assigned)
_GROQ_MODEL_MAP = {
    "gpt-4o": "llama-3.3-70b-versatile",
    "gpt-4o-mini": "llama-3.1-8b-instant",
    "chatgpt-4o-latest": "llama-3.3-70b-versatile",
    "gpt-4.1": "llama-3.3-70b-versatile",
    "gpt-4.1-mini": "llama-3.3-70b-versatile",
    "gpt-4.1-nano": "llama-3.1-8b-instant",
    "gpt-4-turbo": "llama-3.3-70b-versatile",
    "gpt-4": "llama-3.3-70b-versatile",
    "gpt-5": "llama-3.3-70b-versatile",
    "gpt-5-mini": "llama-3.3-70b-versatile",
    "gpt-5-nano": "llama-3.1-8b-instant",
    "gpt-5.4-mini": "llama-3.3-70b-versatile",
    "gpt-5.4-nano": "llama-3.1-8b-instant",
    "o4-mini": "llama-3.3-70b-versatile",
    "o3-mini": "llama-3.3-70b-versatile",
    "o3": "llama-3.3-70b-versatile",
}

# Groq Llama IDs → OpenAI when provider=openai (stale env / admin leftovers)
_OPENAI_FROM_GROQ_MAP = {
    "llama-3.3-70b-versatile": "gpt-4o-mini",
    "llama-3.1-8b-instant": "gpt-4o-mini",
    "llama-3.1-70b-versatile": "gpt-4o-mini",
    "llama-3.3-70b-specdec": "gpt-4o-mini",
    "mixtral-8x7b-32768": "gpt-4o-mini",
    "gemma2-9b-it": "gpt-4o-mini",
}


def remap_model_for_provider(model: str | None) -> str | None:
    """
    Map model IDs to provider-native IDs.

    Critical for Groq: requesting gpt-4o fails, then the answer path used to
    wait ~6s per failed model → ~10–12s typed-answer latency.
    Critical for OpenAI: leftover llama-* IDs from Groq sessions must remap.
    """
    if not model or not str(model).strip():
        return model
    m = str(model).strip()
    provider = get_llm_provider()
    low = m.lower()
    if provider == "groq":
        if low in _GROQ_MODEL_MAP:
            return _GROQ_MODEL_MAP[low]
        # Already a Groq/Llama/Mixtral/Gemma id
        if any(
            x in low
            for x in (
                "llama",
                "mixtral",
                "gemma",
                "gpt-oss",
                "deepseek",
                "qwen",
            )
        ):
            return m
        # Unknown OpenAI-ish id → safe Groq default
        if low.startswith("gpt-") or low.startswith("o1") or low.startswith("o3") or low.startswith("o4"):
            return "llama-3.3-70b-versatile"
    elif provider == "openai":
        if low in _OPENAI_FROM_GROQ_MAP:
            return _OPENAI_FROM_GROQ_MAP[low]
        if any(x in low for x in ("llama", "mixtral", "gemma", "gpt-oss")):
            return "gpt-4o-mini"
        # Prefer widely available OpenAI chat models
        if low in ("gpt-4.1-nano", "gpt-4.1-mini"):
            # Keep if account has them; callers may still fall back
            return m
    return m


def groq_allowed_models() -> set[str]:
    return {
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "llama-3.1-70b-versatile",
        "llama-3.3-70b-specdec",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
    }


def get_openai_api_key() -> str | None:
    """
    Resolve chat LLM API key (OpenAI, Groq, or other OpenAI-compatible).

    Order:
      1) GROQ_API_KEY process env (preferred when using Groq)
      2) OPENAI_API_KEY process env (skipped when provider=groq and key is not gsk_)
      3) user config / project .env OPENAI_API_KEY — skipped when ASTRA_LLM_PROVIDER=groq
         so a leftover OpenAI key in .env does not override an intentional Groq session.
    Never writes secrets to disk.
    """
    _ensure_project_env_loaded()

    # 1) Explicit Groq process env
    groq = (os.environ.get("GROQ_API_KEY") or "").strip()
    if is_usable_openai_api_key(groq):
        return groq

    provider = get_llm_provider()

    # 2) Process OPENAI_API_KEY (may be a gsk_ when swapped)
    env_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if is_usable_openai_api_key(env_key):
        # Do not send an OpenAI sk- key to Groq when provider is forced to groq
        if provider == "groq" and not env_key.lower().startswith("gsk_"):
            pass
        else:
            return env_key
    if env_key and not is_usable_openai_api_key(env_key):
        os.environ.pop("OPENAI_API_KEY", None)

    # When forcing Groq, do not fall back to OpenAI keys from .env
    if provider == "groq":
        return None

    data = _read_env_file()
    file_key = (data.get("OPENAI_API_KEY") or "").strip().strip('"').strip("'")
    if is_usable_openai_api_key(file_key):
        os.environ["OPENAI_API_KEY"] = file_key
        return file_key

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
                    if is_usable_openai_api_key(val):
                        os.environ["OPENAI_API_KEY"] = val
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

# ---------------------------------------------------------------------------
# STT: Deepgram Nova-3 (streaming, preferred) + Whisper local fallback
# ---------------------------------------------------------------------------
# ASTRA_STT_PROVIDER: auto | deepgram | whisper
#   auto = Deepgram when DEEPGRAM_API_KEY is set, else Whisper
DEEPGRAM_MODEL = (
    os.environ.get("ASTRA_DEEPGRAM_MODEL") or os.environ.get("DEEPGRAM_MODEL") or "nova-3"
).strip() or "nova-3"
# Endpointing silence (ms) for Deepgram stream — market sweet spot ~200–400
DEEPGRAM_ENDPOINTING_MS = max(
    10, int(os.environ.get("ASTRA_DEEPGRAM_ENDPOINTING", "300") or "300")
)
DEEPGRAM_UTTERANCE_END_MS = max(
    100, int(os.environ.get("ASTRA_DEEPGRAM_UTTERANCE_END", "1000") or "1000")
)


def get_deepgram_api_key() -> str | None:
    """Deepgram API key from env / .env (never log the value)."""
    _ensure_project_env_loaded()
    for name in ("DEEPGRAM_API_KEY", "ASTRA_DEEPGRAM_KEY", "DEEPGRAM_KEY"):
        raw = (os.environ.get(name) or "").strip().strip('"').strip("'")
        if raw and len(raw) >= 16 and "your" not in raw.lower():
            return raw
    # User config dir .env (%APPDATA%/astra/.env)
    try:
        data = _read_env_file()
        for name in ("DEEPGRAM_API_KEY", "ASTRA_DEEPGRAM_KEY", "DEEPGRAM_KEY"):
            raw = (data.get(name) or "").strip().strip('"').strip("'")
            if raw and len(raw) >= 16 and "your" not in raw.lower():
                os.environ.setdefault(name, raw)
                return raw
    except Exception:
        pass
    return None


def get_stt_provider() -> str:
    """
    Return: deepgram | whisper
    auto (default) → deepgram when key present else whisper.
    """
    _ensure_project_env_loaded()
    raw = (os.environ.get("ASTRA_STT_PROVIDER") or "auto").strip().lower()
    if raw in ("deepgram", "dg", "nova", "nova-3"):
        return "deepgram" if get_deepgram_api_key() else "whisper"
    if raw in ("whisper", "local", "faster-whisper"):
        return "whisper"
    # auto
    return "deepgram" if get_deepgram_api_key() else "whisper"


# Whisper Configuration
# tiny.en is fast but mangles jargon (S/4HANA, Vertex, FICO) and weak on long Qs.
# base.en is the production default for interview accuracy on CPU; override via env.
WHISPER_MODEL = (
    os.environ.get("ASTRA_WHISPER_MODEL")
    or os.environ.get("WHISPER_MODEL")
    or "base.en"
).strip() or "base.en"
WHISPER_DEVICE = (
    os.environ.get("ASTRA_WHISPER_DEVICE")
    or os.environ.get("WHISPER_DEVICE")
    or "cpu"
).strip() or "cpu"
WHISPER_COMPUTE_TYPE = (
    os.environ.get("ASTRA_WHISPER_COMPUTE")
    or os.environ.get("WHISPER_COMPUTE_TYPE")
    or "int8"
).strip() or "int8"
# Decode quality: 1 = fastest/greedy, 3–5 = more accurate (small latency cost)
WHISPER_BEAM_SIZE = max(1, int(os.environ.get("ASTRA_WHISPER_BEAM", "2") or "2"))

# RAG Configuration
EMBEDDING_MODEL = "text-embedding-3-small"
# Prefer 4.1 family over 4o: better instruction-following at equal/lower latency
LLM_MODEL = "gpt-4.1-mini"
CLASSIFICATION_MODEL = "gpt-4.1-mini"  # Fast model for question classification
COLLECTION_NAME = "astra_docs"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
CONTEXT_RELEVANCE_THRESHOLD = 0.3  # Below this, consider context not relevant
MIN_CONTEXT_RELEVANCE = 0.2  # Filter out chunks below this threshold

# Auto-Answer Mode Configuration
# End-of-utterance must wait through natural pauses mid-question
# (browser mic + noise suppression creates brief dips between words)
# Peak-boosted meter — Stereo Mix / quiet mics need a low floor
SILENCE_THRESHOLD = 0.0015      # Floor absolute silence (legacy / fallback)
# End-of-question hangover.
# Short questions can cut fast; long multi-clause questions need more hangover
# so mid-sentence pauses don't truncate (was the main "long Q wrong answer" bug).
# End-of-speech hangover (env-overridable). Market voice stacks use ~200–300ms
# endpointing; interview questions need more hangover to avoid multi-clause cuts.
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


SILENCE_DURATION = _env_float("ASTRA_SILENCE_DURATION", 0.95)
MIN_SPEECH_DURATION = _env_float("ASTRA_MIN_SPEECH_DURATION", 0.55)
# If speech never "ends" (noisy room / continuous audio), force process after this
MAX_UTTERANCE_SECONDS = 50.0
# Adaptive VAD: speech if level > noise_floor * factor + offset
# Slightly more sensitive so quiet Stereo Mix / laptop mics still "hear"
VAD_NOISE_FACTOR = 1.95
VAD_NOISE_OFFSET = 0.0055
VAD_SILENCE_FACTOR = 1.08       # Stay "in speech" through quieter mid-sentence dips
# Browser mic (getUserMedia) — AGC dips need a touch more hangover than system
BROWSER_SILENCE_DURATION = _env_float("ASTRA_BROWSER_SILENCE", 1.05)
BROWSER_MIN_SPEECH_DURATION = _env_float("ASTRA_BROWSER_MIN_SPEECH", 0.55)
# Only for SHORT utterances (see live_session) — never on long multi-clause Qs
# Tighter default (0.55) for faster first-token vs market streaming STT stacks
BROWSER_FAST_SILENCE_DURATION = _env_float("ASTRA_BROWSER_FAST_SILENCE", 0.55)
# Long questions: extra hangover after already speaking a while
BROWSER_LONG_SILENCE_DURATION = _env_float("ASTRA_BROWSER_LONG_SILENCE", 1.45)
CLASSIFICATION_CONFIDENCE = 0.55  # slightly looser for live auto path
MIN_WORDS_FOR_CLASSIFICATION = 4  # Skip LLM if fewer words than this
# Must fit full multi-clause interview questions (20–40s spoken is common)
AUTO_TRANSCRIBE_MAX_SECONDS = 40
MANUAL_TRANSCRIBE_MAX_SECONDS = 40


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
