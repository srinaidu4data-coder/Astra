# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for Astra Interview Copilot
# Build with: pyinstaller astra.spec
# Mode: --onedir (output bundled into installer by Inno Setup)

import sys

block_cipher = None

# Collect data files for bundled packages
from PyInstaller.utils.hooks import collect_data_files

datas = []

# Collect faster-whisper assets (ONNX models, etc.)
datas += collect_data_files('faster_whisper')

# Collect chromadb data files (ONNX models, migration files)
datas += collect_data_files('chromadb')

# Hidden imports for PyQt6 and all v3.0 dependencies
hiddenimports = [
    # GUI framework
    'PyQt6.QtCore',
    'PyQt6.QtGui',
    'PyQt6.QtWidgets',
    # Vector database
    'chromadb',
    # LLM client
    'openai',
    # Numerical
    'numpy',
    # PDF parsing
    'pdfplumber',
    # Config directory resolution
    'platformdirs',
    # License activation HTTP calls
    'requests',
    # Prompts config (pyyaml import name)
    'yaml',
    # Hybrid search (sparse retrieval)
    'rank_bm25',
    # Local audio capture module (dynamically imported)
    'audio_capture',
    # Environment variable loading
    'dotenv',
    # Crypto (explicit inclusion for some builds)
    'hashlib',
    'hmac',
]

# Add Windows audio imports
if sys.platform == 'win32':
    hiddenimports.append('pyaudiowpatch')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# EXE launcher (binaries collected separately into dist/Astra/)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Astra',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX disabled — triggers more AV false positives than it saves
    console=False,  # No console window for GUI app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # Add icon path if available: icon='assets/astra.ico'
)

# COLLECT gathers all files into dist/Astra/ — Inno Setup packages this into the installer
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Astra',
)
