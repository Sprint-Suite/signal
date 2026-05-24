# Survey templates from disk + baseline/follow-up grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON-file-based survey-template loader that runs on server boot, ship a "Scrum Health Survey" template as the first non-seed template, and group baselines + follow-ups visually in the builder dropdown and on the dashboard.

**Architecture:** A new `lib/templateLoader.js` module reads `templates/*.json` at boot and inserts any template whose `id` isn't already in the DB (import-once contract; the existing hardcoded `seedQuestionBank()` is untouched). The builder's baseline selector becomes optgrouped by template, and the dashboard renders a `team → template → baseline → follow-ups` tree. Survey summaries gain a `templateVersion` field so the client can label optgroups as `<name> (v<version>)`.

**Tech Stack:** Node.js, Express 5, `better-sqlite3`, vanilla HTML/CSS/JS, `node --test` for units, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-05-24-survey-templates-and-grouping-design.md`

---

## File structure

**Create:**
- `lib/templateLoader.js` — the disk loader + per-file validation + insert.
- `tests/templateLoader.test.js` — unit tests for the loader (uses fixtures from a temp dir).
- `templates/scrum-health-survey-v1.json` — first file-based template.
- `tests/e2e/grouping.spec.js` — E2E test for builder optgroup + dashboard tree.

**Modify:**
- `server.js` — call `loadTemplatesFromDisk` once, after `db.initDb()`.
- `lib/db.js` — `listSurveysWithCounts` to include `template_version`; add a small `insertTemplateBundle` helper used by the loader (keeps SQL in db.js).
- `lib/surveyRoutes.js` — `surveySummary` returns `templateVersion`.
- `public/js/survey.js` — `refreshBaselines` renders `<optgroup>`s per template.
- `public/js/dashboard.js` — `init()` renders a nested tree instead of a flat list.
- `public/css/theme-signal.css` — styles for the nested dashboard rows (`.series-*` classes).
- `tests/db.test.js` — extend to cover the new `template_version` column on the dashboard projection.

---

## Task 1: Template loader module (unit tests + implementation)

**Files:**
- Create: `lib/templateLoader.js`
- Create: `tests/templateLoader.test.js`
- Modify: `lib/db.js` (add `insertTemplateBundle` helper + export)

### Background for the implementer

The loader exists so we can drop a `.json` file in `templates/` and have its template appear in the DB on the next boot. It is **import-once**: if a template with the file's `id` already exists, the loader leaves it alone. This matches the existing seed pattern (`seedQuestionBank()` in `lib/db.js:258-263` no-ops if any template exists) and protects existing surveys from being invalidated by an edit.

Validation rules and the file schema are in `docs/superpowers/specs/2026-05-24-survey-templates-and-grouping-design.md` § "Template file format". The loader must skip a bad file (logging the filename and reason) without aborting the rest of the boot.

The loader does its inserts through a new `db.insertTemplateBundle(conn, bundle)` helper in `lib/db.js`. Keeping SQL in `db.js` matches the codebase pattern (the loader doesn't run raw SQL; it asks `db.js` to).

- [ ] **Step 1: Add the `insertTemplateBundle` helper to `lib/db.js`**

Add this function near the existing template helpers (after `getQuestionsForTemplate` at `lib/db.js:579`):

```js
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

  const run = db.transaction(() => {
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
  run();
}
```

Then add `insertTemplateBundle` to the `module.exports` object at the bottom of `lib/db.js` (the export list around line 800-820 already includes `listTemplates`, `getTemplateById`, etc. — slot the new export next to them).

- [ ] **Step 2: Commit the db.js helper**

```bash
git add lib/db.js
git commit -m "Signal: add db.insertTemplateBundle for the template loader"
```

- [ ] **Step 3: Write the failing loader unit tests**

Create `tests/templateLoader.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const db = require("../lib/db");
const { loadTemplatesFromDisk } = require("../lib/templateLoader");

function freshDb() {
  return db.initDb(":memory:");
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "signal-tpl-"));
}

function writeFile(dir, name, contents) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
  return full;
}

const VALID = {
  id: "test-template-v1",
  name: "Test Template",
  version: 1,
  axes: [
    {
      name: "Axis A",
      description: "First axis.",
      questions: [
        { text: "Q1", reverse: false },
        { text: "Q2", reverse: true }
      ]
    },
    {
      name: "Axis B",
      description: "Second axis.",
      questions: [{ text: "Q3", reverse: false }]
    }
  ]
};

test("loader inserts a valid template, axes, and questions", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  writeFile(dir, "valid.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);

  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0], "test-template-v1");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);

  const tpl = db.getTemplateById(conn, "test-template-v1");
  assert.ok(tpl);
  assert.equal(tpl.name, "Test Template");
  assert.equal(tpl.version, 1);

  const axes = db.getAxesForTemplate(conn, "test-template-v1");
  assert.equal(axes.length, 2);
  assert.equal(axes[0].name, "Axis A");

  const qs = db.getQuestionsForTemplate(conn, "test-template-v1");
  assert.equal(qs.length, 3);
  assert.equal(qs[0].text, "Q1");
  assert.equal(qs[1].is_reverse_scored, 1);

  conn.close();
});

test("loader is idempotent — running twice does not duplicate", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  writeFile(dir, "valid.json", VALID);

  loadTemplatesFromDisk(conn, dir);
  const second = loadTemplatesFromDisk(conn, dir);

  assert.equal(second.imported.length, 0);
  assert.equal(second.skipped.length, 1);
  assert.equal(second.skipped[0], "test-template-v1");

  const all = db.listTemplates(conn).filter((t) => t.id === "test-template-v1");
  assert.equal(all.length, 1);
  conn.close();
});

test("loader treats a missing directory as empty (no error)", () => {
  const conn = freshDb();
  const result = loadTemplatesFromDisk(conn, "/tmp/does-not-exist-signal-xyz");
  assert.equal(result.imported.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);
  conn.close();
});

test("loader treats an empty directory as empty (no error)", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  conn.close();
});

test("loader skips a file with bad JSON and continues", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  writeFile(dir, "bad.json", "{ not json");
  writeFile(dir, "good.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);

  assert.equal(result.imported.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].file, /bad\.json$/);
  assert.match(result.errors[0].reason, /JSON|parse/i);
  conn.close();
});

test("loader rejects a file with no id", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  const noId = { ...VALID };
  delete noId.id;
  writeFile(dir, "no-id.json", noId);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /id/i);
  conn.close();
});

test("loader rejects a file with an empty axes array", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  writeFile(dir, "no-axes.json", { ...VALID, axes: [] });

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /axes/i);
  conn.close();
});

test("loader rejects a question missing the reverse field", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  const noReverse = JSON.parse(JSON.stringify(VALID));
  delete noReverse.axes[0].questions[0].reverse;
  writeFile(dir, "no-reverse.json", noReverse);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /reverse/i);
  conn.close();
});

test("loader rejects two files with the same id (second is skipped)", () => {
  const conn = freshDb();
  const dir = makeTempDir();
  writeFile(dir, "a.json", VALID);
  writeFile(dir, "b.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /duplicate/i);
  conn.close();
});
```

- [ ] **Step 4: Run the new tests, confirm they fail**

```bash
npm test -- tests/templateLoader.test.js
```

Expected: every test fails with `Cannot find module '../lib/templateLoader'`.

- [ ] **Step 5: Implement `lib/templateLoader.js`**

Create the file:

```js
"use strict";

/**
 * lib/templateLoader.js — load extra question templates from JSON files.
 *
 * On server boot we look in `templates/` for `*.json` files. Each valid
 * file becomes one template in the DB. If a template with the same `id`
 * already exists, we skip the file (import-once contract). A broken file
 * never aborts boot: it is logged and skipped.
 *
 * The hardcoded "Agile Health Check" seed in lib/db.js is independent —
 * file-based templates are purely additive.
 */

const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

function validateBundle(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "file must contain a JSON object";
  }
  if (typeof parsed.id !== "string" || !parsed.id.trim()) {
    return "missing or empty 'id'";
  }
  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    return "missing or empty 'name'";
  }
  if (!Number.isInteger(parsed.version) || parsed.version < 1) {
    return "'version' must be a positive integer";
  }
  if (!Array.isArray(parsed.axes) || parsed.axes.length === 0) {
    return "'axes' must be a non-empty array";
  }
  for (let i = 0; i < parsed.axes.length; i += 1) {
    const axis = parsed.axes[i];
    if (!axis || typeof axis !== "object") {
      return `axis #${i} is not an object`;
    }
    if (typeof axis.name !== "string" || !axis.name.trim()) {
      return `axis #${i} is missing 'name'`;
    }
    if (typeof axis.description !== "string" || !axis.description.trim()) {
      return `axis '${axis.name}' is missing 'description'`;
    }
    if (!Array.isArray(axis.questions) || axis.questions.length === 0) {
      return `axis '${axis.name}' has no questions`;
    }
    for (let j = 0; j < axis.questions.length; j += 1) {
      const q = axis.questions[j];
      if (!q || typeof q !== "object") {
        return `question #${j} in '${axis.name}' is not an object`;
      }
      if (typeof q.text !== "string" || !q.text.trim()) {
        return `question #${j} in '${axis.name}' is missing 'text'`;
      }
      if (typeof q.reverse !== "boolean") {
        return `question #${j} in '${axis.name}' is missing boolean 'reverse'`;
      }
    }
  }
  return null;
}

/**
 * Scan `templatesDir` for *.json files, validate each, insert any that
 * are not already present in the DB.
 *
 * Returns { imported: string[], skipped: string[], errors: [{file, reason}] }
 * — the ids that were inserted, the ids that were already present, and
 * any files that failed validation.
 */
function loadTemplatesFromDisk(conn, templatesDir) {
  const result = { imported: [], skipped: [], errors: [] };

  let entries;
  try {
    entries = fs.readdirSync(templatesDir);
  } catch (err) {
    if (err.code === "ENOENT") return result; // dir missing = no templates
    throw err;
  }

  const files = entries.filter((f) => f.endsWith(".json")).sort();
  const seenIds = new Set();

  for (const file of files) {
    const full = path.join(templatesDir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      result.errors.push({ file: full, reason: `JSON parse error: ${err.message}` });
      console.error(`[templateLoader] ${file}: ${err.message}`);
      continue;
    }

    const problem = validateBundle(parsed);
    if (problem) {
      result.errors.push({ file: full, reason: problem });
      console.error(`[templateLoader] ${file}: ${problem}`);
      continue;
    }

    if (seenIds.has(parsed.id)) {
      const reason = `duplicate id '${parsed.id}' across files`;
      result.errors.push({ file: full, reason });
      console.error(`[templateLoader] ${file}: ${reason}`);
      continue;
    }
    seenIds.add(parsed.id);

    if (db.getTemplateById(conn, parsed.id)) {
      result.skipped.push(parsed.id);
      console.log(`[templateLoader] ${parsed.id} already imported, skipping`);
      continue;
    }

    try {
      db.insertTemplateBundle(conn, parsed);
      result.imported.push(parsed.id);
      console.log(`[templateLoader] imported ${parsed.id} (${parsed.name} v${parsed.version})`);
    } catch (err) {
      result.errors.push({ file: full, reason: `DB insert failed: ${err.message}` });
      console.error(`[templateLoader] ${file}: insert failed: ${err.message}`);
    }
  }

  return result;
}

module.exports = { loadTemplatesFromDisk };
```

- [ ] **Step 6: Run the loader tests, confirm they pass**

```bash
npm test -- tests/templateLoader.test.js
```

Expected: all 9 tests pass.

- [ ] **Step 7: Run the full unit-test suite to confirm nothing else broke**

```bash
npm test
```

Expected: all suites green.

- [ ] **Step 8: Commit**

```bash
git add lib/templateLoader.js tests/templateLoader.test.js
git commit -m "Signal: file-based template loader with per-file validation"
```

---

## Task 2: Wire the loader into server boot

**Files:**
- Modify: `server.js`

### Background

The loader needs to run once at boot, **after** `db.initDb()` (which runs DDL and the hardcoded seed) and **before** the HTTP server starts listening. We don't put this inside `db.initDb()` because `initDb` is also called from unit tests with `:memory:`, where there is no `templates/` directory and no need to load files. Keeping the loader call in `server.js` matches the "composition root" comment at `server.js:4-7`.

- [ ] **Step 1: Modify `server.js` to call the loader**

Edit `server.js`. Add this import near the existing `lib` requires (after the `createHttpApp` line around line 25):

```js
const { loadTemplatesFromDisk } = require("./lib/templateLoader");
```

Then immediately after the `const conn = db.initDb(DB_PATH);` line (around line 43), add:

```js
loadTemplatesFromDisk(conn, path.join(__dirname, "templates"));
```

So the relevant section reads:

```js
const conn = db.initDb(DB_PATH);
loadTemplatesFromDisk(conn, path.join(__dirname, "templates"));

const app = createHttpApp({
  ...
```

- [ ] **Step 2: Smoke-test the boot path**

Start the dev server briefly to confirm boot still succeeds with no template files present (the `templates/` dir doesn't exist yet — the loader should no-op).

Run:
```bash
node -e "require('./server.js')" &
SERVER_PID=$!
sleep 2
curl -sf http://localhost:3002/health > /dev/null && echo BOOT_OK || echo BOOT_FAIL
kill $SERVER_PID 2>/dev/null
```

Expected: prints `BOOT_OK`. (If the dev server's already running on 3002 it will fail to bind — kill it first or use `PORT=3099 node -e ...`.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all green. No new tests yet for this task — Task 1 covered the loader itself; this wiring is exercised end-to-end by Task 7's E2E test.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Signal: load file-based templates on server boot"
```

---

## Task 3: Author the Scrum Health Survey template file

**Files:**
- Create: `templates/scrum-health-survey-v1.json`

### Background

This is content authoring, not engineering. The source draft is `docs/new-survey.md` — 6 spokes × 3 questions, all positively worded. We add a 4th question per axis (the spec calls for matching the Agile Health Check density of 4 per axis) and write a short axis description for each.

The wording style: positive, present tense, team-perspective ("We…" / "Our…"), one specific behaviour per question. Match the register of the existing axes in `lib/db.js:188-252`.

Axis descriptions: ≤ 80 characters, plain and concrete. They drive the radar-chart tooltips.

- [ ] **Step 1: Create the JSON file**

Create `templates/scrum-health-survey-v1.json`:

```json
{
  "id": "scrum-health-survey-v1",
  "name": "Scrum Health Survey",
  "version": 1,
  "axes": [
    {
      "name": "Sprint Goal & Planning",
      "description": "How clearly the team plans toward a shared sprint goal.",
      "questions": [
        { "text": "We have a clear Sprint Goal that guides our trade-offs during the sprint.", "reverse": false },
        { "text": "Sprint Planning produces a plan the whole team believes in, not a list handed to us.", "reverse": false },
        { "text": "We plan to realistic capacity and rarely stuff the sprint full.", "reverse": false },
        { "text": "We finish sprints with the Sprint Goal achieved, not just items ticked off.", "reverse": false }
      ]
    },
    {
      "name": "Daily Scrum & Flow",
      "description": "Whether the daily scrum keeps work flowing toward the goal.",
      "questions": [
        { "text": "Our daily scrum helps us re-plan the day together, not report status to one person.", "reverse": false },
        { "text": "We focus the daily scrum on progress toward the Sprint Goal.", "reverse": false },
        { "text": "Blockers raised in the daily scrum get owned and followed up.", "reverse": false },
        { "text": "We swarm on the most important work rather than each holding our own lane.", "reverse": false }
      ]
    },
    {
      "name": "Review & Stakeholders",
      "description": "Whether the sprint review is a real conversation with stakeholders.",
      "questions": [
        { "text": "Our sprint review is a real working conversation with stakeholders, not a one-way demo.", "reverse": false },
        { "text": "Stakeholders give us useful feedback that reshapes the backlog.", "reverse": false },
        { "text": "We show a genuinely usable increment at review, not unfinished work dressed as done.", "reverse": false },
        { "text": "The right stakeholders show up to the review and engage with what we built.", "reverse": false }
      ]
    },
    {
      "name": "Retrospective & Improvement",
      "description": "Whether retrospectives surface honest issues and produce real change.",
      "questions": [
        { "text": "Our retrospectives surface honest issues without blame.", "reverse": false },
        { "text": "We commit to a small number of specific, owned improvement actions each retro.", "reverse": false },
        { "text": "Actions from retros actually get done before the next one.", "reverse": false },
        { "text": "We track whether our improvement actions are making things better.", "reverse": false }
      ]
    },
    {
      "name": "Backlog & Product Ownership",
      "description": "Whether the backlog is ready, ordered, and owned with intent.",
      "questions": [
        { "text": "The top of our backlog is refined and ready before planning.", "reverse": false },
        { "text": "Our Product Owner is available and decisive when we need direction.", "reverse": false },
        { "text": "Our backlog is clearly ordered by value, not a dumping ground.", "reverse": false },
        { "text": "We share a clear understanding of why each top item matters.", "reverse": false }
      ]
    },
    {
      "name": "Increment & Definition of Done",
      "description": "Whether each sprint produces a real, releasable increment.",
      "questions": [
        { "text": "We have a clear Definition of Done that the whole team shares and applies.", "reverse": false },
        { "text": "Each sprint we produce a usable, potentially releasable increment.", "reverse": false },
        { "text": "Work marked \"done\" rarely bounces back as incomplete or defective.", "reverse": false },
        { "text": "Our Definition of Done covers quality, not just feature completion.", "reverse": false }
      ]
    }
  ]
}
```

- [ ] **Step 2: Boot the server and verify the template appears**

```bash
node -e "require('./server.js')" &
SERVER_PID=$!
sleep 2
curl -sf http://localhost:3002/health > /dev/null && echo BOOT_OK || echo BOOT_FAIL
kill $SERVER_PID 2>/dev/null
```

Expected: prints `BOOT_OK`. Also expected in the log output: a line like `[templateLoader] imported scrum-health-survey-v1 (Scrum Health Survey v1)` on the **first** boot, then `already imported, skipping` on subsequent boots.

(If you want to inspect the DB directly: `sqlite3 data/signal.db "SELECT id, name, version FROM templates;"` should list both the original UUID-keyed Agile Health Check and the new `scrum-health-survey-v1`.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add templates/scrum-health-survey-v1.json
git commit -m "Signal: add Scrum Health Survey template (6 axes x 4 questions)"
```

---

## Task 4: Expose `templateVersion` on survey summaries

**Files:**
- Modify: `lib/db.js` (`listSurveysWithCounts`)
- Modify: `lib/surveyRoutes.js` (`surveySummary`)
- Modify: `tests/db.test.js` (add coverage)

### Background

The builder UI wants to render the optgroup label as `"<template name> (v<version>)"`. Today `GET /api/surveys` returns `templateName` but not `templateVersion`. We add the version to the `listSurveysWithCounts` SQL and to the `surveySummary()` projection. This is the only API-shape change in the entire plan.

The per-survey `GET /api/surveys/:id` projection at `lib/surveyRoutes.js:158-177` also calls `surveySummary` — that path already does an explicit `db.getTemplateById` lookup and passes `template_name`. We add `template_version` there too so the projection stays consistent.

- [ ] **Step 1: Write the failing test**

Open `tests/db.test.js`. After the existing "the v1 question bank seeds 1 template, 6 axes, 24 questions" test (around line 19-34), add:

```js
test("listSurveysWithCounts exposes template version", () => {
  const conn = freshDb();
  // Set up a team and a survey under the seeded template.
  const template = db.getActiveTemplate(conn);
  const team = db.createTeam(conn, {
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
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npm test -- tests/db.test.js
```

Expected: the new test fails because `template_version` is `undefined`.

- [ ] **Step 3: Update `listSurveysWithCounts` in `lib/db.js`**

Find `listSurveysWithCounts` (around `lib/db.js:618-635`). Change the SELECT list to add `tpl.version`:

```js
function listSurveysWithCounts(db) {
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
       ORDER BY s.opened_at DESC`
    )
    .all();
}
```

- [ ] **Step 4: Re-run the test, confirm it passes**

```bash
npm test -- tests/db.test.js
```

Expected: all green.

- [ ] **Step 5: Update `surveySummary` in `lib/surveyRoutes.js`**

Find `surveySummary` (at `lib/surveyRoutes.js:29-45`). Add the new field:

```js
function surveySummary(row, appBaseUrl) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    templateId: row.template_id,
    templateName: row.template_name,
    templateVersion: row.template_version,
    parentSurveyId: row.parent_survey_id,
    accessCode: row.access_code,
    link: surveyLink(appBaseUrl, row.access_code),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    responseCount: row.response_count,
    flaggedCount: row.flagged_count
  };
}
```

- [ ] **Step 6: Update the single-survey GET to pass `template_version`**

The handler at `lib/surveyRoutes.js:158-177` builds the row for `surveySummary` by spreading the survey and adding `template_name`. Add `template_version` next to it:

```js
router.get("/surveys/:id", (req, res) => {
  const survey = db.getSurveyById(conn, req.params.id);
  if (!survey) {
    return res.status(404).json({ error: "Survey not found." });
  }
  const team = db.getTeamById(conn, survey.team_id);
  const template = db.getTemplateById(conn, survey.template_id);
  res.json({
    survey: surveySummary(
      {
        ...survey,
        team_name: team ? team.name : null,
        template_name: template ? template.name : null,
        template_version: template ? template.version : null,
        response_count: db.countResponses(conn, survey.id),
        flagged_count: db.countFlaggedResponses(conn, survey.id)
      },
      appBaseUrl
    )
  });
});
```

Also update the POST handler at `lib/surveyRoutes.js:204-228` similarly — it spreads a new survey into `surveySummary` with `template_name`; add `template_version`:

```js
res.status(201).json({
  survey: surveySummary(
    {
      ...survey,
      team_name: team.name,
      template_name: db.getTemplateById(conn, templateId).name,
      template_version: db.getTemplateById(conn, templateId).version,
      response_count: 0,
      flagged_count: 0
    },
    appBaseUrl
  )
});
```

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add lib/db.js lib/surveyRoutes.js tests/db.test.js
git commit -m "Signal: expose templateVersion on survey summaries"
```

---

## Task 5: Group baselines by template in the builder dropdown

**Files:**
- Modify: `public/js/survey.js` (`refreshBaselines`)

### Background

The builder's "Choose baseline" dropdown (`public/js/survey.js:77-92`) currently renders one flat option per survey for the chosen team. We change it to one `<optgroup>` per template, with the options inside listing date + response count.

This is pure DOM rendering — no API change is needed because Task 4 already exposed `templateVersion`. We use the existing `el()` and `setChildren()` helpers from `public/js/api.js`.

There is no JS unit test runner for `public/js/`; the dropdown is exercised by the Task 7 Playwright test.

- [ ] **Step 1: Edit `refreshBaselines`**

Replace the function body at `public/js/survey.js:77-92`. New version:

```js
function refreshBaselines() {
  const forTeam = surveys.filter((s) => s.teamId === teamSelect.value);

  if (forTeam.length === 0) {
    setChildren(baselineSelect, [
      el("option", { value: "", text: "No earlier surveys for this team" })
    ]);
    return;
  }

  // Group by templateId. Map preserves insertion order; we sort by name
  // before rendering so the dropdown is alphabetical.
  const groups = new Map();
  for (const s of forTeam) {
    if (!groups.has(s.templateId)) {
      groups.set(s.templateId, {
        templateId: s.templateId,
        templateName: s.templateName,
        templateVersion: s.templateVersion,
        surveys: []
      });
    }
    groups.get(s.templateId).surveys.push(s);
  }

  const ordered = Array.from(groups.values()).sort((a, b) =>
    a.templateName.localeCompare(b.templateName)
  );

  const children = [];
  for (const group of ordered) {
    const sorted = group.surveys.slice().sort((a, b) =>
      String(b.openedAt).localeCompare(String(a.openedAt))
    );
    const options = sorted.map((s) =>
      el("option", {
        value: s.id,
        text: `opened ${formatDate(s.openedAt)} (${s.responseCount} responses)`
      })
    );
    children.push(
      el(
        "optgroup",
        { label: `${group.templateName} (v${group.templateVersion})` },
        options
      )
    );
  }
  setChildren(baselineSelect, children);
}
```

Note on the `el()` shape: `el(tag, attrs, ...children)` is defined in `public/js/api.js:18-36`. The `attrs` object's keys become `setAttribute` calls (with special handling for `class`, `text`, `html`, `on*`), so `{ label: "..." }` on an `<optgroup>` becomes `setAttribute("label", "...")`. Children pass as the rest arg and can be an array (it's flattened internally).

- [ ] **Step 2: Manually smoke-test in a browser**

Start the dev server:
```bash
npm run dev
```

Sign in, go to `/survey`. Create two test surveys for one team under different templates (use the existing template selector to choose, then create — repeat). Then start a new survey, pick that team, switch to Follow-up. The baseline dropdown should now show two `<optgroup>` headers (one per template) with the surveys grouped underneath.

If only one template's worth of surveys exists, you should see just one optgroup — confirm that the dropdown still looks sensible in that single-group case.

- [ ] **Step 3: Run the full unit suite**

```bash
npm test
```

Expected: still green (no unit tests touched).

- [ ] **Step 4: Commit**

```bash
git add public/js/survey.js
git commit -m "Signal: group baseline-survey dropdown by template (optgroups)"
```

---

## Task 6: Nested dashboard rendering + supporting CSS

**Files:**
- Modify: `public/js/dashboard.js`
- Modify: `public/css/theme-signal.css`

### Background

Today `public/js/dashboard.js` renders one flat `.postcard-tile` per survey. We change `init()` to render a nested tree:

```
Team Alpha
  Agile Health Check (v1)
    ● Baseline · opened 2026-03-10 · 12 responses  [+2 follow-ups]
       └ Follow-up · opened 2026-04-14 · 10 responses
       └ Follow-up · opened 2026-05-12 · 11 responses
  Scrum Health Survey (v1)
    ● Baseline · opened 2026-04-21 · 8 responses
```

Tree-building rules (client-side, from the existing `surveys` array):
1. Group by `teamId`; sort teams alphabetically by `teamName`.
2. Within a team, group by `templateId`; sort alphabetically by `templateName`.
3. Within a template-group, baselines have `parentSurveyId === null`. Sort baselines by `openedAt` descending.
4. For each baseline, list follow-ups whose `parentSurveyId === baseline.id`, sorted by `openedAt` ascending.
5. Follow-ups whose `parentSurveyId` doesn't resolve (the baseline was deleted) go into a synthetic "Orphaned follow-ups" group at the bottom of their team.

The existing `surveyRow(survey)` helper keeps doing its job for individual rows — we just wrap groups of rows in headers and indent follow-ups.

- [ ] **Step 1: Add the CSS for nested rows**

Open `public/css/theme-signal.css`. After the existing `.postcard-tile` block (ends around line 88), add a new block:

```css
/* Dashboard series grouping — team / template / baseline / follow-ups */
.series-team-name {
  font-weight: 700;
  font-size: 1.1rem;
  margin: var(--s-4) 0 var(--s-2);
}
.series-template-name {
  color: var(--muted);
  font-size: 0.95rem;
  margin: var(--s-3) 0 var(--s-1);
  padding-left: var(--s-2);
}
.series-followups {
  margin-left: 24px;
  border-left: 2px solid var(--accent-soft, var(--border));
  padding-left: var(--s-3);
  margin-top: var(--s-2);
}
.series-followups .postcard-tile {
  margin-top: var(--s-2);
}
.series-followup-chip {
  display: inline-block;
  background: var(--accent-soft, var(--surface));
  color: var(--muted);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.8rem;
  margin-left: var(--s-2);
}
.series-orphans-label {
  font-style: italic;
  color: var(--muted);
  margin: var(--s-3) 0 var(--s-1);
  padding-left: var(--s-2);
}
```

(If `--accent-soft` isn't defined in theme-core/theme-signal, the fallbacks above use `--border` / `--surface`. The forest re-skin recently added an accent-soft variant per `docs/forestbuild-spec.md` — if it's present, this rule will use it.)

- [ ] **Step 2: Rewrite `public/js/dashboard.js` to render the nested tree**

Replace the file's content (keep the `weatherGlyphFor`, `escapeHtml`, `formatDate`, `surveyRow`, and `loadResend` helpers — only `init()` and small additions change). The full new file:

```js
"use strict";

/**
 * Pick a weather glyph that summarises a survey's status for the
 * dashboard tile. Closed surveys lean on their average score; open
 * surveys use a neutral cloud until results are in.
 */
function weatherGlyphFor(survey) {
  if (survey.status !== "closed") return "cloud";
  const avg = Number(survey.averageScore);
  if (!Number.isFinite(avg)) return "cloud";
  if (avg >= 4)   return "sun";
  if (avg >= 3)   return "cloud";
  if (avg >= 2)   return "wind";
  return "rain";
}

(function () {
  byId("signout-btn").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    window.location.href = "/";
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : "";
  }

  function surveyRow(survey, followUpCount) {
    const responses = `${survey.responseCount} response${
      survey.responseCount === 1 ? "" : "s"
    }`;
    const flaggedHtml = survey.flaggedCount > 0
      ? ` · <span class="tag tag-flagged">${survey.flaggedCount} flagged</span>`
      : "";
    const kindLabel = survey.parentSurveyId ? "Follow-up" : "Baseline";
    const chip =
      !survey.parentSurveyId && followUpCount > 0
        ? `<span class="series-followup-chip">+${followUpCount} follow-up${followUpCount === 1 ? "" : "s"}</span>`
        : "";
    const glyph = weatherGlyphFor(survey);

    const row = document.createElement("a");
    row.className = "postcard-tile";
    row.href = `/survey?id=${encodeURIComponent(survey.id)}`;
    row.innerHTML = `
      <svg class="glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#${glyph}"/></svg>
      <div class="pt-main">
        <div class="pt-team">${escapeHtml(kindLabel)}${chip}</div>
        <div class="pt-meta">opened ${escapeHtml(formatDate(survey.openedAt))} · ${escapeHtml(responses)}${flaggedHtml}</div>
      </div>
      <span class="pill ${survey.status === "open" ? "tag-ok" : "tag"}">${escapeHtml(survey.status)}</span>
    `;
    return row;
  }

  /**
   * Build a nested tree from the flat survey list:
   *   [{ teamName, templates: [{ templateName, templateVersion, baselines: [{ baseline, followUps: [] }], orphans: [] }] }]
   */
  function buildTree(surveys) {
    const byTeam = new Map();
    for (const s of surveys) {
      if (!byTeam.has(s.teamId)) {
        byTeam.set(s.teamId, { teamId: s.teamId, teamName: s.teamName, templates: new Map() });
      }
      const team = byTeam.get(s.teamId);
      if (!team.templates.has(s.templateId)) {
        team.templates.set(s.templateId, {
          templateId: s.templateId,
          templateName: s.templateName,
          templateVersion: s.templateVersion,
          baselines: [],
          followUps: []
        });
      }
      const grp = team.templates.get(s.templateId);
      if (s.parentSurveyId) grp.followUps.push(s);
      else grp.baselines.push(s);
    }

    const teams = Array.from(byTeam.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    );

    for (const team of teams) {
      const templates = Array.from(team.templates.values()).sort((a, b) =>
        a.templateName.localeCompare(b.templateName)
      );
      team.templatesList = templates;
      team.orphans = [];

      for (const grp of templates) {
        grp.baselines.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
        const baselineIds = new Set(grp.baselines.map((b) => b.id));
        const chains = grp.baselines.map((baseline) => ({
          baseline,
          followUps: grp.followUps
            .filter((f) => f.parentSurveyId === baseline.id)
            .sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)))
        }));
        grp.chains = chains;
        // Anything whose parentSurveyId doesn't match a baseline in this group
        // is an orphan at the team level.
        for (const f of grp.followUps) {
          if (!baselineIds.has(f.parentSurveyId)) team.orphans.push(f);
        }
      }
    }
    return teams;
  }

  function renderTree(tree, container) {
    container.innerHTML = "";
    for (const team of tree) {
      const teamHeader = document.createElement("h2");
      teamHeader.className = "series-team-name";
      teamHeader.textContent = team.teamName;
      container.appendChild(teamHeader);

      for (const grp of team.templatesList) {
        if (grp.chains.length === 0) continue;
        const tplHeader = document.createElement("div");
        tplHeader.className = "series-template-name";
        tplHeader.textContent = `${grp.templateName} (v${grp.templateVersion})`;
        container.appendChild(tplHeader);

        for (const chain of grp.chains) {
          container.appendChild(surveyRow(chain.baseline, chain.followUps.length));
          if (chain.followUps.length > 0) {
            const wrap = document.createElement("div");
            wrap.className = "series-followups";
            for (const f of chain.followUps) {
              wrap.appendChild(surveyRow(f, 0));
            }
            container.appendChild(wrap);
          }
        }
      }

      if (team.orphans.length > 0) {
        const label = document.createElement("div");
        label.className = "series-orphans-label";
        label.textContent = "Orphaned follow-ups (baseline deleted)";
        container.appendChild(label);
        const wrap = document.createElement("div");
        wrap.className = "series-followups";
        for (const f of team.orphans) {
          wrap.appendChild(surveyRow(f, 0));
        }
        container.appendChild(wrap);
      }
    }
  }

  async function loadResend() {
    const banner = byId("verify-banner");
    const messageBox = byId("verify-banner-message");
    byId("resend-btn").addEventListener("click", async () => {
      hide(messageBox);
      const res = await apiPost("/api/auth/resend-verification");
      notice(
        messageBox,
        res.ok
          ? "Verification email sent."
          : (res.data && res.data.error) || "Could not send the email.",
        res.ok ? "ok" : "error"
      );
    });
    show(banner);
  }

  async function init() {
    if (!(await requireSession())) return;

    const res = await apiGet("/api/surveys");
    if (res.status === 403) {
      await loadResend();
      return;
    }

    show(byId("main-content"));
    const surveys = (res.data && res.data.surveys) || [];
    const list = byId("survey-list");
    if (surveys.length === 0) {
      show(byId("empty-state"));
      return;
    }
    renderTree(buildTree(surveys), list);
  }

  init();
})();
```

- [ ] **Step 3: Smoke-test in a browser**

```bash
npm run dev
```

Sign in, go to `/dashboard`. With at least two surveys for one team (e.g. one baseline + one follow-up via the existing builder), confirm the dashboard shows:
- A team header.
- A template name beneath it.
- A baseline row with `+1 follow-up` chip.
- An indented follow-up row below it with a visible left-border accent.

- [ ] **Step 4: Run the full unit suite**

```bash
npm test
```

Expected: still green (no unit tests touched).

- [ ] **Step 5: Commit**

```bash
git add public/js/dashboard.js public/css/theme-signal.css
git commit -m "Signal: dashboard groups surveys as team -> template -> baseline -> follow-ups"
```

---

## Task 7: E2E test for grouping flow

**Files:**
- Create: `tests/e2e/grouping.spec.js`

### Background

Playwright runs against its own DB (see `playwright.config.js` — `data/e2e.db`, seeded by `tests/e2e/seed.js`). It boots a fresh server per run, which means our new `templates/scrum-health-survey-v1.json` will be loaded into the e2e DB automatically — no extra wiring needed.

The seed admin's credentials are exported from `tests/e2e/credentials.js`. The existing `tests/e2e/survey.spec.js` shows the pattern for signing in and creating a team + survey.

This test:
1. Signs in as the e2e admin.
2. Creates one team via the admin page.
3. Creates two surveys for that team — one under each template — via the builder.
4. Loads `/dashboard` and confirms the page contains both template-name headers (`Agile Health Check (v1)` and `Scrum Health Survey (v1)`) and the team name appears once.
5. Loads `/survey` builder, picks the team, switches to Follow-up, and confirms the baseline `<select>` has **two** `<optgroup>` elements, one per template.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/grouping.spec.js`:

```js
"use strict";

const { test, expect } = require("@playwright/test");
const credentials = require("./credentials");

async function signIn(page) {
  await page.goto("/");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("#login-btn");
  await page.waitForURL("**/dashboard");
}

test("dashboard groups surveys by team and template; builder optgroups baselines", async ({
  page
}) => {
  await signIn(page);

  // Create a team
  await page.goto("/admin");
  const teamName = `Grouping Team ${Date.now()}`;
  await page.fill("#team-name", teamName);
  await page.click("#create-team-btn");
  await expect(page.locator("#key-reveal")).toBeVisible();

  // Create a survey under the first template
  await page.goto("/survey");
  await expect(page.locator("#builder-form")).toBeVisible();
  await page.selectOption("#team-select", { label: teamName });
  // template-select defaults to the first option — leave as-is for survey #1
  const firstTemplateLabel = await page
    .locator("#template-select option:checked")
    .textContent();
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  // Create a survey under the OTHER template
  await page.goto("/survey");
  await page.selectOption("#team-select", { label: teamName });
  // pick a template option that is NOT the first one
  const options = await page.locator("#template-select option").allTextContents();
  const otherLabel = options.find((o) => o !== firstTemplateLabel);
  expect(otherLabel).toBeTruthy();
  await page.selectOption("#template-select", { label: otherLabel });
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  // --- Dashboard: should show team header + two template subheaders ---
  await page.goto("/dashboard");
  await expect(page.locator(".series-team-name", { hasText: teamName })).toHaveCount(1);
  await expect(
    page.locator(".series-template-name", { hasText: firstTemplateLabel.trim() })
  ).toHaveCount(1);
  await expect(
    page.locator(".series-template-name", { hasText: otherLabel.trim() })
  ).toHaveCount(1);

  // --- Builder follow-up dropdown: should have two optgroups ---
  await page.goto("/survey");
  await page.selectOption("#team-select", { label: teamName });
  await page.click("#run-followup");
  await expect(page.locator("#baseline-field")).toBeVisible();
  const optgroups = page.locator("#baseline-select optgroup");
  await expect(optgroups).toHaveCount(2);
});
```

- [ ] **Step 2: Run the E2E suite**

```bash
npm run test:e2e -- tests/e2e/grouping.spec.js
```

Expected: passes. If anything fails, the trace (`test-results/`) shows the page state at the failing assertion — read it before adjusting.

- [ ] **Step 3: Run the full E2E suite to confirm no regressions**

```bash
npm run test:e2e
```

Expected: every spec green.

- [ ] **Step 4: Run the unit suite once more**

```bash
npm test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/grouping.spec.js
git commit -m "test: e2e for dashboard grouping and builder optgroup"
```

---

## Final verification

After all seven tasks are complete:

- [ ] **Run everything once more from a clean state**

```bash
npm test && npm run test:e2e
```

Expected: every suite green.

- [ ] **Sanity-check the prod data shape**

If you have a copy of `data/signal.db` locally, run:

```bash
sqlite3 data/signal.db "SELECT id, name, version FROM templates;"
```

You should see two rows: the existing UUID-keyed "Agile Health Check" and the new `scrum-health-survey-v1`. The existing prod template is untouched — no rows were updated or deleted.

- [ ] **One-line PR-ready summary**

The branch should now have ~7 commits, each small and focused. Open a PR with a body that summarises: "Add file-based survey templates (`templates/*.json`), ship a Scrum Health Survey, and group baselines + follow-ups in the builder dropdown and on the dashboard. No prod-DB migration required — file-based templates are additive."
