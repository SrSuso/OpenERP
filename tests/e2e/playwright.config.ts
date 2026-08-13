import { defineConfig, devices } from "@playwright/test";

const FRONTEND_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const BACKEND_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const isCI = Boolean(process.env.CI);

/**
 * End-to-end suite.
 *
 * Playwright boots the real stack: FastAPI against a migrated PostgreSQL, and
 * the Vite dev server proxying `/api` to it.  `OPENERP_DATABASE_URL` must point
 * at a database that has already been migrated (`make db-upgrade`).
 *
 * The E2E suite is its own npm project (the root package.json) so that specs
 * outside `frontend/` can resolve `@playwright/test`, and so a Playwright
 * upgrade never perturbs the application's dependency tree.
 */
export default defineConfig({
  testDir: "./specs",
  outputDir: "./.artifacts/test-results",
  // The specs share one deliberately seeded ERP database (including the same
  // POS terminal and dashboard owner). Running files in parallel makes them
  // mutate those aggregates underneath each other, so the official gate is
  // serialized locally and in CI.
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI
    ? [
        ["list"],
        ["html", { outputFolder: "./.artifacts/report", open: "never" }],
      ]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "admin",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /pos\..*/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The till is a touch device, so the POS specs run as one.
      name: "pos",
      testMatch: /pos\..*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
        isMobile: false,
      },
    },
  ],

  webServer: [
    {
      command: "uv run uvicorn app.main:app --host 127.0.0.1 --port 8000",
      cwd: "../../backend",
      url: `${BACKEND_URL}/api/v1/health/ready`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      cwd: "../../frontend",
      url: FRONTEND_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { VITE_API_PROXY_TARGET: BACKEND_URL },
    },
  ],
});
