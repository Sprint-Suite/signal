# Debate: Scrum alignment review: Signal's scrum-health-survey-v1 questions against the Scrum Guide 2020

- Id: 2026-11-15-scrum-alignment-review-signal-s-scrum-health-surve
- Opened: 2026-11-15T13:15:53.505Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Review templates/scrum-health-survey-v1.json (24 Likert items, 6 axes) against the Scrum Guide 2020. I have an independent review and will compare. Give yours first: for each question, the Scrum element it measures and whether the wording matches the Guide or encodes a misconception (Daily Scrum as status report, Sprint Review as sign-off, SM as manager, velocity as required, etc.); flag outdated terminology, double-barrelled or leading wording; then list coverage gaps against accountabilities (Developers, PO, SM), the five events, three artifacts and their commitments (Product Goal, Sprint Goal, Definition of Done), the five values, the empiricism pillars, self-management and cross-functionality. Also say whether lib/insights.js and lib/quality.js work correctly with this template (e.g. tips per axis, reverse-scored items). Rate each finding Major/Minor. Stay within the listed files.

## Round 1/3 — ChatGPT: OBJECT

I would not endorse the current survey as a comprehensive Scrum alignment assessment. Many items are sound, but important coverage is absent and two diagnostic behaviors can mislead. Claude has requested a review rather than supplied conclusions; the objections below concern the current files.

I independently inspected all four files at commit 2138db5, on feat/suite-auth. This was a read-only review. Reference: [Scrum Guide 2020](https://scrumguides.org/scrum-guide.html). Major means a material coverage or interpretation problem; Minor means ambiguity, editorial weakness, or an optional practice presented too strongly. Coverage gaps do not establish that a surveyed team violates Scrum.

Question-by-question, numbered in template order ([template](/var/www/signal/templates/scrum-health-survey-v1.json)):

1. L10, clear Sprint Goal guiding trade-offs — Sprint Goal commitment and focus. Aligned; no finding.
2. L11, a plan the whole team believes in — collaborative Sprint Planning and self-management. Minor: belief is a vague proxy for participation; the contrasting imposed-list language encourages the preferred answer. Specify Developers’ ownership of the actionable plan.
3. L12, realistic capacity and rarely stuffing the Sprint — forecasting and sustainable work. Minor: two judgments, with loaded language. Ask whether selected work reflects available capacity, past performance, and the Definition of Done.
4. L13, achieving the goal rather than ticking items — Sprint Goal outcomes. Aligned in intent. Minor: combines goal achievement with a judgment about item completion; use a direct statement about achieving the goal.
5. L20, replanning rather than reporting status — Daily Scrum inspection and adaptation. Correctly rejects status-report framing. Minor: ‘we’ leaves participation ambiguous; name Developers and adaptation of their plan.
6. L21, progress toward Sprint Goal — Daily Scrum purpose. Aligned; no finding.
7. L22, blockers owned and followed up — impediment handling. Compatible. Minor: ownership and follow-through can differ, and follow-up alone does not establish removal. It also cannot measure Scrum Master accountability by itself.
8. L23, swarming rather than separate lanes — collaboration and collective focus. Minor: makes a particular working technique the positive scoring target. A team can collaborate effectively without routinely swarming; measure cooperation toward the Sprint Goal instead.
9. L30, working conversation rather than one-way demo — Sprint Review collaboration. Aligned. Minor: ‘real’ and the negative contrast add leading language without improving precision.
10. L31, feedback reshaping the backlog — inspection and adaptation. Minor: useful feedback need not always cause a backlog change. Measure whether feedback informs decisions about future work.
11. L32, usable Increment rather than unfinished work — Increment transparency and Done. Aligned in intent. Minor: ‘genuinely’ and ‘dressed as done’ are accusatory. Ask directly whether presented product work meets the Definition of Done. This item does not itself make Review a release gate.
12. L33, appropriate stakeholders attending and engaging — stakeholder collaboration. Minor: attendance and engagement are separate judgments; ‘right’ needs context, and discussion should include future direction rather than only what was built.
13. L40, honest issues without blame — Retrospective, openness, respect, and courage. Compatible. Minor: candour and absence of blame can vary independently; this is only a partial measure of those values.
14. L41, a small number of specific, owned actions each Retro — improvement planning. Minor: bundles number, specificity, ownership, and frequency. The prescribed action-count pattern is a technique, not the underlying outcome being assessed.
15. L42, completing actions before the next Retro — improvement follow-through. Major: an unconditional completion deadline can penalize valuable longer-running improvements. Measure prompt action and inspection of progress/effectiveness instead.
16. L43, tracking whether improvements help — empirical improvement. Aligned; no finding. ‘Track’ need not imply a formal measurement system.
17. L50, backlog refined and ready before Planning — refinement and selection readiness. Minor: ‘before planning’ can imply a premature readiness gate. Refinement can continue during Planning; clarify sufficient understanding for selection without implying a mandatory Definition of Ready.
18. L51, PO available and decisive for direction — Product Owner collaboration. Minor: availability and decisiveness are distinct. ‘Direction’ is ambiguous about product decisions versus directing Developers’ work; it does not explicitly encode a manager role.
19. L52, backlog ordered by value rather than a dumping ground — Product Backlog ordering and value. Minor: the negative contrast is loaded and ‘by value’ may suggest a single ranking formula. Assess intentional ordering that supports product value.
20. L53, understanding why top items matter — backlog understanding and purpose. Aligned as a partial measure; item-level rationale does not establish a shared Product Goal.
21. L60, shared and applied Definition of Done — Increment commitment and quality transparency. Aligned. Minor: clarity, shared understanding, and actual adherence are separate judgments; name Developers’ adherence explicitly.
22. L61, usable, potentially releasable Increment each Sprint — Increment delivery. Compatible. Minor editorial issue: ‘potentially releasable’ is legacy phrasing rather than the 2020 formulation; it is not inherently a misconception.
23. L62, Done work rarely returning incomplete or defective — quality and rework. Minor: combines incompleteness with defects, which have different causes. A later-discovered defect alone does not prove the original Done assessment was dishonest or invalid.
24. L63, DoD covering quality rather than only feature completion — Definition of Done. Aligned. Minor: ask directly about required product quality measures; the contrast is leading.

Across the template, inconsistent capitalization and informal ‘retro’ terminology are Minor editorial issues. There is no obsolete ‘Development Team’ terminology, required velocity, mandated three-question Daily Scrum, Review sign-off requirement, or Scrum Master-as-manager statement. All 24 propositions point toward healthier behavior when agreement increases, including the items containing ‘rarely’; their reverse:false settings are correct.

Coverage gaps:

• Major — Accountabilities: Developers’ plan ownership and professional mutual accountability are not explicit. PO availability is measured more directly than value accountability or organizational respect for product decisions. Scrum Master accountability is entirely unmeasured, including coaching, effectiveness, impediment removal, and service to the organization.
• Major — Commitments: Sprint Goal and Definition of Done receive substantial coverage; Product Goal is absent. Nothing directly connects backlog ordering, Sprint purpose, Review discussion, and Increment outcomes to a shared longer-term objective.
• Minor — Events: Planning, Daily Scrum, Review, and Retrospective have dedicated coverage. The Sprint is present indirectly, without questions about cadence, timeboxes, goal protection, or scope renegotiation. Planning’s value rationale and Review’s environmental changes/future adaptations are weakly represented.
• Major — Artifacts: Product Backlog ordering and Increment usability are covered. The Sprint Backlog is never named or directly assessed as a visible, evolving plan owned by Developers. Increment integration and verification are unmeasured; release independence from Review is also unmeasured. Absence of that question is not evidence that the template teaches sign-off.
• Minor — Definition of Done: organizational minimum standards and a shared definition across teams working on one product are absent.
• Minor — Values: commitment and focus have strong proxies; openness appears through honest retrospectives and stakeholder conversations; respect and courage have only indirect proxies. None receives direct behavioral coverage sufficient to distinguish it from event mechanics.
• Major — Empiricism: inspection and adaptation have several proxies. Transparency is less directly assessed, especially artifact visibility and whether people share an accurate understanding. The survey cannot distinguish holding events from making evidence-informed decisions through them.
• Major — Self-management and cross-functionality: rejecting imposed plans and status reporting provides partial autonomy coverage. There is no direct assessment of internal decisions about who does what, when, and how, or whether the team collectively has the skills to create value. Swarming is not an adequate substitute.

These coverage judgments follow the accountabilities, events, artifacts, commitments, values, and pillars defined in the [2020 Guide](https://scrumguides.org/scrum-guide.html).

Implementation findings:

• Major — Missing tips for every Scrum axis. [lib/insights.js](/var/www/signal/lib/insights.js:50) contains tips for six different axis names. selectTip() returns null for every current Scrum axis and every concern scenario; getInsights() passes axis.name directly at L187. Classification and top-three focus selection still operate. I verified all 24 axis/scenario combinations return null. Add guidance for the exact six Scrum axes, covering all four concern scenarios. The absent Psychological Safety priority boost is expected because this template has no such axis.

• Major — Uniform answers can be flagged despite being sincere. [lib/quality.js](/var/www/signal/lib/quality.js:86) flags identical raw answers independently of reverse-item evidence or speed. A 120-second response answering 4 to all 24 positive items returns flagged:true with only straight-lining as its reason. This proves the behavior, not respondent dishonesty. Uniformity should remain an explicitly uncertain signal, with stronger evidence required for an untrustworthy-response interpretation. These files do not establish whether flags exclude responses downstream.

• Minor — Reverse inconsistency is unavailable for this template. quality.js L69–71 skips every axis because none mixes scoring directions. This is expected, not a reversal bug. Do not add awkward reverse questions merely to activate the detector. The speed rule remains active: below 60 seconds flags a complete 24-answer response; exactly 60 seconds does not. That threshold is a heuristic, not a validated finding about honesty.

• Major — ‘Divided’ conflates differences between questions with differences between people. [lib/scoring.js](/var/www/signal/lib/scoring.js:78) pools all question answers within each axis before calculating spread. Four respondents giving exactly the same [1,1,5,5] profile produce mean 3, spread 2, and divided:true. insights.js consequently classifies every such axis as divided, despite complete respondent agreement. Compute disagreement between respondents on comparable items, or change the label and interpretation to acknowledge mixed item ratings.

Scoring arithmetic and inversion work for the exercised valid inputs, provided callers supply the documented isReverseScored metadata. Template import and downstream presentation are outside the four-file scope and remain unverified. All read-only Node assertions passed. No files, commits, pushes, or server processes were changed.

## Round 2/3 — Claude

Thanks — I have checked your two code claims and compared them with my independent review. Where we land:

CONCEDED (you found it, I missed it):
1. 'Divided' conflates item variance with respondent disagreement. Confirmed: scoring.js scoreSurvey pools every answer per axis (docstring: "pooled per axis") and axisSpread runs over that pool, so unanimous respondents with a mixed item profile are labelled divided. I agree this is Major: the dashboard asserts team disagreement that does not exist.
2. Reverse-scored items. I had rated "all items reverse:false" Major, partly to activate the reverse-inconsistency check. You are right that activating a detector is not a reason to change instrument wording, and that the 'rarely' items are correctly scored. I keep a weaker claim: an all-positive, agree-direction Likert instrument is exposed to acquiescence bias, which is a standard survey-design concern independent of the detector. I downgrade it to Minor.

PARTLY AGREE:
3. Straight-lining flags sincere uniform answers — confirmed (quality.js identicalAnswers needs only distinctRawValues <= 1). But I rate it Minor, not Major: flagged_quality is only surfaced as a count (db.js:751, 773); it is not excluded from scoring. The harm is a misleading flag count, not corrupted results. Do you have evidence it changes any score or the reporting floor?

DISAGREE:
4. Retro item L42 (actions completed before the next Retro) as Major. The 2020 Guide says the most impactful improvements "are addressed as soon as possible" and "may even be added to the Sprint Backlog for the next Sprint". Completing small improvements within a Sprint is close to the Guide's own expectation; the item penalises only long-running improvements, which the item set elsewhere tolerates (L43 tracks whether improvements help). I hold Minor.

AGREED as stated: Product Goal absent (Major); Scrum Master accountability unmeasured (Major); self-management and cross-functionality only partially covered (Major); insights.js has no tips for any of the six Scrum axes (Major, I reproduced the same); Sprint Backlog never named, transparency weakly covered, values only by proxy, 'potentially releasable' legacy wording, swarming as a prescribed technique, double-barrelled and leading 'not X' foils (Minor each).

Proposed consolidated Major list: (a) Product Goal gap, (b) Scrum Master gap, (c) self-management/cross-functionality gap, (d) Sprint Backlog/transparency gap, (e) insights tips missing, (f) divided-label conflation. Everything else Minor. Do you agree, or do you still hold L42 and the straight-lining flag as Major?

## Round 2/3 — ChatGPT: AGREE

I accept the consolidated six Major findings and downgrade both disputed findings to Minor.

Straight-lining: my initial severity exceeded the demonstrated impact. lib/quality.js:86–90 flags uniform answers, including potentially sincere responses, but I have no evidence that this changes scores or the reporting floor. lib/scoring.js does not consume quality flags. I have not inspected db.js because it is outside our agreed scope, so aggregate-only presentation remains your independently reported finding. The supported objection is a potentially misleading quality signal, rated Minor.

Retrospective deadline: Minor is proportionate for this isolated wording defect. However, I do not accept that the Guide establishes completion before the next Retrospective: prompt attention and optional inclusion in the next Sprint Backlog do not require completing every improvement within one Sprint. L43 measures effectiveness tracking; it does not remove L42’s completion condition. Replace L42 with something like: ‘We act promptly on prioritized retrospective improvements.’ See the [Scrum Guide’s Retrospective section](https://scrumguides.org/scrum-guide.html#sprint-retrospective).

I accept potential acquiescence bias as a Minor instrument-design concern, without claiming that bias has been measured here or that reverse wording necessarily fixes it. All current reverse:false settings correctly represent item direction.

The six Majors remain supported by the inspected files: absent Product Goal coverage; absent Scrum Master accountability coverage; insufficient self-management/cross-functionality coverage; insufficient Sprint Backlog ownership and transparency coverage; missing tips for every Scrum axis in insights.js; and pooled item variance incorrectly interpreted as respondent disagreement in scoring.js. For the Sprint Backlog finding, the substantive omission is its visible, evolving, Developer-owned plan—not merely its missing name. Other identified wording and coverage limitations remain Minor; aligned questions are not findings.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Use the six Major findings as the priority remediation list: add substantive coverage of Product Goal, Scrum Master accountability, self-management/cross-functionality, and Sprint Backlog ownership/transparency; provide tips for all six Scrum axes and four concern scenarios; and distinguish respondent disagreement from variation between questions. Treat the retrospective deadline, uncertain straight-lining signal, potential acquiescence bias, and remaining wording issues as Minor. Preserve correct scoring directions and do not introduce reverse items merely to activate a detector.

