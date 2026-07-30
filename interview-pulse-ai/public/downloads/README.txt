InterviewPulse desktop installers
=================================

IMPORTANT
---------
Cloudflare Pages cannot host the Windows installer (~100MB+; Pages has a
per-file size limit). If nothing real is at /downloads/*.exe, the SPA
fallback serves index.html as "Setup.exe" (~1-2 KB) and Windows reports:

  "The file or directory is corrupted and unreadable."

Production download URL (preferred)
-----------------------------------
GitHub Releases asset (used by the web UI by default):

  https://github.com/srinaidu4data-coder/Astra/releases/latest/download/InterviewPulse-Setup.exe

Publish a new build:

  cd interview-pulse-ai
  npm run dist:win
  gh release create desktop-vX.Y.Z release/InterviewPulse-Setup.exe --title "InterviewPulse Desktop vX.Y.Z" --latest

Optional Cloudflare Pages build env:

  VITE_DESKTOP_DOWNLOAD_URL=https://github.com/srinaidu4data-coder/Astra/releases/latest/download/InterviewPulse-Setup.exe

Local files in this folder
--------------------------
  InterviewPulse-Setup.exe   Windows (from: npm run dist:win -> release/)
  InterviewPulse-Mac.dmg     macOS   (from: npm run dist:mac)

These *.exe / *.dmg files are gitignored on purpose.

Protocol
--------
Installed app also opens via: interviewpulse://open
