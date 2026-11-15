"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/db");
const { publishPending } = require("../lib/publication");

// A fresh in-memory database, migrated and seeded, for each test.
function freshDb() {
  return db.initDb(":memory:");
}

test("a fresh database is at schema version 3", () => {
  const conn = freshDb();
  assert.equal(db.getSchemaVersion(conn), 3);
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
  const { submitted_at: submittedAt } = conn
    .prepare("SELECT submitted_at FROM responses WHERE id = ?")
    .get(responseId);
  assert.match(submittedAt, /^\d{4}-\d{2}-\d{2}$/, "submission time is stored as a UTC date only");
  assert.equal(db.countFlaggedResponses(conn, survey.id), 0);

  // A flagged response bumps only the flagged count.
  db.submitResponse(conn, {
    surveyId: survey.id,
    durationSeconds: 5,
    flaggedQuality: true,
    answers: questions.map((q) => ({ questionId: q.id, score: 3 }))
  });
  assert.equal(db.countResponses(conn, survey.id), 2);
  assert.equal(db.countFlaggedResponses(conn, survey.id), 0, "unpublished flags are hidden");
  publishPending(conn, survey.id, 1);
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

  assert.equal(db.getScoringInputForSurvey(conn, survey.id).length, 0);
  publishPending(conn, survey.id, 1);
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

  publishPending(conn, survey.id, 1);
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

// A real v1 database: the exact v1 DDL replayed, schema_version stamped 1.
function buildV1Db() {
  const conn = db.openDatabase(":memory:");
  conn.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  conn.exec(`
    CREATE TABLE users (
      id                TEXT PRIMARY KEY,
      email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash     TEXT NOT NULL,
      email_verified    INTEGER NOT NULL DEFAULT 0,
      is_active         INTEGER NOT NULL DEFAULT 1,
      failed_attempts   INTEGER NOT NULL DEFAULT 0,
      locked_until      TEXT,
      created_at        TEXT NOT NULL,
      last_login_at     TEXT
    );
    CREATE TABLE auth_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      token_hash   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      used_at      TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      key_hash    TEXT NOT NULL,
      key_salt    TEXT NOT NULL,
      weak        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE axes (
      id            TEXT PRIMARY KEY,
      template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      display_order INTEGER NOT NULL
    );
    CREATE TABLE questions (
      id                TEXT PRIMARY KEY,
      template_id       TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      axis_id           TEXT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
      text              TEXT NOT NULL,
      is_reverse_scored INTEGER NOT NULL DEFAULT 0,
      display_order     INTEGER NOT NULL
    );
    CREATE TABLE surveys (
      id                TEXT PRIMARY KEY,
      team_id           TEXT NOT NULL REFERENCES teams(id),
      template_id       TEXT NOT NULL REFERENCES templates(id),
      parent_survey_id  TEXT REFERENCES surveys(id),
      access_code       TEXT NOT NULL UNIQUE,
      status            TEXT NOT NULL DEFAULT 'open',
      opened_at         TEXT NOT NULL,
      closed_at         TEXT
    );
    CREATE TABLE responses (
      id               TEXT PRIMARY KEY,
      survey_id        TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      duration_seconds INTEGER,
      flagged_quality  INTEGER NOT NULL DEFAULT 0,
      submitted_at     TEXT NOT NULL
    );
    CREATE TABLE answers (
      id           TEXT PRIMARY KEY,
      response_id  TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      question_id  TEXT NOT NULL REFERENCES questions(id),
      score        INTEGER NOT NULL
    );
  `);
  conn
    .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')")
    .run();
  return conn;
}

test("migrateToV2 cleanly upgrades a populated v1 database (FK-safe wipe)", () => {
  const conn = buildV1Db();
  assert.equal(db.getSchemaVersion(conn), 1);

  // Populate the question bank (must survive) and the tenant chain
  // template -> axis -> question, team -> survey -> response -> answer
  // (must be wiped) using raw SQL matching the v1 schema.
  conn
    .prepare(
      "INSERT INTO templates (id, name, version, is_active, created_at) VALUES (?, ?, 1, 1, ?)"
    )
    .run("tpl-1", "Agile Health Check", "2026-01-01T00:00:00.000Z");
  conn
    .prepare(
      "INSERT INTO axes (id, template_id, name, description, display_order) VALUES (?, ?, ?, ?, ?)"
    )
    .run("axis-1", "tpl-1", "Delivery", "desc", 0);
  conn
    .prepare(
      "INSERT INTO questions (id, template_id, axis_id, text, is_reverse_scored, display_order) VALUES (?, ?, ?, ?, 0, 0)"
    )
    .run("q-1", "tpl-1", "axis-1", "We ship reliably.");
  conn
    .prepare(
      "INSERT INTO teams (id, name, key_hash, key_salt, weak, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    )
    .run("team-1", "Legacy Team", "kh", "ks", "2026-01-01T00:00:00.000Z");
  conn
    .prepare(
      "INSERT INTO surveys (id, team_id, template_id, parent_survey_id, access_code, status, opened_at, closed_at) VALUES (?, ?, ?, NULL, ?, 'open', ?, NULL)"
    )
    .run("survey-1", "team-1", "tpl-1", "CODE0001", "2026-01-01T00:00:00.000Z");
  conn
    .prepare(
      "INSERT INTO responses (id, survey_id, duration_seconds, flagged_quality, submitted_at) VALUES (?, ?, 120, 0, ?)"
    )
    .run("resp-1", "survey-1", "2026-01-01T00:00:00.000Z");
  conn
    .prepare(
      "INSERT INTO answers (id, response_id, question_id, score) VALUES (?, ?, ?, 4)"
    )
    .run("ans-1", "resp-1", "q-1");

  // Run the migration: current=1, so only migrateToV2 fires.
  db.ensureSchema(conn);

  // 1. Schema is now at v3.
  assert.equal(db.getSchemaVersion(conn), 3);

  // 2. Tenant tables wiped clean.
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM teams").get().n, 0);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM surveys").get().n, 0);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM responses").get().n, 0);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM answers").get().n, 0);

  // 3. Question bank preserved.
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM templates").get().n, 1);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM questions").get().n, 1);

  // 4. teams gained the company_id column.
  const teamCols = conn
    .prepare("PRAGMA table_info(teams)")
    .all()
    .map((c) => c.name);
  assert.ok(teamCols.includes("company_id"), "teams.company_id exists");

  // 5. No dangling foreign keys after the wipe.
  assert.deepEqual(conn.prepare("PRAGMA foreign_key_check").all(), []);
  conn.close();
});

test("migrateToV2 is idempotent on an already-v2 database", () => {
  const conn = freshDb(); // already at v2
  db.ensureSchema(conn);  // re-run: must not throw or change version
  assert.equal(db.getSchemaVersion(conn), 3);
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

test("ensureSchema refuses a newer database without modifying it", () => {
  const conn = freshDb();
  conn.prepare("UPDATE meta SET value = '4' WHERE key = 'schema_version'").run();
  assert.throws(() => db.ensureSchema(conn), /newer than this build supports/);
  assert.equal(db.getSchemaVersion(conn), 4);
  conn.close();
});

test("a failing migration rolls back completely", () => {
  const conn = buildV1Db();
  conn.exec("DROP TABLE teams; CREATE VIEW teams AS SELECT 1 AS id;");
  assert.throws(() => db.ensureSchema(conn));
  const names = conn
    .prepare("SELECT name FROM sqlite_master WHERE name = 'surveys'")
    .all();
  assert.equal(names.length, 1, "surveys survives the failed migration");
  assert.equal(db.getSchemaVersion(conn), 1);
  conn.close();
});

test("v3 adds invites and responses.published", () => {
  const conn = freshDb();
  const tables = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name);
  assert.ok(tables.includes("invites"));
  const cols = conn
    .prepare("PRAGMA table_info(responses)")
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes("published"));
  assert.equal(db.getSchemaVersion(conn), 3);
  conn.close();
});

test("v3 backfill publishes only closed surveys at the floor", () => {
  const conn = freshDb();
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
    companyId: "co-a", name: "T", keyHash: "h", keySalt: "s"
  });
  const seed = (code, status, n) => {
    const s = db.createSurvey(conn, {
      teamId: team.id, templateId: template.id, accessCode: code
    });
    conn.prepare("UPDATE surveys SET status = ? WHERE id = ?").run(status, s.id);
    for (let i = 0; i < n; i++) {
      conn
        .prepare(
          "INSERT INTO responses (id, survey_id, submitted_at) VALUES (?, ?, 'x')"
        )
        .run(`${code}-${i}`, s.id);
    }
    return s.id;
  };
  const ids = {
    c1: seed("C1", "closed", 1),
    c2: seed("C2", "closed", 2),
    c3: seed("C3", "closed", 3),
    o3: seed("O3", "open", 3)
  };
  // Step the database back to v2, then migrate forward.
  conn.exec("DROP TABLE invites; ALTER TABLE responses DROP COLUMN published;");
  conn.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run();
  db.ensureSchema(conn);

  const published = (id) =>
    conn
      .prepare("SELECT COUNT(*) AS n FROM responses WHERE survey_id = ? AND published = 1")
      .get(id).n;
  assert.equal(published(ids.c1), 0);
  assert.equal(published(ids.c2), 0);
  assert.equal(published(ids.c3), 3);
  assert.equal(published(ids.o3), 0);
  conn.close();
});
