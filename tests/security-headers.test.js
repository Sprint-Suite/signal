"use strict";

/**
 * tests/security-headers.test.js
 *
 * Verifies that every response from the Signal app carries the full set of
 * HTTP security headers defined in middleware/securityHeaders.js.
 * Mirrors the startApp / api helper pattern from server.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { after } = require("node:test");
const { once } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const db = require("../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { createHttpApp } = require("../lib/httpApp");
const { DEFAULT_CSP } = require("../middleware/securityHeaders");

const ACTIVITY_FILE = path.join(
  os.tmpdir(),
  `signal-sec-test-activity-${process.pid}.jsonl`
);
const SESSIONS_DB = path.join(
  os.tmpdir(),
  `signal-sec-test-sessions-${process.pid}.db`
);
after(() => {
  fs.rmSync(ACTIVITY_FILE, { force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(SESSIONS_DB + suffix, { force: true });
  }
});

async function startApp() {
  const conn = db.initDb(":memory:");
  const auth = createAuthClient({
    appName: "signal-sec-test",
    hubBaseUrl: "http://hub.invalid",
    hubApiKey: "test-key",
    cookieName: "signal_session",
    dbPath: SESSIONS_DB,
  });
  const app = createHttpApp({
    conn,
    auth,
    buildInfo: { version: "test", commit: "testsha" },
    publicDir: path.join(os.tmpdir(), "signal-no-public"),
    activityFile: ACTIVITY_FILE,
    appBaseUrl: "http://localhost",
  });
  const server = app.listen(0);
  await once(server, "listening");
  return {
    conn,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          conn.close();
          resolve();
        });
      }),
  };
}

test("security headers: all 6 required headers present on /health", async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/health`);

    // X-Frame-Options
    assert.equal(
      res.headers.get("x-frame-options"),
      "DENY",
      "X-Frame-Options must be DENY"
    );

    // X-Content-Type-Options
    assert.equal(
      res.headers.get("x-content-type-options"),
      "nosniff",
      "X-Content-Type-Options must be nosniff"
    );

    // Referrer-Policy
    assert.equal(
      res.headers.get("referrer-policy"),
      "no-referrer",
      "Referrer-Policy must be no-referrer"
    );

    // Strict-Transport-Security
    assert.equal(
      res.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains",
      "HSTS must be max-age=31536000; includeSubDomains"
    );

    // Permissions-Policy must contain camera=()
    const pp = res.headers.get("permissions-policy") || "";
    assert.ok(
      pp.includes("camera=()"),
      `Permissions-Policy must include camera=(); got: ${pp}`
    );

    // Content-Security-Policy: must contain script-src 'self'
    const csp = res.headers.get("content-security-policy") || "";
    assert.ok(
      csp.includes("script-src 'self'"),
      `CSP must contain script-src 'self'; got: ${csp}`
    );

    // Content-Security-Policy: must NOT have unsafe-inline in script-src
    // Parse out the script-src directive specifically.
    const scriptSrcMatch = csp.match(/script-src([^;]*)/);
    const scriptSrc = scriptSrcMatch ? scriptSrcMatch[1] : "";
    assert.ok(
      !scriptSrc.includes("'unsafe-inline'"),
      `script-src must not contain 'unsafe-inline'; got script-src:${scriptSrc}`
    );

    // No-cache headers — survey data must never be held by a proxy or CDN.
    const cc = res.headers.get("cache-control") || "";
    assert.ok(
      cc.includes("no-store"),
      `Cache-Control must contain no-store; got: ${cc}`
    );
    assert.equal(
      res.headers.get("pragma"),
      "no-cache",
      "Pragma must be no-cache"
    );
    assert.equal(
      res.headers.get("expires"),
      "0",
      "Expires must be 0"
    );
    assert.equal(
      res.headers.get("surrogate-control"),
      "no-store",
      "Surrogate-Control must be no-store"
    );
  } finally {
    await app.close();
  }
});

test("security headers: same headers present on public respondent API route", async () => {
  const app = await startApp();
  try {
    // /api/respond/UNKNOWN is public (no auth required) and returns 404 JSON.
    const res = await fetch(`${app.base}/api/respond/UNKNOWN`);

    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      res.headers.get("referrer-policy"),
      "no-referrer"
    );
    assert.equal(
      res.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains"
    );
    const pp = res.headers.get("permissions-policy") || "";
    assert.ok(pp.includes("camera=()"));
    const csp = res.headers.get("content-security-policy") || "";
    assert.ok(csp.includes("script-src 'self'"));
  } finally {
    await app.close();
  }
});

test("security headers: DEFAULT_CSP export matches the mounted policy", async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/health`);
    const csp = res.headers.get("content-security-policy") || "";
    assert.equal(
      csp,
      DEFAULT_CSP,
      "Live CSP header must match the DEFAULT_CSP export"
    );
  } finally {
    await app.close();
  }
});

test("security headers: unit — makeSecurityHeaders factory returns middleware with correct defaults", () => {
  const { makeSecurityHeaders } = require("../middleware/securityHeaders");

  const headers = {};
  const removedHeaders = [];
  const fakeRes = {
    setHeader: (name, value) => { headers[name] = value; },
    removeHeader: (name) => { removedHeaders.push(name); },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  const mw = makeSecurityHeaders();
  mw({}, fakeRes, next);

  assert.ok(nextCalled, "next() must be called");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(
    headers["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains"
  );
  assert.ok(
    (headers["Permissions-Policy"] || "").includes("camera=()"),
    "Permissions-Policy must include camera=()"
  );
  assert.ok(
    (headers["Content-Security-Policy"] || "").includes("script-src 'self'"),
    "CSP must include script-src 'self'"
  );
  // No unsafe-inline in script-src
  const csp = headers["Content-Security-Policy"] || "";
  const scriptSrcMatch = csp.match(/script-src([^;]*)/);
  const scriptSrc = scriptSrcMatch ? scriptSrcMatch[1] : "";
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src must not be unsafe-inline");

  // No-cache headers
  assert.equal(
    headers["Cache-Control"],
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Cache-Control must be the full no-store directive"
  );
  assert.equal(headers["Pragma"], "no-cache", "Pragma must be no-cache");
  assert.equal(headers["Expires"], "0", "Expires must be 0");
  assert.equal(headers["Surrogate-Control"], "no-store", "Surrogate-Control must be no-store");
});
