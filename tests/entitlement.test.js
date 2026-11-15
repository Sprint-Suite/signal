"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const db = require("../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { createHttpApp } = require("../lib/httpApp");

const HUB = "http://hub.invalid";
const SESSIONS_DB = path.join(
  os.tmpdir(),
  `signal-entitlement-sessions-${process.pid}.db`
);

async function startApp() {
  const conn = db.initDb(":memory:");
  const auth = createAuthClient({
    appName: "signal-test",
    hubBaseUrl: HUB,
    hubApiKey: "test-key",
    cookieName: "signal_session",
    dbPath: SESSIONS_DB
  });
  const app = createHttpApp({
    conn,
    auth,
    buildInfo: { version: "test", commit: "testsha" },
    publicDir: path.join(os.tmpdir(), "signal-no-public"),
    activityFile: path.join(os.tmpdir(), `signal-entitlement-${process.pid}.jsonl`),
    appBaseUrl: "http://localhost"
  });
  const server = app.listen(0);
  await once(server, "listening");
  return {
    auth,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          conn.close();
          resolve();
        })
      )
  };
}

function login(app, entitled) {
  const id = crypto.randomBytes(16).toString("hex");
  app.auth._ctx.store.create({
    id,
    userId: "hub-user-test",
    centralSessionId: crypto.randomBytes(16).toString("hex"),
    expiresAt: Date.now() + 60 * 60 * 1000,
    entitled,
    company: { id: "co-test", name: "Test Co" }
  });
  return `signal_session=${id}`;
}

function get(app, pathname, cookie) {
  return fetch(app.base + pathname, {
    redirect: "manual",
    headers: { Cookie: cookie }
  });
}

test("unentitled session gets 403 on GET /api/surveys", async () => {
  const app = await startApp();
  try {
    const res = await get(app, "/api/surveys", login(app, false));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), {
      error:
        "Signal is not enabled for your account. Ask your company admin to turn it on."
    });
  } finally {
    await app.close();
  }
});

test("unentitled session is redirected from /dashboard to the hub dashboard", async () => {
  const app = await startApp();
  try {
    for (const page of ["/dashboard", "/admin", "/survey"]) {
      const res = await get(app, page, login(app, false));
      assert.equal(res.status, 302, page);
      assert.equal(res.headers.get("location"), `${HUB}/dashboard`, page);
    }
  } finally {
    await app.close();
  }
});

test("entitled session still reaches GET /api/surveys", async () => {
  const app = await startApp();
  try {
    const res = await get(app, "/api/surveys", login(app, true));
    assert.equal(res.status, 200);
  } finally {
    await app.close();
  }
});
