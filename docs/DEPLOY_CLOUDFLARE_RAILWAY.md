# Deploy jobinterviewcracker.com

**Recommended stack**

| Layer | Service | Why |
|-------|---------|-----|
| DNS + CDN | **Cloudflare** | Free SSL, fast global edge, replaces GoDaddy Website Builder DNS |
| Frontend | **Cloudflare Pages** | Static Vite/React, free HTTPS, custom domain |
| Backend | **Railway** (or Render) | Runs Python + Whisper Docker; custom domain `api.` |
| Auth | Google OAuth (already in app) | Redirect to API callback |

Cloudflare **Workers** alone cannot run Whisper. Use Pages for UI + a real container host for the API.

---

## Architecture

```
Browser
  ├─ https://jobinterviewcracker.com     → Cloudflare Pages (UI)
  └─ https://api.jobinterviewcracker.com → Railway (FastAPI + Whisper)
         └─ Google OAuth callback:
            /v1/auth/google/callback
```

---

## 0. Before you start

1. **Google Cloud** OAuth client — add production URLs:
   - JS origins: `https://jobinterviewcracker.com`, `https://www.jobinterviewcracker.com`
   - Redirect URI: `https://api.jobinterviewcracker.com/v1/auth/google/callback`
2. **Secrets ready**
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (you already have these)
   - `JWT_SECRET` (long random string)
   - `OPENAI_API_KEY` (needed for real interview answers)
3. Code on **GitHub** (push this repo)

---

## 1. Move DNS to Cloudflare

Domain is currently on **GoDaddy** (`ns59/ns60.domaincontrol.com`) with GoDaddy Website Builder.

1. Create free account at [cloudflare.com](https://dash.cloudflare.com)
2. **Add site** → `jobinterviewcracker.com`
3. Cloudflare shows two nameservers (e.g. `ada.ns.cloudflare.com`)
4. GoDaddy → Domain → Nameservers → **Change** to Cloudflare’s nameservers
5. Wait until Cloudflare status is **Active** (often 5–60 min)
6. You can turn off GoDaddy Website Builder; Pages will serve the real app

---

## 2. Deploy API on Railway

1. [railway.app](https://railway.app) → Login with GitHub  
2. **New Project** → **Deploy from GitHub** → select `Astra` repo  
3. Settings → **Root Directory** = repo root  
4. Build uses `deploy/Dockerfile.api` via `deploy/railway.toml`  
5. **Variables** (set all):

```env
COPILOT_API_HOST=0.0.0.0
COPILOT_API_PORT=8787
AUTH_REQUIRED=true
AUTH_DEV_BYPASS=false
FRONTEND_URL=https://jobinterviewcracker.com
PUBLIC_API_URL=https://api.jobinterviewcracker.com
GOOGLE_CLIENT_ID=75063910639-5nsge06a1pishurpefqb4gpuhr6e3tah.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-secret>
GOOGLE_REDIRECT_URI=https://api.jobinterviewcracker.com/v1/auth/google/callback
JWT_SECRET=<openssl rand -hex 32>
OPENAI_API_KEY=<your-openai-key>
EMAIL_PASSWORD_AUTH_ENABLED=true
DATABASE_URL=sqlite:////data/db/astra_backend.db
```

6. **Settings → Networking → Generate Domain** (temporary `*.up.railway.app`)  
7. Confirm health: `https://YOUR.up.railway.app/api/health` → `{"ok":true}`  
8. **Custom domain**: add `api.jobinterviewcracker.com`  
9. In **Cloudflare DNS**, add:

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| CNAME | `api` | `YOUR.up.railway.app` | DNS only (grey cloud) **or** Proxied if WebSockets work |

> For WebSockets (`/ws/interview`), if live interview breaks behind orange cloud, set **DNS only** (grey) for `api`.

10. Railway TLS will issue cert for `api.jobinterviewcracker.com` once DNS points correctly.

---

## 3. Deploy UI on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → Connect GitHub  
2. Select repo `Astra`  
3. Build config:

| Field | Value |
|-------|--------|
| Root directory | `interview-pulse-ai` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |

4. **Environment variables** (Production):

```
VITE_COPILOT_API_URL=https://api.jobinterviewcracker.com
VITE_COPILOT_API=https://api.jobinterviewcracker.com
VITE_COPILOT_WS=wss://api.jobinterviewcracker.com/ws/interview
```

5. Deploy  
6. **Custom domains** → add `jobinterviewcracker.com` and `www`  
7. Cloudflare will create the necessary DNS records automatically when the zone is on Cloudflare

---

## 4. Google OAuth final check

| Setting | Value |
|---------|--------|
| Authorized JS origins | `https://jobinterviewcracker.com` |
| Authorized redirect URIs | `https://api.jobinterviewcracker.com/v1/auth/google/callback` |
| Consent screen domain | `jobinterviewcracker.com` |
| Test users | Your Gmail (while app is in Testing) |

---

## 5. Smoke test

1. `https://api.jobinterviewcracker.com/api/health` → ok  
2. `https://api.jobinterviewcracker.com/v1/auth/config` → `google_configured: true`, `auth_required: true`  
3. `https://jobinterviewcracker.com` → **Continue with Google**  
4. Complete Google login → land on app signed in  
5. Copilot / Practice still need `OPENAI_API_KEY` for LLM answers  

---

## Alternatives

| Backend host | Notes |
|--------------|--------|
| **Render** | Use `deploy/render.yaml`; free tier may spin down |
| **Fly.io** | `fly launch` with `deploy/Dockerfile.api` |
| **VPS + Caddy** | Cloudflare DNS → VPS IP; run Docker Compose on the box |

Frontend stays on **Cloudflare Pages** in all cases.

---

## GoDaddy Website Builder

The current site is a GoDaddy builder page. After Cloudflare + Pages go live, that builder site is no longer used. Keep the **domain registration** at GoDaddy (or transfer later); only nameservers move to Cloudflare.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Production callback URI missing in Google Console |
| UI loads, API CORS / failed fetch | Wrong `VITE_COPILOT_API_URL` or API down |
| Google works, answers fail | Set `OPENAI_API_KEY` on Railway |
| WebSocket fails | Grey-cloud the `api` CNAME in Cloudflare |
| Pages build fails | Node 20; root dir `interview-pulse-ai` |
