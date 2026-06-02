# Signal Company-Scoping (identity-v2 Layer 4, Thread C) — Design

Date: 2026-06-02
Repo: signal (`/var/www/signal`, branch `feat/suite-auth` — see Open Questions)
Status: approved (design), pre-plan

## Goal

Make Signal multi-tenant by **company**. Today any authenticated, entitled Signal
facilitator sees **every** team, survey, and report across all companies
(`GET /api/teams` returns `db.listTeams(conn)` with no scoping). Thread C closes
that gap: scope all of Signal's facilitator data to the company on the user's
hub session, reusing the already-deployed `company {id,name}` contract on
`@suite/auth-client`.

This is the last deferred thread of identity-v2 Layer 4 (Thread A = RAID quota,
Thread B = Poker/Retro team-rooms, both shipped). App-only work in the signal
repo; no hub or auth-client change required.

## Background / current architecture

- Agile health-check survey app. SQLite, raw SQL, "Retrospective migration
  pattern": `ensureSchema()` runs `migrateToVN()` branches, `SCHEMA_VERSION` in
  the `meta` table. Currently `SCHEMA_VERSION = 1`.
- Data model (`lib/db.js`): `templates` -> `axes` -> `questions` (the shared
  question bank); `teams` (Signal's own, with `key_hash`/`key_salt`); `surveys`
  (`team_id NOT NULL REFERENCES teams`, `template_id`, `access_code`); `responses`
  -> `answers` (raw 1..5 scores, anonymous by design — no member identity).
- Auth is hub-delegated (`@suite/auth-client`, commit fceded0). `httpApp.js`
  mounts:
  - `/api/respond` -> `responseRoutes` (PUBLIC, anonymous respondents).
  - `/api` -> `adminApi` guarded by `auth.requireAuth`, then `surveyRoutes`
    (teams/surveys/templates CRUD) + `reportRoutes`.
  - Pages `/dashboard`, `/admin`, `/survey` (authed); `/s/:code` respondent page
    (public); `/health`, `/license` (public).
- `auth.requireAuth` (auth-client middleware) attaches the full
  `req.user = { id, entitled, teams, company }`. Signal currently only reads
  `req.user.id`; `req.user.company` (`{id,name}` or null) is available and unused.
- Respondent flow: public `/s/:code` page + `/api/respond` submit, keyed by the
  survey's `access_code`. Already an anonymous, company-agnostic path.

## Decisions (brainstorm 2026-06-02)

1. **Tenant model**: company owns Signal-local teams. Add `company_id` to Signal's
   `teams` table; Signal keeps managing its own teams. All facilitator views
   (teams/surveys/reports) scope to the session company. Teams stay first-class
   (health-check trends are per-team).
2. **Existing data**: clean-cut wipe. The migration drops and recreates the tenant
   tables (`teams`, `surveys`, `responses`, `answers`); the shared question bank
   (`templates`/`axes`/`questions`) is preserved. New teams get their `company_id`
   from the creating facilitator's session, so no company-id backfill is needed.
3. **Templates stay global/shared** — operator-managed, used by all companies. Not
   company-scoped (a company customizing its own questions is future work).

## Design

### Schema migration (v2, clean-cut)

Bump `SCHEMA_VERSION` to 2; add a `migrateToV2(db)` branch (run when stored
version < 2). It:

- Drops the tenant tables in FK-safe order: `answers`, `responses`, `surveys`,
  `teams`.
- Recreates them, with `teams` gaining `company_id TEXT NOT NULL` and an index
  `CREATE INDEX idx_teams_company ON teams(company_id)`. `surveys`/`responses`/
  `answers` are recreated with their existing shape (they reference `teams`/
  `surveys` and inherit the company transitively).
- Leaves `templates`/`axes`/`questions`/`users`/`auth_tokens`/`meta` untouched.

`seedQuestionBank` continues to run after `ensureSchema` (templates are global and
survive). Fresh installs run `migrateToV1` (original tables) then `migrateToV2`
(drop + recreate the tenant tables with `company_id`) and land in the same final
shape — the Retro v6->v7 pattern.

### Company contract wiring

- New `lib/companyAccess.js`: `teamCompanyAllowed(team, company)` returns
  `!!company && !!company.id && team && team.company_id === company.id`.
- `lib/db.js` gains company-scoped helpers: `listTeamsForCompany(conn, companyId)`,
  and `createTeam` takes/stores `company_id`. Survey/report queries scope through
  the team's `company_id` (join or post-fetch check).
- The auth-client adds the `company` column to Signal's session DB via its
  idempotent ALTER on the next restart (same as Poker/Retro saw).

### Authed admin surface — enforcement points (`surveyRoutes.js`, `reportRoutes.js`)

Every facilitator read/write scopes to `req.user.company`:

- `GET /api/teams` -> `listTeamsForCompany(conn, req.user.company.id)` (not
  `listTeams`).
- `POST /api/teams` -> set `company_id = req.user.company.id` on create.
- `GET /api/teams/:id`, `POST /api/teams/:id/rotate-key`, `DELETE /api/teams/:id`
  -> 404 unless `teamCompanyAllowed(team, req.user.company)`.
- Survey create -> the target team must satisfy `teamCompanyAllowed`, else 404/400.
- Survey list/detail/configure and **all report routes** -> only surveys whose
  team belongs to the session company; another company's survey/report returns 404.
- No-company session (`req.user.company` null — pre-Phase-A login or a company-less
  grant): return empty lists / 403 and let the UI prompt re-login. No crash.

### Anonymous respondent flow — unchanged

`/s/:code` + `/api/respond` stay public and company-agnostic. A valid `access_code`
submits an anonymous response; the response is tied to its survey -> team ->
company implicitly. No company check is added to the respondent path (by design;
respondents have no account).

## Edge cases

- Authed facilitator with no company -> sees nothing, prompted to re-login.
- Cross-company access (team/survey/report id from another company) -> 404, never
  a leak.
- Respondent submitting to a survey whose company they have no relationship with ->
  allowed (anonymous, possession of the access_code is the grant) — unchanged and
  intended.

## Testing

Unit (`node --test`):
- `teamCompanyAllowed` (match / mismatch / null company / null team).
- `migrateToV2`: a v1 DB with teams/surveys/responses is wiped and rebuilt with
  `teams.company_id`; templates/axes/questions survive; idempotent on a v2 DB.
- `createTeam` stamps `company_id`; `listTeamsForCompany` returns only that
  company's teams.

e2e (Playwright):
- Company A facilitator sees only A's teams/surveys/reports.
- A cannot read B's team / survey / report (404); creating a survey under B's team
  is rejected.
- The anonymous `/s/:code` respondent flow still submits a response end-to-end.

## Deploy

App-only (signal repo). Follow `reference-ionos-deploy` + the step-by-step command
conventions. Clean-cut migration wipes existing Signal teams/surveys/responses on
boot (decision 2); the shared question bank survives. Restart picks up the
auth-client `company` column. Smoke: a facilitator sees only their company's teams;
anonymous survey submit via `/s/:code` works; `/health` ok.

Rollback: tag the pre-feature commit; `git checkout <tag>` + restart (note the
wipe is not reversed by code rollback — acceptable per the wipe decision).

## Open questions (resolve before implementation/deploy)

1. **Release branch.** Signal is on `feat/suite-auth`, not `main`. Confirm whether
   `feat/suite-auth` is the de-facto release line (prod tracks it) and whether this
   work branches off it, before merging/deploying.
2. **Entitlement gate (out of scope, flagged).** Signal's admin API uses
   `requireAuth` but no `requireEntitled` like Retro/Poker. Entitlement is enforced
   hub-side today. Not changed by this work; possible separate follow-up.

## References

- Reuse pattern: Retro company-scoping spec/plan
  (`/var/www/retrospective/docs/superpowers/{specs,plans}/2026-06-02-retro-room-sharing*`),
  esp. the clean-cut migration, `companyAccess` helper, and company-scoped routes.
- Source vision/decisions: suite product vision (Signal/RAID = CR+CTM-only,
  account-gated) and the 2026-06-01 access-model brainstorm.
