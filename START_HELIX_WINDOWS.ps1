$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path .venv\Scripts\python.exe)) { py -m venv .venv }
& .\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e ".[dev]"
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m app.main
