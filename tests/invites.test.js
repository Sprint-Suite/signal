"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/db");
const invites = require("../lib/invites");
const { startApp, api, loginAsAdmin, codeOf } = require("./helpers/app");

async function setupTeam(app, cookie, name = "Falcons") {
  const templateId = (await api(app.base, "GET", "/api/templates", { cookie }))
    .json.templates[0].id;
  const team = await api(app.base, "POST", "/api/teams", { cookie, body: { name } });
  return { teamId: team.json.team.id, templateId };
}

async function createSurvey(app, cookie, inviteCount = 3) {
  const { teamId, templateId } = await setupTeam(app, cookie);
  const res = await api(app.base, "POST", "/api/surveys", {
    cookie,
    body: { teamId, templateId, inviteCount }
  });
  assert.equal(res.status, 201);
  return { survey: res.json.survey, codes: res.json.inviteLinks.map(codeOf) };
}

async function fullAnswers(app, code) {
  const form = await api(app.base, "GET", `/api/respond/${code}`);
  return form.json.questions.map((q) => ({ questionId: q.id, score: 4 }));
}

function submit(app, code, answers) {
  return api(app.base, "POST", `/api/respond/${code}`, {
    body: { answers, durationSeconds: 120 }
  });
}

test("createInvites stores only hashes", async () => {
  const app = await startApp();
  try {
    const { survey } = await createSurvey(app, loginAsAdmin(app));
    const codes = invites.createInvites(app.conn, survey.id, 5);
    assert.equal(codes.length, 5);
    assert.equal(new Set(codes).size, 5);
    for (const c of codes) assert.equal(c.length, 12);
    const hashes = app.conn.prepare("SELECT code_hash FROM invites").all()
      .map((r) => r.code_hash);
    for (const c of codes) assert.ok(!hashes.some((h) => h.includes(c)));
  } finally {
    await app.close();
  }
});

test("an invite accepts exactly one submission", async () => {
  const app = await startApp();
  try {
    const { codes } = await createSurvey(app, loginAsAdmin(app));
    const answers = await fullAnswers(app, codes[0]);
    assert.equal((await submit(app, codes[0], answers)).status, 201);
    const again = await submit(app, codes[0], answers);
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "This link has already been used.");
  } finally {
    await app.close();
  }
});

test("concurrent submissions on one invite yield one 201", async () => {
  const app = await startApp();
  try {
    const { survey, codes } = await createSurvey(app, loginAsAdmin(app));
    const answers = await fullAnswers(app, codes[0]);
    const results = await Promise.all([
      submit(app, codes[0], answers),
      submit(app, codes[0], answers)
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(db.countResponses(app.conn, survey.id), 1);
  } finally {
    await app.close();
  }
});

test("used invite GET reports used", async () => {
  const app = await startApp();
  try {
    const { codes } = await createSurvey(app, loginAsAdmin(app));
    await submit(app, codes[0], await fullAnswers(app, codes[0]));
    const form = await api(app.base, "GET", `/api/respond/${codes[0]}`);
    assert.equal(form.status, 200);
    assert.equal(form.json.open, false);
    assert.equal(form.json.used, true);
    assert.equal(form.json.questions, undefined);
  } finally {
    await app.close();
  }
});

test("survey creation requires inviteCount 3..50", async () => {
  const app = await startApp();
  try {
    const cookie = loginAsAdmin(app);
    const { teamId, templateId } = await setupTeam(app, cookie);
    const baseline = await api(app.base, "POST", "/api/surveys", {
      cookie,
      body: { teamId, templateId, inviteCount: 3 }
    });
    assert.equal(baseline.status, 201);
    assert.equal(baseline.json.inviteLinks.length, 3);

    const bodies = [{ teamId, templateId }, { parentSurveyId: baseline.json.survey.id }];
    for (const body of bodies) {
      for (const inviteCount of [undefined, 2, 51, 3.5, -3, "5"]) {
        const res = await api(app.base, "POST", "/api/surveys", {
          cookie,
          body: { ...body, inviteCount }
        });
        assert.equal(res.status, 400, `${JSON.stringify(body)} inviteCount=${inviteCount}`);
      }
    }
    const followUp = await api(app.base, "POST", "/api/surveys", {
      cookie,
      body: { parentSurveyId: baseline.json.survey.id, inviteCount: 3 }
    });
    assert.equal(followUp.status, 201);
    assert.equal(followUp.json.inviteLinks.length, 3);
  } finally {
    await app.close();
  }
});

test("a failed answer insert leaves the invite unused", async () => {
  const app = await startApp();
  try {
    const { survey, codes } = await createSurvey(app, loginAsAdmin(app));
    const invite = invites.findInvite(app.conn, codes[0]);
    assert.throws(() =>
      invites.submitWithInvite(app.conn, invite.id, {
        surveyId: survey.id,
        durationSeconds: 60,
        flaggedQuality: false,
        answers: [{ questionId: "no-such-question", score: 3 }]
      })
    );
    assert.equal(invites.findInvite(app.conn, codes[0]).used, false);
    assert.equal(db.countResponses(app.conn, survey.id), 0);
  } finally {
    await app.close();
  }
});

test("adding invites is company-scoped and open-only", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });
    const { survey } = await createSurvey(app, cookieA);
    const path = `/api/surveys/${survey.id}/invites`;

    const added = await api(app.base, "POST", path, { cookie: cookieA, body: { count: 2 } });
    assert.equal(added.status, 201);
    assert.equal(added.json.inviteLinks.length, 2);
    for (const count of [0, 51, 1.5, "2"]) {
      const bad = await api(app.base, "POST", path, { cookie: cookieA, body: { count } });
      assert.equal(bad.status, 400);
    }

    const other = await api(app.base, "POST", path, { cookie: cookieB, body: { count: 1 } });
    assert.equal(other.status, 404);

    await api(app.base, "POST", `/api/surveys/${survey.id}/close`, { cookie: cookieA });
    const closed = await api(app.base, "POST", path, { cookie: cookieA, body: { count: 1 } });
    assert.equal(closed.status, 409);
    assert.equal(closed.json.error, "This survey is closed.");

    const detail = await api(app.base, "GET", `/api/surveys/${survey.id}`, { cookie: cookieA });
    assert.equal(detail.json.survey.invitesTotal, 5);
    assert.equal(detail.json.survey.invitesUsed, 0);
    assert.equal(detail.json.survey.accessCode, undefined);
    assert.equal(detail.json.survey.link, undefined);
  } finally {
    await app.close();
  }
});

test("nothing links an invite to a response", async () => {
  const app = await startApp();
  try {
    const responseCols = app.conn.prepare("PRAGMA table_info(responses)").all()
      .map((c) => c.name);
    assert.ok(!responseCols.some((name) => /invite/i.test(name)));
    const inviteCols = app.conn.prepare("PRAGMA table_info(invites)").all()
      .map((c) => c.name);
    assert.deepEqual(inviteCols, ["id", "survey_id", "code_hash", "used"]);
  } finally {
    await app.close();
  }
});
