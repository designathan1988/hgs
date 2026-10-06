@echo off
setlocal
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"
set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import http.server" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import http.server" >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
  )
)
if not exist "node_modules\three\package.json" (
  echo The local Three.js package is missing. Run npm install in this folder first.
  pause
  exit /b 1
)
if not defined PYTHON_CMD (
  echo Python was not found. Install Python 3 and try again.
  pause
  exit /b 1
)
echo Human Generator Studio
echo Project: %CD%
echo URL: %URL%
echo Starting local server on port %PORT%...
start "" "%URL%"
%PYTHON_CMD% server.py %PORT%
if errorlevel 1 echo Server failed. Port %PORT% may already be in use.
echo Server stopped.
pause
