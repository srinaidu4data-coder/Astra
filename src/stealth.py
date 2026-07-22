"""
Stealth / screen-share hide for Windows (Final Round / Parakeet style).

Uses SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) so the window
does not appear in most screen captures, Zoom/Meet share, and Win+G.
Requires Windows 10 2004+ (build 19041+) for EXCLUDEFROMCAPTURE.
"""

from __future__ import annotations

import sys
from typing import Any


WDA_NONE = 0x00000000
WDA_MONITOR = 0x00000001
WDA_EXCLUDEFROMCAPTURE = 0x00000011  # hide from capture (Win10 2004+)


def _hwnd_from_widget(widget: Any) -> int:
    """Qt widget -> native HWND."""
    wid = int(widget.winId())
    return wid


def set_exclude_from_capture(widget: Any, enabled: bool) -> bool:
    """
    Hide (or show) a Qt window in screen capture / share.

    Returns True if the API call reported success.
    """
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        hwnd = _hwnd_from_widget(widget)
        affinity = WDA_EXCLUDEFROMCAPTURE if enabled else WDA_NONE
        ok = ctypes.windll.user32.SetWindowDisplayAffinity(hwnd, affinity)
        return bool(ok)
    except Exception as e:
        print(f"[stealth] SetWindowDisplayAffinity failed: {e}")
        return False


def is_stealth_supported() -> bool:
    return sys.platform == "win32"
