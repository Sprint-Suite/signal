# Debate: Code review and security audit: Signal (whole app, branch feat/suite-auth) — plus Scrum alignment of the survey questions

- Id: 2026-11-15-code-review-and-security-audit-signal-whole-app-br
- Opened: 2026-11-15T12:40:30.956Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Scope: the whole Signal app at HEAD 2138db5 on feat/suite-auth, not a diff. Signal is a Node/Express + SQLite Scrum team-health survey: admins (signed in via the Sprint Suite hub, @suite/auth-client) create surveys per team/company; respondents answer anonymously via /s/<code> links; dashboards score and chart results.

Purpose of this debate: I am running my own independent multi-agent review in parallel and will bring its verified findings back here to compare. I deliberately have not anchored you on them. Please give your independent review first, in three parts, citing file:line for every claim and assigning Blocker / Major / Minor:

1. SECURITY — auth and session handling with the hub; that every admin/report/dashboard route is gated; tenant isolation (lib/companyAccess.js: can company A read/write company B's data by changing an id?); access keys (lib/accessKeys.js) entropy and comparison; CSRF on state-changing routes; SQL injection; input validation coverage (schemas/, lib/validate.js); XSS in public/js where user-supplied names or free text are rendered; security headers/CSP; anonymous link guessability, ballot stuffing, rate/size limits; respondent anonymity leaks via logs; error handler leakage; deploy/ config.

2. CODE QUALITY — against /var/www/CodingStandards/core/THRESHOLDS.md (30-line functions, cyclomatic 10, 400-line files, <3% duplication, 80% coverage). Note the apparent duplication lib/securityHeaders.js vs middleware/securityHeaders.js.

3. SCRUM ALIGNMENT — templates/scrum-health-survey-v1.json against the Scrum Guide 2020: accountabilities (Developers, Product Owner, Scrum Master), five events and their stated purposes, three artifacts and commitments (Product Goal, Sprint Goal, Definition of Done), five values, the empiricism pillars, self-management. Flag questions that encode misconceptions (Daily Scrum as status report, Review as sign-off demo, SM as manager, velocity as a Scrum requirement), double-barrelled or leading wording, and coverage gaps.

Note: .env, data/ and admin-activity.jsonl have been removed from the tree for this review; do not look for them.

> **Referee:** ChatGPT turn failed; round not counted. codex timed out after 300000 ms

