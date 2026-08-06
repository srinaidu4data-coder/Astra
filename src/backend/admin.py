"""Admin console API — model catalog + per-user LLM assignment."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from backend.config import settings
from backend.database import get_session
from backend.jwt_auth import require_admin, user_public_dict
from backend.models import User

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class ModelCatalogResponse(BaseModel):
    models: list[dict[str, Any]]
    default_answer_model: str
    default_fallback_model: str


class UserModelUpdate(BaseModel):
    answer_model: Optional[str] = Field(
        default=None,
        description="Primary model id, or null/empty to use global default",
    )
    fallback_model: Optional[str] = Field(
        default=None,
        description="Fallback model id, or null/empty to use global default",
    )
    is_admin: Optional[bool] = None


class UsersListResponse(BaseModel):
    users: list[dict[str, Any]]
    total: int
    default_answer_model: str
    default_fallback_model: str
    models: list[dict[str, Any]]


@router.get("/models", response_model=ModelCatalogResponse)
async def list_models(admin: User = Depends(require_admin)) -> ModelCatalogResponse:
    """Models available for assignment."""
    _ = admin
    return ModelCatalogResponse(
        models=settings.catalog_answer_models,
        default_answer_model=settings.DEFAULT_ANSWER_MODEL or "gpt-4.1-mini",
        default_fallback_model=settings.DEFAULT_FALLBACK_MODEL or "gpt-4.1-nano",
    )


@router.get("/users", response_model=UsersListResponse)
async def list_users(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> UsersListResponse:
    """List users with their assigned models."""
    _ = admin
    stmt = select(User).order_by(col(User.id).desc())
    users = list(session.exec(stmt).all())
    if q.strip():
        ql = q.strip().lower()
        users = [
            u
            for u in users
            if ql in (u.email or "").lower() or ql in (u.name or "").lower()
        ]
    total = len(users)
    page = users[offset : offset + limit]
    return UsersListResponse(
        users=[user_public_dict(u) for u in page],
        total=total,
        default_answer_model=settings.DEFAULT_ANSWER_MODEL or "gpt-4.1-mini",
        default_fallback_model=settings.DEFAULT_FALLBACK_MODEL or "gpt-4.1-nano",
        models=settings.catalog_answer_models,
    )


@router.patch("/users/{user_id}")
async def update_user_models(
    user_id: int,
    body: UserModelUpdate,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Assign answer/fallback models (and optional admin flag) for a user."""
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    # answer_model: empty string → clear to default
    if "answer_model" in body.model_fields_set or body.answer_model is not None:
        raw = body.answer_model
        if raw is None or str(raw).strip() == "" or str(raw).strip().lower() in (
            "default",
            "null",
        ):
            target.answer_model = None
        else:
            mid = settings.normalize_model_id(raw)
            if not mid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid answer_model. Allowed: {settings.ALLOWED_MODELS}",
                )
            target.answer_model = mid

    if "fallback_model" in body.model_fields_set or body.fallback_model is not None:
        raw = body.fallback_model
        if raw is None or str(raw).strip() == "" or str(raw).strip().lower() in (
            "default",
            "null",
        ):
            target.fallback_model = None
        else:
            mid = settings.normalize_model_id(raw)
            if not mid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid fallback_model. Allowed: {settings.ALLOWED_MODELS}",
                )
            target.fallback_model = mid

    if body.is_admin is not None:
        # Prevent locking yourself out of admin if you're the only one
        if body.is_admin is False and admin.id == target.id:
            others = session.exec(
                select(User).where(User.is_admin == True, User.id != admin.id)  # noqa: E712
            ).first()
            if others is None:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot remove admin from the only admin account.",
                )
        target.is_admin = bool(body.is_admin)

    session.add(target)
    session.commit()
    session.refresh(target)
    return {"ok": True, "user": user_public_dict(target)}


@router.get("/me")
async def admin_me(admin: User = Depends(require_admin)) -> dict[str, Any]:
    """Confirm admin session + return catalog defaults."""
    return {
        "ok": True,
        "user": user_public_dict(admin),
        "models": settings.catalog_answer_models,
        "default_answer_model": settings.DEFAULT_ANSWER_MODEL or "gpt-4.1-mini",
        "default_fallback_model": settings.DEFAULT_FALLBACK_MODEL or "gpt-4.1-nano",
    }


class ComplimentaryIn(BaseModel):
    days: int = Field(default=14, ge=1, le=365)
    reason: str = Field(default="support_comp", max_length=200)
    live_minutes: int = Field(default=120, ge=0, le=10000)


@router.post("/users/{user_id}/complimentary")
async def grant_complimentary(
    user_id: int,
    body: ComplimentaryIn,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Admin-issued complimentary Sprint access (server-side entitlement)."""
    from datetime import datetime, timedelta

    from backend.entitlements import grant_entitlement
    from backend.products import ProductDef

    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    until = datetime.utcnow() + timedelta(days=int(body.days))
    target.complimentary_until = until
    target.complimentary_reason = (body.reason or "support_comp")[:200]
    target.access_revoked_reason = None
    session.add(target)
    session.commit()

    prod = ProductDef(
        code="admin_comp",
        name="Admin complimentary",
        description=body.reason,
        price_cents=0,
        currency="usd",
        billing_mode="free",
        stripe_price_id="",
        duration_hours=24 * int(body.days),
        live_minutes=int(body.live_minutes),
        max_opportunities=3,
        unlimited_mocks=True,
        features=["company_dossier", "story_bank", "adaptive_mock", "live_sprint", "debrief"],
        sort_order=90,
        active=False,
    )
    ent = grant_entitlement(session, target, prod)
    # Audit without secrets or private materials
    logger = __import__("logging").getLogger("astra.admin")
    logger.info(
        "admin_comp admin_id=%s target_id=%s days=%s minutes=%s entitlement_id=%s",
        admin.id,
        target.id,
        body.days,
        body.live_minutes,
        ent.id,
    )
    return {
        "ok": True,
        "user": user_public_dict(target, session),
        "entitlement_id": ent.id,
        "complimentary_until": until.isoformat(),
    }
