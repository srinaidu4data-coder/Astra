"""Turn state machine, transcript dedupe, stale-event filtering."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_live_cancel_on_new_answer():
    from turn_state import LiveTurnState, TurnStateMachine

    sm = TurnStateMachine(session_id="s1")
    sm.begin_listening()
    t1 = sm.begin_answer(inject=True)
    assert sm.state == LiveTurnState.ANSWER_GENERATING
    assert sm.is_current(t1.generation, t1.turn_id)

    t2 = sm.begin_answer(inject=True)
    assert t2.generation > t1.generation
    assert t1.cancelled or not sm.is_current(t1.generation, t1.turn_id)
    assert sm.is_current(t2.generation, t2.turn_id)


def test_question_finalize_then_answer():
    from turn_state import LiveTurnState, TurnStateMachine

    sm = TurnStateMachine()
    sm.begin_listening()
    t = sm.begin_question_finalize()
    assert sm.state == LiveTurnState.QUESTION_FINALIZING
    assert sm.transition(LiveTurnState.ANSWER_GENERATING)
    sm.mark_answer_done(t.turn_id)
    assert sm.state == LiveTurnState.TURN_COMPLETE


def test_candidate_freeze():
    from turn_state import TurnStateMachine

    sm = TurnStateMachine()
    sm.begin_answer()
    sm.begin_candidate_speaking()
    frozen = sm.freeze_candidate_text("My first answer")
    assert frozen == "My first answer"
    # Late callback must not overwrite
    again = sm.freeze_candidate_text("Late STT overwrite attempt")
    assert again == "My first answer"


def test_interviewer_audio_blocked_during_candidate():
    from turn_state import TurnStateMachine

    sm = TurnStateMachine()
    sm.begin_listening()
    assert sm.accept_interviewer_audio()
    sm.begin_answer()
    sm.begin_candidate_speaking()
    assert not sm.accept_interviewer_audio()
    assert sm.accept_candidate_stt()


def test_mock_skip_speech_drain():
    from turn_state import MockTurnState, MockTurnStateMachine

    m = MockTurnStateMachine()
    tid = m.start_question()
    assert tid
    m.transition(MockTurnState.INTERVIEWER_SPEAKING)
    m.skip_speech()
    assert m.state == MockTurnState.PLAYBACK_DRAINING
    # Immediate enter may fail during drain
    m.drain_until = 0  # force drain complete
    assert m.enter_candidate_ready()
    m.start_candidate()
    text = m.finalize_candidate("spoken answer")
    assert text == "spoken answer"
    assert m.finalize_candidate("should not replace") == "spoken answer"


def test_dedupe_partial_final():
    from turn_state import dedupe_transcript_segments

    out = dedupe_transcript_segments(
        "Tell me about a time you",
        "Tell me about a time you improved month-end close",
    )
    assert "month-end" in out.lower()
    assert out.count("Tell me") == 1


def test_dedupe_exact_previous_final():
    from turn_state import dedupe_transcript_segments

    prev = ["What is your experience with S/4HANA?"]
    out = dedupe_transcript_segments(
        "",
        "What is your experience with S/4HANA?",
        previous_finals=prev,
    )
    assert out == ""


def test_dedupe_stutter():
    from turn_state import dedupe_transcript_segments

    out = dedupe_transcript_segments("", "I I reduced reduced close time")
    assert out == "I reduced close time"


def test_filter_event_stale_generation():
    from turn_state import filter_event_for_turn

    assert filter_event_for_turn(1, "a", 1, "a")
    assert not filter_event_for_turn(1, "a", 2, "b")
    assert not filter_event_for_turn(2, "a", 2, "b")
    assert not filter_event_for_turn(2, "a", 2, "a", cancelled=True)


def test_playback_drain_blocks():
    from turn_state import TurnStateMachine

    sm = TurnStateMachine()
    sm.begin_listening()
    sm.start_playback_drain(ms=500)
    assert sm.in_playback_drain()
    assert not sm.accept_interviewer_audio()

