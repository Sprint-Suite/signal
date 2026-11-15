"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startApp, api, loginAsAdmin, codeOf } = require("./helpers/app");

async function createSurvey(app, cookie, extra = {}) {
  let body = { parentSurveyId: extra.parentSurveyId, inviteCount: 12 };
  if (!extra.parentSurveyId) {
    const templateId = (await api(app.base, "GET", "/api/templates", { cookie }))
      .json.templates[0].id;
    const team = await api(app.base, "POST", "/api/teams", { cookie, body: { name: "Falcons" } });
    body = { teamId: team.json.team.id, templateId, inviteCount: 12 };
  }
  const res = await api(app.base, "POST", "/api/surveys", { cookie, body });
  assert.equal(res.status, 201);
  return { id: res.json.survey.id, codes: res.json.inviteLinks.map(codeOf) };
}

/** A survey handle that spends its invite codes in order. */
function handle(app, cookie, survey) {
  let next = 0;
  const call = (method, suffix) => api(app.base, method, `/api/surveys/${survey.id}${suffix}`, { cookie });
  return {
    id: survey.id,
    async respond(scoreFor) {
      const code = survey.codes[next];
      next += 1;
      const form = await api(app.base, "GET", `/api/respond/${code}`);
      const answers = form.json.questions.map((q, i) => ({ questionId: q.id, score: scoreFor(i) }));
      const res = await api(app.base, "POST", `/api/respond/${code}`, {
        body: { answers, durationSeconds: 200 }
      });
      assert.equal(res.status, 201);
    },
    async varied(count) {
      for (let r = 0; r < count; r += 1) await this.respond((i) => 1 + ((i + r) % 3));
    },
    close: () => call("POST", "/close"),
    reopen: () => call("POST", "/reopen"),
    report: async () => (await call("GET", "/report")).json,
    breakdown: async () => (await call("GET", "/breakdown")).json,
    detail: async () => (await call("GET", "")).json.survey
  };
}

async function withApp(fn, options) {
  const app = await startApp(options);
  try {
    const cookie = loginAsAdmin(app);
    await fn(app, cookie);
  } finally {
    await app.close();
  }
}

async function newSurvey(app, cookie, extra) {
  return handle(app, cookie, await createSurvey(app, cookie, extra));
}

const axisMeans = (report) => report.axes.map((a) => [a.axisId, a.mean]);
const questionMeans = (breakdown) => breakdown.questions.map((q) => [q.questionId, q.mean]);

/** Close with 3 published, reopen, add one all-5 response, close again. */
async function reopenAndRefresh(app, cookie) {
  const s = await newSurvey(app, cookie);
  await s.varied(3);
  await s.close();
  const before = { report: await s.report(), breakdown: await s.breakdown() };
  await s.reopen();
  await s.respond(() => 5);
  await s.close();
  return { s, before };
}

function parseCsvLine(line) {
  return [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)]
    .slice(0, -1)
    .map((m) => m[1]);
}

test("open survey with 4 responses is locked as not-closed", () =>
  withApp(async (app, cookie) => {
    const s = await newSurvey(app, cookie);
    await s.varied(4);
    for (const body of [await s.report(), await s.breakdown()]) {
      assert.equal(body.locked, true);
      assert.equal(body.reason, "not-closed");
    }
  }));

test("closing with 2 responses publishes nothing; reopen + 1 + close publishes 3", () =>
  withApp(async (app, cookie) => {
    const s = await newSurvey(app, cookie);
    await s.varied(2);
    await s.close();
    const first = await s.report();
    assert.equal(first.locked, true);
    assert.equal(first.reason, "below-minimum");
    await s.reopen();
    await s.varied(1);
    await s.close();
    const second = await s.report();
    assert.equal(second.locked, false);
    assert.equal(second.responseCount, 3);
  }));

test("reopen-and-refresh does not reveal the next respondent", () =>
  withApp(async (app, cookie) => {
    const { s, before } = await reopenAndRefresh(app, cookie);
    const report = await s.report();
    const breakdown = await s.breakdown();
    assert.deepEqual(axisMeans(report), axisMeans(before.report));
    assert.deepEqual(questionMeans(breakdown), questionMeans(before.breakdown));
    assert.equal(report.responseCount, 3);
    assert.equal(report.pendingCount, 1);
    assert.equal(breakdown.pendingCount, 1);
  }));

test("baseline overlay ignores unpublished parent responses", () =>
  withApp(async (app, cookie) => {
    const parent = await newSurvey(app, cookie);
    await parent.varied(4);
    const follow = await newSurvey(app, cookie, { parentSurveyId: parent.id });
    await follow.varied(3);
    await follow.close();
    const report = await follow.report();
    assert.equal(report.locked, false);
    assert.equal(report.hasBaseline, false);
  }));

test("CSV uses published responses only", () =>
  withApp(async (app, cookie) => {
    const { s } = await reopenAndRefresh(app, cookie);
    const res = await fetch(`${app.base}/api/surveys/${s.id}/export.csv`, {
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 200);
    const [header, ...rows] = (await res.text()).trim().split("\n").map(parseCsvLine);
    const col = header.indexOf("Responses");
    assert.equal(rows.length, 24);
    for (const row of rows) assert.equal(row[col], "3");
  }));

test("a pending flagged response changes no visible flag count", () =>
  withApp(async (app, cookie) => {
    const { s } = await reopenAndRefresh(app, cookie);
    const listFlags = async () =>
      (await api(app.base, "GET", "/api/surveys", { cookie })).json.surveys
        .find((x) => x.id === s.id).flaggedCount;
    const seen = async () => [(await s.report()).flaggedCount, (await s.detail()).flaggedCount, await listFlags()];
    const before = await seen();
    await s.reopen();
    await s.respond(() => 4);
    const pendingFlagged = app.conn
      .prepare("SELECT COUNT(*) AS n FROM responses WHERE survey_id = ? AND flagged_quality = 1 AND published = 0")
      .get(s.id).n;
    assert.ok(pendingFlagged >= 1);
    assert.deepEqual(await seen(), before);
    await s.close();
    assert.deepEqual(await seen(), before);
  }));

test("flaggedCount is null while nothing is published", () =>
  withApp(async (app, cookie) => {
    const s = await newSurvey(app, cookie);
    await s.respond(() => 4);
    const detail = await s.detail();
    assert.equal(detail.flaggedCount, null);
    assert.equal(detail.publishedCount, 0);
    assert.equal(detail.responseCount, 1);
  }));

test("pending responses accumulate across closes", () =>
  withApp(async (app, cookie) => {
    const s = await newSurvey(app, cookie);
    await s.varied(3);
    await s.close();
    const published = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await s.reopen();
      await s.varied(1);
      await s.close();
      published.push((await s.report()).responseCount);
    }
    assert.deepEqual(published, [3, 3, 6]);
  }));

test("publication survives restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-publication-"));
  const dbPath = path.join(dir, "signal.db");
  try {
    let id;
    let before;
    await withApp(async (app, cookie) => {
      const s = await newSurvey(app, cookie);
      await s.varied(3);
      await s.close();
      id = s.id;
      before = await s.report();
    }, { dbPath });
    await withApp(async (app, cookie) => {
      const after = handle(app, cookie, { id, codes: [] });
      assert.deepEqual(await after.report(), before);
    }, { dbPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reopened baseline with published and pending responses", () =>
  withApp(async (app, cookie) => {
    const parent = await newSurvey(app, cookie);
    await parent.varied(3);
    await parent.close();
    await parent.reopen();
    await parent.varied(1);
    const follow = await newSurvey(app, cookie, { parentSurveyId: parent.id });
    await follow.varied(3);
    await follow.close();
    const report = await follow.report();
    assert.equal(report.hasBaseline, true);
    assert.equal(report.baseline.responseCount, 3);
  }));
