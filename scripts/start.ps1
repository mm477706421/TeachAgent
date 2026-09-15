$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$pythonPath = Join-Path (Get-Location) '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run python -m venv .venv and install requirements.txt first.' }
if (-not (Test-Path -LiteralPath 'frontend/dist/index.html')) { throw 'Build frontend first: cd frontend; npm ci; npm run build' }
& $pythonPath -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
