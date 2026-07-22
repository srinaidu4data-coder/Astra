#!/usr/bin/env python3
"""
Astra Interview Copilot - PyQt6 GUI
Captures system audio and provides AI-powered interview answers.
"""

import sys
import threading
import argparse
from queue import Queue
from concurrent.futures import ThreadPoolExecutor
from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTextEdit,
    QLineEdit,
    QComboBox,
    QProgressBar,
    QCheckBox,
    QSlider,
    QFrame,
    QMessageBox,
    QSplitter,
    QSizePolicy,
)
from PyQt6.QtCore import Qt, pyqtSignal, QObject, QTimer, QUrl
from PyQt6.QtGui import QFont, QTextCursor, QDesktopServices

from transcriber import transcribe_audio
from audio_capture import get_audio_capture
from rag import (
    ask_bullet, ask_script, classify_utterance, search_context,
    get_available_tones, get_default_job_context, get_default_tone, reload_prompts_config,
)
import requests

from config import (
    LICENSE_ENABLED,
    SILENCE_THRESHOLD,
    SILENCE_DURATION,
    MIN_SPEECH_DURATION,
    MAX_UTTERANCE_SECONDS,
    VAD_NOISE_FACTOR,
    VAD_NOISE_OFFSET,
    VAD_SILENCE_FACTOR,
    CLASSIFICATION_CONFIDENCE,
    MIN_WORDS_FOR_CLASSIFICATION,
    AUDIO_SAMPLE_RATE,
    AUTO_TRANSCRIBE_MAX_SECONDS,
    MANUAL_TRANSCRIBE_MAX_SECONDS,
    get_license_key,
    get_proxy_url,
    save_license_key,
    clear_license_key,
    get_hardware_id,
    get_config_dir,
)
from pipeline_utils import (
    friendly_error as _friendly_error,
    speech_window_seconds,
    is_near_duplicate,
    question_fingerprint,
)
from stealth import set_exclude_from_capture, is_stealth_supported


class ListeningState:
    """Enum-like class for listening states."""
    IDLE = "idle"
    LISTENING = "listening"        # Silence, waiting for speech
    HEARING = "hearing"            # Speech detected
    PROCESSING = "processing"      # Transcribing/classifying
    GENERATING = "generating"      # RAG answer in progress


class SignalBridge(QObject):
    """Bridge for thread-safe UI updates."""
    transcription_ready = pyqtSignal(str)
    answer_token = pyqtSignal(str)            # Legacy single-stream (routes to script pane)
    answer_done = pyqtSignal()
    answer_clear = pyqtSignal()  # Clear answer box from background thread
    status_update = pyqtSignal(str)
    error_occurred = pyqtSignal(str)
    audio_level = pyqtSignal(float)
    # Auto-answer mode
    state_changed = pyqtSignal(str)           # ListeningState value
    last_heard_update = pyqtSignal(str, str)  # text, status ("ignored"/"answering"/"")
    queue_update = pyqtSignal(int)            # Number of queued questions
    # Must be emitted to main thread — QTimer.singleShot from workers does NOT fire reliably
    queue_item_ready = pyqtSignal(object)     # dict job for follow-up processing
    # Dual-pane answer signals
    bullet_token = pyqtSignal(str)            # Streaming token for bullet points
    script_token = pyqtSignal(str)            # Streaming token for script
    question_update = pyqtSignal(str)         # Update question display


class IngestionSignals(QObject):
    """Signals for document ingestion progress."""
    progress = pyqtSignal(dict)  # Progress info dict
    complete = pyqtSignal(dict)  # Result summary dict


class FitTextEdit(QTextEdit):
    """QTextEdit that shrinks font to fit content without scrolling."""

    def __init__(self, initial_font_size=16, min_font_size=10):
        super().__init__()
        self.setReadOnly(True)
        self.initial_font_size = initial_font_size
        self.min_font_size = min_font_size

        # Show scrollbars only when content still exceeds after shrinking
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)

        font = QFont("Sans", initial_font_size)
        self.setFont(font)

    def reset_font(self):
        """Reset to initial font size before new content."""
        font = self.font()
        font.setPointSize(self.initial_font_size)
        self.setFont(font)

    def finalize_content(self):
        """Call after streaming completes to shrink font if needed."""
        text = self.toPlainText()
        if not text:
            return

        doc = self.document()
        doc.adjustSize()
        viewport_height = self.viewport().height()

        # Only shrink if content exceeds viewport
        if doc.size().height() <= viewport_height:
            return

        font = self.font()
        size = self.initial_font_size

        while size > self.min_font_size:
            font.setPointSize(size)
            self.setFont(font)
            doc.adjustSize()

            if doc.size().height() <= viewport_height:
                break

            size -= 1


class StartupScreen(QWidget):
    """Final Round–style home: dark stealth panel + Home Depot orange CTAs."""

    # Signals emitted when buttons are clicked
    ingest_requested = pyqtSignal()
    start_session_requested = pyqtSignal()

    def __init__(self):
        super().__init__()
        self._init_ui()

    def _init_ui(self):
        import theme as T

        self.setWindowTitle("Astra — Interview Copilot")
        self.setMinimumSize(480, 620)
        self.resize(520, 680)
        self.setStyleSheet(T.app_stylesheet())

        layout = QVBoxLayout(self)
        layout.setSpacing(0)
        layout.setContentsMargins(0, 0, 0, 0)

        # Hero band
        hero = QFrame()
        hero.setStyleSheet(f"background-color: {T.BG_PANEL}; border-bottom: 1px solid {T.BORDER};")
        hero_l = QVBoxLayout(hero)
        hero_l.setContentsMargins(36, 40, 36, 28)
        hero_l.setSpacing(10)

        brand_row = QHBoxLayout()
        logo = QLabel("A")
        logo.setFixedSize(40, 40)
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo.setStyleSheet(
            f"background: {T.HD_ORANGE}; color: white; border-radius: 10px; "
            f"font-size: 20px; font-weight: 800;"
        )
        brand_row.addWidget(logo)
        brand_name = QLabel("  Astra")
        brand_name.setFont(QFont(T.FONT, 18, QFont.Weight.Bold))
        brand_name.setStyleSheet(f"color: {T.TEXT};")
        brand_row.addWidget(brand_name)
        brand_row.addStretch()
        pill = QLabel("  Interview Copilot  ")
        pill.setStyleSheet(
            f"background: {T.HD_ORANGE_SOFT}; color: {T.HD_ORANGE}; "
            f"border: 1px solid {T.HD_ORANGE}; border-radius: 12px; "
            f"padding: 4px 10px; font-size: 11px; font-weight: 600;"
        )
        brand_row.addWidget(pill)
        hero_l.addLayout(brand_row)

        title = QLabel("Crack every interview\nwith real-time AI")
        title.setFont(QFont(T.FONT, 26, QFont.Weight.Bold))
        title.setStyleSheet(f"color: {T.TEXT}; margin-top: 16px;")
        hero_l.addWidget(title)

        sub = QLabel(
            "Instant, structured answers while you talk — "
            "stealth desktop overlay styled like Final Round AI, "
            "in Home Depot orange."
        )
        sub.setWordWrap(True)
        sub.setFont(QFont(T.FONT, 12))
        sub.setStyleSheet(f"color: {T.TEXT_MUTED}; margin-top: 4px;")
        hero_l.addWidget(sub)
        layout.addWidget(hero)

        body = QWidget()
        body_l = QVBoxLayout(body)
        body_l.setContentsMargins(36, 28, 36, 32)
        body_l.setSpacing(14)

        # Feature cards row
        features = QFrame()
        features.setStyleSheet(T.card_ss())
        fl = QVBoxLayout(features)
        fl.setContentsMargins(18, 16, 18, 16)
        fl.setSpacing(10)
        for icon, head, desc in (
            ("⚡", "Live auto answers", "No button mashing — answers stream when they finish asking."),
            ("★", "Best Answer card", "One premium response surface, short and speakable."),
            ("👁", "Stealth mode", "Hidden from screen share. Stay-on-top overlay during the call."),
        ):
            row = QHBoxLayout()
            ic = QLabel(icon)
            ic.setFont(QFont(T.FONT, 16))
            ic.setFixedWidth(28)
            row.addWidget(ic)
            col = QVBoxLayout()
            h = QLabel(head)
            h.setFont(QFont(T.FONT, 12, QFont.Weight.Bold))
            h.setStyleSheet(f"color: {T.TEXT};")
            d = QLabel(desc)
            d.setWordWrap(True)
            d.setFont(QFont(T.FONT, 11))
            d.setStyleSheet(f"color: {T.TEXT_MUTED};")
            col.addWidget(h)
            col.addWidget(d)
            row.addLayout(col, 1)
            fl.addLayout(row)
        body_l.addWidget(features)

        body_l.addStretch()

        # Primary CTA — Home Depot orange
        self.start_btn = QPushButton("Launch Live Session")
        self.start_btn.setFont(QFont(T.FONT, 14, QFont.Weight.Bold))
        self.start_btn.setMinimumHeight(56)
        self.start_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.start_btn.setStyleSheet(T.primary_button_ss())
        self.start_btn.clicked.connect(self._on_start_session_clicked)
        body_l.addWidget(self.start_btn)

        self.ingest_btn = QPushButton("Upload resume / notes")
        self.ingest_btn.setFont(QFont(T.FONT, 12, QFont.Weight.DemiBold))
        self.ingest_btn.setMinimumHeight(48)
        self.ingest_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.ingest_btn.setStyleSheet(T.secondary_button_ss())
        self.ingest_btn.clicked.connect(self._on_ingest_clicked)
        body_l.addWidget(self.ingest_btn)

        tip = QLabel("Tip: resume is optional — you can start a session without it.")
        tip.setAlignment(Qt.AlignmentFlag.AlignCenter)
        tip.setFont(QFont(T.FONT, 10))
        tip.setStyleSheet(f"color: {T.TEXT_DIM};")
        body_l.addWidget(tip)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setVisible(False)
        body_l.addWidget(self.progress_bar)

        self.status_label = QLabel("")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setFont(QFont(T.FONT, 11))
        self.status_label.setStyleSheet(f"color: {T.TEXT_MUTED};")
        self.status_label.setWordWrap(True)
        body_l.addWidget(self.status_label)

        layout.addWidget(body, 1)

    def _on_ingest_clicked(self):
        """Handle Ingest Documents button click."""
        self.ingest_requested.emit()

    def _on_start_session_clicked(self):
        """Handle Start Session button click."""
        self.start_session_requested.emit()

    def set_status(self, message: str, is_error: bool = False):
        """Update the status label."""
        import theme as T
        if is_error:
            self.status_label.setStyleSheet(f"color: {T.DANGER};")
        else:
            self.status_label.setStyleSheet(f"color: {T.TEXT_MUTED};")
        self.status_label.setText(message)

    def set_buttons_enabled(self, enabled: bool):
        """Enable or disable buttons during operations."""
        self.ingest_btn.setEnabled(enabled)
        self.start_btn.setEnabled(enabled)

    def show_progress_bar(self, show: bool):
        """Toggle progress bar visibility."""
        self.progress_bar.setVisible(show)

    def set_progress(self, current: int, total: int):
        """Update progress bar value."""
        if total > 0:
            self.progress_bar.setRange(0, total)
            self.progress_bar.setValue(current)
        else:
            self.progress_bar.setRange(0, 100)
            self.progress_bar.setValue(0)


class LicenseActivationScreen(QWidget):
    """Styled license activation screen with color-coded feedback."""

    activated = pyqtSignal()
    skipped = pyqtSignal()

    def __init__(self):
        super().__init__()
        self._init_ui()

    def _init_ui(self):
        """Set up the activation screen UI."""
        self.setWindowTitle("Astra - License Activation")
        self.setMinimumSize(400, 450)
        self.resize(400, 450)
        self.setStyleSheet("background-color: #ffffff;")

        layout = QVBoxLayout(self)
        layout.setSpacing(15)
        layout.setContentsMargins(40, 40, 40, 40)

        # Title
        title = QLabel("Astra Interview Copilot")
        title.setFont(QFont("Sans", 18, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("color: #222222;")
        layout.addWidget(title)

        # Subtitle
        subtitle = QLabel("License Activation")
        subtitle.setFont(QFont("Sans", 12))
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #666666;")
        layout.addWidget(subtitle)

        layout.addStretch()

        # License key input
        self.key_input = QLineEdit()
        self.key_input.setPlaceholderText("Enter your license key")
        self.key_input.setFont(QFont("Sans", 14))
        self.key_input.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.key_input.setMinimumHeight(45)
        self.key_input.setStyleSheet("""
            QLineEdit {
                border: 2px solid #ddd;
                border-radius: 8px;
                padding: 8px 12px;
                background-color: #ffffff;
                color: #222222;
            }
            QLineEdit:focus {
                border-color: #4a90d9;
            }
        """)
        layout.addWidget(self.key_input)

        # Status label (hidden initially)
        self.status_label = QLabel("")
        self.status_label.setFont(QFont("Sans", 12))
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setWordWrap(True)
        self.status_label.setVisible(False)
        layout.addWidget(self.status_label)

        # Activate button
        self.activate_btn = QPushButton("Activate")
        self.activate_btn.setFont(QFont("Sans", 12))
        self.activate_btn.setMinimumHeight(50)
        self.activate_btn.setStyleSheet("""
            QPushButton {
                background-color: #4a90d9;
                color: white;
                border: none;
                border-radius: 8px;
            }
            QPushButton:hover {
                background-color: #3a7bc8;
            }
            QPushButton:disabled {
                background-color: #cccccc;
            }
        """)
        self.activate_btn.clicked.connect(self._on_activate)
        layout.addWidget(self.activate_btn)

        layout.addStretch()

        # Purchase link
        purchase_link = QLabel('<a href="#" style="color: #4a90d9;">Where do I get a license key?</a>')
        purchase_link.setFont(QFont("Sans", 10))
        purchase_link.setAlignment(Qt.AlignmentFlag.AlignCenter)
        purchase_link.linkActivated.connect(
            lambda: QDesktopServices.openUrl(QUrl("https://astra-copilot.com"))
        )
        layout.addWidget(purchase_link)

        # Continue without license link
        skip_link = QLabel('<a href="#" style="color: #999999;">Continue without license</a>')
        skip_link.setFont(QFont("Sans", 9))
        skip_link.setAlignment(Qt.AlignmentFlag.AlignCenter)
        skip_link.linkActivated.connect(self._on_skip)
        layout.addWidget(skip_link)

    def _set_status(self, msg: str, color_type: str):
        """Set status label with color-coded feedback."""
        styles = {
            "success": "background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb;",
            "error": "background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;",
            "warning": "background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba;",
            "info": "background-color: #e2e3e5; color: #383d41; border: 1px solid #d6d8db;",
        }
        style = styles.get(color_type, styles["info"])
        self.status_label.setStyleSheet(f"QLabel {{ {style} border-radius: 6px; padding: 8px 12px; }}")
        self.status_label.setText(msg)
        self.status_label.setVisible(True)

    def _on_activate(self):
        """Handle activate button click."""
        self.activate_btn.setEnabled(False)
        self._set_status("Activating...", "info")

        key = self.key_input.text().strip()
        if not key:
            self._set_status("Please enter a license key", "error")
            self.activate_btn.setEnabled(True)
            return

        proxy_url = get_proxy_url()
        hw_id = get_hardware_id()
        try:
            base = proxy_url.rsplit("/v1", 1)[0]
            resp = requests.post(
                f"{base}/v1/license/activate",
                json={"license_key": key, "hardware_id": hw_id},
                timeout=10,
            )
            if resp.status_code == 200:
                save_license_key(key)
                self._set_status("License activated successfully!", "success")
                QTimer.singleShot(500, self.activated.emit)
            else:
                error = resp.json().get("detail", {}).get("error", {})
                msg = error.get("message", "Activation failed.")
                self._set_status(msg, "error")
                self.activate_btn.setEnabled(True)
        except requests.ConnectionError:
            save_license_key(key)
            self._set_status("Key saved — will validate when online", "warning")
            QTimer.singleShot(1000, self.activated.emit)
        except Exception as e:
            self._set_status(f"Error: {e}", "error")
            self.activate_btn.setEnabled(True)

    def _on_skip(self):
        """Handle continue without license."""
        self.skipped.emit()


class AstraWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.capture = None
        self.signals = SignalBridge()
        self.is_listening = False
        self.level_timer = None

        # Auto-answer mode state (ON by default — one-click path)
        self.auto_answer_enabled = True
        self.current_state = ListeningState.IDLE
        self.speech_start_time = None
        self.silence_start_time = None
        self.last_speech_duration = 0.0
        self.question_queue = Queue()
        self.is_processing = False
        self._process_lock = threading.Lock()
        self._generation_id = 0  # cancel in-flight generations
        self._last_answered_fp = ""
        self._zero_level_ticks = 0
        self._device_rotate_ticks = 0
        self._device_rotations = 0
        self._noise_floor = 0.01  # adaptive baseline for live VAD
        self._level_ema = 0.0
        self.confidence_threshold = CLASSIFICATION_CONFIDENCE

        # Layout mode state
        self.horizontal_layout = False
        self.focus_mode = False
        self.advanced_visible = False
        self.stealth_mode = True  # hide from screen share by default (like Final Round)

        self._init_ui()
        self._connect_signals()
        self._init_capture()
        # Default auto-answer ON — fire handler so styling/state actually apply
        self.auto_checkbox.setChecked(True)
        if not self.auto_answer_enabled:
            self._on_auto_mode_toggled(True)
        # Final Round–style stealth copilot + Home Depot orange
        self._apply_finalround_hd_theme()

    def _apply_finalround_hd_theme(self):
        """
        Match Final Round AI Interview Copilot UX patterns:
        dark stealth panel, question strip, Best Answer card, session controls.
        Recolor with Home Depot orange #F96302.
        """
        import theme as T

        self.setWindowTitle("Astra — Interview Copilot")
        self.setWindowOpacity(0.98)
        self.resize(560, 860)
        self.setMinimumSize(520, 780)
        # Normal window so Minimize / Maximize / Close work.
        # Stay-on-top helps during interviews; NOT Tool (Tool blocks minimize).
        flags = (
            Qt.WindowType.Window
            | Qt.WindowType.WindowMinimizeButtonHint
            | Qt.WindowType.WindowMaximizeButtonHint
            | Qt.WindowType.WindowCloseButtonHint
            | Qt.WindowType.WindowTitleHint
            | Qt.WindowType.WindowSystemMenuHint
            | Qt.WindowType.WindowStaysOnTopHint
        )
        self.setWindowFlags(flags)
        self.setStyleSheet(T.app_stylesheet())
        if self.centralWidget():
            self.centralWidget().setStyleSheet(f"background-color: {T.BG_APP};")

        # Spacious premium layout: hide clutter, vertical Best Answer stack
        self.question_panel.hide()
        try:
            # Vertical dual-pane: Best Answer dominates
            self.answer_splitter.setOrientation(Qt.Orientation.Vertical)
            self.answer_splitter.setSizes([620, 140])
        except Exception:
            pass
        if self.centralWidget() and self.centralWidget().layout():
            self.centralWidget().layout().setContentsMargins(22, 18, 22, 18)
            self.centralWidget().layout().setSpacing(14)

        # Live transcript strip: reparent last_heard out of hidden panel
        if not getattr(self, "_live_strip_ready", False):
            try:
                self.live_strip = QFrame()
                self.live_strip.setStyleSheet(
                    f"QFrame {{ background: {T.BG_STRIP}; border: 1px solid {T.BORDER}; "
                    f"border-radius: 12px; }}"
                )
                strip_l = QVBoxLayout(self.live_strip)
                strip_l.setContentsMargins(12, 8, 12, 8)
                strip_l.setSpacing(4)
                strip_title = QLabel("LIVE · heard from interviewer")
                strip_title.setFont(QFont(T.FONT, 10, QFont.Weight.DemiBold))
                strip_title.setStyleSheet(f"color: {T.TEXT_DIM};")
                strip_l.addWidget(strip_title)
                # Move widgets into strip
                self.last_heard_status.setParent(self.live_strip)
                self.last_heard_box.setParent(self.live_strip)
                self.last_heard_box.setMaximumHeight(52)
                self.last_heard_box.setStyleSheet(T.transcript_strip_ss())
                self.last_heard_box.setPlaceholderText("Waiting for interviewer…")
                strip_l.addWidget(self.last_heard_status)
                strip_l.addWidget(self.last_heard_box)
                # Insert above answer area in content splitter's parent layout
                # Prefer place before content_splitter in central layout
                cl = self.centralWidget().layout()
                # Find content_splitter index
                for i in range(cl.count()):
                    item = cl.itemAt(i)
                    if item and item.widget() is self.content_splitter:
                        cl.insertWidget(i, self.live_strip)
                        break
                else:
                    cl.insertWidget(0, self.live_strip)
                self._live_strip_ready = True
            except Exception as e:
                print(f"[ui] live strip reparent skipped: {e}")

        # Question card
        self.question_display.setText("Questions appear here automatically…")
        self.question_display.setFont(QFont(T.FONT, 14))
        self.question_display.setMinimumHeight(56)
        self.question_display.setStyleSheet(
            f"QLabel {{ color: {T.TEXT_SECONDARY}; background: {T.BG_CARD}; "
            f"border: 1px solid {T.BORDER}; border-radius: 14px; padding: 16px 18px; }}"
        )

        # Best Answer hero
        self.script_box.setPlaceholderText(
            "Best Answer streams here live — no button click needed.\n\n"
            "Start Session, then let the interviewer speak."
        )
        self.script_box.setStyleSheet(T.best_answer_body_ss())
        self.script_box.setMinimumHeight(280)
        self.bullet_box.setPlaceholderText("• Key points appear here")
        self.bullet_box.setMaximumHeight(140)
        self.bullet_box.setStyleSheet(
            f"QTextEdit {{ background: {T.BG_CARD}; color: {T.TEXT_MUTED}; "
            f"border: 1px solid {T.BORDER}; border-radius: 14px; padding: 14px; "
            f"font-size: 12px; }}"
        )

        for child in self.findChildren(QLabel):
            t = child.text()
            if "SAY THIS" in t or "Best Answer" in t or "read out loud" in t.lower():
                child.setText("★  Best Answer  ·  auto")
                child.setFont(QFont(T.FONT, 13, QFont.Weight.Bold))
                child.setStyleSheet(f"color: {T.HD_ORANGE}; background: transparent; padding: 4px 0;")
            elif t.strip() in ("Quick tips", "Key Points", "Key points"):
                child.setText("Key Points")
                child.setStyleSheet(f"color: {T.TEXT_MUTED}; background: transparent;")

        # LIVE auto is the product — hide manual Generate as primary
        self.auto_answer_enabled = True
        self.listen_btn.setText("●  Start Session")
        self.listen_btn.setFont(QFont(T.FONT, 14, QFont.Weight.Bold))
        self.listen_btn.setMinimumHeight(52)
        self.listen_btn.setStyleSheet(T.primary_button_ss())
        self.answer_btn.setText("Regenerate")
        self.answer_btn.setStyleSheet(T.ghost_button_ss())
        self.answer_btn.hide()  # auto path; Settings can re-show later
        self.focus_answer_btn.hide()
        if hasattr(self, "auto_checkbox"):
            self.auto_checkbox.blockSignals(True)
            self.auto_checkbox.setChecked(True)
            self.auto_checkbox.blockSignals(False)
            self.auto_checkbox.hide()

        if hasattr(self, "focus_btn"):
            self.focus_btn.setText("Focus")
            self.focus_btn.setToolTip("Answers only — hide controls")
            self.focus_btn.setStyleSheet(T.ghost_button_ss())
        if hasattr(self, "layout_toggle_btn"):
            self.layout_toggle_btn.hide()
        if hasattr(self, "auto_checkbox"):
            self.auto_checkbox.hide()  # always on for copilot UX
        if hasattr(self, "advanced_btn"):
            self.advanced_btn.setText("▾ Settings")
            self.advanced_btn.setStyleSheet(T.ghost_button_ss())
        if hasattr(self, "advanced_panel"):
            self.advanced_panel.hide()
        if hasattr(self, "deactivate_btn") and not LICENSE_ENABLED:
            self.deactivate_btn.hide()

        # Stealth Mode button styling (created in _init_ui)
        if hasattr(self, "stealth_btn"):
            self.stealth_btn.setStyleSheet(
                f"QPushButton {{ background: {T.HD_ORANGE_SOFT}; color: {T.HD_ORANGE}; "
                f"border: 1px solid {T.HD_ORANGE}; border-radius: 8px; padding: 6px 12px; "
                f"font-weight: 700; }}"
                f"QPushButton:checked {{ background: {T.HD_ORANGE}; color: white; }}"
                f"QPushButton:!checked {{ background: {T.BG_CARD}; color: {T.TEXT_MUTED}; "
                f"border: 1px solid {T.BORDER}; }}"
            )
            self.stealth_btn.setText("Stealth ON" if self.stealth_mode else "Stealth OFF")
            self.stealth_btn.setChecked(self.stealth_mode)
            if not is_stealth_supported():
                self.stealth_btn.setEnabled(False)
                self.stealth_btn.setToolTip("Stealth mode is only available on Windows.")

        if hasattr(self, "job_context_input"):
            self.job_context_input.setPlaceholderText("Target role (e.g. Sales Associate, Software Engineer)")
            self.job_context_input.setStyleSheet(
                f"QLineEdit {{ background: {T.BG_INPUT}; color: {T.TEXT}; "
                f"border: 1px solid {T.BORDER}; border-radius: 10px; padding: 10px; }}"
            )

        if hasattr(self, "state_frame"):
            self.state_frame.setStyleSheet(T.status_pill_ss(False))
        if hasattr(self, "state_text"):
            self.state_text.setText("Ready")
            self.state_text.setStyleSheet(f"color: {T.TEXT_MUTED}; font-weight: 600;")
        if hasattr(self, "audio_help_banner"):
            self.audio_help_banner.setStyleSheet(
                f"QLabel {{ background: {T.HD_ORANGE_SOFT}; color: {T.TEXT}; "
                f"border: 1px solid {T.HD_ORANGE}; border-radius: 12px; padding: 12px; }}"
            )

        self.status_label.setStyleSheet(f"color: {T.TEXT_DIM}; font-size: 12px;")
        self.status_label.setText(
            "Auto answers on · no Generate click needed · Stealth hides from screen share"
        )

        # Re-show after flag change; apply stealth after native HWND exists
        self.show()
        QTimer.singleShot(100, self._apply_stealth_affinity)

    def _apply_stealth_affinity(self):
        """Apply Windows exclude-from-capture (must run after window is shown)."""
        ok = set_exclude_from_capture(self, self.stealth_mode)
        if self.stealth_mode and ok:
            self.status_label.setText(
                "Stealth ON — hidden from Zoom/Meet/Teams screen share. You can minimize."
            )
        elif self.stealth_mode and not ok:
            self.status_label.setText(
                "Stealth requested but Windows blocked it (need Win10 2004+)."
            )

    def _toggle_stealth_mode(self):
        """Toggle screen-share invisibility (Final Round / Parakeet style)."""
        self.stealth_mode = self.stealth_btn.isChecked()
        self.stealth_btn.setText("Stealth ON" if self.stealth_mode else "Stealth OFF")
        ok = set_exclude_from_capture(self, self.stealth_mode)
        if self.stealth_mode:
            self.status_label.setText(
                "Stealth ON — they won't see this window if you share your screen."
                if ok else "Stealth failed — update Windows or try again."
            )
        else:
            self.status_label.setText(
                "Stealth OFF — this window is visible in screen share."
            )

    def _init_capture(self):
        """Initialize audio capture with selected device."""
        try:
            device = self.device_combo.currentData()
            self.capture = get_audio_capture(device)
            self.status_label.setText("Status: Ready")
        except Exception as e:
            self.capture = None
            self.status_label.setText(f"Status: Error - {e}")
            self._set_buttons_enabled(False)

    def _init_ui(self):
        """Set up the user interface."""
        self.setWindowTitle("Astra Interview Copilot")
        self.setMinimumSize(450, 600)
        self.resize(600, 750)

        # Make window semi-transparent
        self.setWindowOpacity(0.92)

        # Central widget and layout
        central = QWidget()
        central.setStyleSheet("background-color: rgba(255, 255, 255, 230);")
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setSpacing(10)
        layout.setContentsMargins(15, 15, 15, 15)

        # === ANSWER/QUESTION SECTION AT TOP ===
        # Splitter style shared between content_splitter and answer_splitter
        splitter_style = """
            QSplitter::handle {
                background-color: #e0e0e0;
            }
            QSplitter::handle:horizontal {
                width: 6px;
            }
            QSplitter::handle:vertical {
                height: 6px;
            }
        """

        # Create splitter for Question/Answer sections
        self.content_splitter = QSplitter(Qt.Orientation.Vertical)
        self.content_splitter.setStyleSheet(splitter_style)

        # Answer area container (TOP - most important)
        self.answer_area = QWidget()
        answer_area_layout = QVBoxLayout(self.answer_area)
        answer_area_layout.setContentsMargins(0, 0, 0, 0)
        answer_area_layout.setSpacing(5)

        # Question display at top of answer area
        self.question_display = QLabel("Your question will show here…")
        self.question_display.setFont(QFont("Segoe UI", 13))
        self.question_display.setStyleSheet("""
            QLabel {
                color: #2d3748;
                background-color: #ebf8ff;
                border: 2px solid #90cdf4;
                border-radius: 12px;
                padding: 12px;
            }
        """)
        self.question_display.setWordWrap(True)
        answer_area_layout.addWidget(self.question_display)

        # Horizontal splitter for dual answer panes
        self.answer_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.answer_splitter.setStyleSheet(splitter_style)
        self.answer_splitter.setChildrenCollapsible(False)

        # Left pane: Key Points (bullet_box)
        left_pane = QWidget()
        left_layout = QVBoxLayout(left_pane)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(5)

        bullet_label = QLabel("Quick tips")
        bullet_label.setFont(QFont("Sans", 10))
        bullet_label.setStyleSheet("color: #333333;")
        left_layout.addWidget(bullet_label)

        self.bullet_box = FitTextEdit(initial_font_size=16, min_font_size=10)
        self.bullet_box.setPlaceholderText("• Quick tip 1\n• Quick tip 2\n• Quick tip 3")
        self.bullet_box.setStyleSheet("""
            QTextEdit {
                background-color: rgba(249, 249, 249, 220);
                color: #222222;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 8px;
            }
        """)
        self.bullet_box.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        left_layout.addWidget(self.bullet_box, stretch=1)

        # Primary pane: Say this (script) — shown first / larger
        right_pane = QWidget()
        right_layout = QVBoxLayout(right_pane)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(5)

        script_label = QLabel("📣  SAY THIS (read out loud)")
        script_label.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        script_label.setStyleSheet("color: #1a365d;")
        right_layout.addWidget(script_label)

        self.script_box = FitTextEdit(initial_font_size=18, min_font_size=12)
        self.script_box.setPlaceholderText(
            "When someone asks a question, words you can say will appear here."
        )
        self.script_box.setStyleSheet("""
            QTextEdit {
                background-color: #ffffff;
                color: #1a202c;
                border: 3px solid #38a169;
                border-radius: 12px;
                padding: 14px;
                font-size: 16px;
            }
        """)
        self.script_box.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        right_layout.addWidget(self.script_box, stretch=1)

        # Script first (primary), tips secondary
        self.answer_splitter.addWidget(right_pane)
        self.answer_splitter.addWidget(left_pane)

        # Prefer script pane (~70/30)
        self.answer_splitter.setSizes([420, 180])

        answer_area_layout.addWidget(self.answer_splitter, stretch=1)

        # Backward compatibility: answer_box points to primary script pane
        self.answer_box = self.script_box

        self.content_splitter.addWidget(self.answer_area)

        # Question panel (below answer)
        self.question_panel = QWidget()
        question_layout = QVBoxLayout(self.question_panel)
        question_layout.setContentsMargins(0, 0, 0, 0)
        question_layout.setSpacing(5)

        # Transcription section (manual mode)
        trans_label = QLabel("Question:")
        trans_label.setFont(QFont("Sans", 10))
        trans_label.setStyleSheet("color: #333333;")
        question_layout.addWidget(trans_label)

        self.transcription_box = QTextEdit()
        self.transcription_box.setReadOnly(True)
        self.transcription_box.setFont(QFont("Sans", 11))
        self.transcription_box.setMinimumHeight(60)
        self.transcription_box.setPlaceholderText("(transcription appears here)")
        self.transcription_box.setStyleSheet("""
            QTextEdit {
                background-color: rgba(245, 245, 245, 220);
                color: #333333;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 5px;
            }
        """)
        self.transcription_box.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        question_layout.addWidget(self.transcription_box, stretch=1)

        # Last heard section (for auto-mode)
        last_heard_layout = QHBoxLayout()
        last_heard_label = QLabel("Last heard:")
        last_heard_label.setFont(QFont("Sans", 9))
        last_heard_label.setStyleSheet("color: #666666;")
        last_heard_layout.addWidget(last_heard_label)

        self.last_heard_status = QLabel("")
        self.last_heard_status.setFont(QFont("Sans", 9))
        self.last_heard_status.setStyleSheet("color: #888888; font-style: italic;")
        last_heard_layout.addWidget(self.last_heard_status)
        last_heard_layout.addStretch()

        question_layout.addLayout(last_heard_layout)

        self.last_heard_box = QTextEdit()
        self.last_heard_box.setReadOnly(True)
        self.last_heard_box.setFont(QFont("Sans", 9))
        self.last_heard_box.setMinimumHeight(40)
        self.last_heard_box.setMaximumHeight(60)
        self.last_heard_box.setPlaceholderText("(waiting for speech...)")
        self.last_heard_box.setStyleSheet("""
            QTextEdit {
                background-color: rgba(250, 250, 250, 220);
                color: #555555;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                padding: 4px;
            }
        """)
        question_layout.addWidget(self.last_heard_box)

        self.content_splitter.addWidget(self.question_panel)

        # Set initial splitter sizes (60% answer, 40% question)
        self.content_splitter.setSizes([350, 200])
        self.content_splitter.setChildrenCollapsible(False)

        layout.addWidget(self.content_splitter, stretch=1)

        # === CONTROLS CONTAINER (hideable in focus mode) ===
        self.controls_container = QWidget()
        controls_layout = QVBoxLayout(self.controls_container)
        controls_layout.setContentsMargins(0, 0, 0, 0)
        controls_layout.setSpacing(10)

        # Quiet-audio banner (shown when level stays ~0 while listening)
        self.audio_help_banner = QLabel("")
        self.audio_help_banner.setWordWrap(True)
        self.audio_help_banner.setFont(QFont("Sans", 10))
        self.audio_help_banner.setStyleSheet("""
            QLabel {
                background-color: #fff3cd;
                color: #856404;
                border: 1px solid #ffc107;
                border-radius: 6px;
                padding: 8px;
            }
        """)
        self.audio_help_banner.hide()
        controls_layout.addWidget(self.audio_help_banner)

        # Settings (collapsed by default)
        self.advanced_btn = QPushButton("▾ Settings")
        self.advanced_btn.setFont(QFont("Segoe UI", 9))
        self.advanced_btn.setCheckable(True)
        self.advanced_btn.setChecked(False)
        self.advanced_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: #a0aec0;
                border: none;
                text-align: left;
                padding: 2px 0;
            }
        """)
        self.advanced_btn.toggled.connect(self._on_advanced_toggled)
        controls_layout.addWidget(self.advanced_btn)

        self.advanced_panel = QWidget()
        advanced_layout = QVBoxLayout(self.advanced_panel)
        advanced_layout.setContentsMargins(0, 0, 0, 0)
        advanced_layout.setSpacing(8)

        # Audio source selection
        source_layout = QHBoxLayout()
        source_label = QLabel("Audio Source:")
        source_label.setFont(QFont("Sans", 10))
        source_label.setStyleSheet("color: #333333;")
        source_layout.addWidget(source_label)

        self.device_combo = QComboBox()
        self.device_combo.setStyleSheet("""
            QComboBox {
                background-color: rgba(245, 245, 245, 220);
                color: #333333;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 5px;
            }
            QComboBox::drop-down {
                border: none;
            }
            QComboBox QAbstractItemView {
                background-color: rgba(255, 255, 255, 240);
                color: #333333;
                selection-background-color: #4a90d9;
            }
        """)
        self._populate_devices()
        self.device_combo.currentIndexChanged.connect(self._on_device_changed)
        source_layout.addWidget(self.device_combo, stretch=1)

        self.test_btn = QPushButton("Test")
        self.test_btn.setFont(QFont("Sans", 10))
        self.test_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(108, 117, 125, 220);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 5px 15px;
            }
            QPushButton:hover {
                background-color: rgba(90, 98, 104, 230);
            }
            QPushButton:disabled {
                background-color: rgba(204, 204, 204, 200);
            }
        """)
        self.test_btn.clicked.connect(self._on_test_audio)
        source_layout.addWidget(self.test_btn)

        advanced_layout.addLayout(source_layout)

        # Auto-Answer Mode section
        auto_frame = QFrame()
        auto_frame.setStyleSheet("""
            QFrame {
                background-color: rgba(240, 244, 248, 200);
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 5px;
            }
        """)
        auto_layout = QHBoxLayout(auto_frame)
        auto_layout.setContentsMargins(10, 5, 10, 5)

        self.auto_checkbox = QCheckBox("🤖 Auto-Answer Mode")
        self.auto_checkbox.setFont(QFont("Sans", 10))
        self.auto_checkbox.setStyleSheet("color: #333333;")
        self.auto_checkbox.toggled.connect(self._on_auto_mode_toggled)
        auto_layout.addWidget(self.auto_checkbox)

        auto_layout.addStretch()

        controls_layout.addWidget(auto_frame)

        # Job context — simple wording
        job_frame = QFrame()
        job_frame.setStyleSheet("""
            QFrame {
                background-color: #fffaf0;
                border: 2px solid #fbd38d;
                border-radius: 12px;
                padding: 6px;
            }
        """)
        job_layout = QHBoxLayout(job_frame)
        job_layout.setContentsMargins(12, 8, 12, 8)
        job_label = QLabel("Job:")
        job_label.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        job_label.setStyleSheet("color: #744210;")
        job_layout.addWidget(job_label)
        self.job_context_input = QLineEdit()
        self.job_context_input.setPlaceholderText("e.g. babysitter, cashier, soccer coach")
        self.job_context_input.setText(get_default_job_context())
        self.job_context_input.setFont(QFont("Segoe UI", 12))
        self.job_context_input.setStyleSheet("""
            QLineEdit {
                background-color: white;
                color: #1a202c;
                border: 1px solid #f6ad55;
                border-radius: 8px;
                padding: 8px 10px;
            }
        """)
        job_layout.addWidget(self.job_context_input, stretch=1)
        controls_layout.addWidget(job_frame)

        # --- Advanced: confidence, tone, reload ---
        conf_row = QHBoxLayout()
        conf_label = QLabel("Confidence:")
        conf_label.setFont(QFont("Sans", 9))
        conf_label.setStyleSheet("color: #555555;")
        conf_row.addWidget(conf_label)

        self.confidence_slider = QSlider(Qt.Orientation.Horizontal)
        self.confidence_slider.setMinimum(30)
        self.confidence_slider.setMaximum(95)
        self.confidence_slider.setValue(int(CLASSIFICATION_CONFIDENCE * 100))
        self.confidence_slider.setFixedWidth(80)
        self.confidence_slider.setStyleSheet("""
            QSlider::groove:horizontal {
                height: 6px;
                background: #ddd;
                border-radius: 3px;
            }
            QSlider::handle:horizontal {
                width: 14px;
                margin: -4px 0;
                background: #4a90d9;
                border-radius: 7px;
            }
        """)
        self.confidence_slider.valueChanged.connect(self._on_confidence_changed)
        conf_row.addWidget(self.confidence_slider)

        self.confidence_label = QLabel(f"{CLASSIFICATION_CONFIDENCE:.2f}")
        self.confidence_label.setFont(QFont("Sans", 9))
        self.confidence_label.setStyleSheet("color: #555555;")
        self.confidence_label.setFixedWidth(30)
        conf_row.addWidget(self.confidence_label)
        conf_row.addStretch()
        advanced_layout.addLayout(conf_row)

        # Settings section (Tone, Reload Config) inside advanced
        settings_frame = QFrame()
        settings_frame.setStyleSheet("""
            QFrame {
                background-color: rgba(248, 249, 250, 200);
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 5px;
            }
        """)
        settings_layout = QHBoxLayout(settings_frame)
        settings_layout.setContentsMargins(10, 5, 10, 5)
        settings_layout.setSpacing(10)

        # Tone dropdown
        tone_label = QLabel("Tone:")
        tone_label.setFont(QFont("Sans", 9))
        tone_label.setStyleSheet("color: #555555;")
        settings_layout.addWidget(tone_label)

        self.tone_combo = QComboBox()
        self.tone_combo.setFont(QFont("Sans", 9))
        self.tone_combo.setStyleSheet("""
            QComboBox {
                background-color: rgba(255, 255, 255, 220);
                color: #333333;
                border: 1px solid #ccc;
                border-radius: 4px;
                padding: 4px 6px;
            }
            QComboBox::drop-down {
                border: none;
            }
        """)
        self._populate_tones()
        settings_layout.addWidget(self.tone_combo)

        # Reload Config button
        self.reload_config_btn = QPushButton("⟳ Reload")
        self.reload_config_btn.setFont(QFont("Sans", 9))
        self.reload_config_btn.setToolTip("Reload prompts.yaml config")
        self.reload_config_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(108, 117, 125, 200);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 4px 10px;
            }
            QPushButton:hover {
                background-color: rgba(90, 98, 104, 220);
            }
        """)
        self.reload_config_btn.clicked.connect(self._on_reload_config)
        settings_layout.addWidget(self.reload_config_btn)

        advanced_layout.addWidget(settings_frame)
        controls_layout.addWidget(self.advanced_panel)
        self.advanced_panel.hide()

        # State indicator with color
        self.state_frame = QFrame()
        self.state_frame.setStyleSheet("""
            QFrame {
                background-color: rgba(232, 244, 253, 200);
                border: 1px solid #b8d4e8;
                border-radius: 6px;
            }
        """)
        state_layout = QHBoxLayout(self.state_frame)
        state_layout.setContentsMargins(10, 8, 10, 8)

        self.state_indicator = QLabel("🔵")
        self.state_indicator.setFont(QFont("Sans", 14))
        state_layout.addWidget(self.state_indicator)

        self.state_text = QLabel("Ready")
        self.state_text.setFont(QFont("Sans", 11))
        self.state_text.setStyleSheet("color: #333333;")
        state_layout.addWidget(self.state_text)

        state_layout.addStretch()

        self.queue_label = QLabel("")
        self.queue_label.setFont(QFont("Sans", 9))
        self.queue_label.setStyleSheet("color: #666666;")
        state_layout.addWidget(self.queue_label)

        controls_layout.addWidget(self.state_frame)

        # Audio level meter
        level_layout = QHBoxLayout()
        level_label = QLabel("Level:")
        level_label.setFont(QFont("Sans", 10))
        level_label.setStyleSheet("color: #333333;")
        level_layout.addWidget(level_label)

        self.level_bar = QProgressBar()
        self.level_bar.setRange(0, 100)
        self.level_bar.setValue(0)
        self.level_bar.setTextVisible(False)
        self.level_bar.setMaximumHeight(20)
        self.level_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #ddd;
                border-radius: 4px;
                background-color: rgba(245, 245, 245, 200);
            }
            QProgressBar::chunk {
                background-color: rgba(40, 167, 69, 220);
                border-radius: 3px;
            }
        """)
        level_layout.addWidget(self.level_bar, stretch=1)

        controls_layout.addLayout(level_layout)

        # Control buttons
        btn_layout = QHBoxLayout()

        self.listen_btn = QPushButton("🎧 Start Listening")
        self.listen_btn.setFont(QFont("Sans", 12))
        self.listen_btn.setMinimumHeight(50)
        self.listen_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(74, 144, 217, 230);
                color: white;
                border: none;
                border-radius: 8px;
            }
            QPushButton:hover {
                background-color: rgba(58, 123, 200, 240);
            }
            QPushButton:disabled {
                background-color: rgba(204, 204, 204, 200);
            }
        """)
        self.listen_btn.clicked.connect(self._on_listen_toggle)
        btn_layout.addWidget(self.listen_btn)

        self.answer_btn = QPushButton("💡 Get Answer")
        self.answer_btn.setFont(QFont("Sans", 12))
        self.answer_btn.setMinimumHeight(50)
        self.answer_btn.setEnabled(False)
        self.answer_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(40, 167, 69, 230);
                color: white;
                border: none;
                border-radius: 8px;
            }
            QPushButton:hover {
                background-color: rgba(33, 136, 56, 240);
            }
            QPushButton:disabled {
                background-color: rgba(204, 204, 204, 200);
            }
        """)
        self.answer_btn.clicked.connect(self._on_get_answer)
        btn_layout.addWidget(self.answer_btn)

        controls_layout.addLayout(btn_layout)

        # Add controls container to main layout
        layout.addWidget(self.controls_container)

        # === TITLE AT BOTTOM ===
        title_layout = QHBoxLayout()
        title_layout.addStretch()

        title = QLabel("Astra Interview Copilot")
        title.setFont(QFont("Sans", 11))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("color: #888888;")
        title_layout.addWidget(title)

        title_layout.addStretch()

        # Deactivate license button
        self.deactivate_btn = QPushButton("Deactivate License")
        self.deactivate_btn.setFont(QFont("Sans", 9))
        self.deactivate_btn.setToolTip("Deactivate license on this machine")
        self.deactivate_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(220, 53, 69, 180);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 4px 8px;
            }
            QPushButton:hover {
                background-color: rgba(200, 35, 51, 210);
            }
        """)
        self.deactivate_btn.clicked.connect(self._deactivate_license)
        title_layout.addWidget(self.deactivate_btn)
        if not LICENSE_ENABLED:
            self.deactivate_btn.hide()

        # Focus mode button (shows only answers)
        self.focus_btn = QPushButton("👁 Focus")
        self.focus_btn.setFont(QFont("Sans", 10))
        self.focus_btn.setToolTip("Toggle focus mode (show only answers)")
        self.focus_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(74, 144, 217, 200);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 4px 10px;
            }
            QPushButton:hover {
                background-color: rgba(58, 123, 200, 220);
            }
        """)
        self.focus_btn.clicked.connect(self._toggle_focus_mode)
        title_layout.addWidget(self.focus_btn)

        # Stealth mode (hide from screen share) — Final Round / Parakeet style
        self.stealth_btn = QPushButton("Stealth ON")
        self.stealth_btn.setCheckable(True)
        self.stealth_btn.setChecked(True)
        self.stealth_btn.setFont(QFont("Sans", 9, QFont.Weight.Bold))
        self.stealth_btn.setToolTip(
            "When ON, this window is hidden from Zoom/Meet/Teams screen share. "
            "You still see it; they don't. (Windows 10 2004+)"
        )
        self.stealth_btn.clicked.connect(self._toggle_stealth_mode)
        title_layout.addWidget(self.stealth_btn)

        # Layout toggle button
        self.layout_toggle_btn = QPushButton("⇕")
        self.layout_toggle_btn.setFont(QFont("Sans", 12))
        self.layout_toggle_btn.setFixedSize(28, 28)
        self.layout_toggle_btn.setToolTip("Toggle horizontal/vertical layout")
        self.layout_toggle_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(224, 224, 224, 200);
                color: #333333;
                border: 1px solid #ccc;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: rgba(208, 208, 208, 220);
            }
        """)
        self.layout_toggle_btn.clicked.connect(self._toggle_layout)
        title_layout.addWidget(self.layout_toggle_btn)

        layout.addLayout(title_layout)

        # Focus mode toolbar (hidden by default, shown in focus mode)
        self.focus_toolbar = QFrame()
        self.focus_toolbar.setStyleSheet("""
            QFrame {
                background-color: rgba(240, 240, 240, 220);
                border: 1px solid #ccc;
                border-radius: 6px;
            }
        """)
        focus_toolbar_layout = QHBoxLayout(self.focus_toolbar)
        focus_toolbar_layout.setContentsMargins(10, 8, 10, 8)

        # State indicator for focus mode
        self.focus_state_indicator = QLabel("🔵")
        self.focus_state_indicator.setFont(QFont("Sans", 16))
        focus_toolbar_layout.addWidget(self.focus_state_indicator)

        focus_toolbar_layout.addStretch()

        # Get Answer button for focus mode
        self.focus_answer_btn = QPushButton("💡 Get Answer")
        self.focus_answer_btn.setFont(QFont("Sans", 12))
        self.focus_answer_btn.setMinimumHeight(40)
        self.focus_answer_btn.setMinimumWidth(150)
        self.focus_answer_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(40, 167, 69, 230);
                color: white;
                border: none;
                border-radius: 6px;
            }
            QPushButton:hover {
                background-color: rgba(33, 136, 56, 240);
            }
            QPushButton:disabled {
                background-color: rgba(204, 204, 204, 200);
            }
        """)
        self.focus_answer_btn.clicked.connect(self._on_get_answer)
        focus_toolbar_layout.addWidget(self.focus_answer_btn)

        focus_toolbar_layout.addStretch()

        self.focus_toolbar.hide()  # Hidden by default
        layout.addWidget(self.focus_toolbar)

        # Status bar
        self.status_label = QLabel("Status: Initializing...")
        self.status_label.setFont(QFont("Sans", 9))
        self.status_label.setStyleSheet("color: #555555; background-color: transparent;")
        layout.addWidget(self.status_label)

    def _populate_devices(self):
        """Populate device dropdown with available monitor devices."""
        self.device_combo.clear()

        try:
            # Temporarily create capture to list devices
            temp_capture = get_audio_capture()
            devices = temp_capture.list_devices()

            default_idx = 0
            for i, dev in enumerate(devices):
                # Shorten the name for display
                name = dev["name"]
                display_name = name
                if len(name) > 50:
                    display_name = "..." + name[-47:]

                status = dev["status"]
                label = f"[{status}] {display_name}"

                self.device_combo.addItem(label, name)

                # Prefer active/idle monitors
                if status in ("IDLE", "RUNNING") and ".monitor" in name:
                    default_idx = i

            if devices:
                self.device_combo.setCurrentIndex(default_idx)

        except Exception as e:
            self.device_combo.addItem(f"Error: {e}", None)

    def _populate_tones(self):
        """Populate tone dropdown with available tones from config."""
        self.tone_combo.clear()
        tones = get_available_tones()
        default_tone = get_default_tone()

        for tone in tones:
            self.tone_combo.addItem(tone.capitalize(), tone)

        # Set default tone as selected
        idx = self.tone_combo.findData(default_tone)
        if idx >= 0:
            self.tone_combo.setCurrentIndex(idx)

    def _on_reload_config(self):
        """Reload prompts config from YAML file."""
        reload_prompts_config()
        # Refresh tone dropdown
        current_tone = self.tone_combo.currentData()
        self._populate_tones()
        # Try to restore previous selection
        idx = self.tone_combo.findData(current_tone)
        if idx >= 0:
            self.tone_combo.setCurrentIndex(idx)
        # Update job context if changed in config
        default_job = get_default_job_context()
        if default_job and not self.job_context_input.text():
            self.job_context_input.setText(default_job)
        self.status_label.setText("Status: Config reloaded")

    def _connect_signals(self):
        """Connect thread-safe signals to UI updates."""
        self.signals.transcription_ready.connect(self._on_transcription_ready)
        # Legacy single-stream → primary "Say this" pane (was wired to dead _on_answer_token path)
        self.signals.answer_token.connect(self._on_script_token)
        self.signals.answer_done.connect(self._on_answer_done)
        self.signals.answer_clear.connect(self._on_answer_clear)
        self.signals.status_update.connect(self._on_status_update)
        self.signals.error_occurred.connect(self._on_error)
        self.signals.audio_level.connect(self._on_audio_level)
        # Auto-answer mode signals
        self.signals.state_changed.connect(self._on_state_changed)
        self.signals.last_heard_update.connect(self._on_last_heard_update)
        self.signals.queue_update.connect(self._on_queue_update)
        # Queue drain MUST go through Qt signals — QTimer from worker threads is dormant
        self.signals.queue_item_ready.connect(self._run_queued_item)
        # Dual-pane answer signals
        self.signals.bullet_token.connect(self._on_bullet_token)
        self.signals.script_token.connect(self._on_script_token)
        self.signals.question_update.connect(self._on_question_update)

    def _set_buttons_enabled(self, enabled: bool):
        """Enable/disable control buttons."""
        self.listen_btn.setEnabled(enabled)
        self.test_btn.setEnabled(enabled)
        self.device_combo.setEnabled(enabled)

    def _on_device_changed(self):
        """Handle device selection change."""
        if self.is_listening:
            self._stop_listening()
        self._init_capture()

    def _on_listen_toggle(self):
        """Toggle listening state."""
        if self.is_listening:
            self._stop_listening()
        else:
            self._start_listening()

    def _start_listening(self):
        """Start continuous audio capture."""
        if not self.capture:
            # Retry device init (e.g. advanced panel opened after failed start)
            self._init_capture()
            if not self.capture:
                self.signals.error_occurred.emit(
                    "We can't hear computer sound. Open Advanced settings and pick an audio device."
                )
                return

        try:
            self.capture.start_capture()
            self.is_listening = True

            # Reset auto-answer timing (do not cancel in-flight gen mid-start)
            self.speech_start_time = None
            self.silence_start_time = None
            self._zero_level_ticks = 0
            self._device_rotate_ticks = 0
            self._device_rotations = 0
            if self.audio_help_banner.isVisible():
                self.audio_help_banner.hide()

            import theme as T
            self.listen_btn.setText("■  End Session")
            self.listen_btn.setStyleSheet(T.danger_button_ss() + "QPushButton { min-height: 44px; font-weight: 700; }")
            # LIVE auto is always on during a session
            self.auto_answer_enabled = True
            self.answer_btn.hide()
            self.focus_answer_btn.hide()
            self.test_btn.setEnabled(False)
            self.device_combo.setEnabled(False)
            self._noise_floor = 0.01
            self._level_ema = 0.0

            self.status_label.setText(
                "LIVE · answers appear automatically when the interviewer pauses"
            )
            self.script_box.setPlaceholderText(
                "Listening… Best Answer will stream here automatically."
            )
            self.signals.state_changed.emit(ListeningState.LISTENING)

            # Start level meter + adaptive VAD
            self.level_timer = QTimer()
            self.level_timer.timeout.connect(self._update_level)
            self.level_timer.start(80)  # snappier endpointing

        except Exception as e:
            self.signals.error_occurred.emit(str(e))

    def _stop_listening(self):
        """Stop audio capture."""
        if self.level_timer:
            self.level_timer.stop()
            self.level_timer = None

        self.is_listening = False
        self.level_bar.setValue(0)

        # Reset auto-answer state; invalidate in-flight generation
        self.speech_start_time = None
        self.silence_start_time = None
        with self._process_lock:
            self.is_processing = False
            self._generation_id += 1
        # Drop pending queue items on stop
        while not self.question_queue.empty():
            try:
                self.question_queue.get_nowait()
            except Exception:
                break
        self.signals.queue_update.emit(0)
        self.signals.state_changed.emit(ListeningState.IDLE)

        if self.capture:
            self.capture.stop_capture()

        import theme as T
        self.listen_btn.setText("●  Start Session")
        self.listen_btn.setStyleSheet(T.primary_button_ss())
        self.answer_btn.setEnabled(False)
        self.focus_answer_btn.setEnabled(False)
        self.test_btn.setEnabled(True)
        self.device_combo.setEnabled(True)
        self.status_label.setText("Session ended. Start again when ready.")

    def _on_advanced_toggled(self, checked: bool):
        """Show/hide advanced settings (device, confidence, tone)."""
        self.advanced_visible = checked
        self.advanced_panel.setVisible(checked)
        self.advanced_btn.setText("▴ Hide settings" if checked else "▾ Settings")

    def _update_level(self):
        """Update audio level meter and handle auto-answer mode."""
        if not self.capture or not self.is_listening:
            return

        level = self.capture.get_audio_level()
        # VAD must use pre-gain level when available (post-gain never looks silent)
        vad_level = level
        if hasattr(self.capture, "get_vad_level"):
            try:
                vad_level = float(self.capture.get_vad_level())
            except Exception:
                vad_level = level
        self.level_bar.setValue(int(min(100, level * 100)))

        # Quiet-call detector + auto-switch Windows loopback device
        if vad_level < SILENCE_THRESHOLD and level < 0.02:
            self._zero_level_ticks += 1
            self._device_rotate_ticks += 1
        else:
            self._zero_level_ticks = 0
            self._device_rotate_ticks = 0
            if self.audio_help_banner.isVisible():
                self.audio_help_banner.hide()

        # After ~2.5s of silence, try the next loopback (wrong speaker is common)
        if (
            self._device_rotate_ticks >= 25
            and self._device_rotations < 6
            and hasattr(self.capture, "try_next_loopback")
        ):
            self._device_rotate_ticks = 0
            new_dev = self.capture.try_next_loopback()
            if new_dev:
                self._device_rotations += 1
                short = new_dev if len(new_dev) < 48 else ("…" + new_dev[-45:])
                self.status_label.setText(f"Trying another sound device: {short}")
                # Refresh combo selection if present
                try:
                    idx = self.device_combo.findData(new_dev)
                    if idx < 0:
                        # try partial match
                        for i in range(self.device_combo.count()):
                            data = self.device_combo.itemData(i)
                            if data and (data in new_dev or new_dev in str(data)):
                                idx = i
                                break
                    if idx >= 0:
                        self.device_combo.blockSignals(True)
                        self.device_combo.setCurrentIndex(idx)
                        self.device_combo.blockSignals(False)
                except Exception:
                    pass

        if self._zero_level_ticks >= 80:  # ~8s still silent
            dev = ""
            diag = {}
            try:
                dev = getattr(self.capture, "device", "") or ""
                if hasattr(self.capture, "diagnostics"):
                    diag = self.capture.diagnostics()
            except Exception:
                pass
            bytes_rx = diag.get("bytes_received", 0)
            using_mic = bool(diag.get("using_microphone"))
            tip = (
                "We still can't hear your video. 🔇\n"
                "1) Turn the video volume UP on THIS computer (not muted)\n"
                "2) Windows taskbar speaker icon → use the SAME speakers/headphones\n"
                "   that are playing the video as the DEFAULT device\n"
                "3) Sound must play on THIS PC — not only on a phone\n"
            )
            if using_mic:
                tip += "4) Mic mode is on — put the laptop near the speaker, volume up\n"
            if dev:
                tip += f"\nRight now listening on: {dev[:80]}"
            if bytes_rx == 0:
                tip += "\n(No audio data yet — wrong device or Windows blocked capture.)"
            elif diag.get("level", 0) == 0:
                tip += "\n(Device is open but silent — video may be on a different output.)"
            self.audio_help_banner.setText(tip)
            self.audio_help_banner.show()

        # --- LIVE auto-answer (always on in session) ---
        # Adaptive VAD: absolute threshold fails on continuous noise or gain-boosted
        # Stereo Mix floors. Track noise floor and detect relative silence after speech.
        self.auto_answer_enabled = True

        import time
        current_time = time.time()

        # EMA + noise floor from pre-gain VAD level
        self._level_ema = (0.65 * self._level_ema) + (0.35 * vad_level)
        if self.speech_start_time is None:
            self._noise_floor = min(
                0.06,
                max(0.001, (0.94 * self._noise_floor) + (0.06 * self._level_ema)),
            )

        speech_on = self._noise_floor * VAD_NOISE_FACTOR + VAD_NOISE_OFFSET
        speech_off = max(
            SILENCE_THRESHOLD,
            self._noise_floor * VAD_SILENCE_FACTOR + (VAD_NOISE_OFFSET * 0.35),
        )
        # Hysteresis: different thresholds for start vs end of speech
        if self.speech_start_time is None:
            is_speech = vad_level >= speech_on
        else:
            is_speech = vad_level >= speech_off

        if is_speech:
            self.silence_start_time = None
            if self.speech_start_time is None:
                self.speech_start_time = current_time
                if not self.is_processing:
                    self.signals.state_changed.emit(ListeningState.HEARING)
            else:
                # Force endpoint if question rambles without a clear pause
                speech_so_far = current_time - self.speech_start_time
                if speech_so_far >= MAX_UTTERANCE_SECONDS and not self.is_processing:
                    self.last_speech_duration = speech_so_far
                    self.speech_start_time = None
                    self.silence_start_time = None
                    self._trigger_auto_process()
        else:
            if self.speech_start_time is not None:
                if self.silence_start_time is None:
                    self.silence_start_time = current_time
                else:
                    silence_duration = current_time - self.silence_start_time
                    speech_duration = self.silence_start_time - self.speech_start_time
                    if silence_duration >= SILENCE_DURATION:
                        if speech_duration >= MIN_SPEECH_DURATION:
                            self.last_speech_duration = speech_duration
                            self._trigger_auto_process()
                        elif not self.is_processing:
                            self.signals.state_changed.emit(ListeningState.LISTENING)
                        self.speech_start_time = None
                        self.silence_start_time = None
            else:
                if not self.is_processing and self.current_state != ListeningState.LISTENING:
                    self.signals.state_changed.emit(ListeningState.LISTENING)

    def _snapshot_audio_for_speech(self, speech_s: float = 0.0):
        """Copy the utterance window NOW (before the ring buffer rolls forward)."""
        if not self.capture:
            return None
        window_s = speech_window_seconds(
            speech_s,
            min_seconds=3.0,
            max_seconds=float(AUTO_TRANSCRIBE_MAX_SECONDS),
            pad_seconds=0.75,
        )
        try:
            return self.capture.get_last_n_seconds(int(window_s + 0.5))
        except Exception:
            return None

    def _trigger_auto_process(self):
        """Trigger automatic transcription and classification (or queue if busy)."""
        # Snapshot UI + audio on the main thread (Qt-safe, correct clip)
        job_context = self.job_context_input.text().strip()
        tone = self.tone_combo.currentData() or "professional"
        speech_s = getattr(self, "last_speech_duration", 0) or 0
        conf = self.confidence_threshold
        audio = self._snapshot_audio_for_speech(speech_s)

        with self._process_lock:
            if self.is_processing:
                # Queue the captured clip — do NOT re-read the ring later
                try:
                    self.question_queue.put_nowait({
                        "audio": audio,
                        "speech_s": speech_s,
                        "job_context": job_context,
                        "tone": tone,
                        "conf": conf,
                    })
                    self.signals.queue_update.emit(self.question_queue.qsize())
                    self.signals.status_update.emit(
                        f"Queued next question ({self.question_queue.qsize()})…"
                    )
                except Exception:
                    pass
                return

            self.is_processing = True
            self._generation_id += 1
            gen_id = self._generation_id

        self.signals.state_changed.emit(ListeningState.PROCESSING)

        thread = threading.Thread(
            target=self._auto_process_audio,
            args=(job_context, tone, speech_s, conf, gen_id, audio),
            daemon=True,
        )
        thread.start()

    def _auto_process_audio(self, job_context: str = "", tone: str = "professional",
                            speech_s: float = 0.0, confidence_threshold: float = None,
                            gen_id: int = 0, audio=None):
        """Background thread: auto-transcribe, classify, and optionally answer."""
        if confidence_threshold is None:
            confidence_threshold = self.confidence_threshold
        try:
            if gen_id and gen_id != self._generation_id:
                return  # cancelled by newer work

            # Prefer pre-snapshotted audio (correct for queued follow-ups)
            if audio is None or (hasattr(audio, "__len__") and len(audio) == 0):
                window_s = speech_window_seconds(
                    speech_s,
                    min_seconds=3.0,
                    max_seconds=float(AUTO_TRANSCRIBE_MAX_SECONDS),
                    pad_seconds=0.75,
                )
                audio = self.capture.get_last_n_seconds(int(window_s + 0.5))

            if audio is None or len(audio) == 0:
                self.signals.status_update.emit("No clip captured — still listening")
                self.signals.state_changed.emit(ListeningState.LISTENING)
                return

            # Transcribe
            self.signals.status_update.emit("Transcribing…")
            text = transcribe_audio(audio)

            if gen_id and gen_id != self._generation_id:
                return

            if not text or not text.strip():
                self.signals.status_update.emit("Couldn't make out words — still listening")
                self.signals.last_heard_update.emit("(no clear speech)", "ignored")
                self.signals.state_changed.emit(ListeningState.LISTENING)
                return

            # Show transcript immediately (live strip)
            self.signals.last_heard_update.emit(text, "")
            self.signals.transcription_ready.emit(text)

            # Soft classify: only skip high-confidence NON-questions
            # (manual path always answered — hard gate was why auto felt broken)
            classification = classify_utterance(text, MIN_WORDS_FOR_CLASSIFICATION)
            question = classification.get("cleaned_question") or text
            is_q = bool(classification.get("is_interview_question", False))
            conf = float(classification.get("confidence", 0.0) or 0.0)

            if (not is_q) and conf >= 0.92:
                self.signals.last_heard_update.emit(text, "ignored")
                self.signals.status_update.emit("Not a question — still listening")
                self.signals.state_changed.emit(ListeningState.LISTENING)
                return

            if is_near_duplicate(question, self._last_answered_fp):
                self.signals.last_heard_update.emit(text, "ignored")
                self.signals.status_update.emit("Same question — still listening")
                self.signals.state_changed.emit(ListeningState.LISTENING)
                return

            # LIVE auto: always generate Best Answer
            self.signals.last_heard_update.emit(text, "answering")
            self.signals.state_changed.emit(ListeningState.GENERATING)
            self.signals.transcription_ready.emit(question)
            self.signals.question_update.emit(question)
            self.signals.answer_clear.emit()
            self.signals.status_update.emit("Writing Best Answer…")
            self._generate_parallel(
                question, job_context=job_context, tone=tone, gen_id=gen_id
            )
            if gen_id and gen_id != self._generation_id:
                return
            self._last_answered_fp = question_fingerprint(question)
            self.signals.answer_done.emit()
            self.signals.state_changed.emit(ListeningState.LISTENING)

        except Exception as e:
            self.signals.error_occurred.emit(_friendly_error(str(e)))
            self.signals.state_changed.emit(ListeningState.LISTENING)
        finally:
            with self._process_lock:
                self.is_processing = False

            # Drain one queued follow-up (if any) — via signal so main thread runs it
            try:
                if not self.question_queue.empty():
                    item = self.question_queue.get_nowait()
                    self.signals.queue_update.emit(self.question_queue.qsize())
                    self.signals.queue_item_ready.emit(item)
            except Exception:
                pass

    def _run_queued_item(self, item: dict):
        """Process one queued utterance after the previous job finishes (main thread)."""
        if not item:
            return
        with self._process_lock:
            if self.is_processing:
                try:
                    self.question_queue.put_nowait(item)
                    self.signals.queue_update.emit(self.question_queue.qsize())
                except Exception:
                    pass
                return
            self.is_processing = True
            self._generation_id += 1
            gen_id = self._generation_id
        self.signals.state_changed.emit(ListeningState.PROCESSING)
        self.last_speech_duration = item.get("speech_s", 0) or 0
        thread = threading.Thread(
            target=self._auto_process_audio,
            args=(
                item.get("job_context", ""),
                item.get("tone", "professional"),
                item.get("speech_s", 0),
                item.get("conf", self.confidence_threshold),
                gen_id,
                item.get("audio"),  # pre-snapshotted clip
            ),
            daemon=True,
        )
        thread.start()

    def _on_get_answer(self):
        """Transcribe recent audio and generate answer."""
        if not self.capture or not self.is_listening:
            return

        self.transcription_box.clear()
        # Clear both answer boxes and reset fonts
        self._on_answer_clear()
        self.answer_btn.setEnabled(False)
        self.focus_answer_btn.setEnabled(False)
        self.listen_btn.setEnabled(False)

        # Snapshot UI values on the main thread (thread-safe)
        job_context = self.job_context_input.text().strip()
        tone = self.tone_combo.currentData() or "professional"

        # Process in background thread
        thread = threading.Thread(
            target=self._process_audio,
            args=(job_context, tone),
            daemon=True,
        )
        thread.start()

    def _process_audio(self, job_context: str = "", tone: str = "professional"):
        """Background thread: transcribe and get answer."""
        try:
            self.signals.status_update.emit("Thinking about what they said…")
            audio = self.capture.get_last_n_seconds(MANUAL_TRANSCRIBE_MAX_SECONDS)

            if len(audio) == 0:
                self.signals.error_occurred.emit(
                    "No sound yet. Press START first, then try again."
                )
                return

            text = transcribe_audio(audio)

            if not text or not text.strip():
                self.signals.error_occurred.emit(
                    "We didn't hear talking. Make sure their voice plays on THIS computer."
                )
                return

            self.signals.transcription_ready.emit(text)

            # Prefer cleaned last question when classifier can help
            classification = classify_utterance(text, MIN_WORDS_FOR_CLASSIFICATION)
            question = classification.get("cleaned_question") or text
            if classification.get("is_interview_question"):
                question = classification.get("cleaned_question", text)

            self.signals.question_update.emit(question)
            self.signals.status_update.emit("Writing words you can say…")
            self._generate_parallel(question, job_context=job_context, tone=tone)

            self.signals.answer_done.emit()

        except Exception as e:
            self.signals.error_occurred.emit(_friendly_error(str(e)))

    def _generate_parallel(self, question: str, job_context: str = None, tone: str = None,
                           gen_id: int = 0):
        """Generate bullet and script responses in parallel (one shared RAG search)."""
        # Prefer caller-provided snapshots; only touch widgets if still needed
        if job_context is None:
            job_context = self.job_context_input.text().strip()
        if tone is None:
            tone = self.tone_combo.currentData() or "professional"

        # Single RAG search — was duplicated by ask_bullet + ask_script (2× embed lag)
        try:
            chunks = search_context(question)
        except Exception as e:
            self.signals.error_occurred.emit(_friendly_error(str(e)))
            chunks = []

        if gen_id and gen_id != self._generation_id:
            return

        def stream_bullets():
            try:
                for token in ask_bullet(question, job_context, context_chunks=chunks):
                    if gen_id and gen_id != self._generation_id:
                        return
                    self.signals.bullet_token.emit(token)
            except Exception as e:
                self.signals.error_occurred.emit(_friendly_error(str(e)))

        def stream_script():
            try:
                for token in ask_script(question, job_context, tone, context_chunks=chunks):
                    if gen_id and gen_id != self._generation_id:
                        return
                    self.signals.script_token.emit(token)
            except Exception as e:
                self.signals.error_occurred.emit(_friendly_error(str(e)))

        with ThreadPoolExecutor(max_workers=2) as executor:
            bullet_future = executor.submit(stream_bullets)
            script_future = executor.submit(stream_script)
            # Wait for both to complete (futures handle exceptions internally)
            bullet_future.result()
            script_future.result()

    def _on_test_audio(self):
        """Test audio capture for 3 seconds."""
        if not self.capture:
            return

        self._set_buttons_enabled(False)
        self.transcription_box.clear()
        self.answer_box.clear()

        thread = threading.Thread(target=self._run_test, daemon=True)
        thread.start()

    def _run_test(self):
        """Background thread: run audio test."""
        import time

        try:
            self.signals.status_update.emit("Testing sound… say something!")
            self.capture.start_capture()

            # Show levels for 3 seconds
            for _ in range(30):
                time.sleep(0.1)
                level = self.capture.get_audio_level()
                self.signals.audio_level.emit(level)

            self.signals.status_update.emit("Checking what we heard…")
            audio = self.capture.stop_capture()

            if len(audio) == 0:
                self.signals.error_occurred.emit("No audio captured - check device")
                return

            text = transcribe_audio(audio)

            if text:
                self.signals.transcription_ready.emit(f"[TEST] {text}")
                self.signals.status_update.emit("Sound works! ✅")
            else:
                self.signals.transcription_ready.emit("[TEST] (no speech detected)")
                self.signals.status_update.emit("We didn't hear words — try again closer to the speaker.")

        except Exception as e:
            self.signals.error_occurred.emit(f"Test failed: {e}")
        finally:
            self.signals.answer_done.emit()

    def _on_transcription_ready(self, text: str):
        """Update transcription box."""
        self.transcription_box.setText(text)

    def _on_answer_done(self):
        """Processing complete."""
        # Shrink fonts to fit content without scrolling
        self.bullet_box.finalize_content()
        self.script_box.finalize_content()
        # Keep "Say this" scrolled to the end so the full answer is visible
        sb = self.script_box.verticalScrollBar()
        sb.setValue(sb.maximum())

        if self.is_listening:
            self.status_label.setText("Done! ✅ Read the green box out loud.")
            self.answer_btn.setEnabled(True)
            self.focus_answer_btn.setEnabled(True)
            self.listen_btn.setEnabled(True)
            # Do NOT zero the live level meter while still listening
        else:
            self.status_label.setText("Ready. Press START when you want help.")
            self._set_buttons_enabled(True)
            self.level_bar.setValue(0)

    def _on_answer_clear(self):
        """Clear answer boxes and reset font (thread-safe via signal)."""
        self.bullet_box.clear()
        self.bullet_box.reset_font()
        self.script_box.clear()
        self.script_box.reset_font()

    def _on_bullet_token(self, token: str):
        """Append token to bullet tips pane."""
        self.bullet_box.moveCursor(QTextCursor.MoveOperation.End)
        self.bullet_box.insertPlainText(token)

    def _on_script_token(self, token: str):
        """Append token to primary 'Say this' pane and follow the stream."""
        self.script_box.moveCursor(QTextCursor.MoveOperation.End)
        self.script_box.insertPlainText(token)
        # Auto-follow streaming text (old code pinned scroll at top — looked frozen)
        sb = self.script_box.verticalScrollBar()
        sb.setValue(sb.maximum())

    def _on_question_update(self, text: str):
        """Update question display label."""
        self.question_display.setText(text)

    def _on_status_update(self, status: str):
        """Update status label."""
        self.status_label.setText(status)

    def _on_audio_level(self, level: float):
        """Update audio level from signal."""
        self.level_bar.setValue(int(level * 100))

    def _on_error(self, message: str):
        """Handle errors with plain-English messages."""
        friendly = _friendly_error(message)
        self.status_label.setText(f"Status: {friendly}")
        if self.is_listening:
            self.answer_btn.setEnabled(True)
            self.focus_answer_btn.setEnabled(True)
            self.listen_btn.setEnabled(True)
        else:
            self._set_buttons_enabled(True)
        self.level_bar.setValue(0)

    def _on_auto_mode_toggled(self, enabled: bool):
        """Handle auto-answer mode toggle."""
        self.auto_answer_enabled = enabled
        self.confidence_slider.setEnabled(enabled)
        if enabled:
            self.state_frame.setStyleSheet("""
                QFrame {
                    background-color: #e8f4fd;
                    border: 1px solid #4a90d9;
                    border-radius: 6px;
                }
            """)
        else:
            self.state_frame.setStyleSheet("""
                QFrame {
                    background-color: #f5f5f5;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                }
            """)

    def _on_confidence_changed(self, value: int):
        """Handle confidence slider change."""
        self.confidence_threshold = value / 100.0
        self.confidence_label.setText(f"{self.confidence_threshold:.2f}")

    def _on_state_changed(self, state: str):
        """Update UI based on listening state."""
        self.current_state = state

        import theme as T
        # Premium live status (large)
        state_config = {
            ListeningState.IDLE: ("○", "Ready", "idle"),
            ListeningState.LISTENING: ("●", "LIVE · Listening", "live"),
            ListeningState.HEARING: ("●", "Hearing question…", "hearing"),
            ListeningState.PROCESSING: ("◐", "Processing…", "processing"),
            ListeningState.GENERATING: ("★", "Writing Best Answer…", "writing"),
        }
        indicator, text, kind = state_config.get(state, ("○", "Ready", "idle"))
        active = kind != "idle"
        color = (
            T.LIVE_GREEN if kind == "live"
            else (T.HD_ORANGE if active else T.TEXT_DIM)
        )

        self.state_indicator.setText(indicator)
        self.state_indicator.setStyleSheet(f"color: {color}; font-size: 18px; font-weight: 800;")
        self.state_text.setText(text)
        self.state_text.setStyleSheet(
            f"color: {color}; font-weight: 800; font-size: 15px; letter-spacing: 0.2px;"
        )
        self.state_frame.setStyleSheet(T.live_status_ss(kind))
        self.focus_state_indicator.setText(indicator)
        self.focus_state_indicator.setStyleSheet(f"color: {color}; font-size: 18px;")

    def _on_last_heard_update(self, text: str, status: str):
        """Update the 'last heard' section."""
        self.last_heard_box.setText(text)
        if status == "ignored":
            self.last_heard_status.setText("That wasn't a question — still listening")
            self.last_heard_status.setStyleSheet("color: #999999; font-style: italic;")
        elif status == "answering":
            self.last_heard_status.setText("Writing words for you to say…")
            self.last_heard_status.setStyleSheet("color: #4a90d9; font-style: italic;")
        elif status == "low_confidence":
            self.last_heard_status.setText("Not sure that was a question — still listening")
            self.last_heard_status.setStyleSheet("color: #d9a54a; font-style: italic;")
        else:
            self.last_heard_status.setText("")

    def _on_queue_update(self, count: int):
        """Update queue indicator."""
        if count > 0:
            self.queue_label.setText(f"📋 {count} queued")
        else:
            self.queue_label.setText("")

    def _toggle_focus_mode(self):
        """Toggle focus mode - show only answer screens."""
        self.focus_mode = not self.focus_mode

        if self.focus_mode:
            # Hide controls and question panel
            self.controls_container.hide()
            self.question_panel.hide()
            self.status_label.hide()
            # Show focus toolbar with Get Answer button and state indicator
            self.focus_toolbar.show()
            self.focus_answer_btn.setEnabled(self.is_listening)
            # Update button appearance
            import theme as T
            self.focus_btn.setText("Exit focus")
            self.focus_btn.setStyleSheet(T.danger_button_ss())
            # Give full space to answer area
            self.content_splitter.setSizes([1, 0])
        else:
            # Show all controls
            self.controls_container.show()
            # Keep transcript panel hidden in copilot theme
            self.question_panel.hide()
            self.status_label.show()
            # Hide focus toolbar
            self.focus_toolbar.hide()
            # Reset button appearance
            import theme as T
            self.focus_btn.setText("Focus")
            self.focus_btn.setStyleSheet(T.ghost_button_ss())
            # Restore splitter sizes
            self.content_splitter.setSizes([480, 160])

    def _toggle_layout(self):
        """Toggle between horizontal and vertical layout."""
        self.horizontal_layout = not self.horizontal_layout
        self._update_layout_orientation()

    def _update_layout_orientation(self):
        """Update splitter orientation based on layout mode.

        content_splitter children: [0]=answer_area (primary), [1]=question_panel
        """
        if self.horizontal_layout:
            self.content_splitter.setOrientation(Qt.Orientation.Horizontal)
            self.layout_toggle_btn.setText("⇔")
            self.layout_toggle_btn.setToolTip("Switch to vertical layout")
            # Was inverted (40% answer / 60% question) — primary answer needs the space
            total_width = max(self.content_splitter.width(), 400)
            self.content_splitter.setSizes([int(total_width * 0.6), int(total_width * 0.4)])
        else:
            self.content_splitter.setOrientation(Qt.Orientation.Vertical)
            self.layout_toggle_btn.setText("⇕")
            self.layout_toggle_btn.setToolTip("Switch to horizontal layout")
            total_height = max(self.content_splitter.height(), 400)
            self.content_splitter.setSizes([int(total_height * 0.6), int(total_height * 0.4)])

    def _deactivate_license(self):
        """Deactivate license and exit app."""
        reply = QMessageBox.question(
            self, "Deactivate License",
            "This will deactivate your license on this machine.\n"
            "You can then activate it on another machine.\n\n"
            "Continue?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        license_key = get_license_key()
        if not license_key:
            QMessageBox.warning(self, "No License", "No license key is currently active.")
            return

        proxy_url = get_proxy_url()
        hw_id = get_hardware_id()
        try:
            base = proxy_url.rsplit("/v1", 1)[0]
            resp = requests.post(
                f"{base}/v1/license/deactivate",
                json={"license_key": license_key, "hardware_id": hw_id},
                timeout=10,
            )
            if resp.status_code == 200:
                clear_license_key()
                QMessageBox.information(self, "Deactivated", "License deactivated. You can activate on another machine.")
                sys.exit(0)
            else:
                error = resp.json().get("detail", {}).get("error", {})
                msg = error.get("message", "Deactivation failed.")
                QMessageBox.warning(self, "Error", msg)
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Could not reach server: {e}")

    def closeEvent(self, event):
        """Clean up on close."""
        if self.is_listening:
            self._stop_listening()
        event.accept()


class AstraApp:
    """Application controller managing screen transitions."""

    def __init__(self):
        self.startup_screen = StartupScreen()
        # Keep class available so re-enabling LICENSE_ENABLED is a one-line flip
        self.activation_screen = LicenseActivationScreen() if LICENSE_ENABLED else None
        self.session_window = None  # Lazy create

        # Connect startup screen signals
        self.startup_screen.ingest_requested.connect(self._on_ingest)
        self.startup_screen.start_session_requested.connect(self._on_start_session)

        # Connect activation screen signals (only when licensing is on)
        if self.activation_screen is not None:
            self.activation_screen.activated.connect(self._on_license_activated)
            self.activation_screen.skipped.connect(self._on_license_skipped)

        # Thread for background ingestion
        self._ingest_thread = None

    def _on_license_activated(self):
        """Handle successful license activation."""
        if self.activation_screen is not None:
            self.activation_screen.hide()
        self.startup_screen.show()

    def _on_license_skipped(self):
        """Handle continue without license."""
        if self.activation_screen is not None:
            self.activation_screen.hide()
        self.startup_screen.show()

    def show(self):
        """Show the appropriate screen based on license state."""
        if not LICENSE_ENABLED:
            # Licensing off — go straight to app
            self.startup_screen.show()
            return
        if get_license_key():
            self.startup_screen.show()
        else:
            self.activation_screen.show()

    def _on_ingest(self):
        """Handle document ingestion request (folder picker + default documents/)."""
        import os
        from PyQt6.QtWidgets import QFileDialog

        # Prefer default documents/ next to the app, but allow choosing any folder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        default_path = os.path.join(script_dir, "documents")
        start_dir = default_path if os.path.isdir(default_path) else script_dir

        documents_path = QFileDialog.getExistingDirectory(
            self.startup_screen,
            "Pick the folder with your resume (PDF or Word text / MD)",
            start_dir,
        )
        if not documents_path:
            # User cancelled — if default folder exists, offer it
            if os.path.isdir(default_path):
                reply = QMessageBox.question(
                    self.startup_screen,
                    "Use the sample folder?",
                    "You didn't pick a folder.\n\n"
                    "Want to use the sample documents that came with Astra?",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                )
                if reply != QMessageBox.StandardButton.Yes:
                    return
                documents_path = default_path
            else:
                self.startup_screen.set_status(
                    "No folder picked. That's OK — you can still press Start!",
                    is_error=False,
                )
                return

        if not os.path.exists(documents_path):
            self.startup_screen.set_status(
                f"Folder not found: {documents_path}",
                is_error=True,
            )
            return

        # Disable buttons during ingestion
        self.startup_screen.set_buttons_enabled(False)
        self.startup_screen.set_status("Scanning documents...")
        self.startup_screen.show_progress_bar(True)
        self.startup_screen.set_progress(0, 100)

        # Create ingestion signals for thread-safe UI updates
        self._ingestion_signals = IngestionSignals()
        self._ingestion_signals.progress.connect(self._on_ingestion_progress)
        self._ingestion_signals.complete.connect(self._on_ingestion_complete)

        # Run ingestion in background thread
        self._ingest_thread = threading.Thread(
            target=self._run_ingestion,
            args=(documents_path,),
            daemon=True
        )
        self._ingest_thread.start()

    def _run_ingestion(self, folder_path: str):
        """Background thread: run document ingestion with progress reporting."""
        from ingest import ingest_folder_with_progress

        def progress_callback(info: dict):
            """Emit progress signal from background thread."""
            self._ingestion_signals.progress.emit(info)

        try:
            result = ingest_folder_with_progress(folder_path, progress_callback)
            self._ingestion_signals.complete.emit(result)
        except Exception as e:
            self._ingestion_signals.complete.emit({
                "success": False,
                "total_files": 0,
                "total_chunks": 0,
                "errors": [str(e)]
            })

    def _on_ingestion_progress(self, info: dict):
        """Handle progress updates from ingestion thread."""
        stage = info.get("stage", "")
        total_files = info.get("total_files", 0)
        current_index = info.get("current_file_index", 0)
        current_name = info.get("current_file_name", "")
        message = info.get("message", "")
        total_chunks = info.get("total_chunks", 0)

        if stage == "scanning":
            self.startup_screen.set_status(message or f"Found {total_files} files")
            self.startup_screen.set_progress(0, max(total_files, 1))
        elif stage == "processing":
            display_index = current_index + 1
            self.startup_screen.set_status(
                f"Processing {current_name} ({display_index} of {total_files})"
            )
            self.startup_screen.set_progress(display_index, max(total_files, 1))
        elif stage == "complete":
            # Was emitted by ingest but never handled — progress bar looked stuck
            self.startup_screen.set_status(
                message or f"Ingestion complete! {total_chunks} chunks added."
            )
            self.startup_screen.set_progress(max(total_files, 1), max(total_files, 1))
        elif stage == "error":
            self.startup_screen.set_status(message or "Ingestion error", is_error=True)

    def _on_ingestion_complete(self, result: dict):
        """Handle ingestion completion."""
        self.startup_screen.set_buttons_enabled(True)
        self.startup_screen.show_progress_bar(False)

        success = result.get("success", False)
        total_chunks = result.get("total_chunks", 0)
        errors = result.get("errors", [])

        if success and not errors:
            message = f"Ingestion complete! {total_chunks} chunks added."
            self.startup_screen.set_status(message)
            QMessageBox.information(
                self.startup_screen,
                "All done!",
                f"Your resume is ready. ✅\n\n{message}\n\nNow press the big green button to start!"
            )
        else:
            error_msg = errors[0] if errors else "Something went wrong"
            self.startup_screen.set_status(f"Oops: {error_msg}", is_error=True)
            QMessageBox.warning(
                self.startup_screen,
                "Couldn't add resume",
                f"Oops — we couldn't read that folder.\n\n{error_msg}"
            )

    def _on_start_session(self):
        """Handle start session request."""
        # Check license only when licensing is enabled
        if LICENSE_ENABLED and not get_license_key():
            self.startup_screen.hide()
            try:
                self.activation_screen.activated.disconnect()
            except TypeError:
                pass
            self.activation_screen.activated.connect(self._on_license_activated_start_session)
            self.activation_screen.show()
            return

        # Create session window if not exists
        if self.session_window is None:
            self.session_window = AstraWindow()

        # Hide startup, show session, auto-start listening (one-click path)
        self.startup_screen.hide()
        self.session_window.show()
        QTimer.singleShot(300, self.session_window._start_listening)

    def _on_license_activated_start_session(self):
        """Handle activation from start session flow -- go directly to session."""
        self.activation_screen.hide()
        # Restore default activated signal connection
        try:
            self.activation_screen.activated.disconnect()
        except TypeError:
            pass
        self.activation_screen.activated.connect(self._on_license_activated)

        # Create session window if not exists
        if self.session_window is None:
            self.session_window = AstraWindow()

        self.session_window.show()
        QTimer.singleShot(300, self.session_window._start_listening)


TEST_UTTERANCES = [
    ("Tell me about a time you led a difficult project", True),
    ("Thanks for joining us today", False),
    ("What's your experience with distributed systems", True),
    ("That's a great answer", False),
    ("Describe a situation where you had to deal with conflict", True),
    ("Can you hear me okay", False),
    ("How would you approach debugging a production issue", True),
    ("Let me tell you about our engineering culture", False),
    ("Walk me through your thought process when designing a new feature", True),
    ("Interesting", False),
    ("Give me an example of when you had to learn something quickly", True),
    ("Let's move on to the next topic", False),
]


def run_classifier_test():
    """Test the interview question classifier."""
    print("=" * 60)
    print("Interview Question Classifier Test")
    print("=" * 60)
    print()

    correct = 0
    total = len(TEST_UTTERANCES)

    for utterance, expected in TEST_UTTERANCES:
        result = classify_utterance(utterance)
        is_question = result["is_interview_question"]
        confidence = result["confidence"]
        q_type = result["question_type"]

        status = "✓" if is_question == expected else "✗"
        if is_question == expected:
            correct += 1

        print(f"{status} \"{utterance[:50]}{'...' if len(utterance) > 50 else ''}\"")
        print(f"   Expected: {'Question' if expected else 'Not question'}")
        print(f"   Got: {'Question' if is_question else 'Not question'} "
              f"(type={q_type}, confidence={confidence:.2f})")
        print()

    print("=" * 60)
    print(f"Results: {correct}/{total} correct ({100*correct/total:.0f}%)")
    print("=" * 60)

    return correct == total


def main():
    parser = argparse.ArgumentParser(description="Astra Interview Copilot")
    parser.add_argument(
        "--test-classifier",
        action="store_true",
        help="Run classifier test instead of GUI"
    )
    args = parser.parse_args()

    if args.test_classifier:
        success = run_classifier_test()
        sys.exit(0 if success else 1)

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    window = AstraWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
