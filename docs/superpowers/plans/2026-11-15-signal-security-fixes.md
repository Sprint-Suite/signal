# Signal Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three Signal-owned security Majors from the 2026-11-15 review: unenforced entitlement, unlimited anonymous submissions, and result differencing on live aggregates.

**Architecture:** An entitlement middleware gates the admin surface. Each survey gets N single-use invite links (hashed at rest) instead of one shared code; consuming an invite and storing the response happen in one transaction, with no link between them. Responses become visible to reports only in published batches of at least `MIN_RESPONSES`, and a batch is published only when a survey is closed.

**Tech Stack:** Node 20, Express 5, better-sqlite3, zod 4, `node --test`, Playwright.

**Spec:** `docs/debates/2026-11-15-code-review-and-security-audit-signal-security-aut.md` (agreed solution, findings 1, 4, 5). David chose per-respondent single-use links on 2026-11-15.

**Out of scope (separate plans):** open redirect, login CSRF and revocation propagation live in `/var/www/suite` (auth-client + hub) and get their own plan there. Code-quality and Scrum-template findings are separate plans. Security Minors (codes in logs, GET logout, `NODE_ENV` in systemd, unused team keys) are logged, not fixed here.

## Global Constraints

- Branch: `feat/suite-auth`. Do not touch `/var/www/suite`.
- `MIN_RESPONSES` stays `3` and stays defined once, in `lib/reportRoutes.js`; other modules import it.
- No table may link an invite to a response. `invites` carries no timestamp.
- Invite codes: `accessKeys.generateAccessKey()` (12 chars, ~71 bits); stored as `sha256(code)` hex only. Plaintext is returned exactly once, at creation.
- `inviteCount` on survey creation: integer 3–50, required. `count` when adding links: integer 1–50.
- `lib/db.js` must not grow: new persistence goes in new modules.
- Verify with `npm test` and `npm run test:e2e`. Both must pass before each commit.

## Review Focus

1. **Double-submit race on one invite** — two concurrent POSTs with the same code: exactly one 201, the other 409. Pinned in Task 3 (`submitWithInvite` uses a guarded `UPDATE … WHERE used = 0`).
2. **Reopen-and-refresh** — closed with 5 published, reopened, 1 more response, closed again: report still shows the 5-response snapshot, not 6. Pinned in Task 4.
3. **Baseline overlay on an open parent** — follow-up report must use only the parent's *published* responses. Pinned in Task 4.
4. **First close below the floor** — closing with 2 responses publishes nothing; a later reopen + 1 + close publishes all 3. Pinned in Task 4.
5. **Rolled-back deploy** — older code opening a newer DB must refuse to start and must not rewrite `schema_version`. Pinned in Task 2.

---

### Task 1: Enforce Signal entitlement

**Files:**
- Create: `lib/entitlement.js`
- Modify: `lib/httpApp.js` (adminApi mount, the three guarded pages)
- Modify: `tests/server.test.js` (`loginAsAdmin` helper), `tests/e2e/seed.js:51`
- Test: `tests/entitlement.test.js`

**Interfaces:**
- Produces: `makeRequireEntitled({ hubBaseUrl: string }) => (req, res, next)`. For `req.originalUrl` starting `/api/`: `403 {"error":"Signal is not enabled for your account. Ask your company admin to turn it on."}`. Otherwise `302` to `${hubBaseUrl}/dashboard`. Mirrors `scrumpoker/lib/httpApp.js:86-89`.

- [ ] **Step 1: Write failing tests** in `tests/entitlement.test.js`, using the `startApp`/`api` helpers pattern from `tests/server.test.js`, with a session created with `entitled: false`:
  - `unentitled session gets 403 on GET /api/surveys` — asserts status 403 and the exact error string.
  - `unentitled session is redirected from /dashboard to the hub dashboard` — asserts 302 and `location` ends with `/dashboard` on the hub base URL.
  - `entitled session still reaches GET /api/surveys` — asserts 200.
- [ ] **Step 2:** Run `node --test tests/entitlement.test.js`. Expected: the two unentitled tests FAIL (200 / page served).
- [ ] **Step 3:** Implement `makeRequireEntitled` and mount it immediately after `auth.requireAuth` on `adminApi` and on `/dashboard`, `/admin`, `/survey`. Pass `auth._ctx.hubBaseUrl`.
- [ ] **Step 4:** Set `entitled: true` in `loginAsAdmin` (`tests/server.test.js`) and in the e2e seed session (`tests/e2e/seed.js`).
- [ ] **Step 5:** Run `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** — `fix(signal): require Signal entitlement on admin API and pages`

### Task 2: Harden migrations and add schema v3

**Files:**
- Create: `lib/schemaV3.js`
- Modify: `lib/db.js:21` (`SCHEMA_VERSION = 3`), `lib/db.js:76-90` (`ensureSchema`)
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `migrateToV3(db)` creating:
  ```sql
  CREATE TABLE invites (
    id         TEXT PRIMARY KEY,
    survey_id  TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL UNIQUE,
    used       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_invites_survey ON invites(survey_id);
  ALTER TABLE responses ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
  UPDATE responses SET published = 1
    WHERE survey_id IN (
      SELECT s.id FROM surveys s
      WHERE s.status = 'closed'
        AND (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) >= 3
    );
  ```
- Produces: `ensureSchema(db)` throws `Error("Database schema version <n> is newer than this build supports (3).")` when the stored version is above `SCHEMA_VERSION`, before writing anything. Otherwise runs all pending migrations **and** `setSchemaVersion` inside one `db.transaction`.
- The guard protects builds that contain it; the current v2 `ensureSchema` still rewrites a newer version. **This plan must land before `feat/suite-auth` reaches production**, so no guard-less v2 build is ever deployed. After v3 has run anywhere, rolling back to a pre-v3 build of this branch is prohibited.
- `surveys.access_code` stays (NOT NULL UNIQUE) but is no longer routed; `createSurvey` keeps filling it with `generateAccessKey()`. Dropping it belongs to the code-quality plan's baseline-schema fold.

- [ ] **Step 1: Write failing tests** in `tests/db.test.js`:
  - `ensureSchema refuses a newer database without modifying it` — in-memory DB, set `schema_version` to `4`; `assert.throws(() => db.ensureSchema(conn), /newer than this build supports/)`; then `getSchemaVersion(conn) === 4`.
  - `a failing migration rolls back completely` — build a v1 DB as the existing v1-migration test does, then replace table `teams` with `CREATE VIEW teams AS SELECT 1 AS id`. `ensureSchema` throws (v2's `DROP TABLE IF EXISTS teams` fails on a view, after it has dropped `surveys`); assert table `surveys` still exists and `getSchemaVersion(conn) === 1`.
  - `v3 adds invites and responses.published` — fresh DB: `invites` exists; `PRAGMA table_info(responses)` contains `published`; version is 3.
  - `v3 backfill publishes only closed surveys at the floor` — a v2 DB with closed surveys holding 1, 2 and 3 responses and an open survey holding 3: after migration only the closed 3-response survey has published rows.
- [ ] **Step 2:** Run `node --test tests/db.test.js`. Expected: the three new tests FAIL.
- [ ] **Step 3:** Implement `lib/schemaV3.js` and the `ensureSchema` changes.
- [ ] **Step 4:** Run `npm test`. Expected: all pass (update any test that asserts `schema_version === 2`).
- [ ] **Step 5: Commit** — `fix(signal): atomic migrations, refuse newer schemas, add v3 invites`

### Task 3: Single-use invite links

**Files:**
- Create: `lib/invites.js`
- Modify: `schemas/survey.js` (add `inviteCount`, new `inviteBatchSchema`), `lib/surveyRoutes.js` (`POST /surveys`, new `POST /surveys/:id/invites`, `surveySummary`), `lib/responseRoutes.js`, `lib/reportRoutes.js:37` (drop `accessCode` from `surveyInfo`)
- Modify UI: `public/survey.html`, `public/js/survey.js`, `public/respond.html`, `public/js/respond.js`
- Modify tests: every `survey.accessCode` use in `tests/server.test.js`, `tests/zod-schemas.test.js`, `tests/e2e/*.spec.js` → an invite code from the creation response
- Test: `tests/invites.test.js`

**Interfaces:**
- Consumes: `migrateToV3` tables (Task 2); `accessKeys.generateAccessKey()`; `db.submitResponse(conn, payload)`.
- Produces (`lib/invites.js`):
  - `createInvites(conn, surveyId: string, count: number) => string[]` — plaintext codes.
  - `findInvite(conn, code: string) => { id, surveyId, used: boolean } | null`
  - `submitWithInvite(conn, inviteId: string, payload) => "ok" | "used"` — one `conn.transaction`: `UPDATE invites SET used = 1 WHERE id = ? AND used = 0`; if `changes === 0` return `"used"`; else `db.submitResponse(conn, payload)`.
  - `countInvites(conn, surveyId) => { total: number, used: number }`
- API changes:
  - `POST /api/surveys` requires `inviteCount` (3–50), for baselines and follow-ups alike; 201 body adds `inviteLinks: string[]` (`${appBaseUrl}/s/${code}`). Replace the inline `safeParse` fallback at `lib/surveyRoutes.js:193-197` with `validate(surveySchema)` so invalid input fails closed with 400; keep the route's own domain 400s (team/template/baseline not found) after it.
  - `POST /api/surveys/:id/invites` `{count}` (1–50), company-scoped like the other `:id` routes; `409 {"error":"This survey is closed."}` when not open; `201 {inviteLinks}`.
  - `surveySummary` drops `accessCode` and `link`; adds `invitesTotal`, `invitesUsed`.
  - `GET /api/respond/:code`: unknown code → 404; used invite → `200 {open:false, used:true, team}`; otherwise as today.
  - `POST /api/respond/:code`: unknown → 404; closed → 409 (existing copy); `"used"` → `409 {"error":"This link has already been used."}`.

- [ ] **Step 1: Write failing tests** in `tests/invites.test.js`:
  - `createInvites stores only hashes` — returns 5 distinct 12-char codes; `SELECT code_hash FROM invites` contains none of them in plaintext.
  - `an invite accepts exactly one submission` — POST twice with the same code: 201 then 409 with the exact string.
  - `concurrent submissions on one invite yield one 201` — `Promise.all` of two POSTs: statuses sorted equal `[201, 409]`; `countResponses === 1`.
  - `used invite GET reports used` — after submit, GET returns `{open:false, used:true}`.
  - `survey creation requires inviteCount 3..50` — missing, `2`, `51`, `3.5`, `-3` and `"5"` → 400, on both a baseline and a follow-up (`parentSurveyId`) request; `3` → 201 with `inviteLinks.length === 3`.
  - `a failed answer insert leaves the invite unused` — call `submitWithInvite` with an answer whose `questionId` violates the `answers.question_id` foreign key: it throws; `findInvite(code).used === false`; `countResponses === 0`.
  - `adding invites is company-scoped and open-only` — other company → 404; closed survey → 409.
  - `nothing links an invite to a response` — `PRAGMA table_info(responses)` has no column naming an invite; `PRAGMA table_info(invites)` has exactly `id, survey_id, code_hash, used`.
- [ ] **Step 2:** Run `node --test tests/invites.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `lib/invites.js`, schema changes, and the route changes.
- [ ] **Step 4:** Update existing tests to obtain codes from `inviteLinks` (last path segment); give each survey an `inviteCount` large enough for the submissions it makes.
- [ ] **Step 5:** UI — survey builder: number input "How many people will answer?" (3–50, required); after creation, list every link with one "Copy all links" button and the note: *"Give each person one link. Each link works once. These links are shown only now — copy them before leaving this page."* Survey detail: replace the share link with "`<used>` of `<total>` links used" and an "Add links" control calling `POST /surveys/:id/invites`, showing new links the same way. Respondent page: on `used:true` show *"This link has already been used. Each link can be used once."*; add the footer line *"Signal stores no name or email with your answers, and stores no record of which link they came from. Whoever sent you this link can see that it has been used, but not what you answered. Results are shown only for groups of at least 3 people."*
- [ ] **Step 6:** Run `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 7: Commit** — `feat(signal): single-use invite links per respondent`

### Task 4: Publish results only in closed batches of at least MIN_RESPONSES

**Files:**
- Create: `lib/publication.js`
- Modify: `lib/surveyRoutes.js` (close transition, `surveySummary`), `lib/db.js` (`getScoringInputForSurvey`, `getAnswersWithQuestionForSurvey`, `countFlaggedResponses` and the two list queries' `flagged_count`: add `published = 1`), `lib/reportRoutes.js` (report, breakdown, CSV, baseline), `public/js/dashboard.js`, `public/js/survey.js` (locked messages)
- Modify tests: report tests in `tests/server.test.js` close the survey before reading results
- Test: `tests/publication.test.js`

**Interfaces:**
- Consumes: `responses.published` (Task 2); `MIN_RESPONSES` exported from `lib/reportRoutes.js`.
- Produces (`lib/publication.js`):
  - `publishPending(conn, surveyId, min: number) => number` — in one transaction, counts `published = 0` responses; if `>= min`, sets them all to 1 and returns the count, else returns 0.
  - `countPublished(conn, surveyId) => number`; `countPending(conn, surveyId) => number`.
- Close transition calls `publishPending(conn, id, MIN_RESPONSES)` after `closeSurvey`.
- Report, breakdown and CSV use `countPublished` instead of `countResponses`. When it is below `MIN_RESPONSES` (defensive: publication already guarantees 0 or ≥ 3) they return the existing locked shape plus `reason`: `"not-closed"` if the survey is open, else `"below-minimum"`; CSV returns 409 as today. Unlocked bodies add `pendingCount`. `responseCount` in unlocked bodies is the published count.
- Baseline overlay uses `countPublished(parent)` for its floor check and `baseline.responseCount`.
- Flagged counts are derived from answers, so they are results too: `countFlaggedResponses` and the `flagged_count` subqueries in `listSurveysWithCountsForCompany` / `listSurveysWithCounts` filter `published = 1`, and every API body returns `flaggedCount: null` while `countPublished < MIN_RESPONSES`. Survey list/detail keep a live `responseCount` (participation, not results) and add `publishedCount`.
- Dashboard copy: `not-closed` → *"Results appear when you close the survey."*; `below-minimum` → *"Results need at least 3 responses. Reopen the survey to collect more."*; `pendingCount > 0` → *"`<n>` newer responses will be included once the survey closes with at least 3 of them."*

- [ ] **Step 1: Write failing tests** in `tests/publication.test.js`:
  - `open survey with 4 responses is locked as not-closed`.
  - `closing with 2 responses publishes nothing; reopen + 1 + close publishes 3` — reason `below-minimum` after first close; unlocked with `responseCount === 3` after second.
  - `reopen-and-refresh does not reveal the next respondent` — close with 3 (published), reopen, submit one 5-score response, close: report and breakdown means equal the 3-response values; `pendingCount === 1`.
  - `baseline overlay ignores unpublished parent responses` — parent open with 4 responses → follow-up report `hasBaseline === false`.
  - `CSV uses published responses only` — same scenario as reopen-and-refresh; CSV `Responses` column is 3.
  - `a pending flagged response changes no visible flag count` — after the reopen-and-refresh setup, submit one straight-lined response: `flaggedCount` on report, survey list and survey detail is unchanged.
  - `pending responses accumulate across closes` — close with 3 (published), then three cycles of reopen + 1 + close: published stays 3 after the first two, becomes 6 after the third.
  - `publication survives restart` — after a close publishes, open a new connection on the same DB file: report unchanged.
  - `reopened baseline with published and pending responses` — parent closed with 3, reopened with 1 pending: follow-up's baseline `responseCount === 3`.
- [ ] **Step 2:** Run `node --test tests/publication.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `lib/publication.js`, the query filters, and the route changes.
- [ ] **Step 4:** Update existing report tests to close before reading; update the dashboard/survey locked copy.
- [ ] **Step 5:** Run `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** — `fix(signal): publish results only from closed batches of at least 3`
