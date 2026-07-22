#!/usr/bin/env python3
"""
Astra Interview Copilot - Main Entry Point

Usage:
    python main.py                      Launch the GUI (starts at startup screen)
    python main.py --ingest ./docs/     Ingest documents then exit
"""

import argparse
import logging
import os
import sys


def _setup_crash_log():
    """Redirect stderr to a log file when running as a frozen PyInstaller exe."""
    if getattr(sys, 'frozen', False):
        from platformdirs import user_data_dir
        log_dir = user_data_dir("astra", ensure_exists=True)
        log_path = os.path.join(log_dir, "crash.log")
        logging.basicConfig(
            filename=log_path,
            level=logging.DEBUG,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
        # Also redirect stderr so uncaught exceptions go to the file
        sys.stderr = open(log_path, "a")
        logging.info("Astra starting (frozen exe)")


def run_ingestion(folder_path: str) -> None:
    """Run the document ingestion process."""
    from ingest import ingest_folder
    ingest_folder(folder_path)


def launch_gui() -> None:
    """Launch the PyQt6 GUI application with startup screen."""
    from PyQt6.QtWidgets import QApplication, QLabel, QVBoxLayout, QWidget
    from PyQt6.QtCore import Qt

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    try:
        import theme as T
        app.setStyleSheet(T.app_stylesheet())
        splash_bg, splash_fg, splash_muted, splash_orange = (
            T.BG_APP, T.TEXT, T.TEXT_MUTED, T.HD_ORANGE
        )
    except Exception:
        splash_bg, splash_fg, splash_muted, splash_orange = (
            "#0E0E0E", "#F5F5F5", "#A3A3A3", "#F96302"
        )

    # Splash so first launch (Whisper load) doesn't look frozen
    splash = QWidget()
    splash.setWindowTitle("Astra")
    splash.setFixedSize(380, 160)
    splash.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
    splash.setStyleSheet(f"background-color: {splash_bg}; border-radius: 12px;")
    splash_layout = QVBoxLayout(splash)
    title = QLabel("Astra Interview Copilot")
    title.setAlignment(Qt.AlignmentFlag.AlignCenter)
    title.setStyleSheet(
        f"font-size: 17px; font-weight: 800; color: {splash_fg}; font-family: 'Segoe UI';"
    )
    accent = QLabel("●")
    accent.setAlignment(Qt.AlignmentFlag.AlignCenter)
    accent.setStyleSheet(f"color: {splash_orange}; font-size: 14px;")
    status = QLabel("Loading speech model… first launch can take a minute")
    status.setAlignment(Qt.AlignmentFlag.AlignCenter)
    status.setStyleSheet(f"font-size: 11px; color: {splash_muted}; font-family: 'Segoe UI';")
    status.setWordWrap(True)
    splash_layout.addWidget(title)
    splash_layout.addWidget(accent)
    splash_layout.addWidget(status)
    splash.show()
    app.processEvents()

    # Pre-load Whisper on main thread to avoid onnxruntime threading issues
    try:
        from transcriber import get_whisper_model
        get_whisper_model()
        status.setText("Almost ready…")
        app.processEvents()
    except Exception as e:
        status.setText(f"Speech model load issue: {e}\nYou can still try to continue.")
        app.processEvents()

    from gui import AstraApp

    astra_app = AstraApp()
    astra_app.show()
    splash.close()

    sys.exit(app.exec())


def main():
    _setup_crash_log()

    parser = argparse.ArgumentParser(
        description="Astra Interview Copilot",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main.py                      Launch the interview copilot GUI
    python main.py --ingest ./docs/     Ingest documents from a folder
        """
    )
    parser.add_argument(
        "--ingest",
        metavar="FOLDER",
        type=str,
        help="Ingest documents from the specified folder"
    )

    args = parser.parse_args()

    # Handle ingestion mode
    if args.ingest:
        print("Starting document ingestion...")
        run_ingestion(args.ingest)
        print("\nIngestion complete. You can now run: python main.py")
        return

    # Launch GUI with startup screen
    print("Starting Astra Interview Copilot...")
    try:
        launch_gui()
    except Exception:
        logging.exception("Fatal error during startup")
        raise


if __name__ == "__main__":
    main()
