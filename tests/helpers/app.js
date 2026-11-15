"use strict";

// Boots the full app over an in-memory database with a seeded, entitled session.

const { after } = require("node:test");
const { once } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const db = require("../../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { createHttpApp } = require("../../lib/httpApp");

const tag = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const ACTIVITY_FILE = path.join(os.tmpdir(), `signal-test-activity-${tag}.jsonl`);
const SESSIONS_DB = path.join(os.tmpdir(), `signal-test-sessions-${tag}.db`);
after(() => {
  fs.rmSync(ACTIVITY_FILE, { force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(SESSIONS_DB + suffix, { force: true });
  }
});

async function startApp() {
  const conn = db.initDb(":memory:");
  const auth = createAuthClient({
    appName: "signal-test",
    hubBaseUrl: "http://hub.invalid",
    hubApiKey: "test-key",
    cookieName: "signal_session",
    dbPath: SESSIONS_DB
  });
  const app = createHttpApp({
    conn,
    auth,
    buildInfo: { version: "test", commit: "testsha" },
    publicDir: path.join(os.tmpdir(), "signal-no-public"),
    activityFile: ACTIVITY_FILE,
    appBaseUrl: "http://localhost"
  });
  const server = app.listen(0);
  await once(server, "listening");
  return {
    conn,
    auth,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          conn.close();
          resolve();
        });
      })
  };
}

async function api(base, method, pathname, { cookie, body } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

function loginAsAdmin(app, userId = "hub-user-test", company = { id: "co-test", name: "Test Co" }) {
  const id = crypto.randomBytes(16).toString("hex");
  app.auth._ctx.store.create({
    id,
    userId,
    centralSessionId: crypto.randomBytes(16).toString("hex"),
    expiresAt: Date.now() + 60 * 60 * 1000,
    entitled: true,
    company
  });
  return `signal_session=${id}`;
}

/** The invite code is the last path segment of an invite link. */
function codeOf(link) {
  return link.split("/").pop();
}

module.exports = { startApp, api, loginAsAdmin, codeOf };
