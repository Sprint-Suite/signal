const { defineConfig, devices } = require("@playwright/test");

const PORT = 3010;

// Playwright boots its own Signal instance against a throwaway database.
// The webServer command seeds that database (resetting it and creating a
// verified admin) before starting the server — sequential, so there is no
// race over the database file.
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
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
      DB_PATH: "./data/e2e.db",
      APP_BASE_URL: `http://localhost:${PORT}`,
      MAIL_TRANSPORT: "log"
    }
  }
});
