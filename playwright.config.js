const { defineConfig, devices } = require("@playwright/test");

const PORT = 3010;

// Playwright boots its own Signal instance against a throwaway database.
// The webServer command seeds that database (resetting it) AND a fresh
// auth-client session (so the specs can authenticate by injecting the
// signal_session cookie) before starting the server — sequential, so there
// is no race over the database files. HUB_BASE_URL points at an unreachable
// host on purpose: the seeded session is fresh, so requireAuth admits it
// straight from cache and never contacts the hub.
module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30 * 1000,
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/e2e/seed.js && node server.js",
    port: PORT,
    reuseExistingServer: false,
    timeout: 30 * 1000,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      DB_PATH: "./data/e2e.db",
      APP_BASE_URL: `http://localhost:${PORT}`,
      APP_NAME: "signal",
      APP_SESSIONS_DB: "./data/e2e-sessions.db",
      HUB_BASE_URL: "http://hub.invalid",
      HUB_API_KEY: "e2e-key"
    }
  }
});
