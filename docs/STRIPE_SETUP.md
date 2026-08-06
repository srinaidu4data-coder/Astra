# Stripe setup — InterviewPulse

## Plugin

The **Stripe Grok plugin** is enabled in `~/.grok/config.toml` (`plugins.enabled` includes `"stripe"`).

- Source: [stripe/ai](https://github.com/stripe/ai) via xAI marketplace  
- Skills: billing, payments, Connect, tax, security best practices  

MCP Stripe tools need Dashboard auth when you connect them; code uses the Python SDK with env keys.

## Architecture

| Piece | Location |
|-------|----------|
| Checkout / portal / webhooks | `src/backend/billing.py` |
| StripeClient factory | `src/backend/stripe_client.py` |
| Product catalog | `src/backend/products.py` |
| Entitlements after pay | `src/backend/entitlements.py` |
| UI paywall | `interview-pulse-ai/src/pages/PaywallPage.tsx` |
| FE client | `interview-pulse-ai/src/services/auth.ts` |

Flow: **Google/email sign-in → Stripe Checkout (subscription or one-time) → confirm-session or webhook → access.**

Checkout uses **dynamic payment methods** (no hardcoded `payment_method_types`).

## Local sandbox (7-day, claimable)

```bash
# Install CLI once
npm i -g @stripe/cli

# Temporary sandbox + test keys
stripe sandbox create --from-git --non-interactive

# Create Pro / Pass / Sprint prices
set STRIPE_SECRET_KEY=rkcs_test_...   # from sandbox output
python src/scripts/setup_stripe_catalog.py

# Paste printed STRIPE_PRICE_* into src/.env
# Optional: stripe listen --forward-to localhost:8787/v1/billing/webhook
```

Claim before expiry:

```bash
stripe sandbox claim
# or open the claim_url from sandbox create
```

## Railway (production)

Set on service **api**:

```
STRIPE_SECRET_KEY=sk_live_...   # or test key while validating
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...               # pro monthly (legacy)
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_INTERVIEW_PASS=price_...
STRIPE_PRICE_INTERVIEW_SPRINT=price_...
STRIPE_SUCCESS_URL=https://jobinterviewcracker.com/#/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://jobinterviewcracker.com/#/billing?checkout=cancel
FRONTEND_URL=https://jobinterviewcracker.com
PUBLIC_API_URL=https://api.jobinterviewcracker.com
```

Webhook in Stripe Dashboard → Developers → Webhooks:

- URL: `https://api.jobinterviewcracker.com/v1/billing/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`

Redeploy after setting variables.

## Verify

```bash
curl -s https://api.jobinterviewcracker.com/v1/auth/config | jq .stripe_configured
# true when key + any price id are set
```

Signed-in user → Paywall → **Subscribe monthly** → Stripe Checkout → return with `session_id` → `/v1/billing/confirm-session`.
