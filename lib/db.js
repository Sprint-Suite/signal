"use strict";

/**
 * lib/db.js — SQLite persistence for Signal.
 *
 * Raw SQL, no ORM. Schema version lives in a `meta` table; `ensureSchema()`
 * runs migrations on boot (the Retrospective pattern). Adding a future
 * migration means bumping SCHEMA_VERSION and adding a `migrateToVN()` branch.
 *
 * Design principles carried from the spec:
 *  - Store raw answers (1..5) immutably. Never store inverted scores.
 *  - Survey content (axes, questions, reverse flag) is data, not code.
 *  - Anonymity by design: `responses` carries no member/email/name column.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 1;

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Open (creating if needed) the SQLite database at dbPath.
 * Enables foreign keys and WAL journalling.
 */
function openDatabase(dbPath) {
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Open the database, run migrations, and seed the v1 question bank.
 * Returns a ready-to-use connection.
 */
function initDb(dbPath) {
  const db = openDatabase(dbPath);
  ensureSchema(db);
  seedQuestionBank(db);
  return db;
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

function getSchemaVersion(db) {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get();
  return row ? Number.parseInt(row.value, 10) || 0 : 0;
}

function setSchemaVersion(db, version) {
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)"
  ).run(String(version));
}

/**
 * Create the meta table, then run any migrations the current DB is missing.
 */
function ensureSchema(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  const current = getSchemaVersion(db);

  if (current < 1) {
    migrateToV1(db);
  }
  // Future: if (current < 2) migrateToV2(db);

  setSchemaVersion(db, SCHEMA_VERSION);
}

function migrateToV1(db) {
  const ddl = `
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      token_hash   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      used_at      TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      key_hash    TEXT NOT NULL,
      key_salt    TEXT NOT NULL,
      weak        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS axes (
      id            TEXT PRIMARY KEY,
      template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id                TEXT PRIMARY KEY,
      template_id       TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      axis_id           TEXT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
      text              TEXT NOT NULL,
      is_reverse_scored INTEGER NOT NULL DEFAULT 0,
      display_order     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS surveys (
      id                TEXT PRIMARY KEY,
      team_id           TEXT NOT NULL REFERENCES teams(id),
      template_id       TEXT NOT NULL REFERENCES templates(id),
      parent_survey_id  TEXT REFERENCES surveys(id),
      access_code       TEXT NOT NULL UNIQUE,
      status            TEXT NOT NULL DEFAULT 'open',
      opened_at         TEXT NOT NULL,
      closed_at         TEXT
    );

    CREATE TABLE IF NOT EXISTS responses (
      id               TEXT PRIMARY KEY,
      survey_id        TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      duration_seconds INTEGER,
      flagged_quality  INTEGER NOT NULL DEFAULT 0,
      submitted_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id           TEXT PRIMARY KEY,
      response_id  TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      question_id  TEXT NOT NULL REFERENCES questions(id),
      score        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_surveys_team     ON surveys(team_id);
    CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id);
    CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
    CREATE INDEX IF NOT EXISTS idx_questions_axis   ON questions(axis_id);
    CREATE INDEX IF NOT EXISTS idx_authtokens_user  ON auth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_authtokens_hash  ON auth_tokens(token_hash);
  `;
  db.exec(ddl);
}

// ---------------------------------------------------------------------------
// Question bank — seeded as template version 1 (spec section 9)
// ---------------------------------------------------------------------------

const QUESTION_BANK = {
  templateName: "Agile Health Check",
  axes: [
    {
      name: "Delivery",
      description: "How smoothly and predictably the team ships work. (DORA)",
      questions: [
        { text: "We can release work to production whenever we choose, without long delays.", reverse: false },
        { text: "Our work flows steadily without large batches piling up.", reverse: false },
        { text: "Getting a change from \"done\" to \"live\" usually takes far longer than it should.", reverse: true },
        { text: "Dependencies on other teams rarely block our progress.", reverse: false }
      ]
    },
    {
      name: "Quality",
      description: "Confidence that what ships is production-ready and stays that way. (DORA + craftsmanship)",
      questions: [
        { text: "We are confident our changes won't break things in production.", reverse: false },
        { text: "We rarely have to redo work because of defects found later.", reverse: false },
        { text: "Our definition of done genuinely reflects production-ready quality.", reverse: false },
        { text: "We frequently take shortcuts that we know we'll pay for later.", reverse: true }
      ]
    },
    {
      name: "Team Health",
      description: "Energy, capacity, and mutual support within the team. (Spotify Squad Health Check)",
      questions: [
        { text: "The mood on this team is generally positive and energised.", reverse: false },
        { text: "We have the people and skills we need to do our work well.", reverse: false },
        { text: "Too much of our time is lost to interruptions and context-switching.", reverse: true },
        { text: "We support each other and share workload when someone is stretched.", reverse: false }
      ]
    },
    {
      name: "Psychological Safety",
      description: "Whether it is safe to take risks, admit mistakes, and speak up. (Edmondson)",
      questions: [
        { text: "It is safe to take a risk or admit a mistake on this team.", reverse: false },
        { text: "I can raise problems and tough issues without fear of blame.", reverse: false },
        { text: "People on this team are sometimes rejected for being different.", reverse: true },
        { text: "My unique skills and views are valued and used by the team.", reverse: false }
      ]
    },
    {
      name: "Learning & Improvement",
      description: "Whether the team learns from experience and retro actions stick. (Spotify + retro practice)",
      questions: [
        { text: "We act on what we decide in retrospectives, things actually change.", reverse: false },
        { text: "We make time to learn new things and improve how we work.", reverse: false },
        { text: "We keep hitting the same problems without ever resolving them.", reverse: true },
        { text: "We treat failures as a chance to learn rather than to blame.", reverse: false }
      ]
    },
    {
      name: "Value & Purpose",
      description: "Whether the team sees how its work connects to real value. (Spotify Mission)",
      questions: [
        { text: "We understand how our work connects to real customer or business value.", reverse: false },
        { text: "We have a clear, shared sense of what we're trying to achieve.", reverse: false },
        { text: "We often build things that turn out not to matter.", reverse: true },
        { text: "We get useful feedback on whether what we ship actually works.", reverse: false }
      ]
    }
  ]
};

/**
 * Idempotently seed the v1 question bank as template version 1.
 * Does nothing if a template already exists.
 */
function seedQuestionBank(db) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM templates").get();
  if (existing.n > 0) {
    return getActiveTemplate(db);
  }

  const seed = db.transaction(() => {
    const templateId = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO templates (id, name, version, is_active, created_at)
       VALUES (?, ?, 1, 1, ?)`
    ).run(templateId, QUESTION_BANK.templateName, createdAt);

    const insertAxis = db.prepare(
      `INSERT INTO axes (id, template_id, name, description, display_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertQuestion = db.prepare(
      `INSERT INTO questions
         (id, template_id, axis_id, text, is_reverse_scored, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    let questionOrder = 0;
    QUESTION_BANK.axes.forEach((axis, axisIndex) => {
      const axisId = newId();
      insertAxis.run(axisId, templateId, axis.name, axis.description, axisIndex);
      axis.questions.forEach((q) => {
        insertQuestion.run(
          newId(),
          templateId,
          axisId,
          q.text,
          q.reverse ? 1 : 0,
          questionOrder
        );
        questionOrder += 1;
      });
    });
    return templateId;
  });

  seed();
  return getActiveTemplate(db);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function createUser(db, { email, passwordHash, emailVerified = false }) {
  const id = newId();
  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    throw new Error("Email is required.");
  }
  try {
    db.prepare(
      `INSERT INTO users
         (id, email, password_hash, email_verified, is_active,
          failed_attempts, locked_until, created_at, last_login_at)
       VALUES (?, ?, ?, ?, 1, 0, NULL, ?, NULL)`
    ).run(id, safeEmail, passwordHash, emailVerified ? 1 : 0, nowIso());
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const exists = new Error("An account with that email already exists.");
      exists.code = "EMAIL_EXISTS";
      throw exists;
    }
    throw err;
  }
  return getUserById(db, id);
}

function getUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function getUserByEmail(db, email) {
  const safeEmail = String(email || "").trim();
  if (!safeEmail) return null;
  return (
    db
      .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .get(safeEmail) || null
  );
}

function listUsers(db) {
  return db
    .prepare(
      `SELECT id, email, email_verified, is_active, created_at, last_login_at
       FROM users ORDER BY created_at`
    )
    .all();
}

function setUserVerified(db, userId) {
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}

function setUserActive(db, userId, isActive) {
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(
    isActive ? 1 : 0,
    userId
  );
}

function updateUserPassword(db, userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    passwordHash,
    userId
  );
}

/** Change a user's login email. Throws EMAIL_EXISTS if it is already taken. */
function updateUserEmail(db, userId, email) {
  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    throw new Error("Email is required.");
  }
  try {
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(safeEmail, userId);
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const exists = new Error("An account with that email already exists.");
      exists.code = "EMAIL_EXISTS";
      throw exists;
    }
    throw err;
  }
  return getUserById(db, userId);
}

/** Increment the failed-login counter; returns the new count. */
function recordFailedLogin(db, userId) {
  db.prepare(
    "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?"
  ).run(userId);
  const row = db
    .prepare("SELECT failed_attempts FROM users WHERE id = ?")
    .get(userId);
  return row ? row.failed_attempts : 0;
}

function lockUser(db, userId, lockedUntilIso) {
  db.prepare("UPDATE users SET locked_until = ? WHERE id = ?").run(
    lockedUntilIso,
    userId
  );
}

/** Clear lockout state (failed attempts + locked_until). */
function clearLockout(db, userId) {
  db.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?"
  ).run(userId);
}

/** On successful login: reset lockout state and stamp last_login_at. */
function recordSuccessfulLogin(db, userId) {
  db.prepare(
    `UPDATE users
     SET failed_attempts = 0, locked_until = NULL, last_login_at = ?
     WHERE id = ?`
  ).run(nowIso(), userId);
}

// ---------------------------------------------------------------------------
// Auth tokens (verify / reset) — store only the HASH of the token
// ---------------------------------------------------------------------------

function createAuthToken(db, { userId, kind, tokenHash, expiresAt }) {
  const id = newId();
  db.prepare(
    `INSERT INTO auth_tokens
       (id, user_id, kind, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`
  ).run(id, userId, kind, tokenHash, expiresAt, nowIso());
  return getAuthTokenById(db, id);
}

function getAuthTokenById(db, id) {
  return db.prepare("SELECT * FROM auth_tokens WHERE id = ?").get(id) || null;
}

function getAuthTokenByHash(db, tokenHash) {
  return (
    db.prepare("SELECT * FROM auth_tokens WHERE token_hash = ?").get(tokenHash) ||
    null
  );
}

/** Mark a token consumed (single-use). */
function consumeAuthToken(db, tokenId) {
  db.prepare("UPDATE auth_tokens SET used_at = ? WHERE id = ?").run(
    nowIso(),
    tokenId
  );
}

/** Invalidate every outstanding (unused) token of a kind for a user. */
function invalidateUserTokens(db, userId, kind) {
  db.prepare(
    `UPDATE auth_tokens SET used_at = ?
     WHERE user_id = ? AND kind = ? AND used_at IS NULL`
  ).run(nowIso(), userId, kind);
}

// ---------------------------------------------------------------------------
// Teams — key hashing is owned by lib/accessKeys.js; db.js only persists.
// ---------------------------------------------------------------------------

function createTeam(db, { name, keyHash, keySalt, weak = false }) {
  const id = newId();
  const safeName = String(name || "").trim();
  if (!safeName) {
    throw new Error("Team name is required.");
  }
  try {
    db.prepare(
      `INSERT INTO teams (id, name, key_hash, key_salt, weak, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, safeName, keyHash, keySalt, weak ? 1 : 0, nowIso());
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const exists = new Error("A team with that name already exists.");
      exists.code = "TEAM_EXISTS";
      throw exists;
    }
    throw err;
  }
  return getTeamById(db, id);
}

function getTeamById(db, id) {
  return db.prepare("SELECT * FROM teams WHERE id = ?").get(id) || null;
}

function getTeamByName(db, name) {
  const safeName = String(name || "").trim();
  if (!safeName) return null;
  return (
    db
      .prepare("SELECT * FROM teams WHERE name = ? COLLATE NOCASE")
      .get(safeName) || null
  );
}

function listTeams(db) {
  return db
    .prepare("SELECT * FROM teams ORDER BY name COLLATE NOCASE")
    .all();
}

function updateTeamKey(db, teamId, { keyHash, keySalt, weak = false }) {
  db.prepare(
    "UPDATE teams SET key_hash = ?, key_salt = ?, weak = ? WHERE id = ?"
  ).run(keyHash, keySalt, weak ? 1 : 0, teamId);
  return getTeamById(db, teamId);
}

function deleteTeam(db, teamId) {
  return db.prepare("DELETE FROM teams WHERE id = ?").run(teamId).changes > 0;
}

// ---------------------------------------------------------------------------
// Templates / axes / questions
// ---------------------------------------------------------------------------

function listTemplates(db) {
  return db
    .prepare("SELECT * FROM templates ORDER BY version DESC, created_at DESC")
    .all();
}

function getTemplateById(db, id) {
  return db.prepare("SELECT * FROM templates WHERE id = ?").get(id) || null;
}

/** The newest active template — what new surveys default to. */
function getActiveTemplate(db) {
  return (
    db
      .prepare(
        `SELECT * FROM templates WHERE is_active = 1
         ORDER BY version DESC, created_at DESC LIMIT 1`
      )
      .get() || null
  );
}

function getAxesForTemplate(db, templateId) {
  return db
    .prepare(
      "SELECT * FROM axes WHERE template_id = ? ORDER BY display_order"
    )
    .all(templateId);
}

/** Axis metadata as a Map keyed by axis id — the shape scoring.js expects. */
function getAxisMetaMap(db, templateId) {
  const map = new Map();
  for (const axis of getAxesForTemplate(db, templateId)) {
    map.set(axis.id, axis);
  }
  return map;
}

/** Questions for a template, ordered, each carrying its axis name. */
function getQuestionsForTemplate(db, templateId) {
  return db
    .prepare(
      `SELECT q.*, a.name AS axis_name, a.display_order AS axis_order
       FROM questions q
       JOIN axes a ON a.id = q.axis_id
       WHERE q.template_id = ?
       ORDER BY q.display_order`
    )
    .all(templateId);
}

/**
 * Insert a template with its axes and questions in a single transaction.
 * `bundle` is the validated shape produced by templateLoader:
 *   { id, name, version, axes: [{ name, description, questions: [{ text, reverse }] }] }
 * Throws SQLITE_CONSTRAINT_PRIMARYKEY if the id already exists; callers
 * should check first.
 */
function insertTemplateBundle(db, bundle) {
  const insertTpl = db.prepare(
    `INSERT INTO templates (id, name, version, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)`
  );
  const insertAxis = db.prepare(
    `INSERT INTO axes (id, template_id, name, description, display_order)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO questions
       (id, template_id, axis_id, text, is_reverse_scored, display_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    insertTpl.run(bundle.id, bundle.name, bundle.version, nowIso());
    let qOrder = 0;
    bundle.axes.forEach((axis, axisIndex) => {
      const axisId = newId();
      insertAxis.run(axisId, bundle.id, axis.name, axis.description, axisIndex);
      axis.questions.forEach((q) => {
        insertQuestion.run(
          newId(),
          bundle.id,
          axisId,
          q.text,
          q.reverse ? 1 : 0,
          qOrder
        );
        qOrder += 1;
      });
    });
  });
  tx();
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

function createSurvey(db, { teamId, templateId, parentSurveyId = null, accessCode }) {
  const id = newId();
  try {
    db.prepare(
      `INSERT INTO surveys
         (id, team_id, template_id, parent_survey_id, access_code,
          status, opened_at, closed_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)`
    ).run(id, teamId, templateId, parentSurveyId, accessCode, nowIso());
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const exists = new Error("That access code is already in use.");
      exists.code = "ACCESS_CODE_EXISTS";
      throw exists;
    }
    throw err;
  }
  return getSurveyById(db, id);
}

function getSurveyById(db, id) {
  return db.prepare("SELECT * FROM surveys WHERE id = ?").get(id) || null;
}

function getSurveyByAccessCode(db, accessCode) {
  if (!accessCode) return null;
  return (
    db.prepare("SELECT * FROM surveys WHERE access_code = ?").get(accessCode) ||
    null
  );
}

/** Surveys with team/template names and response counts — for the dashboard. */
function listSurveysWithCounts(db) {
  return db
    .prepare(
      `SELECT s.*,
              t.name   AS team_name,
              tpl.name AS template_name,
              (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id)
                AS response_count,
              (SELECT COUNT(*) FROM responses r
                 WHERE r.survey_id = s.id AND r.flagged_quality = 1)
                AS flagged_count
       FROM surveys s
       JOIN teams t      ON t.id = s.team_id
       JOIN templates tpl ON tpl.id = s.template_id
       ORDER BY s.opened_at DESC`
    )
    .all();
}

function closeSurvey(db, surveyId) {
  db.prepare(
    "UPDATE surveys SET status = 'closed', closed_at = ? WHERE id = ?"
  ).run(nowIso(), surveyId);
  return getSurveyById(db, surveyId);
}

function reopenSurvey(db, surveyId) {
  db.prepare(
    "UPDATE surveys SET status = 'open', closed_at = NULL WHERE id = ?"
  ).run(surveyId);
  return getSurveyById(db, surveyId);
}

function deleteSurvey(db, surveyId) {
  return db.prepare("DELETE FROM surveys WHERE id = ?").run(surveyId).changes > 0;
}

/**
 * Retention: delete surveys closed more than `days` ago. Responses and answers
 * cascade. Open surveys and history within the window are never touched.
 * Returns the number of surveys removed.
 */
function applyRetention(db, days) {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .prepare(
      `DELETE FROM surveys
       WHERE status = 'closed' AND closed_at IS NOT NULL AND closed_at < ?`
    )
    .run(cutoff).changes;
}

// ---------------------------------------------------------------------------
// Responses & answers — submitted together in one transaction
// ---------------------------------------------------------------------------

/**
 * Persist a complete anonymous response: one `responses` row plus one
 * `answers` row per question. Raw scores (1..5) are stored verbatim.
 *
 * @param {object} payload
 * @param {string} payload.surveyId
 * @param {number|null} payload.durationSeconds
 * @param {boolean} payload.flaggedQuality
 * @param {Array<{questionId: string, score: number}>} payload.answers
 * @returns {string} the new response id
 */
function submitResponse(db, { surveyId, durationSeconds, flaggedQuality, answers }) {
  const responseId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO responses
         (id, survey_id, duration_seconds, flagged_quality, submitted_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      responseId,
      surveyId,
      Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
      flaggedQuality ? 1 : 0,
      nowIso()
    );
    const insertAnswer = db.prepare(
      "INSERT INTO answers (id, response_id, question_id, score) VALUES (?, ?, ?, ?)"
    );
    for (const a of answers) {
      insertAnswer.run(newId(), responseId, a.questionId, a.score);
    }
  });
  tx();
  return responseId;
}

function countResponses(db, surveyId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM responses WHERE survey_id = ?")
    .get(surveyId).n;
}

function countFlaggedResponses(db, surveyId) {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM responses WHERE survey_id = ? AND flagged_quality = 1"
    )
    .get(surveyId).n;
}

/**
 * Scoring input for a survey: one row per answer, carrying the axis id and
 * the reverse-scored flag so scoring.js can normalise. Raw scores only.
 */
function getScoringInputForSurvey(db, surveyId) {
  return db
    .prepare(
      `SELECT r.id          AS response_id,
              a.question_id AS questionId,
              q.axis_id     AS axisId,
              a.score       AS rawScore,
              q.is_reverse_scored AS isReverseScored
       FROM answers a
       JOIN responses r ON r.id = a.response_id
       JOIN questions q ON q.id = a.question_id
       WHERE r.survey_id = ?`
    )
    .all(surveyId);
}

/**
 * Per-response, per-question answers for a survey, joined with question text
 * and axis — feeds both the quality checks and the per-question breakdown.
 */
function getAnswersWithQuestionForSurvey(db, surveyId) {
  return db
    .prepare(
      `SELECT r.id          AS response_id,
              q.id          AS question_id,
              q.axis_id     AS axis_id,
              q.text        AS question_text,
              q.is_reverse_scored AS is_reverse_scored,
              q.display_order     AS display_order,
              a.score       AS score
       FROM answers a
       JOIN responses r ON r.id = a.response_id
       JOIN questions q ON q.id = a.question_id
       WHERE r.survey_id = ?
       ORDER BY r.id, q.display_order`
    )
    .all(surveyId);
}

module.exports = {
  SCHEMA_VERSION,
  QUESTION_BANK,
  // connection / schema
  openDatabase,
  initDb,
  ensureSchema,
  getSchemaVersion,
  seedQuestionBank,
  // users
  createUser,
  getUserById,
  getUserByEmail,
  listUsers,
  setUserVerified,
  setUserActive,
  updateUserPassword,
  updateUserEmail,
  recordFailedLogin,
  lockUser,
  clearLockout,
  recordSuccessfulLogin,
  // auth tokens
  createAuthToken,
  getAuthTokenById,
  getAuthTokenByHash,
  consumeAuthToken,
  invalidateUserTokens,
  // teams
  createTeam,
  getTeamById,
  getTeamByName,
  listTeams,
  updateTeamKey,
  deleteTeam,
  // templates / axes / questions
  listTemplates,
  getTemplateById,
  getActiveTemplate,
  getAxesForTemplate,
  getAxisMetaMap,
  getQuestionsForTemplate,
  insertTemplateBundle,
  // surveys
  createSurvey,
  getSurveyById,
  getSurveyByAccessCode,
  listSurveysWithCounts,
  closeSurvey,
  reopenSurvey,
  deleteSurvey,
  applyRetention,
  // responses & answers
  submitResponse,
  countResponses,
  countFlaggedResponses,
  getScoringInputForSurvey,
  getAnswersWithQuestionForSurvey
};
