# Survey templates from disk + baseline/follow-up grouping UI

**Status:** Design — not yet implemented
**Date:** 2026-05-24
**Scope:** Signal app only. No changes to Scrum Poker or Retrospective.

## Motivation

Signal currently ships exactly one survey template, hardcoded in
`lib/db.js` as `QUESTION_BANK` and seeded into the database on first
boot by `seedQuestionBank()`. Adding a new template today means
editing the hardcoded constant and reseeding the DB — too heavy a
change for what is effectively content authoring.

Two needs drive this design:

1. **A way to add new templates without editing `db.js`.** Templates
   are content; they should live in their own files in version
   control and load themselves into the DB on boot.
2. **A clearer UI for baseline → follow-up chains.** Once a team has
   surveys under more than one template, the current flat lists in
   the builder's baseline selector and on the dashboard make the
   relationship between a baseline and its follow-ups hard to see at
   a glance.

The first non-seed template — a "Scrum Health Survey" with 6 axes ×
4 questions, all positively worded — ships as part of this work and
exercises the new loader end-to-end.

## Out of scope

- An admin UI for creating or editing templates in the running app.
  Authoring stays developer-only for now (file in repo + redeploy).
- Migrating the existing hardcoded "Agile Health Check" template to
  a file. The prod DB already has that template under a UUID; rerunning
  a file-based import under a kebab-case `id` would create a
  duplicate. The hardcoded seed stays untouched. File-based templates
  are purely additive.
- Editing a template in place. Once imported, a template is
  immutable from the loader's perspective. To change a template,
  author a new file with a new `id` (typically a version bump:
  `scrum-health-survey-v2.json`).
- Survey-series collapsibility on the dashboard. We render the full
  nested list. If any team accumulates 5+ follow-ups against one
  baseline and the list becomes unwieldy, we add collapsibility
  then.
- Reverse-scored questions in the Scrum Health Survey. The source
  draft (`docs/new-survey.md`) is all positively worded; we keep it
  that way for the first ship. The schema still requires the
  `reverse` field on every question so future templates can mix.

## Architecture overview

Three independent pieces, each landable on its own:

1. **Template loader** — a new module `lib/templateLoader.js` that
   reads every `.json` file in a `templates/` directory at the repo
   root, validates each, and inserts any template whose `id` is not
   already present in the DB. Runs on server boot, after the DDL is
   applied but before route mounting.
2. **First file-based template** — `templates/scrum-health-survey-v1.json`,
   authored in the format the loader expects. 6 axes × 4 questions,
   all `reverse: false`.
3. **Grouping UI** — mostly client-side changes in
   `public/js/survey.js` (builder baseline dropdown becomes optgrouped
   by template) and `public/js/dashboard.js` (flat list becomes a
   nested tree of `team → template → baseline → follow-ups`). The
   only server-side change is adding `templateVersion` to the
   `surveySummary()` projection in `lib/surveyRoutes.js` so the
   client can render `(v<version>)` in optgroup labels; no new
   endpoints, no contract changes.

## Template file format

JSON, one file per template, in `templates/` at the repo root.

### Schema

```json
{
  "id": "scrum-health-survey-v1",
  "name": "Scrum Health Survey",
  "version": 1,
  "axes": [
    {
      "name": "Sprint Goal & Planning",
      "description": "How clearly the team plans toward a shared goal.",
      "questions": [
        { "text": "We have a clear Sprint Goal that guides our trade-offs during the sprint.", "reverse": false },
        { "text": "Sprint Planning produces a plan the whole team believes in, not a list handed to us.", "reverse": false },
        { "text": "We plan to realistic capacity and rarely stuff the sprint full.", "reverse": false },
        { "text": "<the 4th question, to be authored in implementation>", "reverse": false }
      ]
    }
  ]
}
```

### Field rules

- `id` (string, required) — stable kebab-case identifier. Used as
  the `templates.id` primary key in the DB. Must be unique across
  all template files. Changing it = a new template.
- `name` (string, required) — display name shown in the builder
  dropdown as `<name> (v<version>)`.
- `version` (integer, required) — written to `templates.version`.
- `axes` (array, required, length ≥ 1) — ordered.
- `axes[].name` (string, required) — axis label on the radar chart
  and in reports.
- `axes[].description` (string, required) — non-empty. Drives the
  axis tooltips and the report card descriptions.
- `axes[].questions` (array, required, length ≥ 1) — ordered.
- `axes[].questions[].text` (string, required) — non-empty question
  wording.
- `axes[].questions[].reverse` (boolean, required) — `true` if a
  higher answer indicates a *worse* state. The field is required
  (not optional with a default) so the author has to make an
  explicit choice per question.

### Validation

The loader validates each file before insert. Any of these reject
the file with a clear error to stderr and abort that file's import
(other files continue):

- JSON parse error.
- Missing or empty `id`, `name`, `version`, or `axes`.
- Duplicate `id` across files in `templates/`.
- Any axis with missing fields or zero questions.
- Any question with missing `text` or non-boolean `reverse`.

If a file's `id` already exists as a template row in the DB, the
loader logs `template already imported, skipping` at info level and
moves on. This is the import-once contract.

## Loader behavior

### Where it runs

A new module `lib/templateLoader.js` exporting one function:

```js
function loadTemplatesFromDisk(db, templatesDir) { ... }
```

Called from `server.js` once, after `initSchema()` and
`seedQuestionBank()`, before mounting routes. `templatesDir`
defaults to `path.join(__dirname, "templates")`; tests can pass a
fixture directory.

### Insert path

For each accepted file, inside a transaction:

```
INSERT INTO templates (id, name, version, is_active, created_at)
                       VALUES (?, ?, ?, 1, ?)

INSERT INTO axes (id, template_id, name, description, display_order)
                  VALUES (?, ?, ?, ?, ?)        -- one per axis

INSERT INTO questions (id, template_id, axis_id, text,
                       is_reverse_scored, display_order)
                       VALUES (?, ?, ?, ?, ?, ?) -- one per question
```

The template's `id` is the kebab-case string from the file. Axis
and question `id`s are generated UUIDs (the existing `newId()`
helper in `lib/db.js`) — they don't appear in the file because
nothing external needs to reference them. `display_order` is the
array index in the file. `created_at` is `nowIso()`.

### Failure modes

- **Bad JSON in a file:** log the filename + parse error, skip that
  file. Server boot still succeeds; other templates load.
- **Validation failure:** log the filename + the specific field at
  fault, skip that file. Server boot still succeeds.
- **DB insert error:** the transaction rolls back; log and skip.
  Server boot still succeeds.
- **`templates/` directory missing:** treat as empty. No error.
  This matters for fresh checkouts and for environments that don't
  ship any file-based templates yet.

The principle: a broken template file must never prevent the server
from starting.

## The first template: Scrum Health Survey

File: `templates/scrum-health-survey-v1.json`.

Contents:

- `id`: `"scrum-health-survey-v1"`
- `name`: `"Scrum Health Survey"`
- `version`: `1`
- 6 axes, in the order they appear in `docs/new-survey.md`:
  Sprint Goal & Planning, Daily Scrum & Flow, Review & Stakeholders,
  Retrospective & Improvement, Backlog & Product Ownership,
  Increment & Definition of Done.
- 4 questions per axis. The first three are the ones already in
  `docs/new-survey.md`. The 4th is newly authored during
  implementation in the same positively-worded register, so each
  axis has the same density as the existing Agile Health Check
  template (which is also 4 per axis).
- All `reverse: false`.
- Axis descriptions: newly authored during implementation — short
  (≤ ~80 chars) and consistent in tone with the existing template's
  axis descriptions.

The `0.0` placeholders in `docs/new-survey.md` are not template
fields; they're result placeholders and have no equivalent in the
schema. They are dropped.

`docs/new-survey.md` becomes redundant once the JSON file lands.
It's left in place for now as a human-readable draft reference but
can be deleted in a later cleanup.

## Grouping UI

### Builder baseline selector

File: `public/js/survey.js`, function `refreshBaselines()` at
lines 77-92.

Today the function maps every survey for the chosen team into a
flat list of `<option>` elements. Change it to group those options
under one `<optgroup label="<template name> (v<version>)">` per
template. Sort optgroups alphabetically by template name; sort
options within each optgroup by `openedAt` descending (newest
first).

Option label drops the template name (now redundant with the
optgroup header) and keeps the date and response count:

```html
<optgroup label="Agile Health Check (v1)">
  <option value="...">opened 2026-04-14 (10 responses)</option>
  <option value="...">opened 2026-03-10 (12 responses)</option>
</optgroup>
<optgroup label="Scrum Health Survey (v1)">
  <option value="...">opened 2026-04-21 (8 responses)</option>
</optgroup>
```

The empty-state option (`No earlier surveys for this team`) stays
flat — no optgroup — since there's nothing to group.

`GET /api/templates` is not needed here; every survey row already
carries its `templateName`, and the version isn't currently exposed
on the survey row. To render `(v<version>)` in the optgroup label
we add `templateVersion` to the `surveySummary()` projection in
`lib/surveyRoutes.js:29-45`. That's the only API-shape change in
this work.

### Dashboard list

File: `public/js/dashboard.js`.

Today the dashboard renders one flat row per survey. Change to a
nested tree:

```
Team Alpha
  Agile Health Check (v1)
    ● Baseline · opened 2026-03-10 · 12 responses        [+2 follow-ups]
       └ Follow-up · opened 2026-04-14 · 10 responses
       └ Follow-up · opened 2026-05-12 · 11 responses
  Scrum Health Survey (v1)
    ● Baseline · opened 2026-04-21 · 8 responses
```

Tree-building (client-side, from the existing `surveys` array):

1. Group by `teamId`. Sort teams alphabetically by `teamName`.
2. Within a team, group by `templateId`. Sort alphabetically by
   `templateName`.
3. Within a template-group, partition into baselines
   (`parentSurveyId === null`) and follow-ups (everything else).
4. Sort baselines by `openedAt` descending (most recent baseline
   first).
5. Under each baseline, list its follow-ups (those whose
   `parentSurveyId === baseline.id`) by `openedAt` ascending
   (chronological progress).
6. Any follow-up whose `parentSurveyId` doesn't match a baseline in
   the current list goes into a synthetic "Orphaned follow-ups"
   group at the bottom of its team. This can happen because
   `parent_survey_id` has no `ON DELETE` action — a deleted
   baseline leaves its follow-ups dangling. Rendering them keeps
   them visible and reachable.

Visual treatment:

- Team and template names render as small section headers (reuse
  existing dashboard heading styles — no new colour tokens).
- Each baseline row keeps the existing survey-row appearance.
- Each follow-up row is indented (~24 px) and gets a 2-px left
  border in the muted theme colour, so the chain is visually
  obvious.
- A small chip on the baseline row shows the follow-up count
  (`+0 follow-ups` is suppressed; `+1 follow-up` is shown).
- All rows remain individually clickable to the same survey detail
  pages they link to today; no link targets change.

### What does *not* change

- The API contract for creating a follow-up
  (`POST /api/surveys` with `parentSurveyId`) — `lib/surveyRoutes.js:179-229`
  already enforces team+template inheritance, so the UI rework is
  purely visual.
- The radar chart, report rendering, response submission, and
  scoring code paths.

## Testing

Unit tests (`tests/` directory, `node --test`):

- `templateLoader` happy path: load a fixture with one valid
  template, assert the DB has the row, axes, and questions.
- `templateLoader` idempotency: load the same fixture twice, assert
  no duplicate rows.
- `templateLoader` validation: a file with no `id`, a file with an
  empty `axes` array, a file with a question missing `reverse` —
  each should be skipped without aborting the loader.
- `templateLoader` malformed JSON: skipped, loader continues.
- `templateLoader` empty/missing directory: no-op, no error.

End-to-end (`tests/` Playwright):

- After boot with the Scrum Health Survey file present, the builder
  template dropdown shows both "Agile Health Check (v1)" and
  "Scrum Health Survey (v1)".
- Creating a survey under each template, then opening the builder
  again with that team selected, shows the baseline selector with
  two optgroups.
- Dashboard with two baselines for one team (one per template) and
  one follow-up against the older baseline renders the nested shape
  described above (baseline rows + indented follow-up + count
  chip).

## Risks and mitigations

- **A bad file silently breaks boot.** Mitigated by per-file
  try/catch in the loader; a broken file is logged and skipped.
- **An author re-imports under a colliding `id`.** The DB primary
  key would reject the second insert; the loader catches that and
  treats it as "already imported, skipping." Safe.
- **The hardcoded seed and the file-based loader disagree on which
  template is "active."** The DB schema already has multiple
  active templates as a supported state (the builder lists all
  active templates). No new conflict.
- **Existing prod surveys reference the old "Agile Health Check"
  template by UUID.** Unchanged by this work — we deliberately don't
  migrate the seed. Files are additive only.
