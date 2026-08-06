"""Server-side entitlement checks for Company Twin Interview Sprint.

Never trust the client for plan limits. All paid features call into this module.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session
from backend.jwt_auth import get_current_user, user_has_active_subscription
from backend.models import Entitlement, JobOpportunity, User
from backend.products import ProductDef, get_product, product_catalog

logger = logging.getLogger("astra.entitlements")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_active_row(ent: Entitlement, now: datetime | None = None) -> bool:
    now = now or _utcnow()
    if (ent.status or "").lower() != "active":
        return False
    if ent.expires_at and ent.expires_at <= now:
        return False
    return True


def list_active_entitlements(session: Session, user_id: int) -> list[Entitlement]:
    now = _utcnow()
    rows = session.exec(
        select(Entitlement).where(
            Entitlement.user_id == user_id,
            Entitlement.status == "active",
        )
    ).all()
    active: list[Entitlement] = []
    for e in rows:
        if e.expires_at and e.expires_at <= now:
            e.status = "expired"
            e.updated_at = now
            session.add(e)
            continue
        active.append(e)
    if len(active) != len(rows):
        session.commit()
    return active


def has_complimentary(user: User, now: datetime | None = None) -> bool:
    now = now or _utcnow()
    if not user.complimentary_until:
        return False
    end = user.complimentary_until
    if end.tzinfo is not None:
        end = end.replace(tzinfo=None)
    return end > now


def user_has_paid_access(session: Session, user: User) -> bool:
    """True if monthly sub, active one-time entitlement, or admin/comp."""
    if settings.AUTH_DEV_BYPASS:
        return True
    if getattr(user, "is_admin", False):
        return True
    if has_complimentary(user):
        return True
    if user_has_active_subscription(user):
        return True
    return len(list_active_entitlements(session, int(user.id or 0))) > 0


def max_opportunities_allowed(session: Session, user: User) -> int:
    if settings.AUTH_DEV_BYPASS or getattr(user, "is_admin", False):
        return 99
    if has_complimentary(user):
        return 5
    limit = 0
    if user_has_active_subscription(user):
        pro = get_product("pro_monthly")
        limit = max(limit, pro.max_opportunities if pro else 5)
    for e in list_active_entitlements(session, int(user.id or 0)):
        limit = max(limit, e.max_opportunities or 1)
    # Free diagnostic allows draft opportunities but paid activation is limited
    return max(limit, 1) if limit == 0 else limit


def can_use_feature(session: Session, user: User, feature: str) -> bool:
    """Feature keys: diagnostic, dossier, adaptive_mock, live_sprint, multi_opportunity, premium_packs."""
    if settings.AUTH_DEV_BYPASS or getattr(user, "is_admin", False) or has_complimentary(user):
        return True
    if feature == "diagnostic":
        return True  # free for signed-in users
    if user_has_active_subscription(user):
        return True
    ents = list_active_entitlements(session, int(user.id or 0))
    if not ents:
        return False
    paid_features = {
        "dossier",
        "story_bank",
        "adaptive_mock",
        "live_sprint",
        "debrief",
        "multi_opportunity",
        "premium_packs",
    }
    if feature in paid_features:
        return True
    return False


def live_minutes_remaining(session: Session, user: User) -> int:
    """-1 = unlimited (admin/bypass), else sum of remaining across grants."""
    if settings.AUTH_DEV_BYPASS or getattr(user, "is_admin", False):
        return -1
    total = 0
    unlimited = False
    if user_has_active_subscription(user):
        pro = get_product("pro_monthly")
        # Monthly pool approximated on subscription entitlement or synthetic
        sub_mins = pro.live_minutes if pro else 600
        # Find subscription-linked entitlement
        found_sub = False
        for e in list_active_entitlements(session, int(user.id or 0)):
            if e.plan_code == "pro_monthly":
                found_sub = True
                if e.live_minutes_total < 0:
                    unlimited = True
                else:
                    total += max(0, e.live_minutes_total - e.live_minutes_used)
        if not found_sub:
            total += max(0, sub_mins)
    for e in list_active_entitlements(session, int(user.id or 0)):
        if e.plan_code == "pro_monthly":
            continue
        if e.live_minutes_total < 0:
            unlimited = True
        else:
            total += max(0, e.live_minutes_total - e.live_minutes_used)
    if unlimited:
        return -1
    return total


def consume_live_minutes(
    session: Session,
    user: User,
    minutes: int = 1,
    *,
    opportunity_id: int | None = None,
) -> dict[str, Any]:
    """Atomically consume live minutes. Raises 402 if exhausted."""
    if minutes <= 0:
        return {"ok": True, "remaining": live_minutes_remaining(session, user)}
    if settings.AUTH_DEV_BYPASS or getattr(user, "is_admin", False):
        return {"ok": True, "remaining": -1}
    remaining = live_minutes_remaining(session, user)
    if remaining == 0:
        raise HTTPException(
            status_code=402,
            detail={
                "error": {
                    "code": "live_minutes_exhausted",
                    "message": "Live minutes used up for this plan. Upgrade or buy a new Pass.",
                }
            },
        )
    if remaining > 0 and minutes > remaining:
        raise HTTPException(
            status_code=402,
            detail={
                "error": {
                    "code": "live_minutes_insufficient",
                    "message": f"Only {remaining} live minute(s) left.",
                    "remaining": remaining,
                }
            },
        )
    # Prefer opportunity-bound entitlement, then FIFO by expires_at
    ents = list_active_entitlements(session, int(user.id or 0))
    ents.sort(key=lambda e: (e.expires_at or datetime.max, e.id or 0))
    left = minutes
    for e in ents:
        if e.live_minutes_total < 0:
            left = 0
            break
        avail = max(0, e.live_minutes_total - e.live_minutes_used)
        if avail <= 0:
            continue
        take = min(avail, left)
        e.live_minutes_used += take
        e.updated_at = _utcnow()
        if opportunity_id and not e.opportunity_id:
            e.opportunity_id = opportunity_id
        session.add(e)
        left -= take
        if left <= 0:
            break
    if left > 0 and not user_has_active_subscription(user):
        raise HTTPException(
            status_code=402,
            detail={
                "error": {
                    "code": "live_minutes_exhausted",
                    "message": "Live minutes used up for this plan.",
                }
            },
        )
    session.commit()
    return {"ok": True, "remaining": live_minutes_remaining(session, user)}


def grant_entitlement(
    session: Session,
    user: User,
    product: ProductDef,
    *,
    checkout_session_id: str | None = None,
    payment_intent_id: str | None = None,
    subscription_id: str | None = None,
    opportunity_id: int | None = None,
    pack_id: str | None = None,
) -> Entitlement:
    """Idempotent grant by checkout_session_id when provided."""
    now = _utcnow()
    if checkout_session_id:
        existing = session.exec(
            select(Entitlement).where(
                Entitlement.stripe_checkout_session_id == checkout_session_id
            )
        ).first()
        if existing:
            return existing

    expires = None
    if product.duration_hours:
        expires = now + timedelta(hours=int(product.duration_hours))
    elif product.billing_mode == "subscription" and user.subscription_current_period_end:
        expires = user.subscription_current_period_end

    ent = Entitlement(
        user_id=int(user.id),
        plan_code=product.code,
        status="active",
        opportunity_id=opportunity_id,
        live_minutes_total=product.live_minutes,
        live_minutes_used=0,
        max_opportunities=product.max_opportunities,
        unlimited_mocks=product.unlimited_mocks,
        starts_at=now,
        expires_at=expires,
        stripe_checkout_session_id=checkout_session_id,
        stripe_payment_intent_id=payment_intent_id,
        stripe_subscription_id=subscription_id,
        pack_id=pack_id,
        created_at=now,
        updated_at=now,
        meta_json=json.dumps({"product": product.code}),
    )
    session.add(ent)
    if product.billing_mode == "subscription":
        user.plan_code = product.code
        session.add(user)
    session.commit()
    session.refresh(ent)
    logger.info(
        "Granted entitlement user=%s plan=%s id=%s expires=%s",
        user.id,
        product.code,
        ent.id,
        expires,
    )
    return ent


def revoke_entitlements_for_refund(
    session: Session,
    user: User,
    *,
    reason: str = "refund",
) -> int:
    n = 0
    for e in list_active_entitlements(session, int(user.id or 0)):
        e.status = "refunded" if reason == "refund" else "revoked"
        e.updated_at = _utcnow()
        session.add(e)
        n += 1
    session.commit()
    return n


def entitlement_summary(session: Session, user: User) -> dict[str, Any]:
    ents = list_active_entitlements(session, int(user.id or 0))
    return {
        "paid_access": user_has_paid_access(session, user),
        "subscription_active": user_has_active_subscription(user),
        "plan_code": user.plan_code
        or (
            "pro_monthly"
            if user_has_active_subscription(user)
            else (ents[0].plan_code if ents else "free_diagnostic")
        ),
        "live_minutes_remaining": live_minutes_remaining(session, user),
        "max_opportunities": max_opportunities_allowed(session, user),
        "active_entitlements": [
            {
                "id": e.id,
                "plan_code": e.plan_code,
                "expires_at": e.expires_at.isoformat() if e.expires_at else None,
                "live_minutes_total": e.live_minutes_total,
                "live_minutes_used": e.live_minutes_used,
                "opportunity_id": e.opportunity_id,
            }
            for e in ents
        ],
        "products": [p.public_dict() for p in product_catalog() if p.active],
        "features": {
            "diagnostic": can_use_feature(session, user, "diagnostic"),
            "dossier": can_use_feature(session, user, "dossier"),
            "story_bank": can_use_feature(session, user, "story_bank"),
            "adaptive_mock": can_use_feature(session, user, "adaptive_mock"),
            "live_sprint": can_use_feature(session, user, "live_sprint"),
            "debrief": can_use_feature(session, user, "debrief"),
        },
    }


def require_paid_access(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> User:
    if not user_has_paid_access(session, user):
        raise HTTPException(
            status_code=402,
            detail={
                "error": {
                    "code": "payment_required",
                    "message": "Purchase an Interview Pass or Sprint to unlock this feature.",
                }
            },
        )
    return user


def count_user_opportunities(session: Session, user_id: int, *, active_only: bool = True) -> int:
    q = select(JobOpportunity).where(JobOpportunity.user_id == user_id)
    if active_only:
        q = q.where(JobOpportunity.status != "archived")
    return len(session.exec(q).all())
