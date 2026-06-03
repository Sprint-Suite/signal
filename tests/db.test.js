"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/db");

// A fresh in-memory database, migrated and seeded, for each test.
function freshDb() {
  return db.initDb(":memory:");
}

test("a fresh database is at schema version 2", () => {
  const conn = freshDb();
  assert.equal(db.getSchemaVersion(conn), 2);
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

test("listSurveysWithCounts exposes template version", () => {
  const conn = freshDb();
  // Set up a team and a survey under the seeded template.
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    companyId: "co-a",
    name: "Team Version",
    keyHash: "h",
    keySalt: "s",
    weak: false
  });
  db.createSurvey(conn, {
    teamId: team.id,
    templateId: template.id,
    parentSurveyId: null,
    accessCode: "ABCDEF1234"
  });

  const rows = db.listSurveysWithCounts(conn);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].template_version, 1);
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

test("createTeam stores a team; duplicate name within a company is rejected", () => {
  const conn = freshDb();
  const team = db.createTeam(conn, {
    companyId: "co-a",
    name: "Falcons",
    keyHash: "h",
    keySalt: "s"
  });
  assert.ok(team.id);
  assert.equal(team.company_id, "co-a");
  assert.equal(db.getTeamByName(conn, "falcons").id, team.id);

  assert.throws(
    () =>
      db.createTeam(conn, {
        companyId: "co-a",
        name: "Falcons",
        keyHash: "x",
        keySalt: "y"
      }),
    /already exists/
  );
  conn.close();
});

test("a survey can be created, found by access code, and closed", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    companyId: "co-a",
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
    companyId: "co-a",
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
    companyId: "co-a",
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
    companyId: "co-a",
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
    companyId: "co-a",
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

test("migrateToV2 wipes tenant tables, keeps the question bank, adds company_id", () => {
  const conn = db.openDatabase(":memory:");
  conn.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const dbModule = require("../lib/db");
  dbModule.ensureSchema(conn);
  dbModule.seedQuestionBank(conn);

  // Question bank survived the v2 migration.
  assert.equal(dbModule.listTemplates(conn).length, 1);
  const template = dbModule.getActiveTemplate(conn);
  assert.equal(dbModule.getQuestionsForTemplate(conn, template.id).length, 24);

  // teams now has a company_id column.
  const teamCols = conn.prepare("PRAGMA table_info(teams)").all().map((c) => c.name);
  assert.ok(teamCols.includes("company_id"), "teams.company_id exists");

  // Tenant tables are empty (clean-cut wipe).
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM teams").get().n, 0);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM surveys").get().n, 0);
  conn.close();
});

test("migrateToV2 is idempotent on an already-v2 database", () => {
  const conn = freshDb(); // already at v2
  db.ensureSchema(conn);  // re-run: must not throw or change version
  assert.equal(db.getSchemaVersion(conn), 2);
  conn.close();
});

test("listTeamsForCompany returns only that company's teams", () => {
  const conn = freshDb();
  db.createTeam(conn, { companyId: "co-a", name: "Alpha", keyHash: "h", keySalt: "s" });
  db.createTeam(conn, { companyId: "co-a", name: "Beta", keyHash: "h", keySalt: "s" });
  db.createTeam(conn, { companyId: "co-b", name: "Gamma", keyHash: "h", keySalt: "s" });

  const aTeams = db.listTeamsForCompany(conn, "co-a");
  assert.deepEqual(aTeams.map((t) => t.name).sort(), ["Alpha", "Beta"]);

  const bTeams = db.listTeamsForCompany(conn, "co-b");
  assert.deepEqual(bTeams.map((t) => t.name), ["Gamma"]);
  conn.close();
});

test("two companies can each have a team with the same name", () => {
  const conn = freshDb();
  const a = db.createTeam(conn, { companyId: "co-a", name: "Platform", keyHash: "h", keySalt: "s" });
  const b = db.createTeam(conn, { companyId: "co-b", name: "Platform", keyHash: "h", keySalt: "s" });
  assert.notEqual(a.id, b.id);
  assert.equal(db.listTeamsForCompany(conn, "co-a").length, 1);
  assert.equal(db.listTeamsForCompany(conn, "co-b").length, 1);
  conn.close();
});

test("listSurveysWithCountsForCompany returns only that company's surveys", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const teamA = db.createTeam(conn, { companyId: "co-a", name: "A-Team", keyHash: "h", keySalt: "s" });
  const teamB = db.createTeam(conn, { companyId: "co-b", name: "B-Team", keyHash: "h", keySalt: "s" });
  db.createSurvey(conn, { teamId: teamA.id, templateId: template.id, parentSurveyId: null, accessCode: "AAAAAA1111" });
  db.createSurvey(conn, { teamId: teamB.id, templateId: template.id, parentSurveyId: null, accessCode: "BBBBBB2222" });

  const aRows = db.listSurveysWithCountsForCompany(conn, "co-a");
  assert.equal(aRows.length, 1);
  assert.equal(aRows[0].team_name, "A-Team");

  assert.equal(db.listSurveysWithCountsForCompany(conn, "co-b").length, 1);
  assert.equal(db.listSurveysWithCountsForCompany(conn, null).length, 0);
  conn.close();
});
