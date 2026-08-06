# Company Twin Interview Sprint — environment & deploy

## New / extended environment variables

```env
# Existing monthly (legacy → pro_monthly)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...                 # Pro monthly fallback

# Sprint product prices (create in Stripe Dashboard)
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_INTERVIEW_PASS=price_...     # one-time $19
STRIPE_PRICE_INTERVIEW_SPRINT=price_...   # one-time $39

# Optional display/limit overrides (cents / hours / minutes)
PRICE_INTERVIEW_PASS_CENTS=1900
PRICE_INTERVIEW_SPRINT_CENTS=3900
PRICE_PRO_MONTHLY_CENTS=5900
PASS_DURATION_HOURS=72
PASS_LIVE_MINUTES=120
SPRINT_DURATION_HOURS=336
SPRINT_LIVE_MINUTES=180
PRO_LIVE_MINUTES_PER_MONTH=600
PRO_MAX_OPPORTUNITIES=5

FRONTEND_URL=https://jobinterviewcracker.com
PUBLIC_API_URL=https://api.jobinterviewcracker.com
STRIPE_SUCCESS_URL=https://jobinterviewcracker.com/#/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://jobinterviewcracker.com/#/billing?checkout=cancel
```

## Stripe Dashboard checklist

1. Create products: Interview Pass (one-time), Interview Sprint (one-time), Pro Monthly (recurring).
2. Copy price IDs into Railway env.
3. Webhook endpoint: `https://api.jobinterviewcracker.com/v1/billing/webhook`
   - Events: `checkout.session.completed`, subscription lifecycle, invoice, charge.refunded.
4. Customer Portal enabled for cancel/refunds.

## Server-side entitlement

- Free signed-in users: diagnostic + Sprint setup (no dossier/live).
- Pass/Sprint: `entitlements` table rows with expiry + live minute meters.
- Pro monthly: `users.subscription_*` + entitlement grant on checkout.
- Webhooks + `POST /v1/billing/confirm-session` both grant access (idempotent by checkout session id).

## API surface (new)

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/sprint/entitlements` | JWT |
| GET/POST | `/v1/sprint/opportunities` | JWT |
| PATCH | `/v1/sprint/opportunities/{id}` | JWT |
| POST | `/v1/sprint/diagnostic` | JWT (free) |
| POST | `/v1/sprint/opportunities/{id}/dossier` | paid |
| GET | `/v1/sprint/opportunities/{id}/stories` | JWT |
| PATCH | `/v1/sprint/stories/{id}` | JWT |
| POST | `/v1/sprint/opportunities/{id}/mock-plan` | paid |
| GET | `/v1/sprint/opportunities/{id}/live-context` | paid |
| POST | `/v1/sprint/debrief` | paid |
| POST | `/v1/sprint/events` | JWT |
| GET | `/v1/billing/products` | JWT |
| POST | `/v1/billing/checkout` | JWT + `{product_code}` |
