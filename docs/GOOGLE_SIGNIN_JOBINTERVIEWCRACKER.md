# Google sign-in for jobinterviewcracker.com

InterviewPulse already implements **server-side Google OAuth** (FastAPI).  
You only need Google Cloud credentials + production URLs — not NextAuth, Passport, or GIS.

## Architecture

```
User clicks "Continue with Google"
    → https://api.jobinterviewcracker.com/v1/auth/google
    → Google consent screen
    → https://api.jobinterviewcracker.com/v1/auth/google/callback
    → Backend creates user + JWT
    → Redirect https://jobinterviewcracker.com/#/auth/callback?token=...
    → App stores token → signed in
```

| Host | Role |
|------|------|
| `https://jobinterviewcracker.com` | React UI (static build) |
| `https://api.jobinterviewcracker.com` | FastAPI (`copilot_api.py`) |

If you prefer a single host, reverse-proxy `/v1` and `/api` and `/ws` to the API and set  
`GOOGLE_REDIRECT_URI=https://jobinterviewcracker.com/v1/auth/google/callback`.

## 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select/create project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External** (public product)
   - App name: **Job Interview Cracker**
   - User support email: your Gmail
   - **Authorized domains:** `jobinterviewcracker.com`
   - Developer contact: your email
   - Scopes: leave defaults (`openid`, `email`, `profile`) or add them explicitly
   - Test users: add your Gmail while status is **Testing**
   - For real users: publish the app (Verification may be required later)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Job Interview Cracker Web`
   - **Authorized JavaScript origins**
     - `https://jobinterviewcracker.com`
     - `https://www.jobinterviewcracker.com` (if you use www)
   - **Authorized redirect URIs**
     - `https://api.jobinterviewcracker.com/v1/auth/google/callback`
4. Copy **Client ID** and **Client Secret**.

## 2. Server env (`src/.env` on the API host)

Use `src/.env.production.example` as a template:

```env
FRONTEND_URL=https://jobinterviewcracker.com
PUBLIC_API_URL=https://api.jobinterviewcracker.com
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://api.jobinterviewcracker.com/v1/auth/google/callback
JWT_SECRET=long-random-secret
AUTH_REQUIRED=true
AUTH_DEV_BYPASS=false
COPILOT_API_HOST=0.0.0.0
COPILOT_API_PORT=8787
```

Restart the API after saving.

## 3. UI build (`interview-pulse-ai`)

```bat
cd interview-pulse-ai
copy .env.production.example .env.production
REM edit VITE_* URLs if needed
npm run build
```

Deploy the `dist/` folder to the host that serves `jobinterviewcracker.com`.

## 4. Reverse proxy (example)

Point DNS:

- `jobinterviewcracker.com` → UI server  
- `api.jobinterviewcracker.com` → API server  

TLS required (Google OAuth + secure cookies / mixed content).

**Caddy sketch for API:**

```
api.jobinterviewcracker.com {
  reverse_proxy 127.0.0.1:8787
}
```

**Nginx sketch for API:**

```nginx
server {
  server_name api.jobinterviewcracker.com;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## 5. Verify

1. Open `https://jobinterviewcracker.com` → should show **sign-in** (when `AUTH_REQUIRED=true`).
2. Click **Continue with Google**.
3. Pick a Google account → land back on the site signed in.
4. Check API: `https://api.jobinterviewcracker.com/v1/auth/config`  
   - `google_configured: true`  
   - `auth_required: true`  
   - `dev_bypass: false`

## Local vs production

| | Local | Production |
|--|--------|------------|
| Domain | `http://localhost:5173` | `https://jobinterviewcracker.com` |
| Redirect | `http://127.0.0.1:8787/v1/auth/google/callback` | `https://api.jobinterviewcracker.com/v1/auth/google/callback` |
| `AUTH_REQUIRED` | `false` (open testing) | `true` |
| `AUTH_DEV_BYPASS` | optional `true` | **always `false`** |

You can keep both OAuth clients, or one client with **both** local and production redirect URIs listed.

## Common errors

| Symptom | Fix |
|---------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Console must **exactly** match `GOOGLE_REDIRECT_URI` (https, host, path, no trailing slash). |
| Google button disabled | `GOOGLE_CLIENT_ID` / `SECRET` missing; restart API; check `/v1/auth/config` → `google_configured`. |
| Sign-in works but no gate | Backend still has `AUTH_REQUIRED=false` or `AUTH_DEV_BYPASS=true`. |
| Stuck after Google | `FRONTEND_URL` must be `https://jobinterviewcracker.com` (no wrong port). |
| Mixed content blocked | UI is https but `VITE_COPILOT_API_URL` still points at `http://…`. |

## Not used here

- NextAuth / Auth.js  
- Passport.js  
- Google Identity Services (`gsi/client`) ID-token button  

Code paths: `src/backend/google_oauth.py`, `interview-pulse-ai/src/services/auth.ts`.
