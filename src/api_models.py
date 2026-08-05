#!/usr/bin/env python3
"""
HTTP / WebSocket request models for the copilot API.

Kept separate from route handlers so copilot_api.py stays focused on wiring.
Public JSON field names are stable — do not rename without a migration plan.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AnswerRequest(BaseModel):
    question: str
    job_context: str = ""
    tone: str = "confident"
    mode: str = Field(default="star", description="star | shorter | technical | code")
    # Optional overrides (validated against ALLOWED_MODELS); else per-user / global defaults
    answer_model: Optional[str] = None
    fallback_model: Optional[str] = None
    depth: Optional[str] = Field(
        default=None, description="fast | balanced | deep — latency vs quality"
    )


class SessionContextRequest(BaseModel):
    role: Optional[str] = None
    company: Optional[str] = None
    seniority: Optional[str] = None
    interview_type: Optional[str] = None
    job_description: Optional[str] = None
    resume_text: Optional[str] = None
    stories: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    depth: Optional[str] = None
    outline_first: Optional[bool] = None
    clear: bool = False


class InjectQuestionRequest(BaseModel):
    question: str
    job_context: str = ""
    tone: str = "confident"
    mode: str = "star"
    depth: Optional[str] = None


class FileRunRequest(BaseModel):
    path: Optional[str] = None
    max_questions: int = 3
    job_context: str = ""
    tone: str = "confident"
    mode: str = "star"
    min_segment_sec: float = 1.5
    silence_ms: int = 900
    silence_threshold: float = 0.012
