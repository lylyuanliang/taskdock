@echo off
setlocal

cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found on PATH.
  echo Install pnpm or enable Corepack, then run this file again.
  pause
  exit /b 1
)

echo Using the production TaskDock identifier and data directory.
echo Make sure the installed TaskDock app is closed before continuing.
echo.

call pnpm tauri dev
set "exit_code=%errorlevel%"

if not "%exit_code%" == "0" (
  echo.
  echo TaskDock development process exited with code %exit_code%.
  pause
)

endlocal & exit /b %exit_code%
