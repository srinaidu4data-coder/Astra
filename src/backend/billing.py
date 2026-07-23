"""Stripe monthly subscription: checkout, portal, sync, webhooks, refunds.

Wiring fixes:
- Post-checkout race: success URL includes session_id; POST /sync and /confirm-session
  pull subscription from Stripe even if webhook is late/missing.
- Refunds: charge.refunded + refund.updated revoke access and email the user.
- Cancel / past_due / payment_failed update status and notify via Gmail SMTP.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session
from backend.email_service import send_billing_email, send_email_async
from backend.jwt_auth import get_current_user, user_has_active_subscription, user_public_dict
from backend.models import User

logger = logging.getLogger("astra.billing")

router = APIRouter(prefix="/v1/billing", tags=["billing"])


def _stripe() -> None:
    if not settings.STRIPE_SECRET_KEY.strip():
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "stripe_not_configured",
                    "message": "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.",
                }
            },
        )
    stripe.api_key = settings.STRIPE_SECRET_KEY.strip()


def _as_dict(obj: Any) -> dict:
    """Normalize StripeObject / dict."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        try:
            return obj.to_dict()  # type: ignore[no-any-return]
        except Exception:
            pass
    try:
        return dict(obj)
    except Exception:
        return {}


class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str


class BillingStatusResponse(BaseModel):
    configured: bool
    subscription_status: str
    subscription_active: bool
    subscription_current_period_end: str | None
    access_revoked_reason: str | None = None
    user: dict | None = None


class ConfirmSessionRequest(BaseModel):
    session_id: str = Field(min_length=8)


class SyncResponse(BaseModel):
    user: dict
    subscription_active: bool
    source: str


def _ensure_customer(user: User, session: Session) -> str:
    """Return Stripe customer id, creating one if needed."""
    _stripe()
    if user.stripe_customer_id:
        return user.stripe_customer_id

    customer = stripe.Customer.create(
        email=user.email,
        name=user.name or None,
        metadata={"astra_user_id": str(user.id)},
    )
    user.stripe_customer_id = customer["id"]
    session.add(user)
    session.commit()
    session.refresh(user)
    return str(user.stripe_customer_id)


def _period_end_dt(sub: dict) -> datetime | None:
    period_end = sub.get("current_period_end")
    if not period_end:
        return None
    return datetime.fromtimestamp(int(period_end), tz=timezone.utc).replace(tzinfo=None)


def _apply_subscription(
    session: Session,
    user: User,
    sub: dict,
    *,
    clear_revocation: bool = True,
) -> None:
    """Update user row from a Stripe Subscription object."""
    sub = _as_dict(sub)
    prev = user.subscription_status
    user.stripe_subscription_id = sub.get("id") or user.stripe_subscription_id
    user.subscription_status = (sub.get("status") or "none").lower()
    pe = _period_end_dt(sub)
    if pe:
        user.subscription_current_period_end = pe
    customer = sub.get("customer")
    if isinstance(customer, str):
        user.stripe_customer_id = customer
    elif isinstance(customer, dict) and customer.get("id"):
        user.stripe_customer_id = customer["id"]

    # Successful active/trialing clears refund lock
    if clear_revocation and user.subscription_status in ("active", "trialing"):
        user.access_revoked_reason = None

    session.add(user)
    session.commit()
    session.refresh(user)

    # Email transitions (async so webhooks stay fast)
    if (
        user.subscription_status in ("active", "trialing")
        and prev not in ("active", "trialing")
        and settings.BILLING_EMAIL_ENABLED
    ):
        send_email_async(
            to_email=user.email,
            subject="Your InterviewPulse subscription is active",
            text_body=(
                f"Hi {user.name or user.email},\n\n"
                "Your monthly subscription is active. Enjoy live interview answers.\n\n"
                f"{settings.FRONTEND_URL}\n\n— The Astra team\n"
            ),
        )
    elif user.subscription_status == "canceled" and prev != "canceled":
        _notify_billing(user, "canceled")


def _revoke_for_refund(
    session: Session,
    user: User,
    *,
    refund_id: str | None,
    detail: str = "",
) -> None:
    """Full refund path: lock out access + mark status + email."""
    user.subscription_status = "refunded"
    user.access_revoked_reason = "refund"
    user.last_refund_at = datetime.utcnow()
    if refund_id:
        user.last_refund_id = refund_id
    # Keep subscription id for audit but treat as dead for access checks
    session.add(user)
    session.commit()
    session.refresh(user)
    logger.info("Access revoked for user %s due to refund %s", user.id, refund_id)
    _notify_billing(user, "refunded", detail=detail)


def _notify_billing(user: User, kind: str, detail: str = "") -> None:
    def _done(ok: bool, err: str | None) -> None:
        if not ok:
            logger.warning("Billing email (%s) to %s failed: %s", kind, user.email, err)

    # run in thread via send_email_async path — use wrapper
    try:
        ok, err = send_billing_email(
            to_email=user.email,
            name=user.name,
            kind=kind,
            detail=detail,
        )
        _done(ok, err)
    except Exception:
        logger.exception("billing email failed")


def _user_from_subscription(session: Session, sub: dict) -> User | None:
    sub = _as_dict(sub)
    meta = sub.get("metadata") or {}
    uid = meta.get("astra_user_id")
    if uid:
        user = session.get(User, int(uid))
        if user:
            return user
    customer = sub.get("customer")
    cid = customer if isinstance(customer, str) else (customer or {}).get("id")
    if cid:
        return session.exec(select(User).where(User.stripe_customer_id == cid)).first()
    return None


def _user_from_customer_id(session: Session, customer_id: str | None) -> User | None:
    if not customer_id:
        return None
    return session.exec(
        select(User).where(User.stripe_customer_id == customer_id)
    ).first()


def _sync_user_from_stripe(session: Session, user: User) -> str:
    """Pull latest subscription state from Stripe for this user. Returns source label."""
    _stripe()

    # Prefer known subscription id
    if user.stripe_subscription_id:
        try:
            sub = stripe.Subscription.retrieve(user.stripe_subscription_id)
            _apply_subscription(session, user, _as_dict(sub))
            return "subscription_id"
        except stripe.error.InvalidRequestError:
            logger.warning("Stored subscription %s missing", user.stripe_subscription_id)

    customer_id = user.stripe_customer_id
    if not customer_id:
        # Try lookup by email
        customers = stripe.Customer.list(email=user.email, limit=3)
        data = list(getattr(customers, "data", None) or [])
        if data:
            customer_id = data[0]["id"]
            user.stripe_customer_id = customer_id
            session.add(user)
            session.commit()

    if customer_id:
        subs = stripe.Subscription.list(customer=customer_id, status="all", limit=10)
        items = list(getattr(subs, "data", None) or [])
        preferred = None
        for s in items:
            sd = _as_dict(s)
            if sd.get("status") in ("active", "trialing"):
                preferred = sd
                break
        if preferred is None and items:
            preferred = _as_dict(items[0])
        if preferred:
            # If Stripe shows canceled/unpaid after a refund path, respect dead status
            st = (preferred.get("status") or "").lower()
            if st in ("canceled", "unpaid", "incomplete_expired") and user.access_revoked_reason == "refund":
                user.subscription_status = "refunded"
                session.add(user)
                session.commit()
                return "customer_list_refunded"
            _apply_subscription(
                session,
                user,
                preferred,
                clear_revocation=st in ("active", "trialing"),
            )
            return "customer_list"

    return "no_subscription_found"


@router.get("/status", response_model=BillingStatusResponse)
async def billing_status(
    user: User = Depends(get_current_user),
) -> BillingStatusResponse:
    end = user.subscription_current_period_end
    return BillingStatusResponse(
        configured=settings.stripe_configured,
        subscription_status=user.subscription_status,
        subscription_active=user_has_active_subscription(user),
        subscription_current_period_end=end.isoformat() if end else None,
        access_revoked_reason=user.access_revoked_reason,
        user=user_public_dict(user),
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CheckoutResponse:
    """Create a Stripe Checkout session for the monthly plan."""
    if not settings.stripe_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "stripe_not_configured",
                    "message": "Stripe monthly price is not configured.",
                }
            },
        )
    _stripe()

    if user_has_active_subscription(user):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "already_subscribed",
                    "message": "You already have an active subscription.",
                }
            },
        )

    customer_id = _ensure_customer(user, session)
    success_url = settings.STRIPE_SUCCESS_URL
    if "{CHECKOUT_SESSION_ID}" not in success_url:
        # Guarantee session id for post-pay confirm (fixes webhook race)
        sep = "&" if "?" in success_url else "?"
        if "#" in success_url:
            # HashRouter: inject before end
            base, frag = success_url.split("#", 1)
            if "?" in frag:
                success_url = f"{base}#{frag}&session_id={{CHECKOUT_SESSION_ID}}"
            else:
                success_url = f"{base}#{frag}?session_id={{CHECKOUT_SESSION_ID}}"
        else:
            success_url = f"{success_url}{sep}session_id={{CHECKOUT_SESSION_ID}}"

    checkout = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": settings.STRIPE_PRICE_ID.strip(), "quantity": 1}],
        success_url=success_url,
        cancel_url=settings.STRIPE_CANCEL_URL,
        client_reference_id=str(user.id),
        metadata={"astra_user_id": str(user.id)},
        subscription_data={"metadata": {"astra_user_id": str(user.id)}},
        allow_promotion_codes=True,
    )
    url = checkout.get("url") if isinstance(checkout, dict) else checkout.url
    if not url:
        raise HTTPException(status_code=500, detail="Stripe did not return a checkout URL.")
    return CheckoutResponse(url=url)


@router.post("/portal", response_model=PortalResponse)
async def create_portal(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PortalResponse:
    """Stripe Customer Portal — cancel, update card, view invoices / request refunds."""
    _stripe()
    if not user.stripe_customer_id and not user_has_active_subscription(user):
        # Still allow portal creation after first customer ensure
        pass
    customer_id = _ensure_customer(user, session)
    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{settings.FRONTEND_URL.rstrip('/')}/#/settings",
    )
    url = portal.get("url") if isinstance(portal, dict) else portal.url
    return PortalResponse(url=url)


@router.post("/sync", response_model=SyncResponse)
async def sync_billing(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SyncResponse:
    """Re-pull subscription from Stripe (use after pay / refund lag)."""
    if not settings.stripe_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "stripe_not_configured",
                    "message": "Stripe is not configured.",
                }
            },
        )
    # Re-load user in this session
    db_user = session.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=401, detail="User not found")
    source = _sync_user_from_stripe(session, db_user)
    session.refresh(db_user)
    return SyncResponse(
        user=user_public_dict(db_user),
        subscription_active=user_has_active_subscription(db_user),
        source=source,
    )


@router.post("/confirm-session", response_model=SyncResponse)
async def confirm_checkout_session(
    body: ConfirmSessionRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SyncResponse:
    """After Stripe redirects back with session_id — apply sub without waiting for webhook."""
    _stripe()
    db_user = session.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=401, detail="User not found")

    try:
        cs = stripe.checkout.Session.retrieve(
            body.session_id,
            expand=["subscription"],
        )
    except stripe.error.InvalidRequestError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "invalid_session",
                    "message": "Unknown Checkout session.",
                }
            },
        ) from exc

    cs_d = _as_dict(cs)
    # Ownership check
    meta_uid = (cs_d.get("metadata") or {}).get("astra_user_id")
    ref = cs_d.get("client_reference_id")
    if str(meta_uid or ref or "") not in ("", str(user.id)) and str(meta_uid or ref) != str(
        user.id
    ):
        raise HTTPException(status_code=403, detail="Checkout session does not belong to you.")

    if cs_d.get("customer"):
        cid = cs_d["customer"]
        if isinstance(cid, str):
            db_user.stripe_customer_id = cid

    sub = cs_d.get("subscription")
    if isinstance(sub, str):
        sub = _as_dict(stripe.Subscription.retrieve(sub))
    else:
        sub = _as_dict(sub)

    if sub and sub.get("id"):
        _apply_subscription(session, db_user, sub, clear_revocation=True)
        source = "checkout_session"
    else:
        source = _sync_user_from_stripe(session, db_user)

    session.refresh(db_user)
    return SyncResponse(
        user=user_public_dict(db_user),
        subscription_active=user_has_active_subscription(db_user),
        source=source,
    )


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    """Handle Stripe events: sub lifecycle, payments, refunds."""
    if not settings.STRIPE_SECRET_KEY.strip():
        raise HTTPException(status_code=503, detail="Stripe not configured")

    stripe.api_key = settings.STRIPE_SECRET_KEY.strip()
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        if settings.STRIPE_WEBHOOK_SECRET.strip():
            event = stripe.Webhook.construct_event(
                payload, sig, settings.STRIPE_WEBHOOK_SECRET.strip()
            )
        else:
            import json

            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
            logger.warning(
                "Stripe webhook accepted WITHOUT signature verification — set STRIPE_WEBHOOK_SECRET"
            )
    except Exception as exc:
        logger.warning("Stripe webhook verification failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid webhook") from exc

    etype = event["type"] if isinstance(event, dict) else event.type
    data_obj = event["data"]["object"] if isinstance(event, dict) else event.data.object
    data = _as_dict(data_obj)
    logger.info("Stripe webhook: %s", etype)

    if etype == "checkout.session.completed":
        sub_id = data.get("subscription")
        user_id = (data.get("metadata") or {}).get("astra_user_id") or data.get(
            "client_reference_id"
        )
        if user_id and sub_id:
            user = session.get(User, int(user_id))
            if user:
                sub = stripe.Subscription.retrieve(sub_id)
                _apply_subscription(session, user, _as_dict(sub), clear_revocation=True)

    elif etype in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        user = _user_from_subscription(session, data)
        if user:
            _apply_subscription(session, user, data, clear_revocation=True)

    elif etype == "customer.subscription.deleted":
        user = _user_from_subscription(session, data)
        if user:
            user.subscription_status = "canceled"
            # Soft cancel: keep access until period end if still in future
            pe = _period_end_dt(data)
            if pe:
                user.subscription_current_period_end = pe
            # If already past period or no period, hard revoke
            if pe is None or pe.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
                user.access_revoked_reason = "cancel"
            session.add(user)
            session.commit()
            _notify_billing(user, "canceled")

    elif etype == "invoice.payment_succeeded":
        customer = data.get("customer")
        cid = customer if isinstance(customer, str) else None
        user = _user_from_customer_id(session, cid)
        sub_id = data.get("subscription")
        if user and sub_id:
            sub = stripe.Subscription.retrieve(sub_id)
            _apply_subscription(session, user, _as_dict(sub), clear_revocation=True)

    elif etype == "invoice.payment_failed":
        customer = data.get("customer")
        cid = customer if isinstance(customer, str) else None
        user = _user_from_customer_id(session, cid)
        if user:
            user.subscription_status = "past_due"
            user.access_revoked_reason = "payment_failed"
            session.add(user)
            session.commit()
            _notify_billing(user, "past_due")

    elif etype in ("charge.refunded", "charge.refund.updated"):
        # Full refund → revoke. Partial refund leaves access (log only).
        customer = data.get("customer")
        cid = customer if isinstance(customer, str) else None
        user = _user_from_customer_id(session, cid)
        if user is None:
            # Try via payment_intent / invoice metadata later — also search by charge receipt email
            receipt = (data.get("billing_details") or {}).get("email") or data.get(
                "receipt_email"
            )
            if receipt:
                user = session.exec(
                    select(User).where(User.email == str(receipt).lower())
                ).first()

        amount = int(data.get("amount") or 0)
        amount_refunded = int(data.get("amount_refunded") or 0)
        # charge.refunded object is a Charge; refund.updated is a Refund
        if etype == "charge.refund.updated":
            # Refund object
            status = data.get("status")
            refund_id = data.get("id")
            if status == "succeeded" and user:
                # Treat successful refund webhook as access revoke for subscription products
                _revoke_for_refund(
                    session,
                    user,
                    refund_id=refund_id,
                    detail=f"Refund {refund_id} status={status}",
                )
        else:
            # Charge fully refunded?
            refunded_flag = bool(data.get("refunded"))
            full = refunded_flag or (amount > 0 and amount_refunded >= amount)
            refund_id = None
            refunds = data.get("refunds") or {}
            rdata = refunds.get("data") if isinstance(refunds, dict) else None
            if rdata:
                refund_id = rdata[0].get("id")
            if user and full:
                # Also cancel subscription in Stripe if still open (best-effort)
                if user.stripe_subscription_id:
                    try:
                        stripe.Subscription.cancel(user.stripe_subscription_id)
                    except Exception:
                        logger.warning(
                            "Could not cancel sub %s after refund",
                            user.stripe_subscription_id,
                        )
                _revoke_for_refund(
                    session,
                    user,
                    refund_id=refund_id,
                    detail=f"Charge fully refunded ({amount_refunded}/{amount})",
                )
            elif user and amount_refunded and not full:
                logger.info(
                    "Partial refund for user %s amount_refunded=%s — access kept",
                    user.id,
                    amount_refunded,
                )

    elif etype == "charge.dispute.created":
        customer = data.get("customer")
        cid = customer if isinstance(customer, str) else None
        # Dispute object nests charge — customer may be on dispute
        user = _user_from_customer_id(session, cid)
        if user:
            user.access_revoked_reason = "refund"
            user.subscription_status = "refunded"
            session.add(user)
            session.commit()
            logger.warning("Dispute — access revoked for user %s", user.id)

    return {"received": True}
