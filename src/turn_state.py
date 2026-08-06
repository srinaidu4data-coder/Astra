#!/usr/bin/env python3
"""
Interview turn state machine — prevents interviewer/candidate audio cross-contamination
and stale stream events from writing into the wrong answer.

Live path states:
  IDLE → INTERVIEWER_LISTENING → QUESTION_FINALIZING → ANSWER_GENERATING
       → CANDIDATE_SPEAKING → TURN_COMPLETE → (back to INTERVIEWER_LISTENING)
  Any → RECONNECTING | ERROR

Mock TTS path states:
  INTERVIEWER_PREPARING → INTERVIEWER_SPEAKING → PLAYBACK_DRAINING
  → CANDIDATE_READY → CANDIDATE_SPEAKING → CANDIDATE_FINALIZING → SCORING
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class LiveTurnState(str, Enum):
    IDLE = "IDLE"
    INTERVIEWER_LISTENING = "INTERVIEWER_LISTENING"
    QUESTION_FINALIZING = "QUESTION_FINALIZING"
    ANSWER_GENERATING = "ANSWER_GENERATING"
    CANDIDATE_SPEAKING = "CANDIDATE_SPEAKING"
    TURN_COMPLETE = "TURN_COMPLETE"
    RECONNECTING = "RECONNECTING"
    ERROR = "ERROR"


class MockTurnState(str, Enum):
    IDLE = "IDLE"
    INTERVIEWER_PREPARING = "INTERVIEWER_PREPARING"
    INTERVIEWER_SPEAKING = "INTERVIEWER_SPEAKING"
    PLAYBACK_DRAINING = "PLAYBACK_DRAINING"
    CANDIDATE_READY = "CANDIDATE_READY"
    CANDIDATE_SPEAKING = "CANDIDATE_SPEAKING"
    CANDIDATE_FINALIZING = "CANDIDATE_FINALIZING"
    SCORING = "SCORING"
    ERROR = "ERROR"


# Allowed transitions (from → set of to)
_LIVE_TRANSITIONS: dict[LiveTurnState, set[LiveTurnState]] = {
    LiveTurnState.IDLE: {
        LiveTurnState.INTERVIEWER_LISTENING,
        LiveTurnState.RECONNECTING,
        LiveTurnState.ERROR,
    },
    LiveTurnState.INTERVIEWER_LISTENING: {
        LiveTurnState.QUESTION_FINALIZING,
        LiveTurnState.ANSWER_GENERATING,  # typed inject
        LiveTurnState.IDLE,
        LiveTurnState.RECONNECTING,
        LiveTurnState.ERROR,
    },
    LiveTurnState.QUESTION_FINALIZING: {
        LiveTurnState.ANSWER_GENERATING,
        LiveTurnState.INTERVIEWER_LISTENING,  # chatter / incomplete
        LiveTurnState.ERROR,
    },
    LiveTurnState.ANSWER_GENERATING: {
        LiveTurnState.CANDIDATE_SPEAKING,
        LiveTurnState.TURN_COMPLETE,
        LiveTurnState.ANSWER_GENERATING,  # cancel → new gen same state, new turn
        LiveTurnState.INTERVIEWER_LISTENING,  # cancelled, resume listen
        LiveTurnState.ERROR,
    },
    LiveTurnState.CANDIDATE_SPEAKING: {
        LiveTurnState.TURN_COMPLETE,
        LiveTurnState.INTERVIEWER_LISTENING,
        LiveTurnState.ERROR,
    },
    LiveTurnState.TURN_COMPLETE: {
        LiveTurnState.INTERVIEWER_LISTENING,
        LiveTurnState.IDLE,
        LiveTurnState.ANSWER_GENERATING,  # rapid follow-up
    },
    LiveTurnState.RECONNECTING: {
        LiveTurnState.INTERVIEWER_LISTENING,
        LiveTurnState.IDLE,
        LiveTurnState.ERROR,
    },
    LiveTurnState.ERROR: {
        LiveTurnState.IDLE,
        LiveTurnState.INTERVIEWER_LISTENING,
        LiveTurnState.RECONNECTING,
    },
}

_MOCK_TRANSITIONS: dict[MockTurnState, set[MockTurnState]] = {
    MockTurnState.IDLE: {MockTurnState.INTERVIEWER_PREPARING, MockTurnState.ERROR},
    MockTurnState.INTERVIEWER_PREPARING: {
        MockTurnState.INTERVIEWER_SPEAKING,
        MockTurnState.ERROR,
        MockTurnState.IDLE,
    },
    MockTurnState.INTERVIEWER_SPEAKING: {
        MockTurnState.PLAYBACK_DRAINING,
        MockTurnState.CANDIDATE_READY,  # skip speech
        MockTurnState.ERROR,
        MockTurnState.IDLE,
    },
    MockTurnState.PLAYBACK_DRAINING: {
        MockTurnState.CANDIDATE_READY,
        MockTurnState.ERROR,
    },
    MockTurnState.CANDIDATE_READY: {
        MockTurnState.CANDIDATE_SPEAKING,
        MockTurnState.INTERVIEWER_PREPARING,  # skip answer
        MockTurnState.ERROR,
    },
    MockTurnState.CANDIDATE_SPEAKING: {
        MockTurnState.CANDIDATE_FINALIZING,
        MockTurnState.ERROR,
    },
    MockTurnState.CANDIDATE_FINALIZING: {
        MockTurnState.SCORING,
        MockTurnState.INTERVIEWER_PREPARING,
        MockTurnState.ERROR,
    },
    MockTurnState.SCORING: {
        MockTurnState.INTERVIEWER_PREPARING,
        MockTurnState.IDLE,
        MockTurnState.ERROR,
    },
    MockTurnState.ERROR: {MockTurnState.IDLE, MockTurnState.INTERVIEWER_PREPARING},
}


@dataclass
class TurnContext:
    """One answer turn — all STT/audio/stream events must carry these IDs."""

    session_id: str
    turn_id: str
    request_id: str
    generation: int
    sequence: int = 0
    role_focus: str = "interviewer"  # interviewer | candidate | system
    created_at: float = field(default_factory=time.time)
    cancelled: bool = False
    frozen_candidate_text: str = ""

    def next_seq(self) -> int:
        self.sequence += 1
        return self.sequence

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "turn_id": self.turn_id,
            "request_id": self.request_id,
            "generation": self.generation,
            "sequence": self.sequence,
            "role_focus": self.role_focus,
            "cancelled": self.cancelled,
        }


class TurnStateMachine:
    """Thread-safe live interview turn coordinator."""

    def __init__(self, session_id: str = "") -> None:
        self._lock = threading.RLock()
        self.session_id = session_id or uuid.uuid4().hex[:12]
        self.state: LiveTurnState = LiveTurnState.IDLE
        self.generation = 0
        self.active_turn: Optional[TurnContext] = None
        self._history: list[str] = []  # recent turn_ids
        self.playback_drain_until: float = 0.0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "session_id": self.session_id,
                "state": self.state.value,
                "generation": self.generation,
                "active_turn": self.active_turn.to_dict() if self.active_turn else None,
                "playback_drain_active": time.time() < self.playback_drain_until,
            }

    def can_transition(self, to: LiveTurnState) -> bool:
        with self._lock:
            allowed = _LIVE_TRANSITIONS.get(self.state, set())
            return to in allowed or to == self.state

    def transition(self, to: LiveTurnState, *, force: bool = False) -> bool:
        with self._lock:
            if not force and to not in _LIVE_TRANSITIONS.get(self.state, set()) and to != self.state:
                return False
            self.state = to
            return True

    def begin_listening(self) -> None:
        with self._lock:
            self.state = LiveTurnState.INTERVIEWER_LISTENING

    def begin_question_finalize(self) -> TurnContext:
        """End-of-speech detected — new turn for this question."""
        with self._lock:
            self._cancel_active_unlocked()
            self.generation += 1
            turn = TurnContext(
                session_id=self.session_id,
                turn_id=uuid.uuid4().hex[:12],
                request_id=uuid.uuid4().hex[:12],
                generation=self.generation,
                role_focus="interviewer",
            )
            self.active_turn = turn
            self.state = LiveTurnState.QUESTION_FINALIZING
            self._history.append(turn.turn_id)
            self._history = self._history[-32:]
            return turn

    def begin_answer(self, *, inject: bool = False) -> TurnContext:
        """Start answer generation; cancels any in-flight turn."""
        with self._lock:
            self._cancel_active_unlocked()
            self.generation += 1
            turn = TurnContext(
                session_id=self.session_id,
                turn_id=uuid.uuid4().hex[:12],
                request_id=uuid.uuid4().hex[:12],
                generation=self.generation,
                role_focus="interviewer",
            )
            self.active_turn = turn
            self.state = LiveTurnState.ANSWER_GENERATING
            self._history.append(turn.turn_id)
            self._history = self._history[-32:]
            return turn

    def mark_answer_done(self, turn_id: str = "") -> None:
        with self._lock:
            if self.active_turn and turn_id and self.active_turn.turn_id != turn_id:
                return  # stale completion
            if self.active_turn:
                self.active_turn.role_focus = "candidate"
            self.state = LiveTurnState.TURN_COMPLETE

    def begin_candidate_speaking(self, freeze_text: str = "") -> None:
        with self._lock:
            self.state = LiveTurnState.CANDIDATE_SPEAKING
            if self.active_turn:
                self.active_turn.role_focus = "candidate"
                if freeze_text:
                    self.active_turn.frozen_candidate_text = freeze_text

    def freeze_candidate_text(self, text: str) -> str:
        """Freeze submitted candidate text; later STT callbacks must not mutate it."""
        with self._lock:
            if self.active_turn:
                if self.active_turn.frozen_candidate_text:
                    return self.active_turn.frozen_candidate_text
                self.active_turn.frozen_candidate_text = text or ""
                return self.active_turn.frozen_candidate_text
            return text or ""

    def start_playback_drain(self, ms: float = 250.0) -> None:
        """Guard after mock interviewer TTS before enabling candidate mic."""
        with self._lock:
            self.playback_drain_until = time.time() + max(0.0, ms) / 1000.0

    def in_playback_drain(self) -> bool:
        return time.time() < self.playback_drain_until

    def accept_interviewer_audio(self) -> bool:
        """Whether interviewer STT/audio chunks should be processed."""
        with self._lock:
            if self.in_playback_drain():
                return False
            if self.state in (
                LiveTurnState.CANDIDATE_SPEAKING,
                LiveTurnState.ERROR,
            ):
                return False
            # During answer generation, still accept for next-Q detection but
            # STT partials should not rewrite the frozen answer question.
            return self.state in (
                LiveTurnState.IDLE,
                LiveTurnState.INTERVIEWER_LISTENING,
                LiveTurnState.QUESTION_FINALIZING,
                LiveTurnState.ANSWER_GENERATING,
                LiveTurnState.TURN_COMPLETE,
                LiveTurnState.RECONNECTING,
            )

    def accept_candidate_stt(self) -> bool:
        with self._lock:
            return self.state in (
                LiveTurnState.CANDIDATE_SPEAKING,
                LiveTurnState.TURN_COMPLETE,
            )

    def is_current(self, generation: int, turn_id: str = "") -> bool:
        with self._lock:
            if generation != self.generation:
                return False
            if turn_id and self.active_turn and self.active_turn.turn_id != turn_id:
                return False
            if self.active_turn and self.active_turn.cancelled:
                return False
            return True

    def cancel_active(self) -> int:
        """Cancel in-flight turn; returns new generation."""
        with self._lock:
            self._cancel_active_unlocked()
            self.generation += 1
            return self.generation

    def _cancel_active_unlocked(self) -> None:
        if self.active_turn:
            self.active_turn.cancelled = True
            self.active_turn = None

    def reset(self) -> None:
        with self._lock:
            self._cancel_active_unlocked()
            self.state = LiveTurnState.IDLE
            self.generation += 1
            self.playback_drain_until = 0.0


class MockTurnStateMachine:
    """Mock interview TTS / mic separation."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.state = MockTurnState.IDLE
        self.turn_id = ""
        self.generation = 0
        self.frozen_candidate = ""
        self.drain_until = 0.0

    def transition(self, to: MockTurnState, *, force: bool = False) -> bool:
        with self._lock:
            if not force and to not in _MOCK_TRANSITIONS.get(self.state, set()):
                return False
            self.state = to
            return True

    def start_question(self) -> str:
        with self._lock:
            self.generation += 1
            self.turn_id = uuid.uuid4().hex[:12]
            self.frozen_candidate = ""
            self.state = MockTurnState.INTERVIEWER_PREPARING
            return self.turn_id

    def skip_speech(self) -> None:
        """Skip interviewer TTS → candidate ready after short drain."""
        with self._lock:
            self.state = MockTurnState.PLAYBACK_DRAINING
            self.drain_until = time.time() + 0.2

    def finish_playback(self) -> None:
        with self._lock:
            self.state = MockTurnState.PLAYBACK_DRAINING
            self.drain_until = time.time() + 0.25

    def enter_candidate_ready(self) -> bool:
        with self._lock:
            if time.time() < self.drain_until:
                return False
            self.state = MockTurnState.CANDIDATE_READY
            return True

    def start_candidate(self) -> None:
        with self._lock:
            self.state = MockTurnState.CANDIDATE_SPEAKING

    def finalize_candidate(self, text: str) -> str:
        with self._lock:
            if self.frozen_candidate:
                return self.frozen_candidate
            self.frozen_candidate = (text or "").strip()
            self.state = MockTurnState.CANDIDATE_FINALIZING
            return self.frozen_candidate

    def accept_candidate_partial(self) -> bool:
        with self._lock:
            return self.state == MockTurnState.CANDIDATE_SPEAKING and not self.frozen_candidate

    def accept_interviewer_tts(self) -> bool:
        with self._lock:
            return self.state in (
                MockTurnState.INTERVIEWER_PREPARING,
                MockTurnState.INTERVIEWER_SPEAKING,
            )

    def is_current(self, turn_id: str, generation: int) -> bool:
        with self._lock:
            return turn_id == self.turn_id and generation == self.generation


# ---------------------------------------------------------------------------
# Transcript segment deduplication
# ---------------------------------------------------------------------------


def dedupe_transcript_segments(
    partial: str,
    final: str,
    *,
    previous_finals: Optional[list[str]] = None,
) -> str:
    """
    Collapse overlapping partial/final STT segments into one clean final.

    Rules:
    - Prefer final over partial when final is a prefix extension of partial.
    - Drop exact duplicates of recent finals.
    - Strip repeated consecutive word runs from stream glitches.
    """
    p = (partial or "").strip()
    f = (final or "").strip()
    chosen = f or p
    if not chosen:
        return ""

    # If final is contained in partial (or vice versa), take the longer
    if p and f:
        pl, fl = p.lower(), f.lower()
        if pl in fl or fl.startswith(pl) or pl.startswith(fl):
            chosen = f if len(f) >= len(p) else p
        elif fl in pl:
            chosen = p

    prev = previous_finals or []
    for old in prev[-5:]:
        if not old:
            continue
        if chosen.lower() == old.lower():
            return ""  # exact dup
        # Near-identical: one is prefix of the other with small delta
        a, b = chosen.lower(), old.lower()
        if a.startswith(b) and len(a) - len(b) < 12:
            return chosen  # extension of old — keep
        if b.startswith(a) and len(b) - len(a) < 12:
            return ""  # older is longer — drop short late partial

    # Collapse "word word" stutter
    words = chosen.split()
    out: list[str] = []
    for w in words:
        if out and out[-1].lower() == w.lower():
            continue
        out.append(w)
    return " ".join(out).strip()


def filter_event_for_turn(
    event_generation: int,
    event_turn_id: str,
    current_generation: int,
    current_turn_id: str,
    *,
    cancelled: bool = False,
) -> bool:
    """Return True if the event should be applied to UI/state."""
    if cancelled:
        return False
    if event_generation != current_generation:
        return False
    if current_turn_id and event_turn_id and event_turn_id != current_turn_id:
        return False
    return True

