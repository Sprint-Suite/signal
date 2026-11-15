# Debate: design-final: Signal security fix plan (entitlement, single-use invites, closed-batch publication)

- Id: 2026-11-15-design-final-signal-security-fix-plan-entitlement
- Opened: 2026-11-15T13:39:57.908Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

The plan at docs/superpowers/plans/2026-11-15-signal-security-fixes.md implements Signal-owned findings 1, 4 and 5 from our agreed security debate (docs/debates/2026-11-15-code-review-and-security-audit-signal-security-aut.md). David chose per-respondent single-use invite links over a shared link with cookie/rate-limit, and over hub-authenticated respondents.

Key design decisions I want challenged:
1. Publication model: responses carry a `published` flag. Closing a survey publishes all pending responses only if there are >= MIN_RESPONSES (3) of them; reports, breakdown, CSV and baseline overlay read published responses only. So every visible change between snapshots is an aggregate of >= 3 new responses, durable across restarts and reopen cycles. I think this satisfies the agreed disclosure policy more simply than tracking a separate publication history.
2. Invites: 12-char codes from generateAccessKey (~71 bits), stored as unsalted sha256 (salt unnecessary at that entropy); plaintext shown once; consumption and response insert in one transaction via a guarded UPDATE ... WHERE used = 0; invites carry no timestamp and no column links them to responses.
3. I explicitly accept that a facilitator holding the invites can still plant ballots; the respondent page states that anonymity holds only if each link reaches its intended person. Rate limiting is not added: invites cap total submissions at inviteCount.
4. Quality flags are NOT used for eligibility (straight-lining flags sincere answers; with invites capping volume, excluding flagged rows buys little).
5. surveys.access_code is kept but unrouted, to avoid an SQLite UNIQUE-column table rebuild in v3; dropping it is deferred to the code-quality plan's baseline-schema fold.
6. Migration hardening (atomic migrations, refuse newer schema) is included because v3 is added in the same change.

Please check for gaps against the agreed solution, correctness of the publication rule (including first-close-below-floor and repeated reopen), whether any remaining output path bypasses the published filter (dashboard list counts, survey detail, CSV, baseline), and whether the invite design leaks timing or linkage. Stay within the plan and the files it names.

## Round 1/3 — ChatGPT: OBJECT

Independently inspected the plan, agreed debate, and named code paths at 2138db5 on feat/suite-auth. The core design is sound, but the plan needs these corrections before approval.

1. Migration can expose fewer than three responses. Plan lines 74–75 mark every closed survey's responses published, while line 141 locks only when countPublished is zero. A legacy closed survey with two responses therefore becomes readable. An in-memory probe confirmed published=2 passes the proposed gate. Backfill only closed surveys having at least MIN_RESPONSES responses, and retain the defensive countPublished < MIN_RESPONSES gate for reports, breakdown, CSV and baseline. Add a migration regression covering closed surveys with one and two responses.

2. Quality counts bypass publication. lib/reportRoutes.js:144 returns countFlaggedResponses over all responses. lib/surveyRoutes.js:47,184–185 exposes the same unrestricted statistic through list/detail, backed by lib/db.js:762–774,864–869. Adding one unpublished flagged response changes the visible flag count immediately; I confirmed this against the current helper. Because flags derive from answers and completion duration, this reveals an individual response characteristic. Filter flagged counts to published responses everywhere and suppress them below the floor. Live participation totals may remain, but distinguish them explicitly from published result counts. Test list, detail and report before and after one pending flagged response.

3. Timestamp-free invites do not guarantee timing unlinkability. The proposed GET /api/respond/:code reveals whether each known link has been used. A facilitator retaining the recipient-to-link mapping can poll it to learn participation and approximate submission time. Existing responses also retain submitted_at (lib/db.js:225–230), and bearer-code logging is explicitly deferred. Having no foreign key establishes no direct stored association; it does not establish that 'nothing ties your answers to this link.' Narrow the respondent copy and document the participation/timing limitation. This does not require abandoning single-use invites or resolving the deferred logging finding here.

4. Require fail-closed inviteCount validation. lib/surveyRoutes.js:196–197 currently ignores schema failure and falls back to raw input. Adding a required schema field alone will not enforce the proposed bound. Explicitly reject invalid creation input; test missing, fractional, negative and oversized counts, including follow-up creation. Also test that an answer-insertion failure rolls back invite consumption.

5. Qualify rollback protection. The new version guard protects builds containing it. The current v2 ensureSchema (lib/db.js:76–89) still accepts newer databases and rewrites their version; deploying that historical build against v3 remains unsafe. State this limitation and prohibit that rollback, or ship the guard in a v2-compatible prerequisite.

With these fixes, a durable published flag is sufficient: pending responses accumulate across unsuccessful closes and publish together once three exist. Frozen published results may remain readable during reopening. Add the agreed restart/repeated-reopen tests, including eventual publication after three accumulated pending responses and a reopened baseline with both published and pending responses. I accept the token entropy/hash choice, transactional single-use consumption, inclusion of quality-flagged answers, retained unrouted access_code, and the stated facilitator ballot-planting limitation.

## Round 2/3 — Claude

I concede all five and have amended the plan; please re-read docs/superpowers/plans/2026-11-15-signal-security-fixes.md.

1. Backfill: v3 now publishes only closed surveys with >= 3 responses, and the report/breakdown/CSV/baseline gate is countPublished < MIN_RESPONSES (defensive, since publication itself yields 0 or >= 3). Added test `v3 backfill publishes only closed surveys at the floor` covering closed surveys with 1, 2 and 3 responses plus an open survey with 3.

2. Flag counts: agreed they are derived from answers and so are results. countFlaggedResponses and both list queries' flagged_count now filter published = 1, and every body returns flaggedCount: null below the floor. List/detail keep a live responseCount labelled as participation and add publishedCount. Test: one pending straight-lined response changes no visible flag count on report, list or detail.

3. Respondent copy: you are right that "nothing ties your answers to this link" overclaims given used-status polling and submitted_at. New copy: "Signal stores no name or email with your answers, and stores no record of which link they came from. Whoever sent you this link can see that it has been used, but not what you answered. Results are shown only for groups of at least 3 people." That states the participation/timing limitation to the person it affects.

4. Fail-closed validation: Task 3 now replaces the safeParse fallback at surveyRoutes.js:193-197 with validate(surveySchema), keeping the domain 400s after it. Tests cover missing, 2, 51, 3.5, -3 and "5", on baseline and follow-up; plus a foreign-key-violating answer that must leave the invite unused and zero responses.

5. Rollback: stated as a constraint in Task 2 — this plan must land before feat/suite-auth reaches production, so no guard-less v2 build is ever deployed (production currently runs main, pre-v2), and rollback to a pre-v3 build of the branch is prohibited once v3 has run.

Also added the restart, accumulate-across-closes (published 3 → 3 → 3 → 6), and reopened-baseline-with-pending tests. Do you approve the amended plan?

## Round 2/3 — ChatGPT: AGREE

I re-read the amended plan. It addresses all five objections: Task 2 restricts migration backfill to closed surveys meeting the floor and documents rollback restrictions; Task 3 rejects invalid invite counts and tests transactional rollback; Task 4 filters quality counts consistently across report/list/detail and adds restart, repeated-close and baseline regressions.

The publication invariant is sufficient without a separate history table: published responses remain immutable, and each subsequent publication adds at least three pending responses. First-close-below-floor and repeated reopening now have explicit coverage. Reports, breakdown, CSV and baseline use the published population; live participation counts remain intentionally separate.

The accepted limits remain important: three submissions do not prove three independent people, a facilitator holding links can plant ballots, and used-status polling reveals participation timing. The design prevents direct stored invite-to-answer association and single-response aggregate updates; it does not establish protection against every form of inference. Implementation and the listed tests still need verification.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Enforce Signal entitlement across administrative APIs and pages. Replace shared respondent codes with high-entropy, hash-stored single-use invites whose consumption and response insertion are atomic. Publish immutable responses only on closure when at least three pending submissions exist, preserving pending responses across reopen cycles and restarts. Apply that published population consistently to scores, quality counts, exports and baseline overlays, while exposing participation counts separately. Migrate conservatively, enforce input validation, document timing and facilitator limitations, and prohibit rollback to builds lacking schema protection.

