import { defineConfig, devices } from "@playwright/test";

/**
 * D13: shallow smoke only — this exists to catch build/routing/auth-render
 * breakage (a broken import, a route that 500s, a page that doesn't mount),
 * not to exercise the live Tavus conversation. See docs/ARCHITECTURE.md
 * "Test scope". Chromium only: this is not a cross-browser suite.
 */
// A dedicated, unlikely-to-collide port. `next dev` (package.json's "dev"
// script, untouched here) honors PORT from the environment when no -p flag
// is given, so webServer.env below picks the port without editing the script.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    // Next dev's cold start (first compile) can comfortably exceed 30s on a
    // cold cache; give it real headroom rather than flaking the whole suite.
    timeout: 120_000,
  },
});
