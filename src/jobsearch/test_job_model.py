"""Leaf module tests — job_model + autofill (no network, no FastAPI)."""

from __future__ import annotations

from jobsearch.autofill import build_autofill_profile, parse_person_name
from jobsearch.job_model import is_synthetic_job


def test_is_synthetic_flag():
    assert is_synthetic_job({"is_synthetic": True}) is True
    assert is_synthetic_job({"source": "seed_market"}) is True
    assert is_synthetic_job({"source": "seed"}) is True
    assert is_synthetic_job({"product_label": "practice"}) is True
    assert is_synthetic_job({"source": "freehire", "is_synthetic": False}) is False
    assert is_synthetic_job(None) is False
    assert is_synthetic_job({}) is False


def test_autofill_splits_name():
    af = build_autofill_profile(
        {
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "skills": ["python", "math"],
            "target_title": "Engineer",
        }
    )
    assert af["schema"] == "astra.autofill.v1"
    assert af["fields"]["first_name"] == "Ada"
    assert af["fields"]["last_name"] == "Lovelace"
    assert af["fields"]["email"] == "ada@example.com"
    assert "python" in af["fields"]["skills"]


def test_autofill_empty_profile_safe():
    af = build_autofill_profile(None)
    assert af["fields"]["full_name"] == "Candidate"
    assert af["fields"]["email"] == ""


def test_autofill_never_puts_email_in_name_fields():
    """UI often sets name=user.email — must not become first_name."""
    af = build_autofill_profile(
        {
            "name": "srinaidu4data@gmail.com",
            "email": "srinaidu4data@gmail.com",
            "phone": "5551234567",
            "location": "us",
        }
    )
    assert "@" not in af["fields"]["first_name"]
    assert "@" not in af["fields"]["full_name"]
    assert af["fields"]["email"] == "srinaidu4data@gmail.com"
    assert af["fields"]["phone"] == "5551234567"
    assert af["fields"]["location"] == "United States"
    assert af["ready"]["can_fill"] is True


def test_parse_person_name_from_email_local():
    first, last, full = parse_person_name(
        {"name": "x@y.com", "email": "jane.doe@corp.com"}
    )
    assert first == "Jane"
    assert last == "Doe"
    assert full == "Jane Doe"


def test_parse_person_name_from_resume_filename():
    first, last, full = parse_person_name(
        {
            "name": "Candidate",
            "email": "srinaidu4data@gmail.com",
            "resume_filename": "Sri_Naidu_SAP_ABAP_HANA_Consultant.docx",
        }
    )
    assert first == "Sri"
    assert last == "Naidu"
    assert full == "Sri Naidu"


def test_autofill_strips_binary_resume_summary():
    """clean_profile used to append RESUME:\\nPK… into summary — must never surface."""
    from jobsearch.agents import _clean_profile

    cleaned = _clean_profile(
        {
            "name": "Candidate",
            "email": "srinaidu4data@gmail.com",
            "resume_filename": "Sri_Naidu_SAP_ABAP_HANA_Consultant.docx",
            "resume_text": "PK\x03\x04binary-zip-garbage",
            "phone": "",
            "target_title": "SAP Consultant",
        }
    )
    af = build_autofill_profile(cleaned)
    assert af["fields"]["first_name"] == "Sri"
    assert af["fields"]["last_name"] == "Naidu"
    assert "PK" not in (af["fields"]["summary"] or "")
    assert "PK" not in (af["fields"]["resume_text"] or "")
    assert af["ready"]["has_resume"] is False
    assert af["fields"]["email"] == "srinaidu4data@gmail.com"


def test_extract_phone_from_resume():
    af = build_autofill_profile(
        {
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "resume_text": "Ada Lovelace\nPhone: +1 (555) 987-6543\nExperience…",
        }
    )
    assert "555" in af["fields"]["phone"]


def test_long_docx_binary_with_content_types_rejected():
    from jobsearch.autofill import looks_like_binary_garbage, sanitize_resume_text

    junk = "PK\x03\x04\x14\x00" + ("x" * 300) + "[Content_Types].xml word/document.xml"
    assert looks_like_binary_garbage(junk) is True
    assert sanitize_resume_text(junk) == ""
