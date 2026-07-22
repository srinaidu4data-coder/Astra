cd /d C:\Users\montg\OneDrive\Desktop\Astra\src
set PYTHONPATH=C:\Users\montg\OneDrive\Desktop\Astra\src
set DATABASE_URL=sqlite:///./astra_backend.db
title Astra API - KEEP OPEN - http://127.0.0.1:8000
echo Starting Astra on http://127.0.0.1:8000
echo KEEP THIS WINDOW OPEN
venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
