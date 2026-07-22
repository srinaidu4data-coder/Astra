# Plan 06-01 Summary: Answer Format Prompts and Generation

## Outcome: SUCCESS

## What Was Built

### rag.py - New Answer Formats
1. **BULLET_SYSTEM_PROMPT** - Prompt for generating 2-3 concise key points
   - Quick-reference format (not speakable)
   - Focus on technical essentials: t-codes, config paths, key terms
   - Uses gpt-4o-mini for speed

2. **SCRIPT_SYSTEM_PROMPT** - Prompt for humanized conversational script
   - Natural flowing speech, readable aloud verbatim
   - Includes `{tone_instruction}` placeholder for dynamic tone injection
   - 150-250 words target length
   - Uses gpt-4o for quality

3. **TONE_INSTRUCTIONS** - Three configurable tones:
   - `professional` - Formal but warm, composed and authoritative
   - `casual` - Relaxed and friendly, conversational
   - `confident` - Assertive and direct, self-assured

4. **New Functions**:
   - `generate_bullet_response()` - Streaming bullet point generation
   - `ask_bullet()` - Entry point for bullet format
   - `generate_script_response()` - Streaming script generation with tone
   - `ask_script()` - Entry point for script format with tone parameter

### gui.py - UI Integration
1. **Updated imports** - Added `ask_bullet` from rag
2. **Auto-answer mode** (`_auto_process_audio`) - Now uses:
   - `question_update` signal to display question at top
   - `ask_bullet()` + `bullet_token` for bullet pane
3. **Manual mode** (`_process_audio`) - Same updates
4. **Clear behavior** (`_on_answer_clear`) - Now clears both `bullet_box` and `script_box`

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| gpt-4o-mini for bullets | Speed over quality for simple bullet points |
| gpt-4o for script | Quality required for natural speech generation |
| Temperature 0.3 for bullets | More focused, less variation |
| Temperature 0.7 for script | Creative for natural conversational flow |
| Tone placeholder in prompt | Allows dynamic injection without multiple prompts |

## Verification

- [x] `ask_bullet`, `ask_script` functions exist in rag.py
- [x] `BULLET_SYSTEM_PROMPT`, `SCRIPT_SYSTEM_PROMPT`, `TONE_INSTRUCTIONS` exist
- [x] TONE_INSTRUCTIONS has professional, casual, confident keys
- [x] gui.py imports `ask_bullet` from rag
- [x] Question display updated via `question_update` signal
- [x] Bullet tokens streamed via `bullet_token` signal

## What's Next

Phase 7 will add parallel execution:
- Both `ask_bullet()` and `ask_script()` called simultaneously
- Threading/asyncio for concurrent LLM calls
- Each pane updates independently

## Files Changed

- `rag.py` - Added prompts, tone config, and generation functions
- `gui.py` - Wired bullet format to UI, updated question display

## Duration

~5 minutes
