#!/usr/bin/env python3
"""Create InterviewPulse Stripe Products + Prices (sandbox or live).

Usage:
  set STRIPE_SECRET_KEY=sk_test_...   # or rk_ / rkcs_
  python src/scripts/setup_stripe_catalog.py

Prints env lines you can paste into Railway / src/.env.
Does not write secrets to disk.
"""

from __future__ import annotations

import os
import sys

try:
    from stripe import StripeClient
except ImportError:
    print("Install stripe: pip install 'stripe>=11'", file=sys.stderr)
    sys.exit(1)


SPECS = [
    # name, astra code, cents, recurring interval or None for one-time
    ("InterviewPulse Pro Monthly", "pro_monthly", 5900, "month"),
    ("Interview Pass", "interview_pass", 1900, None),
    ("Interview Sprint", "interview_sprint", 3900, None),
]


def main() -> int:
    key = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        print("Set STRIPE_SECRET_KEY first.", file=sys.stderr)
        return 1

    client = StripeClient(key)
    print("Creating products + prices…\n")
    mapping: dict[str, str] = {}

    for name, code, cents, interval in SPECS:
        product = client.v1.products.create(
            params={"name": name, "metadata": {"astra_code": code}}
        )
        price_params: dict = {
            "product": product.id,
            "unit_amount": cents,
            "currency": "usd",
        }
        if interval:
            price_params["recurring"] = {"interval": interval}
        price = client.v1.prices.create(params=price_params)
        mapping[code] = price.id
        print(f"  {code}: product={product.id}  price={price.id}")

    print("\n# --- paste into Railway / src/.env ---\n")
    print(f"STRIPE_SECRET_KEY={key[:12]}…  # already set")
    print(f"STRIPE_PRICE_ID={mapping['pro_monthly']}")
    print(f"STRIPE_PRICE_PRO_MONTHLY={mapping['pro_monthly']}")
    print(f"STRIPE_PRICE_INTERVIEW_PASS={mapping['interview_pass']}")
    print(f"STRIPE_PRICE_INTERVIEW_SPRINT={mapping['interview_sprint']}")
    print(
        "STRIPE_SUCCESS_URL=https://jobinterviewcracker.com/#/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"
    )
    print("STRIPE_CANCEL_URL=https://jobinterviewcracker.com/#/billing?checkout=cancel")
    print("\n# Webhook: POST /v1/billing/webhook")
    print(
        "# Events: checkout.session.completed, customer.subscription.*, "
        "invoice.payment_*, charge.refunded, charge.refund.updated, charge.dispute.created"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
