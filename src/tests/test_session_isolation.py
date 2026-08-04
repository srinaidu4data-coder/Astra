"""Per-connection session pack isolation (multi-user support)."""

from __future__ import annotations


def test_two_sessions_do_not_share_role():
    from session_context import (
        clear_pack,
        drop_session,
        get_pack,
        session_scope,
        update_pack,
    )

    drop_session("sess_a")
    drop_session("sess_b")
    with session_scope("sess_a"):
        clear_pack()
        update_pack(role="Role A", job_description="JD A")
        assert get_pack().role == "Role A"
    with session_scope("sess_b"):
        clear_pack()
        update_pack(role="Role B")
        assert get_pack().role == "Role B"
        assert "JD A" not in (get_pack().job_description or "")
    with session_scope("sess_a"):
        assert get_pack().role == "Role A"
    drop_session("sess_a")
    drop_session("sess_b")


def test_empty_role_stays_empty_in_session():
    from session_context import clear_pack, drop_session, get_pack, session_scope, update_pack

    drop_session("sess_empty")
    with session_scope("sess_empty"):
        clear_pack()
        update_pack(role="Sticky")
        update_pack(role="")
        assert get_pack().role == ""
    drop_session("sess_empty")
