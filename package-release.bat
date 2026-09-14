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

echo TaskDock Windows release packaging is starting.
echo Stop every pnpm tauri dev instance before continuing.
echo.

call pnpm tauri build
set "exit_code=%errorlevel%"

if "%exit_code%" == "0" (
  echo.
  echo Packaging completed successfully.
  echo NSIS installer: src-tauri\target\release\bundle\nsis\
  echo MSI installer:  src-tauri\target\release\bundle\msi\
) else (
  echo.
  echo Packaging failed with exit code %exit_code%.
  pause
)

endlocal & exit /b %exit_code%
