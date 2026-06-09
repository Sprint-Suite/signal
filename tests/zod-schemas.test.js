"use strict";

// tests/zod-schemas.test.js — unit tests for signal's zod schemas + integration
// tests for the wired routes (bad input → 400 via validate middleware).

const test = require("node:test");
const assert = require("node:assert/strict");
const { after } = require("node:test");
const { once } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { respondSchema } = require("../schemas/respond");
const { teamSchema, surveySchema } = require("../schemas/survey");
const { SCALE_MIN, SCALE_MAX } = require("../lib/scoring");

// ============================================================================
// respondSchema — the primary anonymous un-authed surface
// ============================================================================

test("respondSchema: valid submission with all fields passes", () => {
  const result = respondSchema.safeParse({
    answers: [
      { questionId: "q-1", score: 3 },
      { questionId: "q-2", score: SCALE_MIN },
      { questionId: "q-3", score: SCALE_MAX }
    ],
    durationSeconds: 120
  });
  assert.ok(result.success);
  assert.equal(result.data.answers.length, 3);
  assert.equal(result.data.durationSeconds, 120);
});

test("respondSchema: durationSeconds is optional — defaults to null", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: 3 }]
  });
  assert.ok(result.success);
  assert.equal(result.data.durationSeconds, null);
});

test("respondSchema: durationSeconds null coerces to null", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: 3 }],
    durationSeconds: null
  });
  assert.ok(result.success);
  assert.equal(result.data.durationSeconds, null);
});

test("respondSchema: score coerced from string to integer", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: "4" }]
  });
  assert.ok(result.success);
  assert.equal(result.data.answers[0].score, 4);
});

test("respondSchema: rejects empty answers array", () => {
  const result = respondSchema.safeParse({ answers: [] });
  assert.ok(!result.success);
  const fields = result.error.flatten().fieldErrors;
  assert.ok(fields.answers, "answers field error expected");
});

test("respondSchema: rejects missing answers", () => {
  const result = respondSchema.safeParse({ durationSeconds: 10 });
  assert.ok(!result.success);
});

test("respondSchema: rejects answers that is not an array", () => {
  const result = respondSchema.safeParse({ answers: "not-an-array" });
  assert.ok(!result.success);
});

test("respondSchema: rejects score below SCALE_MIN", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: SCALE_MIN - 1 }]
  });
  assert.ok(!result.success);
});

test("respondSchema: rejects score above SCALE_MAX", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: SCALE_MAX + 1 }]
  });
  assert.ok(!result.success);
});

test("respondSchema: rejects non-integer score", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: 3.5 }]
  });
  assert.ok(!result.success);
});

test("respondSchema: rejects empty questionId", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "", score: 3 }]
  });
  assert.ok(!result.success);
});

test("respondSchema: rejects missing questionId", () => {
  const result = respondSchema.safeParse({
    answers: [{ score: 3 }]
  });
  assert.ok(!result.success);
});

test("respondSchema: strips unknown top-level keys", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: 3 }],
    injected: "evil",
    __proto__: { polluted: true }
  });
  assert.ok(result.success);
  assert.ok(!("injected" in result.data));
});

test("respondSchema: strips unknown keys from individual answers", () => {
  const result = respondSchema.safeParse({
    answers: [{ questionId: "q-1", score: 3, extra: "dropped" }]
  });
  assert.ok(result.success);
  assert.ok(!("extra" in result.data.answers[0]));
});

// ============================================================================
// teamSchema
// ============================================================================

test("teamSchema: valid team name passes", () => {
  const result = teamSchema.safeParse({ name: "  My Team  " });
  assert.ok(result.success);
  assert.equal(result.data.name, "My Team"); // trimmed
});

test("teamSchema: rejects empty name", () => {
  const result = teamSchema.safeParse({ name: "" });
  assert.ok(!result.success);
});

test("teamSchema: rejects whitespace-only name", () => {
  const result = teamSchema.safeParse({ name: "   " });
  assert.ok(!result.success);
});

test("teamSchema: rejects missing name", () => {
  const result = teamSchema.safeParse({});
  assert.ok(!result.success);
});

test("teamSchema: strips unknown keys", () => {
  const result = teamSchema.safeParse({ name: "Valid", extra: "dropped" });
  assert.ok(result.success);
  assert.ok(!("extra" in result.data));
});

// ============================================================================
// surveySchema
// ============================================================================

test("surveySchema: valid survey body passes (teamId + templateId)", () => {
  const result = surveySchema.safeParse({ teamId: "t-1", templateId: "tmpl-1" });
  assert.ok(result.success);
  assert.equal(result.data.teamId, "t-1");
  assert.equal(result.data.templateId, "tmpl-1");
  assert.equal(result.data.parentSurveyId, null);
});

test("surveySchema: follow-up body passes (parentSurveyId only)", () => {
  const result = surveySchema.safeParse({ parentSurveyId: "survey-1" });
  assert.ok(result.success);
  assert.equal(result.data.parentSurveyId, "survey-1");
  assert.equal(result.data.teamId, null);
  assert.equal(result.data.templateId, null);
});

test("surveySchema: empty body defaults all fields to null", () => {
  const result = surveySchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.teamId, null);
  assert.equal(result.data.templateId, null);
  assert.equal(result.data.parentSurveyId, null);
});

test("surveySchema: strips unknown keys", () => {
  const result = surveySchema.safeParse({ teamId: "t-1", templateId: "tmpl-1", evil: "x" });
  assert.ok(result.success);
  assert.ok(!("evil" in result.data));
});

// ============================================================================
// Integration: route-level bad input → 400 via validate middleware
// ============================================================================

const db = require("../lib/db");
const { createAuthClient } = require("@suite/auth-client");
const { createHttpApp } = require("../lib/httpApp");

const ACTIVITY_FILE = path.join(
  os.tmpdir(),
  `signal-zod-test-activity-${process.pid}.jsonl`
);
const SESSIONS_DB = path.join(
  os.tmpdir(),
  `signal-zod-test-sessions-${process.pid}.db`
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
    appName: "signal-zod-test",
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
        server.close(() => { conn.close(); resolve(); });
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
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

function loginAsAdmin(app, userId = "hub-user-test", company = { id: "co-test", name: "Test Co" }) {
  const id = crypto.randomBytes(16).toString("hex");
  app.auth._ctx.store.create({
    id,
    userId,
    centralSessionId: crypto.randomBytes(16).toString("hex"),
    expiresAt: Date.now() + 60 * 60 * 1000,
    company
  });
  return `signal_session=${id}`;
}

// --- Anonymous survey-submit validation (the key untrusted surface) ---

test("POST /api/respond/:code — no answers → 400", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    // Create a survey to get a valid access code.
    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie })
    ).json.templates[0].id;
    const team = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "TestTeam" }
    });
    const survey = (
      await api(app.base, "POST", "/api/surveys", {
        cookie,
        body: { teamId: team.json.team.id, templateId }
      })
    ).json.survey;

    // Submit with no answers field.
    const res = await api(app.base, "POST", `/api/respond/${survey.accessCode}`, {
      body: { durationSeconds: 10 }
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test("POST /api/respond/:code — out-of-range score → 400", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie })
    ).json.templates[0].id;
    const team = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "TestTeam2" }
    });
    const survey = (
      await api(app.base, "POST", "/api/surveys", {
        cookie,
        body: { teamId: team.json.team.id, templateId }
      })
    ).json.survey;
    const form = await api(app.base, "GET", `/api/respond/${survey.accessCode}`);
    const badAnswers = form.json.questions.map((q, i) => ({
      questionId: q.id,
      score: i === 0 ? SCALE_MAX + 4 : 3 // first answer has invalid score
    }));

    const res = await api(app.base, "POST", `/api/respond/${survey.accessCode}`, {
      body: { answers: badAnswers, durationSeconds: 10 }
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test("POST /api/respond/:code — answers not an array → 400", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const templateId = (
      await api(app.base, "GET", "/api/templates", { cookie })
    ).json.templates[0].id;
    const team = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "TestTeam3" }
    });
    const survey = (
      await api(app.base, "POST", "/api/surveys", {
        cookie,
        body: { teamId: team.json.team.id, templateId }
      })
    ).json.survey;

    const res = await api(app.base, "POST", `/api/respond/${survey.accessCode}`, {
      body: { answers: "not-an-array" }
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

// --- Admin team creation validation ---

test("POST /api/teams — missing name → 400 (validate middleware fires)", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const res = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: {}
    });
    assert.equal(res.status, 400);
    assert.ok(res.json.fields || res.json.error, "should have fields or error in response body");
  } finally {
    await app.close();
  }
});

test("POST /api/teams — whitespace-only name → 400", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const res = await api(app.base, "POST", "/api/teams", {
      cookie,
      body: { name: "   " }
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
