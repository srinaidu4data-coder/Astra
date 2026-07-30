InterviewPulse desktop installers
=================================

Place built installers here so the web app can offer one-click download:

  InterviewPulse-Setup.exe   ← Windows (from: npm run dist:win)
  InterviewPulse-Mac.dmg     ← macOS   (from: npm run dist:mac)

Build steps (from interview-pulse-ai/):

  npm run dist:win

Copy the installer from release/ into this folder (or into the site's
published /downloads/ path), then redeploy the web app.

Optional production override (build-time env):

  VITE_DESKTOP_DOWNLOAD_URL=https://your-cdn/InterviewPulse-Setup.exe

The web UI "Desktop" button will download that URL and can also try to open
an already-installed app via interviewpulse://open
