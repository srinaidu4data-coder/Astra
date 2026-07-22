# Astra Interview Copilot

Real-time AI-powered interview assistant that listens to interview questions and generates contextual answers using your documents and experience.

## Features

- **Real-time Audio Capture**: Captures system audio (what you hear) to detect interview questions
- **Auto-Answer Mode**: Automatically detects questions and generates answers without manual intervention
- **Dual-Pane Answers**:
  - **Key Points**: 2-3 bullet points for quick reference
  - **Script**: Natural, speakable response you can read aloud
- **RAG-Powered**: Uses your uploaded documents (resume, job descriptions, notes) to personalize answers
- **Fallback to General Knowledge**: Works even without documents - uses LLM's knowledge
- **Customizable**:
  - Job context input for role-specific answers
  - Tone selection (Professional, Casual, Confident)
  - All prompts configurable via YAML file
- **Focus Mode**: Clean view showing only answers during interviews
- **Cross-Platform**: Works on Windows and Linux

## Screenshots

The app shows:
- Question detected at top
- Key Points (bullet format) on left
- Conversational Script on right
- Controls for audio source, auto-answer, job context, and tone

## Installation

### Prerequisites

- Python 3.10-3.12 (3.13+ not yet supported due to onnxruntime)
- OpenAI API key

### Linux

```bash
# Clone the repository
git clone git@github.com:alucard1311/astra-v1.git
cd astra-v1

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the app
python main.py
```

### Windows

```batch
# Clone the repository
git clone git@github.com:alucard1311/astra-v1.git
cd astra-v1

# Run the automated setup (installs Python, Rust if needed)
setup_windows.bat

# Run the app
run.bat
```

## First Run Setup

1. **API Key**: On first launch, you'll be prompted to set up your OpenAI API key
   - Linux: `~/.config/astra/.env`
   - Windows: `%APPDATA%\astra\.env`

   Create the file with:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```

2. **Ingest Documents** (Optional): Click "Ingest Documents" to scan the `documents/` folder
   - Supports: PDF, TXT, MD files
   - Place your resume, job descriptions, or notes there

3. **Start Session**: Click to open the main interview copilot window

## Usage

### Basic Flow

1. **Select Audio Source**: Choose your system audio monitor device
2. **Click "Start Listening"**: Begin capturing audio
3. **Enable Auto-Answer Mode**: Automatically detect and answer questions
4. **Adjust Settings**:
   - **Job Context**: Enter the role (e.g., "Senior SAP MM Consultant")
   - **Tone**: Select Professional, Casual, or Confident
   - **Confidence**: Adjust threshold for auto-detection

### Focus Mode

Click **"Focus"** button to hide all controls and show only the answer panes - perfect during live interviews.

### Manual Mode

With Auto-Answer disabled:
1. Let the interviewer ask a question
2. Click **"Get Answer"** to transcribe and generate response

## Configuration

### Prompts Configuration

All LLM prompts are customizable via YAML:

- **Linux**: `~/.config/astra/prompts.yaml`
- **Windows**: `%APPDATA%\astra\prompts.yaml`

```yaml
job_context: "Senior SAP MM Consultant"
default_tone: professional

tones:
  professional: "Use formal but warm language..."
  casual: "Use relaxed, friendly language..."
  confident: "Use assertive, direct language..."

prompts:
  classification: |
    [Question classification prompt]
  bullet_system: |
    [Bullet point generation prompt]
  script_system: |
    [Conversational script prompt with {tone_instruction} placeholder]
```

After editing, click **"Reload"** in the app to apply changes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Astra Interview Copilot                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Audio     │───▶│  Whisper    │───▶│  Question   │     │
│  │  Capture    │    │ Transcribe  │    │ Classifier  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                              │              │
│                                              ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  ChromaDB   │◀──▶│    RAG      │───▶│   OpenAI    │     │
│  │  (Vectors)  │    │   Search    │    │   GPT-4o    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                              │              │
│                                              ▼              │
│                     ┌───────────────────────────────┐      │
│                     │        PyQt6 GUI              │      │
│                     │  ┌─────────┐  ┌─────────┐    │      │
│                     │  │ Bullets │  │ Script  │    │      │
│                     │  └─────────┘  └─────────┘    │      │
│                     └───────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Audio Capture | PyAudio / PyAudioWPatch | System audio loopback |
| Transcription | faster-whisper (tiny.en) | Speech-to-text |
| Classification | GPT-4o-mini | Detect interview questions |
| RAG Search | ChromaDB + OpenAI Embeddings | Find relevant context |
| Answer Generation | GPT-4o / GPT-4o-mini | Generate responses |
| GUI | PyQt6 | Desktop application |
| Config | platformdirs + PyYAML | Cross-platform settings |

## File Structure

```
astra-v1/
├── main.py              # Entry point
├── gui.py               # PyQt6 GUI application
├── rag.py               # RAG search and answer generation
├── ingest.py            # Document ingestion
├── transcriber.py       # Whisper transcription
├── audio_capture.py     # Audio capture abstraction
├── config.py            # Configuration management
├── requirements.txt     # Python dependencies
├── setup_windows.bat    # Windows setup script
├── run.bat              # Windows run script
├── documents/           # Place documents here for ingestion
└── chroma_db/           # Vector database (created after ingestion)
```

## Troubleshooting

### No audio detected
- Ensure you selected the correct monitor device (usually ends with `.monitor`)
- Check that audio is playing on your system
- Try the "Test" button to verify audio capture

### Answers not relevant
- Ingest documents with your experience/resume
- Add job context in the settings
- Customize prompts in `prompts.yaml`

### Windows: PyAudio installation fails
- Run `setup_windows.bat` which handles dependencies
- Ensure Rust is installed (required for tokenizers)

### API key not found
- Create the config file at the correct location:
  - Linux: `~/.config/astra/.env`
  - Windows: `%APPDATA%\astra\.env`

## Performance

- **Target Latency**: < 3 seconds from question to answer
- **Parallel Generation**: Both bullet and script formats generated simultaneously
- **Optimized Whisper**: Uses tiny.en model with VAD filtering

## License

MIT License

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## Acknowledgments

- [faster-whisper](https://github.com/guillaumekln/faster-whisper) - Fast Whisper implementation
- [ChromaDB](https://www.trychroma.com/) - Vector database
- [OpenAI](https://openai.com/) - GPT models and embeddings
- [PyQt6](https://www.riverbankcomputing.com/software/pyqt/) - GUI framework
