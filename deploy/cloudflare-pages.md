# Cloudflare Pages — frontend only

## Build settings (Cloudflare dashboard)

| Setting | Value |
|---------|--------|
| Framework preset | Vite |
| Root directory | `interview-pulse-ai` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Node version | 20 |

## Environment variables (Pages → Settings → Environment variables)

Production:

```
VITE_COPILOT_API_URL=https://api.jobinterviewcracker.com
VITE_COPILOT_API=https://api.jobinterviewcracker.com
VITE_COPILOT_WS=wss://api.jobinterviewcracker.com/ws/interview
```

## Custom domain

Pages → Custom domains → `jobinterviewcracker.com` + `www.jobinterviewcracker.com`

DNS must be on Cloudflare (nameservers changed from GoDaddy).
