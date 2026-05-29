"use strict";

/**
 * server.js — composition root.
 *
 * Loads config, opens the database, assembles the app's collaborators, and
 * starts listening. Authentication is delegated to the central Sprint Suite
 * hub via @suite/auth-client: facilitators sign in at the hub and launch
 * Signal with a one-time launch token. This app no longer owns any
 * login/session/password code; protected routes use auth.requireAuth.
 */

const fs = require("fs");
const path = require("path");

// Load .env for local dev. In production the systemd unit supplies the env.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const db = require("./lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { getBuildInfo } = require("./lib/buildInfo");
const { getActivityFilePath } = require("./lib/adminActivity");
const { createHttpApp } = require("./lib/httpApp");
const { loadTemplatesFromDisk } = require("./lib/templateLoader");

const PORT = Number(process.env.PORT) || 3002;
const NODE_ENV = process.env.NODE_ENV || "development";
const HOST =
  process.env.HOST || (NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "data/signal.db");
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

const conn = db.initDb(DB_PATH);
loadTemplatesFromDisk(conn, path.join(__dirname, "templates"));

// Hub-delegated authentication. createAuthClient throws if HUB_BASE_URL or
// HUB_API_KEY are missing, so a misconfigured deploy fails fast at boot.
const auth = createAuthClient({
  appName: process.env.APP_NAME || "signal",
  hubBaseUrl: process.env.HUB_BASE_URL,
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: "signal_session",
  cookieDomain: process.env.COOKIE_DOMAIN, // unset in local dev (localhost)
  dbPath: process.env.APP_SESSIONS_DB || "./data/signal-sessions.db"
});

const app = createHttpApp({
  conn,
  auth,
  buildInfo: getBuildInfo(__dirname),
  publicDir: path.join(__dirname, "public"),
  activityFile: getActivityFilePath(__dirname),
  appBaseUrl: APP_BASE_URL
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Signal listening on http://${HOST}:${PORT} (${NODE_ENV})`);
});

function shutdown(signal) {
  console.log(`${signal} received — shutting down.`);
  server.close(() => {
    try {
      conn.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
