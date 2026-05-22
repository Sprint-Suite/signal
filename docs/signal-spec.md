# Signal — Agile Health Check App

**Build specification (v1)**
Status: ready to build
Stack: Node.js + Express 5, SQLite, vanilla frontend (no build step)

---

## 1. Overview

Signal is an Agile health check survey app. A team admin (Scrum Master / Delivery Manager) creates a survey, shares an anonymous link with the team, and reviews the results as a radar chart with curated improvement insights. Surveys can be re-run later and compared against a baseline to show change over time.

Signal is the third app in an internal suite alongside Scrum Poker and a Retrospective app, but the three apps are **independent**: no shared services, no shared assets, no cross-app runtime dependencies. Signal matches the established house stack and conventions but stands alone.

### Core user journeys

- **Admin:** pick a template, select a team, generate an anonymous access link, share it, monitor the response count, close the survey, view the report.
- **Respondent:** open the link (no login), answer one question per screen on a 1-5 scale, submit. Quality checks run invisibly on submit.
- **Follow-up:** after a chosen interval, create a follow-up survey linked to a baseline. The report overlays both runs on the radar.

### Design principles (carried through the whole spec)

- **Anonymity by design.** Responses carry no identity. There is deliberately no member/email/name column. The mandate to complete the survey is enforced socially by the admin, never technically by login. This protects honest answers, especially on psychological safety.
- **Survey as data, not code.** Axes, questions, and the reverse-scored flag live in the database, not in hardcoded logic. Adding an axis or question requires no scoring changes.
- **Store raw, compute on read.** Raw answers (1-5) are immutable. Every derived value (axis means, spread, divided flags, insights) is recomputed from raw data, so a formula or threshold fix never requires data migration.
- **Reuse proven plumbing.** Most non-feature modules are copied from the existing apps. New code is limited to survey logic and the auth layer.
- **Robust admin auth.** Unlike the existing apps' casual access keys, Signal uses real email + password accounts (argon2id, lockout, full reset/verification lifecycle). This is admin-only; respondents are never identified. See section 7.

---

## 2. Tech Stack (matches the house style)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js + Express 5 | Matches Scrum Poker. Standardise on Express 5. |
| Real-time | **None** | No WebSockets. Surveys are async, request/response only. Signal is the simplest of the three apps. |
| Persistence | SQLite via `better-sqlite3` | Schema version tracked in a `meta` table, migrations run on boot (the Retro pattern). |
| Frontend | Vanilla HTML / CSS / JS | No framework, no build step. External script files only (strict CSP forbids inline scripts and CDNs). |
| Radar chart | Hand-drawn SVG in vanilla JS | Zero dependencies. Lives in `public/js/radar.js`. CSP-clean. |
| Admin auth | **Email + password accounts** | Robust login. argon2id hashing, server-side sessions, lockout, rate limiting. Admin-only. See section 7. |
| Password hashing | **argon2id** (`argon2` package) | Gold standard, memory-hard. Deliberately NOT the salted SHA-256 used for access keys (see 7.1). |
| Account creation | Invite / seed only | First admin seeded via CLI. No public self-registration. |
| Respondent access | Anonymous link (access code) | No auth at all. Respondents are never identified. |
| Ops | systemd service behind Nginx | New port (see Setup). `/health` endpoint. |
| CI | GitHub Actions | Copy Scrum Poker's workflow. (Retro lacking CI is known tech debt; do not repeat it.) |

### Decisions explicitly settled (do not revisit without reason)

- No WebSockets.
- Radar is hand-drawn SVG, not a charting library.
- Reusable modules are **copied** into Signal (independence preserved), not extracted into a shared package. Extraction is a possible future move once a third real consumer proves the pattern.
- 5-point agree/disagree scale with a neutral midpoint (not a forced-choice 4-point scale).
- Rules-based insights for v1. AI enrichment is a possible v2, kept behind a single `getInsights()` interface so it is a swap, not a rewrite.
- CSV export is in scope for v1. **PDF export is deferred to v1.1.**

---

## 3. Setup

### 3.1 Directory and permissions

The app lives at `/var/www/signal` on the WSL/Linux host.

```bash
# Create the directory
sudo mkdir -p /var/www/signal

# Ownership: davidj as owner, www-data as group
sudo chown -R davidj:www-data /var/www/signal

# Permissions: owner rwx, group rwx, setgid so new files inherit www-data
sudo chmod -R 2775 /var/www/signal

# Verify (the 's' in place of group 'x' confirms setgid)
ls -la /var/www | grep signal
# drwxrwsr-x  davidj www-data ... signal
```

The leading `2` (setgid) is important: without it, every `npm install`, build, or git pull creates files owned by `davidj:davidj` and the web server (running as `www-data`) loses group access. With setgid, new files inherit the `www-data` group automatically.

### 3.2 Port — NEW PORT REQUIRED

**Signal needs its own port. The existing apps already use:**

- Scrum Poker: **3000**
- Retro: **3001**

**Signal must use a new, unused port. Use `3002`.**

This applies to local testing too. When running the app on localhost during development, it will be reachable at:

```
http://localhost:3002
```

Do not reuse 3000 or 3001, both are taken by the other apps and a collision will cause the server to fail to bind (`EADDRINUSE`). The port should be configurable via an environment variable (e.g. `PORT=3002`) with `3002` as the default, so local testing and production can differ if needed.

### 3.3 Environment

Create `.env` (gitignored) from `.env.example` (committed). Expected variables:

```
PORT=3002
SESSION_SECRET=<random-32-byte-hex>      # session cookie signing (openssl rand -hex 32)
DB_PATH=./data/signal.db
NODE_ENV=development
APP_BASE_URL=http://localhost:3002       # used to build verify/reset links
MAIL_TRANSPORT=log                        # 'log' in v1 (deferred); 'smtp'/'api' later
LOCKOUT_THRESHOLD=5                        # failed logins before lockout
LOCKOUT_MINUTES=15
```

### 3.4 Run targets

- Local dev: `npm run dev` → starts on `http://localhost:3002`.
- Production: systemd service (`deploy/systemd/signal.service`) behind Nginx (`deploy/nginx/signal.conf`).
- Health check: `GET /health` returns version + git commit + status.

---

## 4. Directory Structure

Mirrors Scrum Poker's modular `lib/` layout (the house template). The split between **new** and **copied** modules is intentional and visible.

```
/var/www/signal
├── server.js                     # Thin composition root (~60 lines)
├── manageKeys.js                 # CLI: team access keys + seed/reset admin accounts
├── package.json                  # express ^5, better-sqlite3, argon2. NO ws.
├── .env                          # config (gitignored)
├── .env.example                  # committed template
│
├── lib/
│   │  # ---- Survey-specific (NEW code) ----
│   ├── httpApp.js                # Express app: routes, headers, /health, static
│   ├── surveyRoutes.js           # Admin REST: create/list/configure surveys
│   ├── responseRoutes.js         # Public: submit answers via access code
│   ├── reportRoutes.js           # Aggregates: radar data, breakdown, flags
│   ├── scoring.js                # Axis averages, reverse-score inversion, spread
│   ├── quality.js                # Straight-lining + reverse-item checks
│   ├── insights.js               # Rules engine + curated tip library
│   ├── auth.js                   # NEW: register/login/verify/reset logic, argon2
│   ├── db.js                     # SQLite: schema, migrations, CRUD (raw SQL)
│   │
│   │  # ---- Copied from existing apps ----
│   ├── securityHeaders.js        # strict CSP, HSTS, COOP/COEP
│   ├── accessKeys.js             # salted SHA-256 team keys (NOT for passwords)
│   ├── loginRateLimiter.js       # sliding-window login throttle + lockout
│   ├── session.js                # server-side session cookies
│   ├── roles.js                  # role predicates (admin / respondent)
│   ├── adminActivity.js          # append-only JSONL audit log
│   ├── buildInfo.js              # version + git commit for /health
│   └── mailer.js                 # NEW: email transport seam (logs in v1, real later)
│
├── scripts/
│   └── db-maintenance.js         # migrate / retention / vacuum
│
├── public/                       # Vanilla frontend, no build step
│   ├── index.html                # Admin login
│   ├── dashboard.html / .js      # Survey list + create
│   ├── survey.html / .js         # Builder + report views
│   ├── respond.html / .js        # Public respondent form (no auth)
│   ├── admin.html / .js          # Team key management
│   ├── license.html
│   ├── js/
│   │   └── radar.js              # Hand-drawn SVG radar
│   └── css/
│       ├── app.css
│       └── tokens.css            # design tokens (section 9)
│
├── tests/
│   ├── scoring.test.js           # node --test
│   ├── quality.test.js
│   ├── insights.test.js
│   ├── db.test.js
│   └── e2e/                      # Playwright: smoke, full survey run
│
├── deploy/
│   ├── systemd/signal.service
│   └── nginx/signal.conf
│
├── docs/
│   ├── techstack-overview.md
│   └── deployment.md
│
└── .github/workflows/ci.yml      # copy from Scrum Poker
```

---

## 5. Data Model (SQLite, raw SQL, migrate-on-boot)

Schema version tracked in `meta(key, value)` e.g. `('schema_version','1')`. `ensureSchema()` runs migrations on boot. `PRAGMA foreign_keys = ON`.

```sql
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT NOT NULL,             -- argon2id hash (includes salt + params)
  email_verified    INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1, -- allow disabling without deleting
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,                       -- ISO timestamp; NULL = not locked
  created_at        TEXT NOT NULL,
  last_login_at     TEXT
);

-- Single-use, expiring tokens for verification and password reset.
-- 'kind' distinguishes them; same table keeps the flows uniform.
CREATE TABLE auth_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,        -- 'verify' | 'reset'
  token_hash   TEXT NOT NULL,        -- store a HASH of the token, never the raw token
  expires_at   TEXT NOT NULL,
  used_at      TEXT,                 -- NULL until consumed; single-use
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
  parent_survey_id  TEXT REFERENCES surveys(id),   -- NULL = baseline
  access_code       TEXT NOT NULL UNIQUE,           -- the anonymous link token
  status            TEXT NOT NULL DEFAULT 'open',   -- open | closed
  opened_at         TEXT NOT NULL,
  closed_at         TEXT
);

CREATE TABLE responses (
  id               TEXT PRIMARY KEY,
  survey_id        TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  duration_seconds INTEGER,
  flagged_quality  INTEGER NOT NULL DEFAULT 0,
  submitted_at     TEXT NOT NULL
  -- NOTE: deliberately NO member/email/name column. Anonymity by design.
);

CREATE TABLE answers (
  id           TEXT PRIMARY KEY,
  response_id  TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES questions(id),
  score        INTEGER NOT NULL    -- raw 1..5, inverted at read time if reverse
);

CREATE INDEX idx_surveys_team     ON surveys(team_id);
CREATE INDEX idx_responses_survey ON responses(survey_id);
CREATE INDEX idx_answers_response ON answers(response_id);
CREATE INDEX idx_questions_axis   ON questions(axis_id);
CREATE INDEX idx_authtokens_user  ON auth_tokens(user_id);
CREATE INDEX idx_authtokens_hash  ON auth_tokens(token_hash);
```

### Future-proofing notes (do not build now)

- An `organizations` table could attach above `teams` via a nullable `team.organization_id` without touching surveys/responses/answers.
- A `members` table (for cross-app identity later) would attach to `teams` without disturbing the anonymous `responses` flow.

---

## 6. Scoring Engine (`lib/scoring.js`)

Pure, deterministic functions. Same input always yields same output. The data flows: normalise → group by axis → average → measure spread.

### 6.1 Normalise (the bug-prone step — read carefully)

Reverse-scored questions are worded so that **agreement signals a problem**. They must be inverted before averaging, or they corrupt the axis.

```js
const SCALE_MIN = 1;
const SCALE_MAX = 5;

// Higher always means healthier. Reverse items flip: 1<->5, 2<->4, 3 stays.
function normaliseScore(rawScore, isReverseScored) {
  if (!isReverseScored) return rawScore;
  return (SCALE_MIN + SCALE_MAX) - rawScore;   // 6 - rawScore for 1..5
}
```

**Critical rules:**
- Store raw (1-5) in `answers.score`. NEVER store inverted values. Invert only here, at read time.
- Invert exactly once. The most common bug is double-inversion (on save and on read, cancelling out). Inversion lives ONLY in `normaliseScore`.
- Drive `isReverseScored` from `questions.is_reverse_scored`, never a hardcoded ID list.

### 6.2 Group and average

```js
// answers: [{ axisId, rawScore, isReverseScored }]
function scoreByAxis(answers) {
  const byAxis = new Map();
  for (const a of answers) {
    const value = normaliseScore(a.rawScore, a.isReverseScored);
    if (!byAxis.has(a.axisId)) byAxis.set(a.axisId, []);
    byAxis.get(a.axisId).push(value);
  }
  const result = new Map();
  for (const [axisId, values] of byAxis) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    result.set(axisId, { mean: round1(mean), count: values.length, values });
  }
  return result;
}

const round1 = (n) => Math.round(n * 10) / 10;
```

All normalised answers across all respondents and all questions in an axis are pooled (e.g. 6 respondents x 4 questions = 24 values per axis mean). Pooling smooths out both a single grumpy respondent and a single odd question.

### 6.3 Spread (drives the "divided" flag)

```js
function axisSpread(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return round1(Math.sqrt(variance));
}

const DIVIDED_THRESHOLD = 1.2;   // std dev on 1..5 scale; tune with real data
function isDivided(values) { return axisSpread(values) >= DIVIDED_THRESHOLD; }
```

### 6.4 Public entry point

```js
// returns: [{ axisId, name, mean, count, spread, divided }]
function scoreSurvey(answers, axisMeta) {
  const scored = scoreByAxis(answers);
  return [...scored.entries()].map(([axisId, data]) => ({
    axisId,
    name: axisMeta.get(axisId).name,
    mean: data.mean,                 // radar radius, 1..5
    count: data.count,
    spread: axisSpread(data.values),
    divided: isDivided(data.values),
  }));
}
```

**Baseline vs follow-up:** run `scoreSurvey` twice (once per survey run) and pair results by `axisId`. The follow-up's `parent_survey_id` identifies its baseline. No special comparison logic.

### 6.5 Required tests (`tests/scoring.test.js`, node --test)

- A reverse item inverts correctly (raw 5 → 1, raw 1 → 5, raw 3 → 3).
- A divided axis (wide spread) trips the flag; a tight one does not.
- An all-neutral axis averages to exactly 3.0.
- No double-inversion: scoring twice on the same data gives identical results.

---

## 7. Authentication (`lib/auth.js`)

Robust admin login with real accounts. Admin-only: respondents never authenticate (anonymous links). This is the one area where Signal deliberately exceeds the existing apps' "casual key" approach.

### 7.1 Password hashing — critical

Use **argon2id** via the `argon2` npm package. Hash on registration and password change; verify on login.

```js
const argon2 = require('argon2');

async function hashPassword(plain) {
  return argon2.hash(plain, { type: argon2.argon2id });
}
async function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);   // returns boolean
}
```

**Do NOT use the salted SHA-256 from `accessKeys.js` for passwords.** That module is fine for high-entropy random *access keys* (which are not human-memorable and not brute-forceable in practice), but SHA-256 is a fast hash and unsuitable for human-chosen passwords. argon2id is memory-hard and purpose-built. Keeping these two distinct is intentional, not an inconsistency. The argon2 hash string already embeds its own salt and parameters, so no separate salt column is needed (unlike the access-key table).

### 7.2 Account creation: invite / seed only

No public self-registration. The first admin is created via CLI:

```
node manageKeys.js create-admin --email you@example.com
# prompts for a password (never passed as an argument — it would leak to shell history)
```

Further admins are created by an existing logged-in admin through an admin-only screen, or via the same CLI. New accounts start with `email_verified = 0` until they complete verification (see 7.4).

### 7.3 Login, lockout, rate limiting

- Verify email + password with `verifyPassword`.
- On failure, increment `users.failed_attempts`. After a threshold (e.g. 5), set `locked_until` to a short future window (e.g. 15 minutes). Reject login attempts while `locked_until` is in the future, regardless of password correctness.
- On success, reset `failed_attempts` to 0, clear `locked_until`, set `last_login_at`, issue a session.
- Layer the existing `loginRateLimiter.js` (sliding window per IP) on top of per-account lockout. The two defend different things: rate limiting slows distributed guessing, lockout protects a single targeted account.
- **Always return the same generic error** ("invalid email or password") whether the email is unknown or the password is wrong. Never reveal which. Same response timing where practical.

### 7.4 Email verification & password reset — Option B (transport deferred)

Build the full logic now; defer actual email delivery. All token-based flows go through `auth_tokens`:

- Generate a cryptographically random token. **Store only a hash** of it (`token_hash`), never the raw token, the raw token goes only into the link. Set `kind` (`verify` or `reset`), `expires_at` (e.g. verify 24h, reset 1h), `used_at = NULL`.
- On use: look up by hash, check not expired and `used_at IS NULL`, perform the action, then set `used_at`. Single-use, enforced.
- **Verification:** sets `users.email_verified = 1`.
- **Reset:** sets a new `password_hash`, invalidates outstanding reset tokens for that user, and should clear any lockout.
- Always respond to a reset *request* with the same generic message whether or not the email exists (no account enumeration).

**The transport seam (`lib/mailer.js`):** one function, `sendMail({ to, subject, body })`. In v1 it logs the message (and the link) to the server log / admin CLI rather than sending. Swapping to a real transport (SMTP, or an API like Resend/Postmark/SES) later is a change to this one module, nothing else. CLI fallback for a trapped admin:

```
node manageKeys.js reset-admin --email you@example.com   # prints a one-time reset link
```

### 7.5 Sessions

Server-side sessions via `session.js` (signed, httpOnly, Secure, SameSite=Lax cookie). Session holds `userId` only; everything else is looked up. Admin routes are guarded by a middleware that requires a valid session **and** `email_verified = 1`.

### 7.6 Required tests (`tests/auth.test.js`)

- Correct password verifies; wrong password fails.
- Lockout trips after the threshold and blocks even a correct password until it expires.
- A verify/reset token is single-use (second use rejected) and rejected after expiry.
- Tokens are stored hashed (raw token never present in the DB).
- Unknown-email and wrong-password produce the identical generic error.

---

## 8. Quality Checks (`lib/quality.js`)

Run on submit. Set `responses.flagged_quality` when a response looks untrustworthy. These exist because completion can be mandated but honesty cannot; they catch straight-lining without naming individuals.

- **Straight-lining:** flag when a respondent answers reverse items the same direction as normal items in the same axis (i.e. raw answers are near-identical across an axis despite mixed wording).
- **Speed:** flag when `duration_seconds` is implausibly low (e.g. a 24-question survey completed in under ~60 seconds).
- **Reverse-item inconsistency:** compare each reverse item against the axis's normal items; large contradiction is a flag.

The admin sees only an aggregate count (e.g. "1 response flagged"), never which response or who. Reports stay hidden until at least 3 responses (anonymity floor + data quality).

---

## 9. Question Bank (seed as template version 1)

6 axes, 4 questions each, 24 total. 1-5 agreement scale (Strongly disagree → Strongly agree). Higher = healthier unless marked **[R]** (reverse-scored). One reverse item per axis (questions 3, 8, 11, 15, 19, 23) gives the quality checks full coverage.

### Axis 1: Delivery (DORA)
1. We can release work to production whenever we choose, without long delays.
2. Our work flows steadily without large batches piling up.
3. **[R]** Getting a change from "done" to "live" usually takes far longer than it should.
4. Dependencies on other teams rarely block our progress.

### Axis 2: Quality (DORA + craftsmanship)
5. We are confident our changes won't break things in production.
6. We rarely have to redo work because of defects found later.
7. Our definition of done genuinely reflects production-ready quality.
8. **[R]** We frequently take shortcuts that we know we'll pay for later.

### Axis 3: Team Health (Spotify Squad Health Check)
9. The mood on this team is generally positive and energised.
10. We have the people and skills we need to do our work well.
11. **[R]** Too much of our time is lost to interruptions and context-switching.
12. We support each other and share workload when someone is stretched.

### Axis 4: Psychological Safety (Edmondson)
13. It is safe to take a risk or admit a mistake on this team.
14. I can raise problems and tough issues without fear of blame.
15. **[R]** People on this team are sometimes rejected for being different.
16. My unique skills and views are valued and used by the team.

### Axis 5: Learning & Improvement (Spotify + retro practice)
17. We act on what we decide in retrospectives, things actually change.
18. We make time to learn new things and improve how we work.
19. **[R]** We keep hitting the same problems without ever resolving them.
20. We treat failures as a chance to learn rather than to blame.

### Axis 6: Value & Purpose (Spotify "Mission")
21. We understand how our work connects to real customer or business value.
22. We have a clear, shared sense of what we're trying to achieve.
23. **[R]** We often build things that turn out not to matter.
24. We get useful feedback on whether what we ship actually works.

---

## 10. Insights Engine (`lib/insights.js`)

Rules-based for v1. Reads three signals per axis (score, trend vs baseline, spread) and classifies into one of four scenarios, then selects a curated tip. Exposed via a single function so a future AI enricher can swap in without touching callers.

### 10.1 Scenarios

- **lowFlat** — low score, little/no improvement → stuck, needs intervention.
- **lowRising** — low but improving → encourage, name what worked.
- **highSlip** — was high, has dipped → early warning.
- **divided** — wide spread regardless of score → the disagreement is the signal; needs a conversation.

Focus areas in the report are ranked by where attention helps most, NOT simply the lowest three scores. A decent-scoring but divided axis can outrank a higher one.

### 10.2 Interface (the v2 AI seam)

```js
function getInsights(scoredAxes) { /* rules engine; AI enricher swaps in here */ }
function selectTip(axisKey, scenario) { return TIP_LIBRARY[axisKey][scenario]; }
```

### 10.3 Tip library content

Each tip is short, anchored to a source, and ends with a concrete next move. Psychological Safety is treated as primary: its lowFlat tip says to prioritise it regardless of other scores, because low safety corrupts honesty everywhere including the survey itself.

**Delivery**
- lowFlat: Delivery is your weakest area and hasn't shifted. The usual culprits are large batches, manual release steps, and cross-team dependencies. Pick the single biggest blocker to shipping and run a focused session on it. (DORA)
- lowRising: Delivery is still low but moving the right way. Name what changed in the next retro so the team keeps doing it. (DORA)
- highSlip: Delivery was strong and has dipped. Catch it early: check whether work-in-progress has crept up or a new dependency appeared. (DORA)
- divided: The team disagrees about delivery. Roles near release often feel the friction more. Ask the team where shipping actually slows down. (DORA)

**Quality**
- lowFlat: Quality concerns are persistent, usually a weak definition of done or pressure to cut corners. Tighten what "done" means and protect time for it. (DORA)
- lowRising: Quality is recovering. Reinforce the practices behind it (review, testing, done criteria) before it stalls. (DORA)
- highSlip: Quality has slipped from a good level. Look for recent shortcuts taken under deadline pressure. (DORA)
- divided: Views on quality are split. Part of the team may be absorbing rework the rest don't see. Surface where defects originate. (DORA)

**Team Health**
- lowFlat: Team health is low and unchanged, a sign of sustained strain. Look at workload, interruptions, and skills gaps. Address the biggest drain first. (Spotify)
- lowRising: Getting better. Acknowledge it openly, recognition compounds. Keep protecting whatever reduced the strain. (Spotify)
- highSlip: A healthy team is dipping. Check for a recent change: new members, a tough delivery, rising interruptions. (Spotify)
- divided: Some feel good, some don't, which can mean uneven workload. A one-on-one check-in often reveals more than a group setting. (Spotify)

**Psychological Safety**
- lowFlat: Prioritise this regardless of other scores, low safety suppresses honesty everywhere, including this survey. Focus on how mistakes and dissent are handled; leaders responding well to bad news is the strongest lever. (Edmondson)
- lowRising: Safety is rising, which lifts everything else. Keep responding to mistakes with curiosity rather than blame. (Edmondson)
- highSlip: Safety has dipped from a good level. A single bad reaction to a mistake can do this. Reflect on recent moments where someone took a risk. (Edmondson)
- divided: Safety is felt unevenly. Some voices may feel heard while others don't. Notice who speaks in meetings and who doesn't. (Edmondson)

**Learning & Improvement**
- lowFlat: The team keeps hitting the same problems, usually because retro actions don't get done. Commit to fewer actions and actually finish them. (Spotify)
- lowRising: Improvement is taking hold. Make the wins visible so the team sees retros lead to real change. (Spotify)
- highSlip: Learning has slowed, often because delivery pressure crowded out improvement time. Protect a small, regular slot. (Spotify)
- divided: The team disagrees on whether things improve. Some may not see retro actions follow through. Make completed actions visible. (Spotify)

**Value & Purpose**
- lowFlat: The team is unsure its work matters. Reconnect work to customer/business value and tighten the feedback loop on what you ship. (Spotify)
- lowRising: Sense of purpose is growing. Keep sharing outcomes, not just outputs. (Spotify)
- highSlip: Clarity of purpose has dipped, often a goal shifted without being clearly re-communicated. Restate the "why". (Spotify)
- divided: The team is split on whether work matters. Some may have line of sight to the goal while others don't. Make the shared objective explicit. (Spotify)

Every tip ends with an action, never just a diagnosis. Tips are guidance, not prescriptions; the report should state this.

---

## 11. UI / UX

Vanilla HTML/CSS/JS pages. Strict CSP: external script files only, no inline scripts, no CDNs.

### Screens

- **Login** (`index.html`) — admin email + password, rate-limited, with per-account lockout. Generic error on failure (no account enumeration). Link to "forgot password".
- **Forgot / reset password** — request form (always shows the same generic confirmation) and a reset form reached via the tokenised link. In v1 the link is surfaced via server log / CLI (email transport deferred).
- **Verify email** — landing page for the verification link; on success marks the account verified and lets the admin proceed.
- **Dashboard** (`dashboard.html`) — survey list with status and response counts (e.g. "5 / 6 responses"), flagged-response count, "New survey" action. Footer reminder: counts show participation, never who answered; reports hidden under 3 responses.
- **Survey builder** (`survey.html`, builder view) — template select, team select, run type (baseline / follow-up; follow-up reveals a baseline picker), "Create & generate link", then the copyable anonymous link (`/s/CODE`).
- **Report** (`survey.html`, report view) — radar at top, prioritised "Focus areas" insights panel (top 3), then "All axes" summary grid with baseline → follow-up values. Closing line: tips are guidance, not prescriptions.
- **Per-question breakdown** — drill-down from an axis; questions ranked low-to-high with a bar per question and a "divided" tag where spread is high. This is the training-level detail.
- **Respondent form** (`respond.html`) — public, no login. One question per screen, axis label shown, 1-5 radio scale, progress indicator ("7 of 24"), Back/Next. Footer: anonymous, no login, individual answers never shown. Quality timer runs invisibly.
- **Thank you** — on submit.
- **Admin & team management** (`admin.html`) — create/rotate team access keys; invite additional admin accounts (admin-only).

### Radar (`public/js/radar.js`)

Hand-drawn SVG. Algorithm: position n axes evenly around a circle (`angle = -90 + i * 360/n`), convert each score to a radius (`R * score / MAX`), connect points into a polygon. Draw faint rings (1-5) and spokes first as guides. Two series: baseline (neutral grey) and follow-up (accent green). Always show numeric values alongside the chart. Outer edge = 5 (best), centre = needs work.

### One open UI choice (decide during build)

Respondent form is specced as **one question per screen** (best for honesty, fights straight-lining, but 24 screens). Alternative: group by axis (one screen per axis, ~4 questions, fewer clicks, slightly higher straight-lining risk). Default to one-per-screen unless testing suggests otherwise.

---

## 12. Design Tokens (`public/css/tokens.css`)

```css
:root {
  /* Brand */
  --sig-accent:        #1D9E75;   /* follow-up series, primary */
  --sig-accent-weak:   #E6F4EE;
  --sig-baseline:      #888780;   /* baseline series, neutral */

  /* Surfaces */
  --sig-bg:            #FFFFFF;
  --sig-bg-subtle:     #F7F7F5;
  --sig-bg-inset:      #EFEFEC;
  --sig-border:        #E3E3DF;
  --sig-border-strong: #C9C9C3;

  /* Text */
  --sig-text:          #2A2A28;
  --sig-text-muted:    #6B6B66;
  --sig-text-faint:    #9A9A94;

  /* Status */
  --sig-ok:            #1D9E75;
  --sig-warn:          #C77A0A;   /* low scores */
  --sig-info:          #2D7FF0;   /* divided / neutral signal */
  --sig-warn-bg:       #FBF0DF;
  --sig-info-bg:       #E7F0FE;

  /* Type */
  --sig-font:          system-ui, -apple-system, "Segoe UI", sans-serif;
  --sig-font-mono:     ui-monospace, "Cascadia Code", monospace;

  /* Scale & shape */
  --sig-radius-sm: 6px;  --sig-radius-md: 10px; --sig-radius-lg: 14px;
  --sig-space-1: 4px; --sig-space-2: 8px; --sig-space-3: 12px;
  --sig-space-4: 16px; --sig-space-6: 24px;
}
```

`--sig-baseline` (grey) and `--sig-accent` (green) are the two radar series and should be used consistently anywhere a before/after appears, so "grey is past, green is now" becomes a visual language. If you want true consistency with Poker and Retro, replace these values with their actual accent colour, font stack, and radii.

---

## 13. Build Order (suggested)

The pure, testable modules first, then routes, then UI.

1. `lib/db.js` — schema + migrations + CRUD. Seed the question bank (section 9) as template v1.
2. `lib/scoring.js` + `tests/scoring.test.js` — get inversion and spread watertight before anything depends on them.
3. `lib/quality.js` + tests.
4. `lib/insights.js` + tests — engine + tip library.
5. `lib/auth.js` + `lib/mailer.js` (log-only seam) + `tests/auth.test.js` — argon2id, lockout, single-use tokens. Add `create-admin` to `manageKeys.js` and seed the first admin.
6. Copy in the reusable modules (section 4) and wire `lib/httpApp.js`, `server.js`, `/health`. Session + admin-route guard (valid session AND verified).
7. Auth routes + screens: login, logout, forgot/reset, verify email, invite admin.
8. Routes: `surveyRoutes`, `responseRoutes`, `reportRoutes`.
9. Frontend pages + `radar.js`, against real seeded data.
10. CSV export, audit log, rate limiting, deploy files, CI.

### Out of scope for v1

- PDF export (v1.1).
- AI insight enrichment (v2, behind the existing `getInsights()` seam).
- WebSockets, organizations, members, cross-app integration.

