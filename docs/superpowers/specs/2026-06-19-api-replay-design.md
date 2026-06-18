# Design — API replay for iClosed flows (capture-driven)

**Date:** 2026-06-19
**Status:** Draft for review
**Author:** Zarrar + Claude

## Goal

Replace fragile UI/browser automation with direct **API calls** where practical, by
**capturing** the real network traffic the iClosed UI makes (HAR), then **replaying** the
relevant request sequence from Node. Two scopes:

- **Scope 1 (now, high value):** the **add-payment-method** step on the app Billing page —
  the current blocker in the Zero-funds flow. Replace the Settings→Billing→Stripe-iframe UI
  with `login → token → add-payment-method` API calls.
- **Scope 2 (later, bigger):** full **account creation** (signup → Stripe → onboarding),
  currently done by `electron/iclosed-flow.cjs`.

## Why

- UI automation is brittle (selectors, iframes, consent banners) and sensitive to dev-env
  downtime; APIs are generally faster, deterministic, and easier to maintain.
- We already have the pattern: the back-office API (umbilling) is called directly with a
  cached bearer token over `node:https` with a corp-TLS workaround ([[backoffice-api]]).

## The hard constraints / open questions (the HAR must answer these)

These determine whether API replay is viable; do **not** assume — read them off the capture:

1. **Auth bootstrap** — how does the UI authenticate? (login endpoint, returns JWT/cookie?
   CSRF header?) We must reproduce exactly what later calls send.
2. **Stripe card handling** — the UI tokenizes the card client-side with Stripe.js. The HAR
   will show which Stripe endpoint + key is used (we saw `pk_test_51MK1A2…` in the dashboard
   iframe). Replay options: create the PaymentMethod via Stripe's API with the **publishable
   key** + raw **test** card (allowed client-side in test mode), then hand the `pm_…` to the
   iClosed endpoint. Confirm the exact shape from the HAR.
3. **Dynamic chaining** — which response fields feed later requests (account id, setup-intent
   client secret, onboarding step ids). Replay must thread these, not fire a static list.
4. **Bot protection (the go/no-go gate)** — login page already loads Cookiebot + Hotjar +
   fingerprint tokens. If signup/login requires hCaptcha/recaptcha or a device-fingerprint
   token that only the browser can produce, **pure API replay is blocked** for that step.
   Check this FIRST for Scope 2.
5. **Corp TLS** — Node networking needs the scoped insecure `https.Agent` (the proxy breaks
   normal verification); pg/back-office code already does this.

## Capture method (your "run once, track every call" — automated)

Use Playwright **HAR recording** while a human drives the UI (no selectors needed):

- Launch a headed context with `recordHar`, open the app, and let the user **manually** log
  in and add a card. Playwright records **every** request/response. On window close, the HAR
  is flushed.
- This sidesteps the flaky Settings→Billing selectors entirely for discovery — we only need
  the *traffic*, not automated clicks.

Capture harness (`scripts/har-capture.ts`, runnable when dev is up):

```ts
// Records all network to artifacts/<label>.har while you drive the app manually.
//   npx tsx scripts/har-capture.ts addcard
import { chromium } from "playwright";
const label = process.argv[2] || "capture";
(async () => {
  const ctx = await chromium.launchPersistentContext(".har-profile", {
    headless: false,
    channel: "chrome",
    recordHar: { path: `artifacts/${label}.har`, content: "embed" },
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://dev.iclosed.io/auth/login");
  console.log(`Recording → artifacts/${label}.har. Drive the flow, then CLOSE the window to save.`);
  await ctx.waitForEvent("close", { timeout: 0 }); // until the user closes the window
})();
```

(Secrets: the HAR contains tokens/cookies/card data — keep it under gitignored `artifacts/`.)

## Architecture (replay client)

A small typed client in `src/api/` (ESM, reused by main process), per scope:

- `src/api/http.ts` — thin `request(method, url, { headers, json })` over `node:https` with
  the scoped insecure agent (mirror the back-office client); JSON in/out; error surfacing.
- `src/api/iclosed-app.ts` — `login(email, password) → { token, … }`, then
  `addPaymentMethod(token, pm) → …`, built **from the captured payloads**.
- `src/api/stripe.ts` — `createTestPaymentMethod(pubKey, cardNumber) → pm_…` if the HAR shows
  client-side PM creation; otherwise fold into the iClosed call.
- Wire into the Zero-funds flow as an **alternative to** `addCardOnAppBilling` (keep the UI
  path as a fallback behind a setting until the API path is proven).

## Phasing

- **Phase A — Capture (when dev up):** add `scripts/har-capture.ts`; record one HAR each for
  (a) login, (b) add-payment-method on Billing, (c) full signup (for Scope 2). Analyze.
- **Phase B — Scope 1 impl:** from the add-card HAR, build `http.ts` + `iclosed-app.ts`
  (login + addPaymentMethod) and, if needed, `stripe.ts`. Replace the app-Billing UI step in
  the Zero-funds flow with the API call. Verify the `…5556` method appears (via API read or a
  quick UI check). Keep UI fallback.
- **Phase C — Scope 2 (separate brainstorm/spec):** only after confirming **no captcha**;
  build the signup→Stripe→onboarding sequence; migrate the Create-user flow with the existing
  UI engine retained as fallback.

## Decision criteria (go / no-go)

- **Go** for a step if: its calls are reproducible from captured fields + a login token, with
  no browser-only secret (captcha/fingerprint) required.
- **No-go (keep UI)** if a step needs a browser-solved challenge or an unreproducible
  client-side value. Document which, and stop there.

## Risks

- Undocumented private APIs can change (like selectors) — but they're easier to diff/version,
  and the HAR is a re-capturable spec.
- Stripe raw-card PM creation is test-mode only (fine here; these are test cards).
- HARs hold live secrets/card data → must stay in gitignored `artifacts/`.

## Out of scope

- Production use (test mode only). Bypassing any anti-bot protection.
