"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { after } = require("node:test");
const { once } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const db = require("../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { createHttpApp } = require("../lib/httpApp");

const ACTIVITY_FILE = path.join(
  os.tmpdir(),
  `signal-test-activity-${process.pid}.jsonl`
);
const SESSIONS_DB = path.join(
  os.tmpdir(),
  `signal-test-sessions-${process.pid}.db`
);
after(() => {
  fs.rmSync(ACTIVITY_FILE, { force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(SESSIONS_DB + suffix, { force: true });
  }
});

/**
 * Boot the full app on an ephemeral port over an in-memory content database.
 * Authentication is the real @suite/auth-client, pointed at an unreachable
 * hub: the tests never trigger a hub call because they seed a *fresh* local
 * session, which requireAuth serves straight from its cache (age < cacheTtl).
 */
async function startApp({ publicDir } = {}) {
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
    publicDir: publicDir || path.join(os.tmpdir(), "signal-no-public"),
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

async function api(base, method, pathname, { cookie, body, redirect } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: redirect || "follow",
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

/**
 * Seed a fresh hub-backed session directly in the auth-client store and return
 * the matching cookie. This stands in for the launch flow: requireAuth reads
 * the cookie, finds the session, and (because it is fresh) admits it without
 * contacting the hub.
 */
function loginAsAdmin(
  app,
  userId = "hub-user-test",
  company = { id: "co-test", name: "Test Co" }
) {
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

test("/health reports status and build info", async () => {
  const app = await startApp();
  try {
    const { status, json } = await api(app.base, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(json.status, "ok");
    assert.equal(json.schemaVersion, 3);
    assert.equal(json.version, "test");
  } finally {
    await app.close();
  }
});

test("/robots.txt is served publicly", async () => {
  const app = await startApp({
    publicDir: path.join(__dirname, "..", "public")
  });
  try {
    const { status, text } = await api(app.base, "GET", "/robots.txt");
    assert.equal(status, 200);
    assert.match(text, /User-agent: \*/);
    assert.match(text, /Allow: \//);
  } finally {
    await app.close();
  }
});

test("admin API bounces to the hub without a session; the public respond API does not", async () => {
  const app = await startApp();
  try {
    // No cookie: requireAuth 302-redirects to the hub login.
    const guarded = await api(app.base, "GET", "/api/surveys", {
      redirect: "manual"
    });
    assert.equal(guarded.status, 302);
    assert.match(guarded.res.headers.get("location"), /hub\.invalid\/login/);

    const publicRoute = await api(app.base, "GET", "/api/respond/UNKNOWN");
    assert.equal(publicRoute.status, 404); // reached the handler, not the guard
  } finally {
    await app.close();
  }
});

test("a seeded hub session reaches the admin API", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const ok = await api(app.base, "GET", "/api/surveys", { cookie });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.json.surveys));
  } finally {
    await app.close();
  }
});

test("full survey lifecycle: team, survey, responses, report, breakdown, CSV", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);

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
    const cookie = loginAsAdmin(app);
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
    const cookie = loginAsAdmin(app);
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

test("a facilitator sees only their own company's teams", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    await api(app.base, "POST", "/api/teams", { cookie: cookieB, body: { name: "Bravo" } });

    const aList = await api(app.base, "GET", "/api/teams", { cookie: cookieA });
    assert.equal(aList.status, 200);
    assert.deepEqual(aList.json.teams.map((t) => t.name), ["Alpha"]);

    const bList = await api(app.base, "GET", "/api/teams", { cookie: cookieB });
    assert.deepEqual(bList.json.teams.map((t) => t.name), ["Bravo"]);
  } finally {
    await app.close();
  }
});

test("a company cannot rotate-key or delete another company's team (404)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const created = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const teamId = created.json.team.id;

    const rotate = await api(app.base, "POST", `/api/teams/${teamId}/rotate-key`, { cookie: cookieB });
    assert.equal(rotate.status, 404);

    const del = await api(app.base, "DELETE", `/api/teams/${teamId}`, { cookie: cookieB });
    assert.equal(del.status, 404);
  } finally {
    await app.close();
  }
});

test("a company-less session sees no teams and cannot create one", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app, "user-x", null);
    const list = await api(app.base, "GET", "/api/teams", { cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.teams, []);

    const create = await api(app.base, "POST", "/api/teams", { cookie, body: { name: "Nope" } });
    assert.equal(create.status, 403);
  } finally {
    await app.close();
  }
});

test("a company cannot read or transition another company's survey (404)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie: cookieA })
    ).json.templates[0].id;

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const created = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieA,
      body: { teamId: team.json.team.id, templateId }
    });
    const surveyId = created.json.survey.id;

    const bList = await api(app.base, "GET", "/api/surveys", { cookie: cookieB });
    assert.deepEqual(bList.json.surveys, []);

    const bRead = await api(app.base, "GET", `/api/surveys/${surveyId}`, { cookie: cookieB });
    assert.equal(bRead.status, 404);

    const bClose = await api(app.base, "POST", `/api/surveys/${surveyId}/close`, { cookie: cookieB });
    assert.equal(bClose.status, 404);
  } finally {
    await app.close();
  }
});

test("creating a survey under another company's team is rejected (400)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie: cookieA })
    ).json.templates[0].id;

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const attempt = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieB,
      body: { teamId: team.json.team.id, templateId }
    });
    assert.equal(attempt.status, 400);
  } finally {
    await app.close();
  }
});

test("a company cannot read another company's report/breakdown/export (404)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });

    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie: cookieA })
    ).json.templates[0].id;

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const created = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieA,
      body: { teamId: team.json.team.id, templateId }
    });
    const surveyId = created.json.survey.id;

    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const report = await api(app.base, "GET", `/api/surveys/${surveyId}/report`, { cookie: cookieB });
    assert.equal(report.status, 404);

    const breakdown = await api(app.base, "GET", `/api/surveys/${surveyId}/breakdown`, { cookie: cookieB });
    assert.equal(breakdown.status, 404);

    const csv = await api(app.base, "GET", `/api/surveys/${surveyId}/export.csv`, { cookie: cookieB });
    assert.equal(csv.status, 404);
  } finally {
    await app.close();
  }
});

test("creating a follow-up under another company's baseline survey is rejected (400)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });

    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie: cookieA })
    ).json.templates[0].id;

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const baseline = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieA,
      body: { teamId: team.json.team.id, templateId }
    });
    const surveyId = baseline.json.survey.id;

    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const attempt = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieB,
      body: { parentSurveyId: surveyId }
    });
    assert.equal(attempt.status, 400);
  } finally {
    await app.close();
  }
});
