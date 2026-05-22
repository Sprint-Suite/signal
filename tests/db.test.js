"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/db");

// A fresh in-memory database, migrated and seeded, for each test.
function freshDb() {
  return db.initDb(":memory:");
}

test("a fresh database is at schema version 1", () => {
  const conn = freshDb();
  assert.equal(db.getSchemaVersion(conn), 1);
  conn.close();
});

test("the v1 question bank seeds 1 template, 6 axes, 24 questions", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  assert.equal(template.name, "Agile Health Check");
  assert.equal(template.version, 1);

  const axes = db.getAxesForTemplate(conn, template.id);
  assert.equal(axes.length, 6);

  const questions = db.getQuestionsForTemplate(conn, template.id);
  assert.equal(questions.length, 24);

  const reverse = questions.filter((q) => q.is_reverse_scored);
  assert.equal(reverse.length, 6); // one reverse item per axis
  conn.close();
});

test("seeding is idempotent — re-seeding does not duplicate", () => {
  const conn = freshDb();
  db.seedQuestionBank(conn);
  db.seedQuestionBank(conn);
  assert.equal(db.listTemplates(conn).length, 1);
  conn.close();
});

test("createUser stores a user; duplicate email is rejected", () => {
  const conn = freshDb();
  const user = db.createUser(conn, {
    email: "Admin@Example.com",
    passwordHash: "hash"
  });
  assert.ok(user.id);
  assert.equal(user.email_verified, 0);
  assert.equal(user.is_active, 1);

  // Email lookup is case-insensitive.
  assert.equal(db.getUserByEmail(conn, "admin@example.com").id, user.id);

  assert.throws(
    () => db.createUser(conn, { email: "admin@example.com", passwordHash: "x" }),
    /already exists/
  );
  conn.close();
});

test("lockout lifecycle: count up, lock, then clear on success", () => {
  const conn = freshDb();
  const user = db.createUser(conn, { email: "a@b.com", passwordHash: "h" });

  assert.equal(db.recordFailedLogin(conn, user.id), 1);
  assert.equal(db.recordFailedLogin(conn, user.id), 2);

  const future = new Date(Date.now() + 60000).toISOString();
  db.lockUser(conn, user.id, future);
  assert.equal(db.getUserById(conn, user.id).locked_until, future);

  db.recordSuccessfulLogin(conn, user.id);
  const after = db.getUserById(conn, user.id);
  assert.equal(after.failed_attempts, 0);
  assert.equal(after.locked_until, null);
  assert.ok(after.last_login_at);
  conn.close();
});

test("auth tokens: created, looked up by hash, single-use, invalidated in bulk", () => {
  const conn = freshDb();
  const user = db.createUser(conn, { email: "t@b.com", passwordHash: "h" });

  const token = db.createAuthToken(conn, {
    userId: user.id,
    kind: "reset",
    tokenHash: "hash-abc",
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  });
  assert.equal(db.getAuthTokenByHash(conn, "hash-abc").id, token.id);
  assert.equal(token.used_at, null);

  db.consumeAuthToken(conn, token.id);
  assert.ok(db.getAuthTokenById(conn, token.id).used_at);

  // A second outstanding token, then bulk-invalidate.
  db.createAuthToken(conn, {
    userId: user.id,
    kind: "reset",
    tokenHash: "hash-def",
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  });
  db.invalidateUserTokens(conn, user.id, "reset");
  assert.ok(db.getAuthTokenByHash(conn, "hash-def").used_at);
  conn.close();
});

test("createTeam stores a team; duplicate name is rejected", () => {
  const conn = freshDb();
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });
  assert.ok(team.id);
  assert.equal(db.getTeamByName(conn, "falcons").id, team.id);

  assert.throws(
    () => db.createTeam(conn, { name: "Falcons", keyHash: "x", keySalt: "y" }),
    /already exists/
  );
  conn.close();
});

test("a survey can be created, found by access code, and closed", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });

  const survey = db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    accessCode: "CODE123"
  });
  assert.equal(survey.status, "open");
  assert.equal(db.getSurveyByAccessCode(conn, "CODE123").id, survey.id);

  const closed = db.closeSurvey(conn, survey.id);
  assert.equal(closed.status, "closed");
  assert.ok(closed.closed_at);

  assert.throws(
    () =>
      db.createSurvey(conn, {
        teamId: team.id,
        templateId: template.id,
        accessCode: "CODE123"
      }),
    /access code/
  );
  conn.close();
});

test("submitResponse persists a response and its answers atomically", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });
  const survey = db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    accessCode: "CODE123"
  });
  const questions = db.getQuestionsForTemplate(conn, template.id);

  const responseId = db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 200,
    flaggedQuality: false,
    answers: questions.map((q) => ({ questionId: q.id, score: 4 }))
  });
  assert.ok(responseId);
  assert.equal(db.countResponses(conn, survey.id), 1);
  assert.equal(db.countFlaggedResponses(conn, survey.id), 0);

  // A flagged response bumps only the flagged count.
  db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 5,
    flaggedQuality: true,
    answers: questions.map((q) => ({ questionId: q.id, score: 3 }))
  });
  assert.equal(db.countResponses(conn, survey.id), 2);
  assert.equal(db.countFlaggedResponses(conn, survey.id), 1);
  conn.close();
});

test("getScoringInputForSurvey returns rows ready for the scoring engine", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });
  const survey = db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    accessCode: "CODE123"
  });
  const questions = db.getQuestionsForTemplate(conn, template.id);
  db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 200,
    flaggedQuality: false,
    answers: questions.map((q) => ({ questionId: q.id, score: 4 }))
  });

  const rows = db.getScoringInputForSurvey(conn, survey.id);
  assert.equal(rows.length, 24);
  for (const row of rows) {
    assert.ok(row.axisId);
    assert.ok(Number.isInteger(row.rawScore));
    assert.ok(row.isReverseScored === 0 || row.isReverseScored === 1);
  }
  conn.close();
});

test("listSurveysWithCounts joins team/template names and response counts", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });
  const survey = db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    accessCode: "CODE123"
  });
  const questions = db.getQuestionsForTemplate(conn, template.id);
  db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 200,
    flaggedQuality: true,
    answers: questions.map((q) => ({ questionId: q.id, score: 4 }))
  });

  const list = db.listSurveysWithCounts(conn);
  assert.equal(list.length, 1);
  assert.equal(list[0].team_name, "Falcons");
  assert.equal(list[0].template_name, "Agile Health Check");
  assert.equal(list[0].response_count, 1);
  assert.equal(list[0].flagged_count, 1);
  conn.close();
});

test("deleting a survey cascades to its responses and answers", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    name: "Falcons",
    keyHash: "kh",
    keySalt: "ks"
  });
  const survey = db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    accessCode: "CODE123"
  });
  const questions = db.getQuestionsForTemplate(conn, template.id);
  db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 200,
    flaggedQuality: false,
    answers: questions.map((q) => ({ questionId: q.id, score: 4 }))
  });

  assert.equal(db.deleteSurvey(conn, survey.id), true);
  assert.equal(db.countResponses(conn, survey.id), 0);
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM answers").get().n,
    0
  );
  conn.close();
});
