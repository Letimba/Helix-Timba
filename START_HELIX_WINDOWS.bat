@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo [HELIX] Creating virtual environment...
  py -m venv .venv
  if errorlevel 1 goto :fail
)
echo [HELIX] Installing/updating dependencies...
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -U pip
if errorlevel 1 goto :fail
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -e ".[dev]"
if errorlevel 1 goto :fail
if not exist .env copy /y .env.example .env >nul
echo.
echo [HELIX] Starting V5.3.1 on http://127.0.0.1:8088
echo [HELIX] Press CTRL+C to stop.
.venv\Scripts\python.exe -m app.main
goto :eof
:fail
echo.
echo [HELIX] Startup failed. Read the error above.
pause
exit /b 1
