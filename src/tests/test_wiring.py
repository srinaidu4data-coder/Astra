"""
Regression tests for dormant / mis-wired paths.

These assert that critical hooks exist and are connected the way the app expects,
without needing a live Qt event loop display.
"""

import ast
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def _read(name: str) -> str:
    return open(os.path.join(ROOT, name), encoding="utf-8").read()


class TestGuiWiringSource:
    def test_queue_item_ready_signal_declared(self):
        src = _read("gui.py")
        assert "queue_item_ready = pyqtSignal" in src

    def test_queue_item_ready_connected(self):
        src = _read("gui.py")
        assert "queue_item_ready.connect(self._run_queued_item)" in src

    def test_queue_not_using_worker_qtimer(self):
        """QTimer.singleShot from worker was dormant — must not remain for queue drain."""
        src = _read("gui.py")
        # The only singleShot calls should be license/start-session on main thread
        assert "QTimer.singleShot(50, lambda: self._run_queued_item" not in src
        assert "queue_item_ready.emit" in src

    def test_answer_token_routes_to_script(self):
        src = _read("gui.py")
        assert "answer_token.connect(self._on_script_token)" in src

    def test_queued_audio_snapshot(self):
        src = _read("gui.py")
        assert '"audio": audio' in src or "'audio': audio" in src
        assert "item.get(\"audio\")" in src or "item.get('audio')" in src

    def test_ingest_complete_stage_handled(self):
        src = _read("gui.py")
        assert 'stage == "complete"' in src
        assert 'stage == "error"' in src

    def test_script_auto_scroll(self):
        src = _read("gui.py")
        # Old code restored scroll_pos (pinned at top) — must follow stream
        assert "sb.setValue(sb.maximum())" in src or "scrollbar.setValue(scrollbar.maximum())" in src

    def test_layout_prefers_answer_pane(self):
        src = _read("gui.py")
        assert "0.6" in src and "0.4" in src
        # Must not still document inverted 40/60 as answer/question incorrectly
        assert "int(total_width * 0.6)" in src or "total_width * 0.6" in src


class TestBackendWiring:
    def test_classifications_rpm_wired_in_proxy(self):
        src = _read(os.path.join("backend", "proxy.py"))
        assert "RATE_LIMIT_CLASSIFICATIONS_RPM" in src
        assert "classifications" in src

    def test_embeddings_uses_separate_dependency(self):
        src = _read(os.path.join("backend", "proxy.py"))
        assert "check_embeddings_rate_limit" in src


class TestSignalBridgeRuntime:
    def test_signal_bridge_has_queue_item_ready(self):
        # Import gui only if PyQt available
        try:
            from PyQt6.QtWidgets import QApplication
        except ImportError:
            pytest.skip("PyQt6 not installed")
        # QApplication needed for QObject signals on some platforms
        app = QApplication.instance() or QApplication([])
        from gui import SignalBridge
        bridge = SignalBridge()
        assert hasattr(bridge, "queue_item_ready")
        assert hasattr(bridge, "answer_token")
        assert hasattr(bridge, "script_token")
        # Smoke: emit does not crash
        seen = []
        bridge.queue_item_ready.connect(lambda x: seen.append(x))
        bridge.queue_item_ready.emit({"speech_s": 1.5})
        app.processEvents()
        assert seen and seen[0]["speech_s"] == 1.5
