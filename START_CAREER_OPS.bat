@echo off
title career-ops (separate from InterviewPulse)
cd /d "%~dp0career-ops"

echo.
echo  === career-ops (santifer/career-ops) ===
echo  Separate open-source job search agent
echo  Docs: career-ops\ASTRA_SETUP.md
echo  Upstream: https://github.com/santifer/career-ops
echo.

if not exist node_modules (
  echo Installing npm dependencies...
  call npm.cmd install
)

echo.
echo Running doctor...
call npm.cmd run doctor

echo.
echo Useful:
echo   npm run scan
echo   npm run tracker
echo   npm run pdf
echo.
echo Keep this folder separate from interview-pulse-ai / src\jobsearch.
cmd /k
