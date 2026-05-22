"use strict";

/**
 * Reset the throwaway e2e database and seed one verified admin.
 *
 * Run before the server (see playwright.config.js webServer.command) so it
 * finishes before the app opens the database — no race over the file.
 */

const fs = require("fs");
const path = require("path");
const db = require("../../lib/db");
const auth = require("../../lib/auth");
const credentials = require("./credentials");

const DB_PATH = path.join(__dirname, "..", "..", "data", "e2e.db");

(async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
  const conn = db.initDb(DB_PATH);
  await auth.registerUser(conn, {
    email: credentials.email,
    password: credentials.password,
    emailVerified: true
  });
  conn.close();
  console.log("e2e database seeded.");
})().catch((err) => {
  console.error("e2e seed failed:", err);
  process.exit(1);
});
