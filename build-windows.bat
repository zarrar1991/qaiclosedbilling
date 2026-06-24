@echo off
REM ============================================================================
REM  iClosed Billing - one-click Windows build
REM
REM  Double-click this file. It will:
REM    1) npm install
REM    2) npx playwright install chromium
REM    3) npm run app:build:win   ->  release\iClosed Billing Setup 1.0.0.exe
REM ============================================================================
setlocal
cd /d "%~dp0"

REM Some environments set NODE_OPTIONS=--use-system-ca, which Electron rejects.
REM Clear it for this build session only (does not change your global env).
set "NODE_OPTIONS="

echo ===============================================
echo    iClosed Billing - Windows build
echo ===============================================
echo Folder: %cd%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js / npm was not found.
  echo     Install Node 18+ from https://nodejs.org then re-run this file.
  goto :pause_end
)

for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo Using Node %NODEV%
echo.

echo [1/3] Installing dependencies (npm install)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] Installing Playwright Chromium...
call npx playwright install chromium
if errorlevel 1 goto :fail

echo.
echo [3/3] Building the Windows app (this can take a few minutes)...
call npm run app:build:win
if errorlevel 1 goto :fail

echo.
echo [OK] Done. Your installer is here:
echo      %cd%\release\
echo    Look for:  "iClosed Billing Setup 1.0.0.exe"
goto :pause_end

:fail
echo.
echo [X] Build failed - see the messages above.

:pause_end
echo.
pause
endlocal
