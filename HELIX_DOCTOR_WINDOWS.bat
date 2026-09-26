@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -m venv .venv
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -e ".[dev]"
if errorlevel 1 goto :fail
.venv\Scripts\python.exe scripts\doctor.py
pause
goto :eof
:fail
echo Failed to install dependencies.
pause
exit /b 1
