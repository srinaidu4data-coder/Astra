"""Transactional email via Gmail SMTP (app password).

Fixes vs first pass:
- Gmail app passwords often include spaces → strip before login
- Welcome email retries on later logins if first send failed
- Billing lifecycle emails: paid, canceled, refunded
- Clear last_error return values for diagnostics (not silent True on failure)
"""

from __future__ import annotations

import logging
import smtplib
import threading
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Callable

from backend.config import settings

logger = logging.getLogger("astra.email")


def _from_header() -> str:
    raw = (settings.SMTP_FROM or settings.SMTP_USER or "").strip()
    if not raw:
        return settings.SMTP_USER
    name, addr = parseaddr(raw)
    if addr:
        return formataddr((name or "InterviewPulse", addr))
    # Bare email
    return raw


def _send_message(msg: EmailMessage) -> tuple[bool, str | None]:
    """Send one message. Returns (ok, error_message)."""
    if not settings.smtp_configured:
        err = "SMTP not configured (set SMTP_USER + SMTP_PASSWORD / Gmail app password)"
        logger.warning(err)
        return False, err

    password = settings.smtp_password_clean
    user = settings.SMTP_USER.strip()

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=25) as server:
            server.ehlo()
            if settings.SMTP_PORT != 465:
                server.starttls()
                server.ehlo()
            server.login(user, password)
            server.send_message(msg)
        return True, None
    except smtplib.SMTPAuthenticationError as exc:
        err = (
            "Gmail SMTP auth failed. Use a Google App Password (not your normal password), "
            "enable 2FA, and strip spaces when pasting. "
            f"Detail: {exc}"
        )
        logger.error(err)
        return False, err
    except Exception as exc:
        err = f"SMTP send failed: {exc}"
        logger.exception(err)
        return False, err


def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> tuple[bool, str | None]:
    """Low-level send. Returns (ok, error)."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _from_header()
    msg["To"] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    return _send_message(msg)


def send_email_async(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    on_done: Callable[[bool, str | None], None] | None = None,
) -> None:
    """Fire-and-forget so OAuth/webhook handlers never block on Gmail."""

    def _run() -> None:
        ok, err = send_email(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
        if on_done:
            try:
                on_done(ok, err)
            except Exception:
                logger.exception("email on_done callback failed")

    threading.Thread(target=_run, name="astra-email", daemon=True).start()


def send_welcome_email(*, to_email: str, name: str | None = None) -> tuple[bool, str | None]:
    """Welcome email after first Google sign-up (or retry if previously failed)."""
    if not settings.WELCOME_EMAIL_ENABLED:
        logger.info("Welcome email skipped (WELCOME_EMAIL_ENABLED=false)")
        return True, None

    display = (name or "").strip() or to_email.split("@")[0]
    frontend = settings.FRONTEND_URL.rstrip("/")
    subject = "Welcome to InterviewPulse"
    text = f"""Hi {display},

Welcome to InterviewPulse (Astra) — your live interview copilot.

You're signed in with Google. Next step: choose a monthly plan so you can
unlock live answers during interviews.

Open the app: {frontend}

If you didn't create this account, you can ignore this email.

— The Astra team
"""
    html = f"""\
<html>
  <body style="font-family: system-ui, sans-serif; color: #1a1a1a; line-height: 1.55;">
    <h2 style="color: #0c0c0c;">Welcome to InterviewPulse</h2>
    <p>Hi {display},</p>
    <p>
      You're signed in with <strong>Google</strong>. Next, activate your
      <strong>monthly subscription</strong> to unlock live interview answers.
    </p>
    <p><a href="{frontend}">Open the app</a></p>
    <p style="color: #666; font-size: 13px;">
      If you didn't create this account, you can ignore this email.
    </p>
    <p>— The Astra team</p>
  </body>
</html>
"""
    ok, err = send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)
    if ok:
        logger.info("Welcome email sent to %s", to_email)
    return ok, err


def send_billing_email(
    *,
    to_email: str,
    name: str | None,
    kind: str,
    detail: str = "",
) -> tuple[bool, str | None]:
    """Lifecycle emails: subscribed | canceled | refunded | past_due."""
    if not settings.BILLING_EMAIL_ENABLED:
        return True, None
    if not settings.smtp_configured:
        return False, "SMTP not configured"

    display = (name or "").strip() or to_email.split("@")[0]
    frontend = settings.FRONTEND_URL.rstrip("/")

    subjects = {
        "subscribed": "Your InterviewPulse subscription is active",
        "canceled": "Your InterviewPulse subscription was canceled",
        "refunded": "Your InterviewPulse payment was refunded",
        "past_due": "Action needed: InterviewPulse payment failed",
    }
    bodies = {
        "subscribed": (
            f"Hi {display},\n\n"
            "Thanks — your monthly subscription is active. You can use live interview answers now.\n\n"
            f"Open the app: {frontend}\n\n— The Astra team\n"
        ),
        "canceled": (
            f"Hi {display},\n\n"
            "Your subscription was canceled. Access ends at the end of the billing period "
            "(or immediately if canceled with refund).\n\n"
            f"Manage billing: {frontend}/#/settings\n\n— The Astra team\n"
        ),
        "refunded": (
            f"Hi {display},\n\n"
            "We processed a refund for your InterviewPulse subscription. "
            "Access has been revoked. You can subscribe again anytime from the app.\n\n"
            f"{detail}\n\n"
            f"Open the app: {frontend}\n\n— The Astra team\n"
        ),
        "past_due": (
            f"Hi {display},\n\n"
            "We couldn't process your latest payment. Update your card in the billing portal "
            "to keep access.\n\n"
            f"Manage billing: {frontend}/#/settings\n\n— The Astra team\n"
        ),
    }
    subject = subjects.get(kind, f"InterviewPulse: {kind}")
    text = bodies.get(kind, f"Hi {display},\n\n{detail}\n\n— The Astra team\n")
    return send_email(to_email=to_email, subject=subject, text_body=text)


def send_password_reset_email(*, to_email: str, name: str | None, reset_url: str) -> tuple[bool, str | None]:
    """Forgot-password email with one-time link (Gmail SMTP)."""
    display = (name or "").strip() or to_email.split("@")[0]
    minutes = settings.PASSWORD_RESET_EXPIRE_MINUTES
    subject = "Reset your InterviewPulse password"
    text = f"""Hi {display},

We received a request to reset your InterviewPulse password.

Open this link to choose a new password (expires in {minutes} minutes):
{reset_url}

If you did not request this, you can ignore this email — your password will stay the same.

— The Astra team
"""
    html = f"""\
<html>
  <body style="font-family: system-ui, sans-serif; color: #1a1a1a; line-height: 1.55;">
    <h2 style="color: #0c0c0c;">Reset your password</h2>
    <p>Hi {display},</p>
    <p>We received a request to reset your InterviewPulse password.</p>
    <p>
      <a href="{reset_url}"
         style="display:inline-block;background:#20B8CD;color:#0c0c0c;padding:12px 18px;
                border-radius:8px;text-decoration:none;font-weight:600;">
        Choose a new password
      </a>
    </p>
    <p style="color:#666;font-size:13px;">This link expires in {minutes} minutes.</p>
    <p style="color:#666;font-size:13px;">
      If the button does not work, paste this URL into your browser:<br/>
      <span style="word-break:break-all;">{reset_url}</span>
    </p>
    <p style="color:#666;font-size:13px;">
      If you did not request this, ignore this email.
    </p>
    <p>— The Astra team</p>
  </body>
</html>
"""
    ok, err = send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)
    if ok:
        logger.info("Password reset email sent to %s", to_email)
    else:
        logger.warning("Password reset email failed for %s: %s", to_email, err)
    return ok, err


def smtp_self_check() -> dict:
    """Diagnostic for /v1/auth/config — does not send mail."""
    return {
        "smtp_configured": settings.smtp_configured,
        "smtp_host": settings.SMTP_HOST,
        "smtp_port": settings.SMTP_PORT,
        "smtp_user_set": bool(settings.SMTP_USER.strip()),
        "smtp_password_set": bool(settings.smtp_password_clean),
        "welcome_enabled": settings.WELCOME_EMAIL_ENABLED,
        "billing_email_enabled": settings.BILLING_EMAIL_ENABLED,
        "from_header": _from_header() if settings.SMTP_USER else "",
    }
