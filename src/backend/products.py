"""Configurable product catalog for Interview Sprint monetization.

Prices/limits come from environment variables (and optional DB overrides later).
Never hardcode prices in the UI — clients always fetch /v1/billing/products.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from typing import Any, Literal

from backend.config import settings

PlanCode = Literal[
    "free_diagnostic",
    "interview_pass",
    "interview_sprint",
    "pro_monthly",
    "premium_pack",
]


@dataclass(frozen=True)
class ProductDef:
    code: str
    name: str
    description: str
    price_cents: int
    currency: str
    billing_mode: str  # subscription | payment | free
    stripe_price_id: str
    duration_hours: int | None  # None = subscription period
    live_minutes: int  # 0 = none, -1 = unlimited
    max_opportunities: int  # concurrent active opportunities
    unlimited_mocks: bool
    features: list[str]
    sort_order: int
    active: bool = True

    def public_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["price_display"] = (
            "Free"
            if self.price_cents <= 0
            else f"${self.price_cents / 100:.0f}"
            + ("/mo" if self.billing_mode == "subscription" else "")
        )
        # Never expose raw secrets; stripe price id is ok for checkout mapping server-side only
        d.pop("stripe_price_id", None)
        d["purchasable"] = bool(
            self.active
            and (
                self.billing_mode == "free"
                or (self.stripe_price_id and settings.STRIPE_SECRET_KEY.strip())
            )
        )
        return d


def _env_int(key: str, default: int) -> int:
    raw = (os.environ.get(key) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_str(key: str, default: str = "") -> str:
    return (os.environ.get(key) or getattr(settings, key, None) or default or "").strip()


def product_catalog() -> list[ProductDef]:
    """Build catalog from env. Stripe price IDs optional until configured."""
    return [
        ProductDef(
            code="free_diagnostic",
            name="Free Diagnostic",
            description="Opportunity match score, 5 likely questions, 3 gaps, one answer preview.",
            price_cents=0,
            currency="usd",
            billing_mode="free",
            stripe_price_id="",
            duration_hours=None,
            live_minutes=0,
            max_opportunities=1,
            unlimited_mocks=False,
            features=[
                "match_score",
                "preview_questions",
                "gap_summary",
                "one_answer_preview",
            ],
            sort_order=0,
        ),
        ProductDef(
            code="interview_pass",
            name="Interview Pass",
            description="One opportunity · 72 hours · 120 live minutes · full Twin prep.",
            price_cents=_env_int("PRICE_INTERVIEW_PASS_CENTS", 1900),
            currency="usd",
            billing_mode="payment",
            stripe_price_id=_env_str(
                "STRIPE_PRICE_INTERVIEW_PASS",
                getattr(settings, "STRIPE_PRICE_INTERVIEW_PASS", "") or "",
            ),
            duration_hours=_env_int("PASS_DURATION_HOURS", 72),
            live_minutes=_env_int("PASS_LIVE_MINUTES", 120),
            max_opportunities=1,
            unlimited_mocks=True,
            features=[
                "company_dossier",
                "story_bank",
                "adaptive_mock",
                "live_sprint",
                "debrief",
            ],
            sort_order=10,
        ),
        ProductDef(
            code="interview_sprint",
            name="Interview Sprint",
            description="One opportunity · 14 days · unlimited mocks · 180 live minutes.",
            price_cents=_env_int("PRICE_INTERVIEW_SPRINT_CENTS", 3900),
            currency="usd",
            billing_mode="payment",
            stripe_price_id=_env_str(
                "STRIPE_PRICE_INTERVIEW_SPRINT",
                getattr(settings, "STRIPE_PRICE_INTERVIEW_SPRINT", "") or "",
            ),
            duration_hours=_env_int("SPRINT_DURATION_HOURS", 24 * 14),
            live_minutes=_env_int("SPRINT_LIVE_MINUTES", 180),
            max_opportunities=1,
            unlimited_mocks=True,
            features=[
                "company_dossier",
                "story_bank",
                "adaptive_mock",
                "live_sprint",
                "debrief",
                "priority_support",
            ],
            sort_order=20,
        ),
        ProductDef(
            code="pro_monthly",
            name="Pro Monthly",
            description="Multiple active opportunities · fair-use live minutes · monthly.",
            price_cents=_env_int("PRICE_PRO_MONTHLY_CENTS", 5900),
            currency="usd",
            billing_mode="subscription",
            # Prefer dedicated price; fall back to legacy STRIPE_PRICE_ID
            stripe_price_id=_env_str("STRIPE_PRICE_PRO_MONTHLY")
            or _env_str("STRIPE_PRICE_ID")
            or (settings.STRIPE_PRICE_ID or "").strip(),
            duration_hours=None,
            live_minutes=_env_int("PRO_LIVE_MINUTES_PER_MONTH", 600),
            max_opportunities=_env_int("PRO_MAX_OPPORTUNITIES", 5),
            unlimited_mocks=True,
            features=[
                "company_dossier",
                "story_bank",
                "adaptive_mock",
                "live_sprint",
                "debrief",
                "multi_opportunity",
                "premium_packs",
            ],
            sort_order=30,
        ),
    ]


def get_product(code: str) -> ProductDef | None:
    code = (code or "").strip().lower()
    for p in product_catalog():
        if p.code == code:
            return p
    return None


def product_by_stripe_price(price_id: str) -> ProductDef | None:
    pid = (price_id or "").strip()
    if not pid:
        return None
    for p in product_catalog():
        if p.stripe_price_id and p.stripe_price_id == pid:
            return p
    # Legacy: any unknown subscription price maps to pro_monthly
    return None
