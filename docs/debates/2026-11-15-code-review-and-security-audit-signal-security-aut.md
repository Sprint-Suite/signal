# Debate: Code review and security audit: Signal security (auth, tenant isolation, anonymous survey surface)

- Id: 2026-11-15-code-review-and-security-audit-signal-security-aut
- Opened: 2026-11-15T13:14:04.467Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Whole-app security review of Signal at HEAD 2138db5 (feat/suite-auth). Node/Express + SQLite. Admins sign in via the Sprint Suite hub (@suite/auth-client in node_modules, symlinked to the shared package); respondents answer anonymously via /s/<code> and POST /api/respond/:code; reports are hidden below MIN_RESPONSES.

I have an independent review already and will compare. Give yours first, Blocker/Major/Minor, file:line for each claim, keep it to the most important ~8 findings. Focus areas: (1) is every admin/report/dashboard route gated, and is the user's entitlement to Signal enforced; (2) tenant isolation — can company A reach company B's data by id; (3) the sign-in launch/return_to flow and session lifecycle; (4) abuse of the anonymous submit endpoint and whether the anonymity floor can be defeated; (5) CSRF, injection, XSS, headers. Please stay within the listed files plus whatever they directly require — a whole-repo sweep timed out last time. .env and data/ are not present; don't look for them.

> **Referee:** ChatGPT turn failed; round not counted. codex timed out after 300000 ms

> **Referee:** Retrying the failed ChatGPT turn.

## Round 1/3 — ChatGPT: OBJECT

Independently inspected Signal at 2138db5 on feat/suite-auth and the installed auth-client symlink at /var/www/suite/shared/auth-client. Findings, ordered by priority:

1. Major — Signal entitlement is not enforced. lib/httpApp.js:78 protects administrative APIs only with requireAuth; pages use the same guard at :121–128. node_modules/@suite/auth-client/middleware.js:16–25 admits sessions regardless of entitled, merely exposing it at :51. Launch also creates unentitled sessions (handlers/launch.js:18–25). Reproduced requireAuth admitting entitled:false. Existing tests/server.test.js:102–107 seeds sessions without entitlement and :156–162 expects administrative access. Require Signal authorization on every administrative API/page, with negative tests.

2. Major — Confirmed external redirect after launch. node_modules/@suite/auth-client/handlers/launch.js:31–35 checks the parsed host, then redirects to pathname + search. With Host: app.test and return_to=https://app.test//evil.test/phish, the actual Location is //evil.test/phish, which resolves externally. Reproduced against the handler. Validate against the configured application origin and emit a destination that cannot become a scheme-relative URL.

3. Major — Launch permits login CSRF/session substitution. lib/httpApp.js:55 exposes launch through GET; handlers/launch.js:7–27 exchanges any valid token and overwrites the browser session cookie without a browser-bound login transaction. An attacker who obtains an unused launch token for their own account can send the launch URL to a victim, placing the victim in the attacker's company context. Subsequent work may be saved where the attacker can read it. Reproduced session replacement without state or prior login initiation. Bind token redemption to a single-use browser login transaction, including Hub-initiated launches.

4. Major — Repeated anonymous submissions defeat the numeric anonymity floor and permit resource abuse. lib/responseRoutes.js:65–126 validates answer shape but imposes no submission credential, replay restriction, volume limit, or rate limit; lib/db.js:833–854 inserts another response each time. Reports count every row, including quality-flagged responses (lib/reportRoutes.js:83–95; lib/db.js:858–869). Reproduced three identical submissions unlocking reporting with all three flagged. A facilitator can supply two known responses beside one genuine response and infer the genuine answers. Use privacy-preserving single-use participation credentials plus volume controls; rate limiting alone cannot establish independent participation.

5. Major — Live aggregates expose individual answers through differencing. lib/reportRoutes.js:79–95, :196–214 and :218–227 publish changing aggregates whenever count reaches three, even while collection remains open. buildBreakdown exposes per-question counts and means at :175–187. Reproduced a question changing from count=3, mean=3 to count=4, mean=3.5: 4×3.5−3×3 recovers the fourth respondent's score of 5. Publication needs a disclosure policy that prevents single-response updates. Merely requiring closure is insufficient if reopening and republishing remain unrestricted (lib/surveyRoutes.js:279–280).

6. Major, conditional on Hub revocation behavior — Tenant authorization is a launch-time snapshot. handlers/launch.js:23–25 stores entitlement/company; middleware.js:21–24 refreshes only validation time, and lib/sessions-db.js:81–82 never refreshes company or entitlement. The default local lifetime is 30 days (lib/factory.js:27). A removed/transferred member retains the old company context while Hub heartbeat returns ok. The reviewed code cannot establish whether Hub automatically revokes affected central sessions. Require and test that revocation contract, or refresh authorization context during validation.

7. Minor — Request logs retain survey bearer codes. lib/httpApp.js:45 logs every request; middleware/requestLogger.js:24 passes URLs through lib/logger.js:17–25, which masks only selected query parameters. Both /s/<code> and /api/respond/<code> remain intact. Reproduced this with safeUrl. Log readers can reuse those codes to inspect survey metadata or submit forged responses while open. Redact respondent codes in path segments.

8. Minor — Logout is vulnerable to forced navigation. lib/httpApp.js:56 mounts logout as GET, and handlers/logout.js:6–15 revokes the central session without CSRF validation. The SameSite=Lax cookie (lib/cookies.js:17) accompanies cross-site top-level GET navigation, allowing an attacker to force Suite logout. Use a CSRF-protected mutation endpoint.

Positive findings: all named administrative API/page routes are behind authentication. Company checks cover team mutations, survey reads/transitions, follow-up creation, reports and exports (lib/companyAccess.js:10–16; lib/surveyRoutes.js:117–139, :209–223, :257–284; lib/reportRoutes.js:64–75). In-memory cross-company report/breakdown/CSV probes returned 404. No SQL injection or server-rendered XSS was identified in the reviewed scope; database lookups use bound parameters, and middleware/securityHeaders.js:16–28 provides restrictive CSP. Frontend DOM sinks were outside this scope.

Verification: seven selected test files passed, syntax checks passed for the nine named modules, and git diff --check passed. No confirmed Blocker. Review only: no files changed, no commit or push, and no project server running.

## Round 2/3 — Claude

My independent review (two security lenses, each Major adversarially verified with probes) reached your findings 1, 2, 4 and 6 at Major, and 7 and 8 at Minor. We agree on those, including that 2 and 6 belong in the shared auth-client/hub rather than Signal.

CONCEDED — 5 (differencing on live aggregates). We missed this. Confirmed: /surveys/:id/report gates only on countResponses >= MIN_RESPONSES (reportRoutes.js:83-90) with no status check, so an open survey republishes on every new response; and /reopen (surveyRoutes.js:279) is unrestricted. This is the stronger form of the anonymity problem because it needs no planted ballots: a facilitator who simply refreshes between the 3rd and 4th response recovers the 4th respondent's answers. Agreed Major. I'd frame the fix as one disclosure policy: publish only on closed surveys, count only unflagged responses toward the floor, and on reopen withhold results until the count has grown by at least MIN_RESPONSES since the last publication.

CONCEDED, with reasoning — 3 (login CSRF). I had it Minor because Signal holds little victim-owned data. Your scenario changes that: a victim facilitator silently placed in the attacker's company creates teams there and distributes those survey links to their real team, so the victim team's responses land where the attacker can read them. That is a confidentiality impact on respondents, not just a nuisance. I accept Major, fixed in auth-client launch with a browser-bound single-use state.

One addition from my side you did not list: the systemd unit (deploy/systemd/signal.service:8) leaves NODE_ENV to .env; absent it, the error handler returns stack traces and the app binds 0.0.0.0. I rate it Minor. Also team access keys are minted, rotated and displayed but never verified anywhere (lib/accessKeys.js) — Minor, a control with no enforcement point.

Proposed consolidated list. Major: (1) entitlement not enforced [Signal]; (2) open redirect via //host [auth-client]; (3) login CSRF on launch [auth-client]; (4) unlimited anonymous submissions defeat the floor [Signal]; (5) differencing on live/reopened aggregates [Signal]; (6) membership/entitlement revocation not propagated, 30-day snapshot [hub/auth-client, conditional on hub contract]. Minor: survey codes in logs, GET logout, NODE_ENV in systemd, unverified team access keys. No Blocker, given the branch is unshipped. Agree?

## Round 2/3 — ChatGPT: AGREE

I agree with six Major findings and four Minor findings, with these qualifications.

The disclosure policy must cover baseline overlays as well as direct report, breakdown and CSV routes. lib/reportRoutes.js:100–106 independently recomputes a parent's scores using only its response count. I reproduced a closed follow-up exposing its open baseline changing from mean 3 at three responses to mean 3.5 at four, revealing the additional score of 5. Closing only the requested survey leaves this bypass.

Publication history must persist across reopening and process restarts. Measure growth using eligible responses since the last published snapshot, consistently across every output. Quality flags are heuristics, not proof of independent participation: excluding flagged submissions from the floor does not resolve unlimited submissions. Finding 4 still needs separate submission controls.

The deployment Minor is supported: deploy/systemd/signal.service:8 supplies an EnvironmentFile without pinning production configuration; server.js:31–33 defaults to development and all-interface binding when NODE_ENV and HOST are unset. middleware/errorHandler.js:49 then returns stacks for HTML errors, which I confirmed directly. This is a conditional configuration weakness; deployed exposure is unverified.

Unused team keys are Minor misleading functionality/cleanup, rather than an established authorization bypass. lib/surveyRoutes.js:114 and :133 returns them, and public/js/admin.js:78 and :94 tells users to copy them, while no reviewed request path verifies them. Remove that obsolete interface unless David specifies a real authorization purpose.

Finding 6 remains conditional on the Hub's membership-change/session-revocation contract. I found no confirmed Blocker based on demonstrated impact; being unshipped alone does not determine severity.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Track six Majors: unenforced Signal entitlement, launch open redirect, launch login CSRF, unrestricted anonymous submissions, aggregate differencing, and conditional stale tenant/entitlement authorization. Track four Minors: logged survey codes, GET logout, unsafe deployment defaults, and obsolete team-key functionality. Enforce Signal authorization in Signal; fix redirect validation and browser-bound single-use login state in the shared auth-client; establish tested Hub revocation or authorization refresh. Add privacy-preserving submission controls separately from reporting controls. Publish aggregates only for closed, eligible surveys through one shared disclosure policy covering reports, breakdowns, CSV and baseline overlays, with durable publication history and at least MIN_RESPONSES additional eligible responses before republishing after reopening. Add regression tests for those paths, repeated reopen cycles, restart persistence and authorization denial.

