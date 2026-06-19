# Building iClosed Billing for macOS

Guide for producing the macOS app (`.dmg`) **on a Mac**. electron-builder can only build
the macOS app on macOS — not on Windows/Linux.

## Prerequisites

- macOS
- Node.js 18+ (`brew install node`, or from nodejs.org)
- **Google Chrome** installed — the Create-user and zero-funds flows drive system Chrome

## Build — one-click

1. Get the project on the Mac (`git clone <repo>`, or copy the folder).
2. In Finder, **double-click `build-macos.command`**. It runs, in order:
   `npm install` → `npx playwright install chromium` → `npm run app:build:mac`.
   - If macOS blocks it ("cannot be opened"), right-click → **Open** once, or run:
     `xattr -d com.apple.quarantine build-macos.command`
3. When it finishes, the installer is at **`release/iClosed Billing-1.0.0.dmg`**.

## Build — manual (identical steps)

```bash
npm install
npx playwright install chromium
npm run app:build:mac        # → release/iClosed Billing-1.0.0.dmg
```

## Two things to remember

1. **Runtime needs Google Chrome installed.** The Create-user flow and the zero-funds
   app-login step drive system Chrome (`channel:'chrome'`); the Stripe/downgrade flow uses
   Playwright's Chromium, installed by the build step (`npx playwright install chromium`).
   If the app will *run* on a different Mac than the one it was built on, run
   `npx playwright install chromium` there too.
2. **The build is unsigned**, so Gatekeeper warns on first launch:
   - right-click the app → **Open** → **Open**, or
   - `xattr -d com.apple.quarantine "/Applications/iClosed Billing.app"`

## First run

Configure DB / Stripe / Back-office / App URL in the **Settings** tab — values are stored
under the app's user-data directory (each user configures their own; nothing is baked into
the build).
