@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    5K6Learn MathBot - starting backend
echo   ============================================
echo.
if not exist ".venv\Scripts\python.exe" (
  echo [setup] Creating virtual environment...
  python -m venv .venv
)
".venv\Scripts\python.exe" -c "import fastapi, sympy, uvicorn" >nul 2>nul
if errorlevel 1 (
  echo [setup] Installing dependencies...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r backend\requirements.txt
  if errorlevel 1 goto :fail
)
if not exist "backend\.env" copy "backend\.env.example" "backend\.env" >nul
echo.
echo   Open the website at:  http://127.0.0.1:8000
echo   API docs:             http://127.0.0.1:8000/docs
echo   Keep this window open. Press Ctrl+C to stop.
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
goto :eof
:fail
echo.
echo Setup failed. Check that Python 3.10+ is installed and you have internet access.
pause
