"use strict";

/**
 * Reset the throwaway e2e databases and seed one fresh hub-backed session.
 *
 * Two SQLite files are reset:
 *   data/e2e.db           — Signal's content database (surveys, teams, …)
 *   data/e2e-sessions.db  — the auth-client session store
 *
 * A single fresh session is inserted into the store so the specs can
 * authenticate by injecting the signal_session cookie (see _auth.js). Because
 * the session is fresh, requireAuth admits it from cache and never contacts
 * the (unreachable) hub.
 *
 * Run before the server (see playwright.config.js webServer.command) so it
 * finishes before the app opens the databases — no race over the files.
 */

const fs = require("fs");
const path = require("path");
const db = require("../../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const credentials = require("./credentials");

const DB_PATH = path.join(__dirname, "..", "..", "data", "e2e.db");
const SESSIONS_DB = path.join(__dirname, "..", "..", "data", "e2e-sessions.db");

for (const base of [DB_PATH, SESSIONS_DB]) {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(base + suffix, { force: true });
  }
}

// Content database.
db.initDb(DB_PATH).close();

// Session store: seed the fresh sessions the specs authenticate as. Each
// carries a `company` ({ id, name }) which becomes `req.user.company` and lets
// company-scoped routes (POST /api/teams, …) admit the session. Company A and B
// are distinct companies used by company-scoping.spec.js to prove isolation.
const auth = createAuthClient({
  appName: "signal",
  hubBaseUrl: "http://hub.invalid",
  hubApiKey: "e2e-key",
  cookieName: "signal_session",
  dbPath: SESSIONS_DB
});

const EXPIRES_AT = Date.now() + 24 * 60 * 60 * 1000;
for (const cred of [credentials, credentials.companyA, credentials.companyB]) {
  auth._ctx.store.create({
    id: cred.sessionId,
    userId: cred.userId,
    centralSessionId: cred.centralSessionId,
    expiresAt: EXPIRES_AT,
    company: cred.company
  });
}

console.log("e2e databases + sessions seeded.");
