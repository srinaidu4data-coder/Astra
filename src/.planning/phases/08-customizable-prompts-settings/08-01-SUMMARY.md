# Plan 08-01 Summary: YAML Config and GUI Controls

## Outcome: SUCCESS

## What Was Built

### requirements.txt
- Added `pyyaml>=6.0.0` dependency

### config.py - YAML Config Functions
1. **Import**: Added `import yaml`
2. **`get_prompts_config_path()`**: Returns path to `~/.config/astra/prompts.yaml`
3. **`get_default_prompts_config()`**: Returns default config dict with all prompts, tones, job_context
4. **`load_prompts_config()`**: Loads YAML, creates default if missing, merges with defaults, handles errors gracefully
5. **`save_prompts_config(config)`**: Saves config to YAML file

### rag.py - Config Integration
1. **Renamed prompts**: `CLASSIFICATION_PROMPT` → `DEFAULT_CLASSIFICATION_PROMPT`, etc.
2. **Config cache**: Added `_prompts_config` module-level cache
3. **Helper functions**:
   - `_get_config()` - Get cached config, load if needed
   - `reload_prompts_config()` - Force reload from YAML
   - `get_prompt(name)` - Get prompt by name with fallback
   - `get_tone_instruction(tone)` - Get tone text from config
   - `get_default_job_context()` - Get default job context
   - `get_default_tone()` - Get default tone name
   - `get_available_tones()` - List all tone names
4. **Updated functions**: `classify_utterance()`, `generate_bullet_response()`, `generate_script_response()` now use config-based prompts

### gui.py - Settings UI
1. **New imports**: `QLineEdit`, config helper functions from rag
2. **Settings frame** (after auto-answer section):
   - Job Context: QLineEdit with placeholder "e.g., Senior SAP MM Consultant"
   - Tone: QComboBox populated from `get_available_tones()`
   - Reload Config: Button to refresh prompts.yaml
3. **New methods**:
   - `_populate_tones()` - Fill tone dropdown from config
   - `_on_reload_config()` - Reload config and refresh UI
4. **Updated `_generate_parallel()`**: Reads job_context and tone from UI inputs

## Default prompts.yaml Structure

```yaml
job_context: ''
default_tone: professional
tones:
  professional: Use formal but warm language...
  casual: Use relaxed, friendly language...
  confident: Use assertive, direct language...
prompts:
  classification: |
    [full classification prompt]
  bullet_system: |
    [full bullet prompt]
  script_system: |
    [full script prompt with {tone_instruction} placeholder]
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| YAML over JSON | Multi-line prompts more readable in YAML |
| Fallback to defaults | Invalid YAML doesn't break app |
| Config cache in rag.py | Avoid repeated file reads during generation |
| Reload button vs auto-reload | User control over when changes take effect |

## Verification

- [x] `pyyaml>=6.0.0` in requirements.txt
- [x] First run creates `~/.config/astra/prompts.yaml` with defaults
- [x] App imports work correctly
- [x] `get_available_tones()` returns ['professional', 'casual', 'confident']
- [x] Job context input visible in main window
- [x] Tone dropdown populated from config
- [x] Reload Config button present

## Files Changed

- `requirements.txt` - Added pyyaml
- `config.py` - Added YAML loading/saving functions
- `rag.py` - Added config helpers, refactored to use config
- `gui.py` - Added settings frame with job context, tone, reload button

## Duration

~5 minutes
