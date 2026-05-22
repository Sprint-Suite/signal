# Technical Stack Overview — Signal (Agile Health Check)

> **Purpose:** Reference document for Signal, the third app in the internal
> agile suite. Describes its technology, structure, data model, security
> posture, and deployment so the build stays consistent with the established
> house patterns (and reuses what already works in Scrum Poker and
> Retrospective).
>
> **As of:** 2026-05-22. Status: **specified, pre-build.** Lives on the same
> host under `/var/www/signal`. Companion to the full build spec in
> `docs/signal-spec.md`.

---

## 1. Executive Summary

Signal is a self-contained agile health check survey app. A team admin (Scrum
Master / Delivery Manager) creates a survey from a question template, shares an
**anonymous link** with the team, and reviews the aggregated results as a radar
chart with curated improvement insights. Surveys can be re-run later and
compared against a baseline to show change over time.

| | **Signal** |
|---|---|
| Purpose | Team agile health check surveys + radar reporting + insights |
| Path | `/var/www/signal` |
| Port | **3002** (3000 and 3001 are taken by Poker and Retro) |
| Domain | TBD (placeholder `signal.example.com`) |
| Runtime | Node.js + Express 5 |
| Real-time | **None** — no `ws`; surveys are async request/response |
| Persistence | **SQLite** (`better-sqlite3`), schema-versioned + migrate-on-boot |
| Admin auth | **Email + password accounts** (argon2id, lockout, full lifecycle) |
| Respondent auth | **None** — anonymous access-code links, never identified |
| Frontend | Vanilla HTML/CSS/JS, no build step |
| Code shape | Modular (`lib/` + thin `server.js`) — Scrum Poker's layout |
| CI | GitHub Actions (copied from Scrum Poker) |

Signal keeps the suite's deliberate philosophy: **minimal dependencies, no
front-end framework, no build/transpile step, no client-side bundler.** All
browser code is plain ES served as static files under a strict
Content-Security-Policy that forbids inline scripts and `eval`. It sits behind
Nginx (TLS termination) and runs as a `systemd` service.

Signal is an **independent codebase** — no shared package with the other two
apps — but it deliberately adopts their converged patterns (security headers,
rate limiting, salted-SHA-256 access-key hashing, health endpoint, Admin role,
audit log). The reusable modules are **copied in**, not extracted into a shared
package; extraction remains a future option once a third real consumer (this
app) proves the pattern.

Signal differs from the other two in three deliberate ways: it has **no
WebSocket layer** (nothing is live-shared), it uses **real account-based auth**
rather than casual access keys for admins, and it **hand-draws its radar chart
in SVG** rather than taking a charting dependency.

---

## 2. Runtime & Dependencies

- **Node.js** (target the suite baseline; CI on Node 24, host on v20.x).
- **Production dependencies** (`package.json`):
  - `express` `^5.x` — HTTP server, static files, JSON body parsing.
  - `better-sqlite3` — synchronous SQLite driver, durable store.
  - `argon2` — password hashing (argon2id) for admin accounts.
- **No `ws`** — Signal is request/response only.
- **No ORM, no front-end framework, no bundler.**
- **Dev dependencies:** `@playwright/test` (e2e), `node --test` (unit).
- Manifest package name should be `signal` (avoid the generic names that the
  other apps carried).

The only dependency Signal adds beyond the suite norm is `argon2`. This is a
conscious exception to the minimal-dependency rule: human-chosen passwords need
a slow, memory-hard hash, and argon2id is the gold standard. The suite's
salted-SHA-256 is retained for high-entropy *access keys* only (see Section 5).

---

## 3. Process & Module Layout

`server.js` is a thin composition root (~60 lines). Real logic lives in `lib/`,
following Scrum Poker's modular layout (the house template). Modules split
cleanly into **new** (survey-specific) and **copied** (proven plumbing).

### New modules

| Module | Responsibility |
|---|---|
| `lib/httpApp.js` | Builds the Express app: security headers, no-cache headers, static serving, route mounting, `/health`. |
| `lib/db.js` | SQLite: schema, migrations (version in `meta`, run on boot), CRUD. Raw SQL. |
| `lib/scoring.js` | Axis averages, reverse-score inversion, spread (std-dev) for the "divided" flag. Pure functions. |
| `lib/quality.js` | Response quality checks: straight-lining, speed, reverse-item inconsistency. Sets `flagged_quality`. |
| `lib/insights.js` | Rules engine (score/trend/spread → scenario) + curated tip library. Single `getInsights()` seam for a future AI enricher. |
| `lib/auth.js` | Admin auth: register/login/verify/reset logic, argon2id hashing, lockout. |
| `lib/mailer.js` | Email transport seam. Logs links in v1; swap to real SMTP/API later, this file only. |
| `lib/surveyRoutes.js` | Admin REST: create/list/configure surveys. |
| `lib/responseRoutes.js` | Public: submit answers via access code (anonymous). |
| `lib/reportRoutes.js` | Aggregates: radar data, per-question breakdown, flags. |

### Copied modules (from Scrum Poker / Retrospective)

| Module | Responsibility |
|---|---|
| `lib/securityHeaders.js` | Strict CSP, HSTS, COOP/COEP/CORP (Scrum Poker's fuller set). |
| `lib/accessKeys.js` | Team access keys: salted SHA-256, `weak` flag, rotation, timing-safe verify. **Not used for passwords.** |
| `lib/loginRateLimiter.js` | In-memory sliding-window login throttle (layered under per-account lockout). |
| `lib/session.js` | Signed, httpOnly, SameSite cookie sessions; holds `userId` only. |
| `lib/roles.js` | Role predicates (admin / respondent). |
| `lib/adminActivity.js` | Append-only JSONL admin audit log with key/account fingerprints. |
| `lib/buildInfo.js` | Version (`package.json`) + git commit (`git rev-parse HEAD`) for `/health`. |
| `manageKeys.js` | CLI: manage team access keys **and** seed/reset admin accounts. |

Each `lib/` module has a matching `tests/*.test.js`, keeping the unit-test
surface clean — the same discipline as Scrum Poker (and the gap Retrospective
is noted for).

---

## 4. Data Model & State

**Durable, in SQLite** (`data/signal.db`). Unlike Scrum Poker (in-memory) and
like Retrospective, Signal's state fully survives a restart — appropriate for a
tool that holds survey history compared over months. No in-memory mirror is
needed because there is no live-shared state.

Schema version is tracked in a `meta(key, value)` row; `ensureSchema()` runs
migrations on boot. `PRAGMA foreign_keys = ON`; cascade deletes mirror Retro.

**Tables**

- `users` — admin accounts: `email`, argon2id `password_hash`, `email_verified`,
  `is_active`, `failed_attempts`, `locked_until`, timestamps.
- `auth_tokens` — single-use, expiring `verify` / `reset` tokens; stores a
  **hash** of the token, never the raw value.
- `teams` — `name`, salted-SHA-256 access key (`key_hash`, `key_salt`, `weak`).
- `templates` — versioned question sets (`version`, `is_active`).
- `axes` — health-check dimensions, ordered, belonging to a template.
- `questions` — text, `axis_id`, `is_reverse_scored`, order.
- `surveys` — a run for a team: `template_id`, `parent_survey_id`
  (NULL = baseline), `access_code` (the anonymous link), `status`, timestamps.
- `responses` — one per submission: `duration_seconds`, `flagged_quality`,
  `submitted_at`. **Deliberately carries no member/email/name** — anonymity is
  enforced at the schema level.
- `answers` — `response_id`, `question_id`, raw `score` (1–5). Reverse items are
  inverted at read time in `scoring.js`, never stored inverted.

**Key data principles**

- **Anonymity by design** — there is no path from an answer back to a person,
  because the link is not stored. This protects honest responses, especially on
  psychological safety.
- **Survey as data, not code** — axes, questions, and the reverse flag live in
  the DB; adding an axis or question needs no scoring change.
- **Store raw, compute on read** — every derived value (means, spread, divided
  flags, insights) is recomputed from immutable raw answers, so a formula or
  threshold fix never requires a data migration.

---

## 5. Security Posture

- **Strict CSP** (copied, Scrum Poker's fuller set): no inline scripts, no
  `eval`, external static assets only. This is *why* the radar is hand-drawn
  SVG in an external file rather than a CDN charting library.
- **Admin auth — the deliberate divergence from the suite.** Real accounts with
  **argon2id** password hashing (memory-hard, salt embedded in the hash). This
  is intentionally **not** the salted SHA-256 used for access keys: SHA-256 is
  fast and unsuitable for human-chosen passwords. The two mechanisms coexist by
  design — SHA-256 for high-entropy team *access keys*, argon2id for *passwords*.
- **Account lifecycle** — invite/seed only (first admin via CLI; no public
  registration). Email verification and password reset are built as single-use,
  expiring, hashed tokens. Email **delivery** is deferred (v1 logs the link via
  `mailer.js`); the logic is complete and the transport is a one-file swap.
- **Brute-force defense** — per-account lockout (threshold + cooldown) layered
  on top of the in-memory per-IP sliding-window rate limiter. Generic
  "invalid email or password" responses prevent account enumeration.
- **Sessions** — signed, httpOnly, Secure, SameSite=Lax cookie holding `userId`
  only. Admin routes require a valid session **and** a verified email.
- **Respondents** — no auth, no identity, no cookies of consequence. Access is
  the survey's `access_code` only.
- **Audit** — admin actions (survey create/close/delete, account invites) append
  to an `admin-activity.jsonl` log with fingerprints, never raw secrets.
- **Edge** — Nginx terminates TLS and applies edge headers; the app should bind
  `127.0.0.1` in production with only 80/443 exposed.

---

## 6. Deployment Topology

```
                 Internet (443/TLS)
                        │
                   ┌────▼────┐
                   │  Nginx  │  TLS termination, edge security headers
                   │ (proxy) │  (no WebSocket upgrade needed for Signal)
                   └────┬────┘
                        │
              ┌─────────▼─────────┐
              │  Signal           │
              │  systemd svc      │
              │  node :3002       │
              │  SQLite signal.db │
              │  .env config      │
              └───────────────────┘
```

- Single Node process (no clustering, no worker threads, no `ws` fan-out).
- Binds `0.0.0.0` in dev fronted by Nginx; production guidance is bind
  `127.0.0.1` and expose only 80/443 via firewall.
- No container / orchestration layer — a bare `systemd` unit (`signal`),
  alongside `scrumpoker` (:3000) and `retrospective` (:3001) on the dev host.
- **Port discipline:** 3002 is mandatory. 3000/3001 are taken; reuse causes
  `EADDRINUSE`. The port is env-configurable (`PORT`, default 3002) so local
  testing reaches `http://localhost:3002`.
- **First-run note:** there is no public registration, so the first admin must
  be seeded via `node manageKeys.js create-admin` before login is possible.

---

## 7. Scaling Constraints

Like the other two apps, Signal assumes **one process**. But its constraints are
milder:

- No live-shared state and no WebSocket fan-out, so the multi-instance ceiling
  that limits Poker and Retro mostly does not apply to request handling.
- SQLite is single-writer; fine at the intended scale (well under 100 teams) but
  the first thing to revisit if write concurrency ever became significant
  (move to Postgres, or a connection-serialized write path).
- The login rate limiter is in-memory and per-process — it resets on restart and
  does not coordinate across instances (same caveat as the other apps). Per
  account lockout *is* durable (stored on `users`), so targeted-account
  protection survives a restart even though IP throttling does not.

This is comfortable for the intended small-team scale and is not a near-term
concern.

---

## 8. Known Gaps / Deferred (by design)

**Deferred to v1.1**
- **Email transport.** Reset/verification logic is complete; actual delivery is
  stubbed to a log via `mailer.js`. Swap in SMTP or an API (Resend/Postmark/SES)
  when provisioned.
- **PDF export.** CSV export is in v1; PDF (heavier dependency, low learning
  value) is deferred.

**Deferred to v2**
- **AI insight enrichment.** The rules engine is the v1 baseline; an LLM
  enricher can slot in behind the existing `getInsights()` interface without
  touching callers. Kept out of v1 for privacy (survey sentiment is sensitive)
  and stack-simplicity reasons.

**Open during build**
- **Respondent form layout** — specced as one-question-per-screen (best for
  honesty / anti straight-lining). Per-axis grouping is the lower-click
  alternative; decide with real testing.
- **Divided threshold** — the std-dev cut-off (default 1.2 on a 1–5 scale) for
  the "divided" flag is a starting value to calibrate once real data exists.
- **Design tokens** — `tokens.css` ships neutral defaults; replace with Poker's
  and Retro's real accent/font/radii if true cross-app visual consistency is
  wanted.

**Consciously out of scope**
- WebSockets, an `organizations` layer, a `members` table, and any cross-app
  integration. The schema leaves clean insertion points for the first three
  without disturbing the anonymous response flow.

---

## 9. Relationship to the Suite

Signal is the third independent app, not a coupled module. It shares **patterns**
with Scrum Poker and Retrospective, not **code at runtime**:

- Adopts Scrum Poker's modular `lib/` layout (the house template) over
  Retrospective's monolith.
- Adopts Retrospective's SQLite schema-version + migrate-on-boot approach (the
  better template for durable state).
- Standardizes on **Express 5** (Scrum Poker is already there; Retro lags at 4).
- Ships with **CI from day one** (Scrum Poker's GitHub Actions workflow),
  avoiding Retrospective's noted CI gap.
- Copies the proven plumbing (Section 3) rather than extracting a shared package.
  Now that three apps demonstrably share these modules, extracting an
  `@internal/web-kit` becomes a sensible **future** consolidation (the
  rule-of-three is now met), but it is not a v1 task.

The one place Signal intentionally leads rather than follows the suite is
**authentication**: it replaces casual access-key login with real, robust
account-based auth. If the suite later standardizes auth, Signal's argon2id +
lockout + lifecycle model is the candidate to lift.

---

*Generated 2026-05-22 from the Signal build specification (`docs/signal-spec.md`).
Cross-check against that spec for full schema, scoring, question bank, and
insights detail, and against the suite-wide
`Technical Stack Overview — Scrum Poker & Retrospective` for shared patterns.*

