import { defineConfig } from "@playwright/test";

// Browser launch is handled manually in src/stripe-flow.ts via a persistent
// context (chromium.launchPersistentContext). This config exists so the
// Playwright toolchain/types are available and trace viewing works.
export default defineConfig({
  use: {
    headless: false,
    trace: "on",
  },
});
