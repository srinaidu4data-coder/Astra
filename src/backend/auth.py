"""License key validation logic with FastAPI dependency injection."""

import hmac
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models import LicenseKey

security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/v1/license", tags=["license"])


# --- Request/Response schemas ---


class ActivateRequest(BaseModel):
    license_key: str
    hardware_id: str


class ActivateResponse(BaseModel):
    valid: bool
    tier: str
    grace_period_days: int = 7


class DeactivateRequest(BaseModel):
    license_key: str
    hardware_id: str


class DeactivateResponse(BaseModel):
    deactivated: bool


class ValidateResponse(BaseModel):
    valid: bool
    tier: str
    expires_at: datetime | None = None
    grace_period_days: int = 7


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


# --- Dependency: validate license from Authorization header ---


async def validate_license(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    session: Session = Depends(get_session),
) -> LicenseKey:
    """Validate the license key from the Authorization: Bearer header.

    Returns the LicenseKey object for downstream use.
    Raises HTTPException(401) for missing/malformed auth.
    Raises HTTPException(403) for invalid/revoked/expired keys.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "missing_key", "message": "Authorization header with Bearer token is required."}},
        )

    provided_key = credentials.credentials

    # Look up key in database
    statement = select(LicenseKey)
    results = session.exec(statement).all()

    # Use timing-safe comparison to prevent timing attacks
    db_key = None
    for k in results:
        if hmac.compare_digest(k.key, provided_key):
            db_key = k
            break

    if db_key is None:
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "invalid_key", "message": "License key is not valid."}},
        )

    if db_key.status == "revoked":
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "revoked_key", "message": "This license key has been revoked."}},
        )

    if db_key.status == "unused":
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "inactive_key", "message": "This license key has not been activated yet. Use /v1/license/activate first."}},
        )

    # Check expiration
    if db_key.expires_at is not None and db_key.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "expired_key", "message": "This license key has expired."}},
        )

    # Update last_validated_at
    db_key.last_validated_at = datetime.utcnow()
    session.add(db_key)
    session.commit()
    session.refresh(db_key)

    return db_key


# --- License management HTTP endpoints ---


@router.post("/activate", response_model=ActivateResponse, responses={403: {"model": ErrorResponse}})
async def activate_license(body: ActivateRequest, session: Session = Depends(get_session)):
    """Activate a license key, binding it to a hardware ID."""
    statement = select(LicenseKey)
    results = session.exec(statement).all()

    db_key = None
    for k in results:
        if hmac.compare_digest(k.key, body.license_key):
            db_key = k
            break

    if db_key is None:
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "invalid_key", "message": "License key is not valid."}},
        )

    if db_key.status == "revoked":
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "revoked_key", "message": "This license key has been revoked."}},
        )

    if db_key.status == "active":
        # Already active — check if same hardware
        if db_key.hardware_id and not hmac.compare_digest(db_key.hardware_id, body.hardware_id):
            raise HTTPException(
                status_code=403,
                detail={"error": {"code": "already_active", "message": "Key is active on another machine."}},
            )
        # Same hardware — return success
        return ActivateResponse(valid=True, tier=db_key.tier)

    # Activate the key
    db_key.status = "active"
    db_key.hardware_id = body.hardware_id
    db_key.activated_at = datetime.utcnow()
    db_key.last_validated_at = datetime.utcnow()
    session.add(db_key)
    session.commit()

    return ActivateResponse(valid=True, tier=db_key.tier)


@router.post("/deactivate", response_model=DeactivateResponse, responses={403: {"model": ErrorResponse}})
async def deactivate_license(body: DeactivateRequest, session: Session = Depends(get_session)):
    """Deactivate a license key, unbinding it from the current hardware."""
    statement = select(LicenseKey)
    results = session.exec(statement).all()

    db_key = None
    for k in results:
        if hmac.compare_digest(k.key, body.license_key):
            db_key = k
            break

    if db_key is None:
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "invalid_key", "message": "License key is not valid."}},
        )

    if db_key.status != "active":
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "not_active", "message": "This license key is not currently active."}},
        )

    # Verify hardware ID matches
    if db_key.hardware_id and not hmac.compare_digest(db_key.hardware_id, body.hardware_id):
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "hardware_mismatch", "message": "Hardware ID does not match the activated machine."}},
        )

    db_key.status = "unused"
    db_key.hardware_id = None
    session.add(db_key)
    session.commit()

    return DeactivateResponse(deactivated=True)


@router.post("/validate", response_model=ValidateResponse)
async def validate_license_endpoint(
    license_key: LicenseKey = Depends(validate_license),
):
    """Validate a license key via Authorization header. Lightweight check."""
    return ValidateResponse(
        valid=True,
        tier=license_key.tier,
        expires_at=license_key.expires_at,
    )
