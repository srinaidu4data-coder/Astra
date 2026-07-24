# Railway + Cloudflare — step-by-step checklist

Repo: https://github.com/fourwheels2512/Astra  
Domain: jobinterviewcracker.com  

Mark each box as you finish. After each major step, tell the AI “done step N”.

---

## Step 1 — Cloudflare account + DNS (do this first)

### 1A. Create / log in
1. Go to https://dash.cloudflare.com and sign up or log in.
2. Click **Add a domain** → enter `jobinterviewcracker.com` → **Continue**.
3. Choose the **Free** plan.

### 1B. Copy Cloudflare nameservers
Cloudflare shows two nameservers, for example:
- `ada.ns.cloudflare.com`
- `bob.ns.cloudflare.com`

Write them down (yours will differ).

### 1C. Point GoDaddy to Cloudflare
1. GoDaddy → **My Products** → Domains → `jobinterviewcracker.com` → **DNS** / **Nameservers**.
2. Choose **Change nameservers** → **Enter my own nameservers** (or “I’ll use my own”).
3. Replace GoDaddy’s `ns59/ns60.domaincontrol.com` with Cloudflare’s two nameservers.
4. Save.

### 1D. Wait until Active
- Back in Cloudflare, status should become **Active** (often 5–60 minutes, sometimes longer).
- You can continue Step 2 while waiting.

**Done when:** Cloudflare shows the domain as Active (or “Pending” is OK to start Railway).

---

## Step 2 — Deploy API on Railway

### 2A. Create project
1. Go to https://railway.app → **Login with GitHub**.
2. Authorize Railway to access the `fourwheels2512/Astra` repo.
3. **New Project** → **Deploy from GitHub repo** → select **Astra**.
4. If asked for root: leave repo root (Dockerfile is `deploy/Dockerfile.api` via `railway.toml`).

### 2B. Confirm build settings
- Railway should detect Docker.
- If not: **Settings → Build** → Dockerfile path = `deploy/Dockerfile.api`
- Watch the first deploy logs (first build can take several minutes because of Whisper deps).

### 2C. Add environment variables
Open the service → **Variables** → add these (Raw Editor is fine):

```env
COPILOT_API_HOST=0.0.0.0
AUTH_REQUIRED=true
AUTH_DEV_BYPASS=false
FRONTEND_URL=https://jobinterviewcracker.com
PUBLIC_API_URL=https://api.jobinterviewcracker.com
GOOGLE_CLIENT_ID=75063910639-5nsge06a1pishurpefqb4gpuhr6e3tah.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=PASTE_YOUR_SECRET_HERE
GOOGLE_REDIRECT_URI=https://api.jobinterviewcracker.com/v1/auth/google/callback
JWT_SECRET=509ed3568c3e89737ff6498580057d5f77fead0ba04d2a203f17347f32aa6fbf
EMAIL_PASSWORD_AUTH_ENABLED=true
DATABASE_URL=sqlite:////data/db/astra_backend.db
WELCOME_EMAIL_ENABLED=false
BILLING_EMAIL_ENABLED=false
```

Optional (needed for real AI answers):
```env
OPENAI_API_KEY=sk-...
```

Redeploy after saving variables if Railway doesn’t auto-redeploy.

### 2D. Public URL
1. Service → **Settings → Networking → Generate Domain**.
2. You get something like `https://astra-production-xxxx.up.railway.app`.
3. Test in browser:  
   `https://YOUR.up.railway.app/api/health`  
   Should return JSON with `"ok": true`.

### 2E. Custom domain api.jobinterviewcracker.com
1. Railway → **Networking → Custom Domain** → `api.jobinterviewcracker.com`.
2. Railway shows a CNAME target (e.g. `xxxx.up.railway.app`).
3. In **Cloudflare DNS** → **Add record**:

| Type | Name | Target | Proxy status |
|------|------|--------|--------------|
| CNAME | `api` | (Railway hostname) | **DNS only** (grey cloud) first |

4. Wait a few minutes. Test:  
   `https://api.jobinterviewcracker.com/api/health`

**Done when:** health endpoint works on the Railway URL (and ideally on `api.` too).

---

## Step 3 — Deploy UI on Cloudflare Pages

### 3A. Create Pages project
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Connect GitHub → select **fourwheels2512/Astra**.
3. Build settings:

| Field | Value |
|-------|--------|
| Project name | `jobinterviewcracker` (or similar) |
| Production branch | `master` |
| Root directory | `interview-pulse-ai` |
| Framework preset | Vite |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |

### 3B. Environment variables (Pages)
**Settings → Environment variables → Production:**

| Name | Value |
|------|--------|
| `VITE_COPILOT_API_URL` | `https://api.jobinterviewcracker.com` |
| `VITE_COPILOT_API` | `https://api.jobinterviewcracker.com` |
| `VITE_COPILOT_WS` | `wss://api.jobinterviewcracker.com/ws/interview` |
| `NODE_VERSION` | `20` |

### 3C. Deploy + custom domain
1. Save and **Deploy**.
2. After success: **Custom domains** → add `jobinterviewcracker.com` and `www.jobinterviewcracker.com`.
3. Cloudflare will create DNS records automatically.

**Done when:** `https://jobinterviewcracker.com` loads your InterviewPulse UI (not the old GoDaddy builder page).

---

## Step 4 — Google OAuth production URLs

1. https://console.cloud.google.com/apis/credentials  
2. Open OAuth client `75063910639-5nsge06a1pishurpefqb4gpuhr6e3tah...`  
3. **Authorized JavaScript origins** — add:
   - `https://jobinterviewcracker.com`
   - `https://www.jobinterviewcracker.com`
4. **Authorized redirect URIs** — add:
   - `https://api.jobinterviewcracker.com/v1/auth/google/callback`
5. Keep local ones if you still test locally:
   - `http://127.0.0.1:8787/v1/auth/google/callback`
6. **Save**.
7. OAuth consent screen → **Test users** → include your Gmail while app is in Testing.

---

## Step 5 — End-to-end test

1. `https://api.jobinterviewcracker.com/api/health` → ok  
2. `https://api.jobinterviewcracker.com/v1/auth/config` →  
   - `google_configured: true`  
   - `auth_required: true`  
   - `dev_bypass: false`  
3. `https://jobinterviewcracker.com` → sign-in screen  
4. **Continue with Google** → pick account → land back signed in  

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Railway build fails | Check logs; Dockerfile path `deploy/Dockerfile.api` |
| `redirect_uri_mismatch` | Step 4 redirect URI must match exactly |
| UI still GoDaddy page | Cloudflare not Active yet, or Pages domain not attached |
| API health fails on custom domain | Wait for DNS; CNAME grey-cloud; Railway domain verified |
| WebSocket / live interview fails | Keep `api` CNAME as **DNS only** (grey) |
| Answers empty | Set `OPENAI_API_KEY` on Railway |

---

## Suggested order of chat replies

1. “done step 1” — nameservers updated  
2. “done step 2” + paste Railway public URL  
3. “done step 3”  
4. “done step 4”  
5. “test failed” + screenshot/error text if anything breaks  
