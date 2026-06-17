#!/bin/bash
# ============================================================================
#  iClosed Billing — one-click macOS build
#
#  Double-click this file in Finder (it opens Terminal and runs itself).
#  It will:
#    1) npm install
#    2) npx playwright install chromium
#    3) npm run app:build:mac   ->  release/iClosed Billing-1.0.0.dmg
#
#  If macOS blocks it ("cannot be opened"), right-click -> Open the first time,
#  or run:  xattr -d com.apple.quarantine "build-macos.command"
# ============================================================================
set -e

# Always run from the repo root (this script's own folder), even with spaces.
cd "$(dirname "$0")"

pause() { echo; read -n 1 -s -r -p "Press any key to close…"; echo; }
trap 'echo; echo "❌ Build failed — see the messages above."; pause; exit 1' ERR

echo "==============================================="
echo "   iClosed Billing — macOS build"
echo "==============================================="
echo "Folder: $(pwd)"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Node.js / npm was not found."
  echo "   Install Node 18+ from https://nodejs.org (or: brew install node), then re-run."
  pause
  exit 1
fi
echo "Node $(node -v)  ·  npm $(npm -v)"
echo

echo "▶ [1/3] Installing dependencies (npm install)…"
npm install

echo
echo "▶ [2/3] Installing Playwright Chromium…"
npx playwright install chromium

echo
echo "▶ [3/3] Building the macOS app (this can take a few minutes)…"
npm run app:build:mac

echo
echo "✅ Done!  Your installer is here:"
echo "     $(pwd)/release/"
echo "   Look for:  iClosed Billing-1.0.0.dmg"
pause
