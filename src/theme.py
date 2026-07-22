"""
Final Round AI–style interview copilot chrome, recolored with Home Depot brand.

Home Depot: Orange #F96302 (primary), white, near-black charcoal.
Layout inspired by Final Round Interview Copilot:
  dark stealth panel, question strip, Best Answer card, compact session controls.
"""

# --- Home Depot brand ---
HD_ORANGE = "#F96302"
HD_ORANGE_HOVER = "#E05702"
HD_ORANGE_PRESS = "#C44C00"
HD_ORANGE_SOFT = "#3D2310"       # dark orange tint for chips
HD_ORANGE_GLOW = "rgba(249, 99, 2, 0.25)"

# --- Premium dark surfaces (spacious Final Round–style) ---
BG_APP = "#0B0B0C"
BG_PANEL = "#121214"
BG_CARD = "#1A1A1D"
BG_CARD_ELEVATED = "#222226"
BG_INPUT = "#0F0F11"
BG_STRIP = "#141416"
BORDER = "#2A2A2E"
BORDER_SOFT = "#333338"
TEXT = "#F4F4F5"
TEXT_SECONDARY = "#D4D4D8"
TEXT_MUTED = "#A1A1AA"
TEXT_DIM = "#71717A"
SUCCESS = "#22C55E"
LIVE_GREEN = "#22C55E"
LIVE_GREEN_SOFT = "rgba(34, 197, 94, 0.15)"
WARNING = "#EAB308"
DANGER = "#EF4444"

FONT = "Segoe UI"


def app_stylesheet() -> str:
    return f"""
    QWidget {{
        background-color: {BG_APP};
        color: {TEXT};
        font-family: "{FONT}";
    }}
    QMainWindow, QDialog {{
        background-color: {BG_APP};
    }}
    QLabel {{
        background: transparent;
        color: {TEXT};
    }}
    QLineEdit, QTextEdit, QPlainTextEdit {{
        background-color: {BG_INPUT};
        color: {TEXT};
        border: 1px solid {BORDER};
        border-radius: 10px;
        padding: 10px 12px;
        selection-background-color: {HD_ORANGE};
        selection-color: white;
    }}
    QLineEdit:focus, QTextEdit:focus {{
        border: 1px solid {HD_ORANGE};
    }}
    QComboBox {{
        background-color: {BG_INPUT};
        color: {TEXT};
        border: 1px solid {BORDER};
        border-radius: 8px;
        padding: 8px 10px;
    }}
    QComboBox::drop-down {{ border: none; width: 24px; }}
    QComboBox QAbstractItemView {{
        background-color: {BG_CARD};
        color: {TEXT};
        selection-background-color: {HD_ORANGE};
        border: 1px solid {BORDER};
    }}
    QCheckBox {{ color: {TEXT_MUTED}; spacing: 8px; }}
    QCheckBox::indicator {{
        width: 16px; height: 16px;
        border-radius: 4px;
        border: 1px solid {BORDER_SOFT};
        background: {BG_INPUT};
    }}
    QCheckBox::indicator:checked {{
        background: {HD_ORANGE};
        border-color: {HD_ORANGE};
    }}
    QProgressBar {{
        border: none;
        border-radius: 4px;
        background: {BG_INPUT};
        max-height: 6px;
        min-height: 6px;
        text-align: center;
    }}
    QProgressBar::chunk {{
        border-radius: 4px;
        background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
            stop:0 {HD_ORANGE}, stop:1 #FF8A3D);
    }}
    QSlider::groove:horizontal {{
        height: 4px; background: {BORDER}; border-radius: 2px;
    }}
    QSlider::handle:horizontal {{
        width: 14px; margin: -6px 0; border-radius: 7px;
        background: {HD_ORANGE};
    }}
    QScrollBar:vertical {{
        background: {BG_PANEL}; width: 8px; margin: 0;
    }}
    QScrollBar::handle:vertical {{
        background: {BORDER_SOFT}; border-radius: 4px; min-height: 24px;
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    QSplitter::handle {{ background: {BORDER}; }}
    QToolTip {{
        background: {BG_CARD}; color: {TEXT};
        border: 1px solid {BORDER}; padding: 6px;
    }}
    """


def primary_button_ss() -> str:
    return f"""
    QPushButton {{
        background-color: {HD_ORANGE};
        color: white;
        border: none;
        border-radius: 12px;
        font-weight: 700;
        padding: 12px 18px;
    }}
    QPushButton:hover {{ background-color: {HD_ORANGE_HOVER}; }}
    QPushButton:pressed {{ background-color: {HD_ORANGE_PRESS}; }}
    QPushButton:disabled {{ background-color: #4A4A4A; color: #888; }}
    """


def secondary_button_ss() -> str:
    return f"""
    QPushButton {{
        background-color: {BG_CARD};
        color: {TEXT};
        border: 1px solid {BORDER_SOFT};
        border-radius: 12px;
        font-weight: 600;
        padding: 12px 18px;
    }}
    QPushButton:hover {{
        border-color: {HD_ORANGE};
        color: {HD_ORANGE};
    }}
    QPushButton:disabled {{ color: #666; border-color: #333; }}
    """


def ghost_button_ss() -> str:
    return f"""
    QPushButton {{
        background: transparent;
        color: {TEXT_MUTED};
        border: none;
        border-radius: 8px;
        padding: 6px 10px;
    }}
    QPushButton:hover {{ color: {HD_ORANGE}; background: {HD_ORANGE_GLOW}; }}
    """


def danger_button_ss() -> str:
    return f"""
    QPushButton {{
        background-color: #3A1515;
        color: #FCA5A5;
        border: 1px solid #7F1D1D;
        border-radius: 10px;
        padding: 8px 12px;
    }}
    QPushButton:hover {{ background-color: #4A1C1C; }}
    """


def card_ss() -> str:
    return f"""
    QFrame {{
        background-color: {BG_CARD};
        border: 1px solid {BORDER};
        border-radius: 14px;
    }}
    """


def best_answer_card_ss() -> str:
    return f"""
    QFrame {{
        background-color: {BG_CARD};
        border: 1px solid {HD_ORANGE};
        border-radius: 14px;
    }}
    """


def status_pill_ss(active: bool = False) -> str:
    if active:
        return f"""
        QFrame {{
            background-color: {HD_ORANGE_SOFT};
            border: 1px solid {HD_ORANGE};
            border-radius: 22px;
            min-height: 40px;
            padding: 4px 8px;
        }}
        """
    return f"""
    QFrame {{
        background-color: {BG_CARD};
        border: 1px solid {BORDER};
        border-radius: 22px;
        min-height: 40px;
        padding: 4px 8px;
    }}
    """


def live_status_ss(kind: str = "idle") -> str:
    """kind: idle | live | hearing | writing"""
    if kind == "live":
        bg, border = LIVE_GREEN_SOFT, LIVE_GREEN
    elif kind in ("hearing", "writing", "processing"):
        bg, border = HD_ORANGE_GLOW, HD_ORANGE
    else:
        bg, border = BG_CARD, BORDER
    return f"""
    QFrame {{
        background-color: {bg};
        border: 1px solid {border};
        border-radius: 22px;
        min-height: 42px;
        padding: 6px 14px;
    }}
    """


def transcript_strip_ss() -> str:
    return f"""
    QTextEdit {{
        background-color: {BG_STRIP};
        color: {TEXT_MUTED};
        border: 1px solid {BORDER};
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 12px;
    }}
    """


def best_answer_body_ss() -> str:
    return f"""
    QTextEdit {{
        background-color: {BG_CARD_ELEVATED};
        color: {TEXT};
        border: 1px solid {HD_ORANGE};
        border-radius: 16px;
        padding: 18px 20px;
        font-size: 15px;
        selection-background-color: {HD_ORANGE};
    }}
    """
