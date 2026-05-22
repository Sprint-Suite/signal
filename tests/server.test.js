"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { after } = require("node:test");
const { once } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const db = require("../lib/db");
const auth = require("../lib/auth");
const { createHttpApp } = require("../lib/httpApp");
const { createSessionManager } = require("../lib/session");
const { createLoginRateLimiter } = require("../lib/loginRateLimiter");

const ACTIVITY_FILE = path.join(
  os.tmpdir(),
  `signal-test-activity-${process.pid}.jsonl`
);
after(() => fs.rmSync(ACTIVITY_FILE, { force: true }));

// A mailer stub — keeps the log transport's output out of the test run.
const stubMailer = { transport: "stub", sendMail: async () => ({ delivered: false }) };

/** Boot the full app on an ephemeral port over an in-memory database. */
async function startApp() {
  const conn = db.initDb(":memory:");
  const app = createHttpApp({
    conn,
    sessions: createSessionManager({
      secret: "test-secret-key-0123456789",
      secure: false
    }),
    rateLimiter: createLoginRateLimiter(),
    mailer: stubMailer,
    buildInfo: { version: "test", commit: "testsha" },
    publicDir: path.join(os.tmpdir(), "signal-no-public"),
    activityFile: ACTIVITY_FILE,
    appBaseUrl: "http://localhost"
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
      })
  };
}

async function api(base, method, pathname, { cookie, body } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response (e.g. CSV) */
  }
  return { status: res.status, json, text, res };
}

function sessionCookie(res) {
  const all = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of all) {
    if (c && c.startsWith("signal_session=")) return c.split(";")[0];
  }
  return null;
}

const STRONG_PASSWORD = "a-strong-admin-password";

/** Register a verified admin directly and return a logged-in session cookie. */
async function loginAsAdmin(app, email = "admin@example.com") {
  await auth.registerUser(app.conn, {
    email,
    password: STRONG_PASSWORD,
    emailVerified: true
  });
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: STRONG_PASSWORD })
  });
  assert.equal(res.status, 200);
  return sessionCookie(res);
}

test("/health reports status and build info", async () => {
  const app = await startApp();
  try {
    const { status, json } = await api(app.base, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(json.status, "ok");
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.version, "test");
  } finally {
    await app.close();
  }
});

test("admin API needs a session; the public respond API does not", async () => {
  const app = await startApp();
  try {
    const guarded = await api(app.base, "GET", "/api/surveys");
    assert.equal(guarded.status, 401);

    const publicRoute = await api(app.base, "GET", "/api/respond/UNKNOWN");
    assert.equal(publicRoute.status, 404); // reached the handler, not the guard
  } finally {
    await app.close();
  }
});

test("login lifecycle: bad creds, success, session, logout", async () => {
  const app = await startApp();
  try {
    const bad = await api(app.base, "POST", "/api/auth/login", {
      body: { email: "nobody@example.com", password: "wrong-password-here" }
    });
    assert.equal(bad.status, 401);

    const cookie = await loginAsAdmin(app);
    assert.ok(cookie);

    const me = await api(app.base, "GET", "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "admin@example.com");

    await api(app.base, "POST", "/api/auth/logout", { cookie });
    const afterLogout = await api(app.base, "GET", "/api/auth/me", { cookie });
    assert.equal(afterLogout.status, 401);
  } finally {
    await app.close();
  }
});

test("an unverified admin is blocked from admin routes", async () => {
  const app = await startApp();
  try {
    await auth.registerUser(app.conn, {
      email: "unverified@example.com",
      password: STRONG_PASSWORD,
      emailVerified: false
    });
    const login = await api(app.base, "POST", "/api/auth/login", {
      body: { email: "unverified@example.com", password: STRONG_PASSWORD }
    });
    assert.equal(login.status, 200); // login itself succeeds
    const cookie = sessionCookie(login.res);

    const guarded = await api(app.base, "GET", "/api/surveys", { cookie });
    assert.equal(guarded.status, 403);
    assert.equal(guarded.json.needsVerification, true);
  } finally {
    await app.close();
  }
});

test("full survey lifecycle: team, survey, responses, report, breakdown, CSV", async () => {
  const app = await startApp();
  try {
    const cookie = await loginAsAdmin(app);

    const templates = await api(app.base, "GET", "/api/templates", { cookie });
    const templateId = templates.json.templates[0].id;

    const team = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "Falcons" }
    });
    assert.equal(team.status, 201);
    assert.ok(team.json.accessKey); // plaintext key shown once

    const created = await api(app.base, "POST", "/api/surveys", {
      cookie,
      body: { teamId: team.json.team.id, templateId }
    });
    assert.equal(created.status, 201);
    const survey = created.json.survey;
    assert.ok(survey.link.includes("/s/"));

    // Public respondent fetches the questions (no cookie).
    const form = await api(app.base, "GET", `/api/respond/${survey.accessCode}`);
    assert.equal(form.status, 200);
    assert.equal(form.json.open, true);
    assert.equal(form.json.questions.length, 24);

    // Report is locked until 3 responses.
    const locked = await api(
      app.base,
      "GET",
      `/api/surveys/${survey.id}/report`,
      { cookie }
    );
    assert.equal(locked.json.locked, true);

    // Submit three responses with varied answers.
    for (let r = 0; r < 3; r += 1) {
      const answers = form.json.questions.map((q, i) => ({
        questionId: q.id,
        score: 3 + ((i + r) % 3) // 3..5, varied
      }));
      const submit = await api(
        app.base,
        "POST",
        `/api/respond/${survey.accessCode}`,
        { body: { answers, durationSeconds: 200 } }
      );
      assert.equal(submit.status, 201);
    }

    // Report now unlocks.
    const report = await api(
      app.base,
      "GET",
      `/api/surveys/${survey.id}/report`,
      { cookie }
    );
    assert.equal(report.json.locked, false);
    assert.equal(report.json.responseCount, 3);
    assert.equal(report.json.axes.length, 6);
    assert.ok(report.json.guidanceNote.length > 0);

    const breakdown = await api(
      app.base,
      "GET",
      `/api/surveys/${survey.id}/breakdown`,
      { cookie }
    );
    assert.equal(breakdown.json.questions.length, 24);

    const csv = await api(
      app.base,
      "GET",
      `/api/surveys/${survey.id}/export.csv`,
      { cookie }
    );
    assert.equal(csv.status, 200);
    assert.ok(csv.res.headers.get("content-type").includes("text/csv"));
    assert.ok(csv.text.split("\n").length > 24); // header + 24 questions
  } finally {
    await app.close();
  }
});

test("response submission is validated", async () => {
  const app = await startApp();
  try {
    const cookie = await loginAsAdmin(app);
    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie })
    ).json.templates[0].id;
    const team = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "Falcons" }
    });
    const survey = (
      await api(app.base, "POST", "/api/surveys", {
        cookie,
        body: { teamId: team.json.team.id, templateId }
      })
    ).json.survey;
    const form = await api(app.base, "GET", `/api/respond/${survey.accessCode}`);
    const fullAnswers = form.json.questions.map((q) => ({
      questionId: q.id,
      score: 4
    }));

    // Missing answers.
    const incomplete = await api(
      app.base,
      "POST",
      `/api/respond/${survey.accessCode}`,
      { body: { answers: fullAnswers.slice(0, 10), durationSeconds: 100 } }
    );
    assert.equal(incomplete.status, 400);

    // Out-of-range score.
    const badScore = await api(
      app.base,
      "POST",
      `/api/respond/${survey.accessCode}`,
      {
        body: {
          answers: fullAnswers.map((a, i) =>
            i === 0 ? { ...a, score: 9 } : a
          ),
          durationSeconds: 100
        }
      }
    );
    assert.equal(badScore.status, 400);

    // A closed survey rejects submissions.
    await api(app.base, "POST", `/api/surveys/${survey.id}/close`, { cookie });
    const closed = await api(
      app.base,
      "POST",
      `/api/respond/${survey.accessCode}`,
      { body: { answers: fullAnswers, durationSeconds: 100 } }
    );
    assert.equal(closed.status, 409);
  } finally {
    await app.close();
  }
});

test("a follow-up survey overlays its baseline on the report", async () => {
  const app = await startApp();
  try {
    const cookie = await loginAsAdmin(app);
    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie })
    ).json.templates[0].id;
    const teamId = (
      await api(app.base, "POST", "/api/teams", {
        cookie,
        body: { name: "Falcons" }
      })
    ).json.team.id;

    async function runSurvey(parentSurveyId) {
      const body = parentSurveyId
        ? { parentSurveyId }
        : { teamId, templateId };
      const survey = (
        await api(app.base, "POST", "/api/surveys", { cookie, body })
      ).json.survey;
      const form = await api(
        app.base,
        "GET",
        `/api/respond/${survey.accessCode}`
      );
      for (let r = 0; r < 3; r += 1) {
        await api(app.base, "POST", `/api/respond/${survey.accessCode}`, {
          body: {
            answers: form.json.questions.map((q, i) => ({
              questionId: q.id,
              score: 3 + ((i + r) % 3)
            })),
            durationSeconds: 200
          }
        });
      }
      return survey;
    }

    const baseline = await runSurvey(null);
    await api(app.base, "POST", `/api/surveys/${baseline.id}/close`, {
      cookie
    });
    const followUp = await runSurvey(baseline.id);

    const report = await api(
      app.base,
      "GET",
      `/api/surveys/${followUp.id}/report`,
      { cookie }
    );
    assert.equal(report.json.locked, false);
    assert.equal(report.json.hasBaseline, true);
    assert.ok(report.json.baseline.responseCount >= 3);
    // Every axis carries a baseline mean for the radar overlay.
    assert.ok(report.json.axes.every((a) => a.baselineMean !== null));
  } finally {
    await app.close();
  }
});

test("a signed-in admin can change their password and login email", async () => {
  const app = await startApp();
  try {
    const cookie = await loginAsAdmin(app, "change@example.com");

    // /me carries the account-detail fields the account page shows.
    const me = await api(app.base, "GET", "/api/auth/me", { cookie });
    assert.ok(me.json.user.createdAt);

    // A wrong current password is refused.
    const bad = await api(app.base, "POST", "/api/auth/change-password", {
      cookie,
      body: {
        currentPassword: "wrong password here",
        newPassword: "a brand new strong password"
      }
    });
    assert.equal(bad.status, 403);

    // The correct current password changes it.
    const changed = await api(app.base, "POST", "/api/auth/change-password", {
      cookie,
      body: {
        currentPassword: STRONG_PASSWORD,
        newPassword: "a brand new strong password"
      }
    });
    assert.equal(changed.status, 200);

    // Change the login email.
    const emailChanged = await api(app.base, "POST", "/api/auth/change-email", {
      cookie,
      body: {
        currentPassword: "a brand new strong password",
        newEmail: "moved@example.com"
      }
    });
    assert.equal(emailChanged.status, 200);

    // The new email + new password sign in; the old email no longer does.
    const fresh = await api(app.base, "POST", "/api/auth/login", {
      body: { email: "moved@example.com", password: "a brand new strong password" }
    });
    assert.equal(fresh.status, 200);
    const stale = await api(app.base, "POST", "/api/auth/login", {
      body: { email: "change@example.com", password: "a brand new strong password" }
    });
    assert.equal(stale.status, 401);
  } finally {
    await app.close();
  }
});
