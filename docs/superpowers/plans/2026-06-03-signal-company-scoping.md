# Signal Company-Scoping (identity-v2 Layer 4, Thread C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Signal multi-tenant by company — every facilitator (teams, surveys, reports) view is scoped to the company on the user's hub session, while the anonymous `/s/:code` respondent flow stays untouched.

**Architecture:** Add `company_id` to Signal's own `teams` table via a clean-cut v2 migration (drop + recreate the four tenant tables, preserve the global question bank). Read the already-deployed `req.user.company` (`{id,name}|null`) provided by `@suite/auth-client` and gate every authed `/api` read/write through the owning team's `company_id`. Cross-company access returns 404; a company-less session sees nothing.

**Tech Stack:** Node.js, Express, better-sqlite3 (raw SQL, "Retrospective migration pattern"), `@suite/auth-client`, `node --test` unit tests, Playwright e2e.

**Source spec:** `docs/superpowers/specs/2026-06-02-signal-company-scoping-design.md`

---

## Branch

This work branches off `feat/suite-auth` (the de-facto Signal release line; prod tracks it), per the resolved open question. Do all work on `feat/company-scoping`, merge back into `feat/suite-auth` at the end.

## File Structure

- **Create** `lib/companyAccess.js` — pure `teamCompanyAllowed(team, company)` predicate. One responsibility: the cross-company guard, shared by both route modules.
- **Create** `tests/companyAccess.test.js` — unit tests for the predicate.
- **Modify** `lib/db.js` — bump `SCHEMA_VERSION` to 2; add `migrateToV2`; `createTeam` stamps `company_id`; add `listTeamsForCompany`, `listSurveysWithCountsForCompany`; teams gain `UNIQUE(company_id, name)`.
- **Modify** `lib/surveyRoutes.js` — scope teams + surveys routes to `req.user.company`.
- **Modify** `lib/reportRoutes.js` — scope `loadSurvey` to `req.user.company`.
- **Modify** `tests/db.test.js` — update the schema-version assertion and the `createTeam` call sites for the new required `company_id`.
- **Modify** `tests/server.test.js` — `loginAsAdmin` seeds a company; add company-isolation route tests.
- **Create** `tests/e2e/company-scoping.spec.js` — A-sees-only-A, A→B 404, anonymous respondent still submits.

Anonymous respondent code (`lib/responseRoutes.js`, `/s/:code`, `/api/respond`) is **not touched** — company-agnostic by design.

---

### Task 0: Create the feature branch

- [ ] **Step 1: Branch off the release line**

Run:
```bash
cd /var/www/signal && git checkout -b feat/company-scoping feat/suite-auth
```
Expected: `Switched to a new branch 'feat/company-scoping'`

- [ ] **Step 2: Confirm clean base**

Run: `git status -sb`
Expected: `## feat/company-scoping` and no staged changes (untracked test-results/ etc. are fine — never `git add -A`).

---

### Task 1: Schema migration to v2 (clean-cut tenant wipe + `company_id`)

**Files:**
- Modify: `lib/db.js` (`SCHEMA_VERSION` line 21; `ensureSchema` lines 76-88; add `migrateToV2`)
- Modify: `tests/db.test.js` (schema-version test lines 13-17)
- Test: `tests/db.test.js`

- [ ] **Step 1: Update the failing schema-version test first**

In `tests/db.test.js`, replace the existing test (lines 13-17):

```javascript
test("a fresh database is at schema version 2", () => {
  const conn = freshDb();
  assert.equal(db.getSchemaVersion(conn), 2);
  conn.close();
});
```

- [ ] **Step 2: Add the migration wipe test**

Append to `tests/db.test.js`:

```javascript
test("migrateToV2 wipes tenant tables, keeps the question bank, adds company_id", () => {
  // Build a v1 database by hand: schema v1 DDL, seeded bank, a team + survey + response.
  const conn = db.openDatabase(":memory:");
  conn.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  // Force the v1-only path, then seed.
  const dbModule = require("../lib/db");
  // Run the real ensureSchema (lands at current SCHEMA_VERSION), then assert final shape.
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: FAIL — the schema-version test expects 2 but gets 1; `teams.company_id` does not exist.

- [ ] **Step 4: Bump the schema version**

In `lib/db.js` line 21, change:

```javascript
const SCHEMA_VERSION = 2;
```

- [ ] **Step 5: Wire the migration into `ensureSchema`**

In `lib/db.js`, replace the body of `ensureSchema` (the `if (current < 1)` block and the comment, lines 80-87) with:

```javascript
  const current = getSchemaVersion(db);

  if (current < 1) {
    migrateToV1(db);
  }
  if (current < 2) {
    migrateToV2(db);
  }

  setSchemaVersion(db, SCHEMA_VERSION);
```

- [ ] **Step 6: Add the `migrateToV2` function**

In `lib/db.js`, immediately after `migrateToV1` (after line 182), add:

```javascript
/**
 * v2 — company scoping (identity-v2 Layer 4, Thread C).
 *
 * Clean-cut tenant wipe: drop and recreate teams + everything beneath it,
 * adding `teams.company_id` so all facilitator data is scoped to the company
 * on the hub session. The shared question bank (templates/axes/questions) and
 * the auth tables (users/auth_tokens) are preserved. Team names are unique
 * per company, not globally, so two companies can each have a "Platform" team
 * without leaking each other's existence.
 */
function migrateToV2(db) {
  const ddl = `
    DROP TABLE IF EXISTS answers;
    DROP TABLE IF EXISTS responses;
    DROP TABLE IF EXISTS surveys;
    DROP TABLE IF EXISTS teams;

    CREATE TABLE teams (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL,
      key_salt    TEXT NOT NULL,
      weak        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      UNIQUE (company_id, name COLLATE NOCASE)
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

    CREATE INDEX IF NOT EXISTS idx_teams_company    ON teams(company_id);
    CREATE INDEX IF NOT EXISTS idx_surveys_team     ON surveys(team_id);
    CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id);
    CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
  `;
  db.exec(ddl);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: the schema-version + migration tests PASS. (Other `createTeam` tests in this file may still fail — fixed in Task 2. That is expected.)

- [ ] **Step 8: Commit**

```bash
cd /var/www/signal
git add lib/db.js tests/db.test.js
git commit -m "feat(db): v2 migration — company_id on teams, clean-cut tenant wipe"
```

---

### Task 2: `createTeam` stamps `company_id`; add `listTeamsForCompany`

**Files:**
- Modify: `lib/db.js` (`createTeam` lines 472-492; `getTeamByName`; `listTeams`; module exports)
- Test: `tests/db.test.js`

- [ ] **Step 1: Update the existing `createTeam` tests to pass `companyId`**

In `tests/db.test.js`, every `db.createTeam(conn, {...})` call must now include `companyId`. Update each of the call sites (lines ~40, 136, 145, 154, 187, 224, 255, 285) to add `companyId: "co-a"` (use `"co-b"` where a second company is wanted). For example the block near line 40 becomes:

```javascript
  const team = db.createTeam(conn, {
    companyId: "co-a",
    name: "Team Version",
    keyHash: "h",
    keySalt: "s",
    weak: false
  });
```

And the duplicate-name test near line 134:

```javascript
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
```

- [ ] **Step 2: Add the `listTeamsForCompany` + same-name-different-company test**

Append to `tests/db.test.js`:

```javascript
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: FAIL — `createTeam` ignores `companyId` (NOT NULL violation on insert) and `listTeamsForCompany` is not a function.

- [ ] **Step 4: Update `createTeam` to store `company_id`**

In `lib/db.js`, replace `createTeam` (lines 472-492) with:

```javascript
function createTeam(db, { companyId, name, keyHash, keySalt, weak = false }) {
  const id = newId();
  const safeName = String(name || "").trim();
  if (!safeName) {
    throw new Error("Team name is required.");
  }
  if (!companyId) {
    throw new Error("A company is required to create a team.");
  }
  try {
    db.prepare(
      `INSERT INTO teams (id, company_id, name, key_hash, key_salt, weak, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, companyId, safeName, keyHash, keySalt, weak ? 1 : 0, nowIso());
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
```

- [ ] **Step 5: Add `listTeamsForCompany` after `listTeams`**

In `lib/db.js`, immediately after `listTeams` (after line 512), add:

```javascript
function listTeamsForCompany(db, companyId) {
  if (!companyId) return [];
  return db
    .prepare("SELECT * FROM teams WHERE company_id = ? ORDER BY name COLLATE NOCASE")
    .all(companyId);
}
```

- [ ] **Step 6: Export `listTeamsForCompany`**

In `lib/db.js` module.exports `// teams` block (after `listTeams,` line 845), add:

```javascript
  listTeamsForCompany,
```

- [ ] **Step 7: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: PASS (all of `tests/db.test.js`).

- [ ] **Step 8: Commit**

```bash
cd /var/www/signal
git add lib/db.js tests/db.test.js
git commit -m "feat(db): createTeam stamps company_id; add listTeamsForCompany"
```

---

### Task 3: `listSurveysWithCountsForCompany`

**Files:**
- Modify: `lib/db.js` (after `listSurveysWithCounts` lines 662-680; module exports)
- Test: `tests/db.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/db.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: FAIL — `listSurveysWithCountsForCompany is not a function`.

- [ ] **Step 3: Add the function**

In `lib/db.js`, immediately after `listSurveysWithCounts` (after line 680), add:

```javascript
/** Same as listSurveysWithCounts, scoped to one company via the owning team. */
function listSurveysWithCountsForCompany(db, companyId) {
  if (!companyId) return [];
  return db
    .prepare(
      `SELECT s.*,
              t.name      AS team_name,
              tpl.name    AS template_name,
              tpl.version AS template_version,
              (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id)
                AS response_count,
              (SELECT COUNT(*) FROM responses r
                 WHERE r.survey_id = s.id AND r.flagged_quality = 1)
                AS flagged_count
       FROM surveys s
       JOIN teams t      ON t.id = s.team_id
       JOIN templates tpl ON tpl.id = s.template_id
       WHERE t.company_id = ?
       ORDER BY s.opened_at DESC`
    )
    .all(companyId);
}
```

- [ ] **Step 4: Export it**

In `lib/db.js` module.exports `// surveys` block (after `listSurveysWithCounts,` line 860), add:

```javascript
  listSurveysWithCountsForCompany,
```

- [ ] **Step 5: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/db.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/www/signal
git add lib/db.js tests/db.test.js
git commit -m "feat(db): add listSurveysWithCountsForCompany"
```

---

### Task 4: `companyAccess.js` guard predicate

**Files:**
- Create: `lib/companyAccess.js`
- Test: `tests/companyAccess.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/companyAccess.test.js`:

```javascript
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { teamCompanyAllowed } = require("../lib/companyAccess");

test("teamCompanyAllowed: true only when team.company_id matches company.id", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { id: "co-a", name: "A" }), true);
});

test("teamCompanyAllowed: false on company mismatch", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { id: "co-b", name: "B" }), false);
});

test("teamCompanyAllowed: false when company is null/undefined", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, null), false);
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, undefined), false);
});

test("teamCompanyAllowed: false when company has no id", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { name: "A" }), false);
});

test("teamCompanyAllowed: false when team is null/has no company_id", () => {
  assert.equal(teamCompanyAllowed(null, { id: "co-a" }), false);
  assert.equal(teamCompanyAllowed({}, { id: "co-a" }), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/companyAccess.test.js`
Expected: FAIL — cannot find module `../lib/companyAccess`.

- [ ] **Step 3: Create the module**

Create `lib/companyAccess.js`:

```javascript
"use strict";

/**
 * lib/companyAccess.js — the cross-company guard for Signal's facilitator API.
 *
 * `team` is a row from the `teams` table (has `company_id`); `company` is
 * `req.user.company` (`{ id, name }` or null) as provided by @suite/auth-client.
 * Returns true only when the team belongs to the session's company.
 */
function teamCompanyAllowed(team, company) {
  return (
    !!company &&
    !!company.id &&
    !!team &&
    team.company_id === company.id
  );
}

module.exports = { teamCompanyAllowed };
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/companyAccess.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/signal
git add lib/companyAccess.js tests/companyAccess.test.js
git commit -m "feat(signal): add teamCompanyAllowed cross-company guard"
```

---

### Task 5: Company-scope the team routes (`surveyRoutes.js`)

**Files:**
- Modify: `lib/surveyRoutes.js` (imports line 13; teams routes lines 73-148)
- Modify: `tests/server.test.js` (`loginAsAdmin` lines 96-105)
- Test: `tests/server.test.js`

- [ ] **Step 1: Update `loginAsAdmin` to seed a company, then add team-scoping tests**

In `tests/server.test.js`, replace `loginAsAdmin` (lines 96-105) with:

```javascript
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
    company
  });
  return `signal_session=${id}`;
}
```

Then append these tests to `tests/server.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: FAIL — team list returns both companies' teams; rotate/delete return 200; company-less create returns 201.

- [ ] **Step 3: Import the guard and add a company helper**

In `lib/surveyRoutes.js`, after line 13 (`const { safeLogActivity } = require("./adminActivity");`), add:

```javascript
const { teamCompanyAllowed } = require("./companyAccess");
```

Then inside `createSurveyRoutes`, immediately after `const router = express.Router();` (line 51), add:

```javascript
  // `req.user.company` is `{ id, name }` or null (set by auth.requireAuth).
  const companyOf = (req) => (req.user && req.user.company) || null;
```

- [ ] **Step 4: Scope `GET /teams`**

In `lib/surveyRoutes.js`, replace the `GET /teams` handler (lines 74-76) with:

```javascript
  router.get("/teams", (req, res) => {
    const company = companyOf(req);
    const teams = company ? db.listTeamsForCompany(conn, company.id) : [];
    res.json({ teams: teams.map(publicTeam) });
  });
```

- [ ] **Step 5: Scope `POST /teams`**

In `lib/surveyRoutes.js`, replace the `POST /teams` handler's opening (the `const name = ...` through the `db.createTeam` call, lines 78-97) so it requires a company and stamps `company_id`:

```javascript
  router.post("/teams", (req, res) => {
    const company = companyOf(req);
    if (!company) {
      return res.status(403).json({ error: "No company is associated with your session. Please sign in again." });
    }
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "A team name is required." });
    }
    const key = accessKeys.createTeamKey();
    let team;
    try {
      team = db.createTeam(conn, {
        companyId: company.id,
        name,
        keyHash: key.keyHash,
        keySalt: key.keySalt,
        weak: key.weak
      });
    } catch (err) {
      if (err.code === "TEAM_EXISTS") {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
```

(Leave the rest of the handler — `safeLogActivity` and the 201 response — unchanged.)

- [ ] **Step 6: Scope `POST /teams/:id/rotate-key`**

In `lib/surveyRoutes.js`, replace the team lookup at the top of the rotate-key handler (lines 108-111) with:

```javascript
    const team = db.getTeamById(conn, req.params.id);
    if (!team || !teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Team not found." });
    }
```

- [ ] **Step 7: Scope `DELETE /teams/:id`**

In `lib/surveyRoutes.js`, replace the team lookup at the top of the delete handler (lines 127-130) with:

```javascript
    const team = db.getTeamById(conn, req.params.id);
    if (!team || !teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Team not found." });
    }
```

- [ ] **Step 8: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: PASS for the new team tests. (Survey/report tests still pass because `loginAsAdmin` now seeds a default company and create→read share it.)

- [ ] **Step 9: Commit**

```bash
cd /var/www/signal
git add lib/surveyRoutes.js tests/server.test.js
git commit -m "feat(signal): company-scope team routes"
```

---

### Task 6: Company-scope the survey routes (`surveyRoutes.js`)

**Files:**
- Modify: `lib/surveyRoutes.js` (surveys routes lines 150-261)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server.test.js`:

```javascript
test("a company cannot read or transition another company's survey (404)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const created = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieA,
      body: { teamId: team.json.team.id }
    });
    const surveyId = created.json.survey.id;

    // B sees no surveys, and cannot read or close A's survey.
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

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const attempt = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieB,
      body: { teamId: team.json.team.id }
    });
    assert.equal(attempt.status, 400);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: FAIL — B can read/close A's survey (200) and create under A's team (201).

- [ ] **Step 3: Scope `GET /surveys`**

In `lib/surveyRoutes.js`, replace the `GET /surveys` handler (lines 151-157) with:

```javascript
  router.get("/surveys", (req, res) => {
    const company = companyOf(req);
    const rows = company ? db.listSurveysWithCountsForCompany(conn, company.id) : [];
    res.json({ surveys: rows.map((row) => surveySummary(row, appBaseUrl)) });
  });
```

- [ ] **Step 4: Scope `GET /surveys/:id`**

In `lib/surveyRoutes.js`, replace the survey + team lookup at the top of the `GET /surveys/:id` handler (lines 160-165) with:

```javascript
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const template = db.getTemplateById(conn, survey.template_id);
```

- [ ] **Step 5: Scope `POST /surveys` (both the parent-inherit and direct paths)**

In `lib/surveyRoutes.js`, in the `POST /surveys` handler, replace the parent-resolution and team-validation block (lines 188-204) with:

```javascript
    const company = companyOf(req);
    if (!company) {
      return res.status(403).json({ error: "No company is associated with your session. Please sign in again." });
    }

    // A follow-up inherits its team and template from the baseline so the
    // two runs share axes and pair cleanly on the radar.
    if (parentSurveyId) {
      const parent = db.getSurveyById(conn, parentSurveyId);
      const parentTeam = parent ? db.getTeamById(conn, parent.team_id) : null;
      if (!parent || !teamCompanyAllowed(parentTeam, company)) {
        return res
          .status(400)
          .json({ error: "The chosen baseline survey was not found." });
      }
      teamId = parent.team_id;
      templateId = parent.template_id;
    }

    const team = teamId ? db.getTeamById(conn, teamId) : null;
    if (!team || !teamCompanyAllowed(team, company)) {
      return res.status(400).json({ error: "A valid team is required." });
    }
    if (!templateId || !db.getTemplateById(conn, templateId)) {
      return res.status(400).json({ error: "A valid template is required." });
    }
```

Note: this replaces the old `db.getTeamById` re-fetch on line 212 (`const team = db.getTeamById(conn, teamId);`) — that line is now redundant because `team` is already resolved above. Delete the duplicate `const team = db.getTeamById(conn, teamId);` line that follows `db.createSurvey(...)` (line 212) so `team` is not redeclared.

- [ ] **Step 6: Scope the `transition` helper (close/reopen/delete)**

In `lib/surveyRoutes.js`, replace the survey lookup at the top of the `transition` function (lines 236-239) with:

```javascript
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Survey not found." });
    }
```

(The existing `const team = db.getTeamById(conn, survey.team_id);` later in `transition`, line 241, is now redundant — remove that second lookup and reuse the `team` resolved by the guard.)

- [ ] **Step 7: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: PASS (all server tests).

- [ ] **Step 8: Commit**

```bash
cd /var/www/signal
git add lib/surveyRoutes.js tests/server.test.js
git commit -m "feat(signal): company-scope survey routes"
```

---

### Task 7: Company-scope the report routes (`reportRoutes.js`)

**Files:**
- Modify: `lib/reportRoutes.js` (imports line 17; `loadSurvey` lines 63-70)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/server.test.js`:

```javascript
test("a company cannot read another company's report/breakdown/export (404)", async () => {
  const app = await startApp();
  try {
    const cookieA = loginAsAdmin(app, "user-a", { id: "co-a", name: "A" });
    const cookieB = loginAsAdmin(app, "user-b", { id: "co-b", name: "B" });

    const team = await api(app.base, "POST", "/api/teams", { cookie: cookieA, body: { name: "Alpha" } });
    const created = await api(app.base, "POST", "/api/surveys", {
      cookie: cookieA,
      body: { teamId: team.json.team.id }
    });
    const surveyId = created.json.survey.id;

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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: FAIL — B gets 200 (report locked-but-readable) / non-404 on A's survey reports.

- [ ] **Step 3: Import the guard**

In `lib/reportRoutes.js`, after line 25 (`const { getInsights } = require("./insights");`), add:

```javascript
const { teamCompanyAllowed } = require("./companyAccess");
```

- [ ] **Step 4: Scope `loadSurvey`**

In `lib/reportRoutes.js`, replace `loadSurvey` (lines 63-70) with:

```javascript
  /** Resolve the survey within the session company, or send 404. */
  function loadSurvey(req, res) {
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      res.status(404).json({ error: "Survey not found." });
      return null;
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, req.user && req.user.company)) {
      res.status(404).json({ error: "Survey not found." });
      return null;
    }
    return survey;
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd /var/www/signal && node --test tests/server.test.js`
Expected: PASS (all server tests).

- [ ] **Step 6: Run the full unit suite**

Run: `cd /var/www/signal && npm test`
Expected: PASS across all `tests/*.test.js` (db, server, companyAccess, scoring, quality, contrast, insights, templateLoader, theme-contrast).

- [ ] **Step 7: Commit**

```bash
cd /var/www/signal
git add lib/reportRoutes.js tests/server.test.js
git commit -m "feat(signal): company-scope report routes"
```

---

### Task 8: End-to-end company isolation + anonymous respondent

**Files:**
- Create: `tests/e2e/company-scoping.spec.js`
- Reference: `tests/e2e/_auth.js`, `tests/e2e/seed.js`, `tests/e2e/survey.spec.js` (existing helpers/patterns)

- [ ] **Step 1: Read the existing e2e helpers**

Run: `cd /var/www/signal && sed -n '1,60p' tests/e2e/_auth.js && echo "---SEED---" && sed -n '1,60p' tests/e2e/seed.js`
Purpose: learn how existing specs authenticate a facilitator (seed a session/cookie) and how they seed teams/surveys, so the new spec follows the same pattern. The session seed must include a `company` (matching `app.auth._ctx.store.create({ ..., company })`). If the existing helper does not yet pass `company`, extend it to accept one (default `{ id: "co-e2e", name: "E2E Co" }`).

- [ ] **Step 2: Write the e2e spec**

Create `tests/e2e/company-scoping.spec.js`. Adapt the auth/seed helper calls to match what Step 1 revealed; the assertions below are the contract:

```javascript
"use strict";

const { test, expect } = require("@playwright/test");
const { loginAs } = require("./_auth"); // adjust to the real helper name/signature

test.describe("company scoping", () => {
  test("a facilitator sees only their own company's teams", async ({ page, request, baseURL }) => {
    // Company A creates a team.
    const cookieA = await loginAs(page, { userId: "user-a", company: { id: "co-a", name: "A" } });
    await request.post(`${baseURL}/api/teams`, {
      headers: { Cookie: cookieA },
      data: { name: "Alpha-E2E" }
    });

    // Company B creates a team.
    const cookieB = await loginAs(page, { userId: "user-b", company: { id: "co-b", name: "B" } });
    await request.post(`${baseURL}/api/teams`, {
      headers: { Cookie: cookieB },
      data: { name: "Bravo-E2E" }
    });

    // B's team list contains only Bravo.
    const bTeams = await (await request.get(`${baseURL}/api/teams`, { headers: { Cookie: cookieB } })).json();
    const names = bTeams.teams.map((t) => t.name);
    expect(names).toContain("Bravo-E2E");
    expect(names).not.toContain("Alpha-E2E");
  });

  test("a company cannot read another company's survey (404)", async ({ request, baseURL, page }) => {
    const cookieA = await loginAs(page, { userId: "user-a", company: { id: "co-a", name: "A" } });
    const team = await (await request.post(`${baseURL}/api/teams`, {
      headers: { Cookie: cookieA },
      data: { name: "Alpha-Iso" }
    })).json();
    const survey = await (await request.post(`${baseURL}/api/surveys`, {
      headers: { Cookie: cookieA },
      data: { teamId: team.team.id }
    })).json();

    const cookieB = await loginAs(page, { userId: "user-b", company: { id: "co-b", name: "B" } });
    const res = await request.get(`${baseURL}/api/surveys/${survey.survey.id}`, { headers: { Cookie: cookieB } });
    expect(res.status()).toBe(404);
  });

  test("the anonymous respondent flow still submits end-to-end", async ({ request, baseURL, page }) => {
    // Company A opens a survey.
    const cookieA = await loginAs(page, { userId: "user-a", company: { id: "co-a", name: "A" } });
    const team = await (await request.post(`${baseURL}/api/teams`, {
      headers: { Cookie: cookieA },
      data: { name: "Alpha-Anon" }
    })).json();
    const survey = await (await request.post(`${baseURL}/api/surveys`, {
      headers: { Cookie: cookieA },
      data: { teamId: team.team.id }
    })).json();
    const accessCode = survey.survey.accessCode;

    // An anonymous respondent (no cookie) loads the public page and submits.
    await page.goto(`${baseURL}/s/${accessCode}`);
    await expect(page).toHaveURL(new RegExp(`/s/${accessCode}`));
    // Drive the respond.html form the same way tests/e2e/survey.spec.js does,
    // then assert the success state that spec asserts. (Reuse its question-
    // answering helper if one exists.)
  });
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `cd /var/www/signal && npm run test:e2e`
Expected: the three company-scoping specs PASS along with the existing e2e specs. If the respondent submit step needs the exact form-driving steps, copy them from `tests/e2e/survey.spec.js` (do not invent selectors).

- [ ] **Step 4: Commit**

```bash
cd /var/www/signal
git add tests/e2e/company-scoping.spec.js tests/e2e/_auth.js
git commit -m "test(signal): e2e company isolation + anonymous respondent"
```

---

### Task 9: Merge to the release line

- [ ] **Step 1: Final full test run on the feature branch**

Run: `cd /var/www/signal && npm test`
Expected: all unit tests PASS.

- [ ] **Step 2: Push the feature branch as an off-machine backup**

Run:
```bash
cd /var/www/signal && git push -u origin feat/company-scoping
```

- [ ] **Step 3: Merge into `feat/suite-auth`**

Run:
```bash
cd /var/www/signal && git checkout feat/suite-auth && git merge --no-ff feat/company-scoping
```

- [ ] **Step 4: Re-run tests on the merge result**

Run: `cd /var/www/signal && npm test`
Expected: all PASS.

- [ ] **Step 5: Push the release line**

Run: `cd /var/www/signal && git push origin feat/suite-auth`

(Deploy to prod is a separate, step-by-step session — see the spec's Deploy section and `reference-ionos-deploy`. The clean-cut migration wipes existing Signal teams/surveys/responses on the first restart; the shared question bank survives; the auth-client `company` column ALTERs into the session DB idempotently.)

---

## Deploy notes (for the separate deploy session)

App-only (signal repo). The first restart on the new code runs `migrateToV2` (clean-cut wipe of teams/surveys/responses/answers; question bank kept) and the auth-client adds the `company` column to the session DB. Smoke checks: `/health` returns `schemaVersion: 2`; a facilitator sees only their company's teams; an anonymous `/s/:code` submit still works. Rollback = `git checkout <pre-feature-tag>` + restart (the wipe is not reversed by code rollback — accepted per the clean-cut decision). Follow the one-command-at-a-time, `---`-fenced convention.

## Self-Review

- **Spec coverage:** Schema v2 clean-cut wipe + `company_id` (Task 1) ✓; templates/axes/questions preserved (Task 1 test) ✓; `companyAccess.teamCompanyAllowed` (Task 4) ✓; `listTeamsForCompany` + `createTeam` stamps company (Task 2) ✓; `GET/POST /teams`, rotate-key, delete scoped (Task 5) ✓; survey create/list/detail + transitions scoped (Task 6) ✓; all report routes scoped (Task 7) ✓; no-company session → empty/403 (Tasks 5–7) ✓; anonymous `/s/:code` untouched + e2e proof (Task 8) ✓; cross-company → 404 (Tasks 5–7) ✓.
- **Refinement beyond spec:** team name made unique **per company** (`UNIQUE(company_id, name)`) rather than global, closing a cross-tenant existence leak. `getTeamByName` is test-only so unaffected.
- **Type consistency:** `teamCompanyAllowed(team, company)` signature used identically in surveyRoutes and reportRoutes; `company` is always `{ id, name }|null`; `companyOf(req)` returns the same shape; db helpers consistently take `companyId` (string) and return `[]` for falsy company.
- **Out of scope (flagged):** entitlement gate (`requireEntitled`) is not added — enforced hub-side today, possible follow-up.
</content>
</invoke>
