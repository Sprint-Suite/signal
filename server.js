"use strict";

/**
 * server.js — composition root.
 *
 * Loads config, opens the database, assembles the app's collaborators, and
 * starts listening. All real logic lives in lib/.
 */

const fs = require("fs");
const path = require("path");

// Load .env for local dev. In production the systemd unit supplies the env.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const db = require("./lib/db");
const { getBuildInfo } = require("./lib/buildInfo");
const { createSessionManager } = require("./lib/session");
const { createLoginRateLimiter } = require("./lib/loginRateLimiter");
const { createMailer } = require("./lib/mailer");
const { getActivityFilePath } = require("./lib/adminActivity");
const { createHttpApp } = require("./lib/httpApp");

const PORT = Number(process.env.PORT) || 3002;
const NODE_ENV = process.env.NODE_ENV || "development";
const HOST =
  process.env.HOST || (NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "data/signal.db");
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "";

if (SESSION_SECRET.length < 16) {
  console.error(
    "FATAL: SESSION_SECRET must be set to at least 16 characters.\n" +
      "Generate one with: openssl rand -hex 32"
  );
  process.exit(1);
}

const conn = db.initDb(DB_PATH);

const app = createHttpApp({
  conn,
  sessions: createSessionManager({
    secret: SESSION_SECRET,
    secure: NODE_ENV === "production"
  }),
  rateLimiter: createLoginRateLimiter({
    maxFailures: Number(process.env.LOGIN_RATE_LIMIT_MAX) || undefined,
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || undefined
  }),
  mailer: createMailer(),
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
