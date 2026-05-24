# Signal Forest Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin Signal to the Forest accent (`#2E6F4E`) defined in `docs/forestbuild-spec.md`, then ship to production at https://sprintsignal.uk.

**Architecture:** Token-level swap in `public/css/theme-signal.css` (palette) plus component upgrades in `public/css/theme-core.css` (button shadow + hover-lift, accent-soft focus ring, list-row hover, success-green shift away from accent) plus consumer cleanup in `public/css/app.css`. Per the user's directive, Signal's CSS is now **independent** from the sister apps' CSS — `scripts/sync-theme.sh` will NOT be run as part of this work; the next Claude session will edit Scrum Poker / Retrospective directly.

**Tech Stack:** Vanilla CSS with custom properties, Node test runner for contrast validation, Apache + systemd `signal` service on IONOS for prod.

**Context files to read first:**
- `docs/forestbuild-spec.md` — the spec being implemented (§1 token target, §2 component target, §4.2 Signal-specific, §5 verification)
- `public/css/theme-signal.css` — current palette overlay + Signal-specific layouts (`.sky-hero`, `.postcard-tile`, `.question-postcard`, `.axis-glyph-*`)
- `public/css/theme-core.css` — defaults + components (`.btn`, `.btn-primary`, `.field`, `.card`, `.pill`, etc.)
- `public/css/app.css` — Signal-only layouts (`.scale-option`, `.survey-row`, `.focus-card`, `.pill-open/.pill-closed` — last two are dead per memory)
- `tests/theme-contrast.test.js` — palette-pair AA harness

---

## Task 1: Update theme-contrast test fixture to spec palette

**Files:**
- Modify: `tests/theme-contrast.test.js`

This test pins palette values and asserts each pair clears WCAG AA. We update the fixture first (TDD-ish: the test fixture is the contract) and run it to confirm spec values still pass before touching CSS.

- [ ] **Step 1: Replace the SIGNAL fixture block**

Replace lines 12–24 (the `const SIGNAL = { … }` and `const BODY_PAIRS = [ … ]` blocks) with:

```js
const SIGNAL = {
  bg:           "#FDF8EB",
  "bg-warm":    "#F4ECE0",
  surface:      "#FFFFFF",
  ink:          "#2A2118",
  muted:        "#876641",
  faint:        "#B0916B",
  accent:       "#2E6F4E",
  "accent-on":  "#FFFFFF",
  "accent-soft":"#DEEBE2",
  "accent-deep":"#245C40",
  ok:    "#1E5A3A",
  "ok-bg":"#D7E8DC",
  err:   "#B4232A"
};

const BODY_PAIRS = [
  ["ink",         "bg"],
  ["ink",         "surface"],
  ["ink",         "bg-warm"],
  ["muted",       "bg"],
  ["muted",       "surface"],
  ["accent-on",   "accent"],
  ["accent-deep", "accent-soft"],
  ["ok",          "ok-bg"],
  ["err",         "bg"]
];
```

Rationale for the pairs: dropped `bg-sky`/`accent-2`/`accent-3` (Signal no longer exposes those tokens). Added the canonical accent-deep/accent-soft pair (per spec §1.2 ≥4.5:1 claim) and the new ok/ok-bg pair (per spec §1.3 ≥4.5:1 claim).

- [ ] **Step 2: Run the contrast suite**

Run: `npm test -- --test-name-pattern='signal contrast'`
Expected: all `signal contrast: <fg> on <bg> meets AA body text` tests pass. If any fail, the spec's claimed contrast ratio is wrong — STOP and flag to the user; do NOT proceed to CSS edits.

- [ ] **Step 3: Commit**

```bash
git add tests/theme-contrast.test.js
git commit -m "test: update theme-contrast fixture to forest palette per spec §1"
```

---

## Task 2: Re-skin theme-signal.css to forest palette

**Files:**
- Modify: `public/css/theme-signal.css` (full file — palette block + Signal-specific component rules)

This is the big visual swap. We swap the palette tokens, add the missing canonical tokens, then repoint every Signal-specific rule that referenced `--accent-2` (peach) or `--bg-sky` (sky) to the new forest tokens. After this task no Signal CSS should reference `--bg-sky`, `--accent-2`, or `--accent-3`.

- [ ] **Step 1: Replace the `:root` palette block (lines 7–22)**

```css
:root {
  /* --- Palette overrides — forest accent per forestbuild-spec.md §1 + §4.2 - */
  --bg:          #FDF8EB;
  --bg-warm:     #F4ECE0;
  --surface:     #FFFFFF;
  --border:      #E8D9C0;
  --border-st:   #C9B27A;
  --ink:         #2A2118;
  --muted:       #876641;
  --faint:       #B0916B;
  --accent:      #2E6F4E;
  --accent-on:   #FFFFFF;
  --accent-soft: #DEEBE2;
  --accent-deep: #245C40;
  /* Status overrides — pull --ok off the accent so green button vs.
     green badge stay visibly distinct (spec §1.3). */
  --ok:    #1E5A3A;
  --ok-bg: #D7E8DC;
}
```

Notes:
- `--bg-sky`, `--accent-2`, `--accent-3` are intentionally removed. Any consumer that referenced them is rewritten in Step 2.
- `--surface` was previously `#FDF8EB` (cream); spec wants `#FFFFFF`. This makes cards visibly lift off the cream page background — that is the intended look per spec §1.1.
- `--ok`/`--ok-bg` are also overridden in theme-core.css (Task 4). Defining them here too is harmless duplication and keeps theme-signal self-describing.

- [ ] **Step 2: Rewrite the Signal-specific component rules (lines 24–109)**

Replace the entire block from `/* Hero — sky-peach dusk gradient …` through the end of the file with:

```css
/* Hero — forest panel used on /index and respond/landing sign-in.
   Was a sky→peach dusk gradient; now a solid forest field so the
   white card inside reads cleanly and the accent green carries the
   identity. */
.sky-hero {
  background: var(--accent);
  color: var(--accent-on);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--s-6);
  position: relative;
  overflow: hidden;
}
.sky-hero .sky-stars {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1.5px);
  background-size: 80px 90px;
  background-position: 12px 24px;
  opacity: 0.18;
}
.sky-hero .card {
  background: var(--surface);
  color: var(--ink);
  position: relative;
  z-index: 1;
  width: min(440px, 100%);
}
.sky-hero > .brand { color: var(--accent-on); }

/* Postcard tile — used on dashboard.html survey list */
.postcard-tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--s-4);
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: var(--s-4);
  align-items: center;
  text-decoration: none;
  color: inherit;
  box-shadow: var(--shadow-sm);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}
.postcard-tile + .postcard-tile { margin-top: var(--s-2); }
.postcard-tile:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-md);
}
.postcard-tile .glyph {
  width: 40px; height: 40px;
  color: var(--accent);
}
.postcard-tile .pt-team   { font-weight: 600; }
.postcard-tile .pt-meta   { font-size: 0.85rem; color: var(--muted); margin-top: 2px; }

/* Per-question postcard — used on respond.html */
.question-postcard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--s-6);
  position: relative;
}
.question-postcard::after {
  /* stamp in the top-right corner — forest tint, dashed cream cut */
  content: "";
  position: absolute;
  top: var(--s-3); right: var(--s-3);
  width: 28px; height: 36px;
  background: var(--accent-soft);
  border: 1.5px dashed var(--surface);
  border-radius: 2px;
}

/* Axis-condition glyphs in the report — used on survey.html.
   With no peach in the palette, the sun glyph now reads as a warm
   muted tone; wind reads as a soft accent-tinted breeze. */
.axis-glyph {
  width: 22px; height: 22px;
  vertical-align: middle;
  margin-right: var(--s-2);
}
.axis-glyph-sun   { color: var(--warn); }
.axis-glyph-cloud { color: var(--muted); }
.axis-glyph-rain  { color: var(--info); }
.axis-glyph-wind  { color: var(--accent-deep); }
```

Changes summary:
- `.sky-hero` → solid `--accent` background (forest), star opacity dropped to 0.18 so it doesn't dazzle on solid green. Star colour switched to pure white (was warm cream) to match new `--accent-on`.
- `.postcard-tile` border tightened to 1px per spec §2.5, hover state gains the canonical accent-soft halo.
- `.postcard-tile .glyph` color: peach → `--accent` (forest) — matches the "icon stroke `--accent`" rule in spec §2.5.
- `.question-postcard::after` stamp: peach → `--accent-soft` (tinted forest), still keeps the dashed cream cut so the stamp metaphor survives.
- `.axis-glyph-sun` was peach; reassigned to `--warn` (amber) so the "sun" still reads as warm without re-introducing peach.
- `.axis-glyph-wind` was `--accent-3` (light green); reassigned to `--accent-deep` so wind reads as a darker forest tint distinct from clouds (`--muted` warm brown).

- [ ] **Step 3: Sanity-grep — no remaining peach/sky references**

Run: `grep -nE '(bg-sky|accent-2|accent-3|BFD8EE|E8A47D|FFF8EE)' public/css/theme-signal.css`
Expected: no output.

If anything matches, fix it before committing.

---

## Task 3: Upgrade theme-core.css components to spec §2

**Files:**
- Modify: `public/css/theme-core.css`

Three changes: shift the shared `--ok`/`--ok-bg` defaults so the success colour stays visibly distinct from forest, rebuild `.btn-primary` and the focus styles per spec §2.1 / §2.4, and add the list-row / card hover state per §2.5.

- [ ] **Step 1: Update status tokens in `:root` (lines 59 + 63)**

Change:
```css
  --ok:    #2A5A2A;
```
to:
```css
  --ok:    #1E5A3A;
```

Change:
```css
  --ok-bg:   #DCE9DA;
```
to:
```css
  --ok-bg:   #D7E8DC;
```

- [ ] **Step 2: Rewrite the `.btn` / `.btn-primary` / focus rules (lines 149–205)**

Replace the whole block from `/* --- Button --- */` through the closing `}` of the focus rule (line 205) with:

```css
/* --- Button --- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 9px 18px;
  min-height: 38px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--sans);
  font-weight: 700;
  font-size: 0.92rem;
  cursor: pointer;
  text-decoration: none;
  transition: transform 120ms ease, filter 120ms ease,
              box-shadow 120ms ease, border-color 120ms ease,
              background 120ms ease, color 120ms ease;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent-deep);
  transform: translateY(-1px);
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 1px 2px rgba(42, 31, 18, 0.12);
}
.btn-primary:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(42, 31, 18, 0.16);
}

.btn-ghost {
  border: 1.5px solid var(--accent);
  background: transparent;
  color: var(--accent);
}
.btn-ghost:hover {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-color: var(--accent);
}

.btn-danger { color: var(--err); border-color: var(--border-st); }
.btn-danger:hover { background: var(--err-bg); border-color: var(--err); color: var(--err); }

.btn-sm { padding: 5px 12px; min-height: 30px; font-size: 0.82rem; }
.btn-block { width: 100%; }

/* --- Field / input --- */
.field { display: block; margin-bottom: var(--s-4); }
.field > span {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: var(--s-1);
  color: var(--ink);
}
input[type="text"], input[type="email"], input[type="password"],
input[type="number"], select, textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
input::placeholder, textarea::placeholder { color: var(--faint); }

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
button:focus-visible, a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent);
}
```

Changes summary:
- `.btn` border tightened to 1px per spec, gains `min-height: 38px` per spec §6 hit-target rule, picks up the additional transition properties listed in spec §3.
- `.btn` hover restyled away from "swap background to bg-warm" toward "outline the button in accent" — matches the spec §2.2 secondary-button hover.
- `.btn-primary` gains the canonical 1px / 2px shadow at rest and the brightness-1.08 + translateY + 4px shadow on hover (spec §2.1).
- `.btn-ghost` upgraded to the spec §2.3 transparent-with-accent-border treatment.
- Inputs/buttons split for focus: inputs get the single accent-soft halo + accent border (spec §2.4); buttons + links get the double-ring focus (spec §2.1).
- Placeholder colour explicit per spec §2.4.

- [ ] **Step 3: Add list-row hover state (after `.card + .card` rule, around line 146)**

After:
```css
.card + .card { margin-top: var(--s-4); }
```

Insert:
```css
.card {
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}
.card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-md);
}
```

This applies the spec §2.5 hover halo to every `.card` (which is the default list-row / panel in both apps).

- [ ] **Step 4: Update reduced-motion block (lines 356–364)**

Append `.btn-primary:hover { filter: none; transform: none; }` to the existing reduced-motion block so the new primary-button hover lift / brightness shift also opt out. The block becomes:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .btn:hover, .btn-primary:hover { transform: none; filter: none; }
  .card:hover, .postcard-tile:hover { transform: none; }
}
```

- [ ] **Step 5: Sanity-grep — no remaining legacy default palette literals**

Run: `grep -nE '(6B4FE8|F5D87E|FFCFB0|8E6E4A)' public/css/theme-core.css`
Expected: matches only in the `:root` defaults (lines ~76–81). These defaults are the fallback palette when no overlay loads; the per-app override in theme-signal.css covers Signal. Leave them.

If matches appear OUTSIDE `:root`, replace with the appropriate `var(--…)`.

---

## Task 4: Clean up app.css legacy consumers

**Files:**
- Modify: `public/css/app.css`

Two consumers reference `--accent-3` (which no longer exists in Signal after Task 2). Also clean up `.pill-open` / `.pill-closed` which the memory says are dead code.

- [ ] **Step 1: Verify .pill-open and .pill-closed are dead**

Run: `grep -rn --include='*.html' --include='*.js' -E '(pill-open|pill-closed)' public/ lib/ server.js 2>/dev/null`
Expected: no matches outside `public/css/app.css` itself.

If matches appear, leave those rules alone and only fix the `--accent-3` consumer in Step 2.

- [ ] **Step 2: Repoint .scale-option.selected**

In `public/css/app.css`, change:
```css
.scale-option.selected { border-color: var(--accent); background: var(--accent-3); }
```
to:
```css
.scale-option.selected { border-color: var(--accent); background: var(--accent-soft); }
```

- [ ] **Step 3: Remove dead pill rules (only if Step 1 confirmed they're unused)**

Delete lines 40–42:
```css
/* --- Signal-specific pill variants -------------------------------------- */
.pill-open   { background: var(--accent-3); color: var(--ok); }
.pill-closed { background: var(--bg-warm);  color: var(--muted); }
```

- [ ] **Step 4: Sanity-grep — no remaining legacy literals or accent-3 refs in app.css**

Run: `grep -nE '(accent-2|accent-3|bg-sky|1F2C4C|E8A47D|BFD8EE|FFF8EE|466091|8AA3C8|E0CFB8|B89A78)' public/css/app.css`
Expected: no output.

- [ ] **Step 5: Commit the CSS work (Tasks 2-4 as one logical commit)**

```bash
git add public/css/theme-signal.css public/css/theme-core.css public/css/app.css
git commit -m "Signal: re-skin to forest accent per forestbuild-spec.md

- theme-signal.css: swap palette to forest (--accent #2E6F4E,
  --ink #2A2118, --muted #876641, --accent-on #FFFFFF), add
  --accent-soft / --accent-deep, drop unused --bg-sky / --accent-2 /
  --accent-3, repoint .sky-hero / .postcard-tile / .question-postcard
  / .axis-glyph-sun-wind off the peach/sky tokens.
- theme-core.css: shift --ok / --ok-bg so success green stays visibly
  distinct from the forest accent; rebuild .btn-primary shadow +
  hover-lift per spec §2.1, split input vs button focus rings per
  §2.1 / §2.4, add .card hover halo per §2.5; add new hover
  transforms to reduced-motion opt-out.
- app.css: repoint .scale-option.selected to --accent-soft, remove
  dead .pill-open / .pill-closed (flagged in theme-core memory)."
```

---

## Task 5: Run spec §5 verification locally

**Files:**
- (None — read-only verification)

Run the full spec §5 checklist before pushing. Do NOT push if anything fails.

- [ ] **Step 1: Re-run the contrast test**

Run: `npm test -- --test-name-pattern='signal contrast'`
Expected: all pass.

- [ ] **Step 2: Restart the dev server**

Per the `dev-server-watch-stale` memory, `--watch` misses server-side edits on this WSL2 host. CSS changes ARE picked up by browser hard-refresh, but kill + restart to be safe:

```bash
pkill -f 'node.*server.js' 2>/dev/null; sleep 1; npm run dev &
```

Wait ~3 seconds, then confirm with: `curl -sI http://127.0.0.1:3002/ | head -1 ; echo`
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 3: Manual visual sweep**

Open these URLs and confirm forest reskin landed cleanly. Each one is a different layout that exercises different tokens — don't skip any:

| URL | What to check |
|---|---|
| http://localhost:3002/ | `.sky-hero` is solid forest, white card inside is readable, "Sign in" button is solid forest with white text, hover lifts ~1px |
| http://localhost:3002/dashboard | `.postcard-tile` rows show forest icon-chip glyph; hover shows accent-soft halo + border becomes accent |
| http://localhost:3002/respond/<any-token> | `.question-postcard` has accent-soft stamp top-right (no peach); scale options selected state shows accent-soft fill, accent border |
| http://localhost:3002/survey/<any-id> | Axis glyphs render: sun=amber, cloud=muted brown, rain=blue, wind=deep forest; radar chart legend "Now" swatch is forest |
| http://localhost:3002/account | `.btn-primary` shadow looks tight at rest, lifts + brightens on hover; secondary buttons get accent border on hover |

If a page won't load or a route 404s, you may not have seed data — note it as "skipped, no data" rather than a failure. The first two URLs are the must-haves.

- [ ] **Step 4: Browser-console token audit (per spec §5.2)**

In the browser devtools console on any page, paste:
```js
const r = getComputedStyle(document.documentElement);
['--accent','--accent-on','--accent-soft','--accent-deep','--ok','--ok-bg','--bg-warm','--ink']
  .forEach(k => console.log(k, r.getPropertyValue(k).trim()));
```
Expected output:
```
--accent #2E6F4E
--accent-on #FFFFFF
--accent-soft #DEEBE2
--accent-deep #245C40
--ok #1E5A3A
--ok-bg #D7E8DC
--bg-warm #F4ECE0
--ink #2A2118
```

- [ ] **Step 5: Repo-wide literal grep (per spec §5.3)**

Run:
```bash
grep -rnE '(1F2C4C|E8A47D|BFD8EE|FFF8EE|466091|8AA3C8|E0CFB8|B89A78|2A5A2A)' \
  --include='*.css' --include='*.html' --include='*.js' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=test-results . 2>/dev/null
```
Expected: only the test fixture (which is now a HISTORICAL list — wait, no, we updated it. Expected: NO matches.).

If anything matches, fix it before pushing.

- [ ] **Step 6: Accent-vs-success distinctness (per spec §5.5)**

On `/dashboard`, find a closed/connected status pill and a primary button in the same viewport. Confirm they read as two different greens (forest = primary button, deeper pine = success). If they look the same, the `--ok` swap didn't land — recheck Task 3 Step 1.

- [ ] **Step 7: Keyboard focus sweep (per spec §5.6)**

On `/`, press Tab repeatedly. Every interactive element (email input, password input, sign-in button, any nav link) must show a visible focus ring (3px accent-soft halo, plus 1px accent line on buttons). Nothing should be `outline: none` without a `box-shadow` replacement.

- [ ] **Step 8: Reduced-motion check (per spec §5.7)**

Toggle the OS "reduce motion" setting (or in Chrome devtools: cmd-shift-P → "Emulate CSS prefers-reduced-motion: reduce"). Hover the primary button — the lift / brightness should disappear. Hover a card — no lift.

- [ ] **Step 9: Record results in this plan file**

Replace each `- [ ]` checkbox above with `- [x]` once that step is confirmed. If anything failed, write a `BLOCKER:` note under the failing step and STOP — do not proceed to Task 6.

---

## Task 6: Ship Signal to production

**Files:**
- (None — git operations)

- [ ] **Step 1: Push to GitHub**

Confirm we're on `main`, clean except for the new plan file and any uncommitted handover work, then push:

```bash
git status
git log --oneline origin/main..HEAD
git push origin main
```

Expected: the test fixture commit and the CSS reskin commit both appear in the log; push reports both pushed cleanly.

- [ ] **Step 2: Print the SSH deploy instruction for the user**

Output to the user (verbatim — they will paste this into their IONOS SSH session):

```
On the IONOS box:
  cd /var/www/signal && git pull && sudo systemctl restart signal
```

Note: a restart clears in-memory sessions (admins will need to re-log-in). Per the production-deployment memory.

- [ ] **Step 3: Wait for user confirmation that prod is live**

Ask: "Has https://sprintsignal.uk picked up the forest reskin? Once you confirm I'll write the handover.md for the next app."

Do NOT proceed to Task 7 until the user confirms live success. If they report a problem, debug from prod-side symptoms (curl headers, journalctl, etc.) rather than re-pushing blind.

---

## Task 7: Write handover.md for the next app

**Files:**
- Create: `/var/www/<NEXT_APP>/handover.md` (NEXT_APP = `retrospective` or `scrumpoker`, ask the user)

The handover briefs a fresh Claude session in the next repo: what's already done in Signal, where the spec lives, and the per-app §4 section they should follow.

- [ ] **Step 1: Ask the user which app comes next**

Per spec §4 the recommended build order was Retrospective → Signal → Scrum Poker, but we've already done Signal. So the next app is either:
- **Retrospective** (`/var/www/retrospective`) — the spec's "do FIRST" because of the gradient button + bg-warm accessibility fix; biggest diff.
- **Scrum Poker** (`/var/www/scrumpoker`) — the spec's "closest to target", smallest diff.

Use `AskUserQuestion` to ask which one. Default recommendation: **Retrospective** so we tackle the harder migration while the spec is still fresh.

- [ ] **Step 2: Write `/var/www/<NEXT_APP>/handover.md`**

Use this template (substitute `<NEXT_APP>` and the matching spec §4 reference):

```markdown
# Forest reskin handover — <NEXT_APP_TITLE>

This repo is **next** in the Forest accent rollout. Signal (this initiative's
first app) is done and live at https://sprintsignal.uk as of 2026-05-24.

## Read first

- **Spec:** `/var/www/signal/docs/forestbuild-spec.md` — the build spec for
  all three apps. Read sections §1 (tokens), §2 (components), §3 (motion),
  §4.<N> (this app's per-app changes), §5 (verification), §6 (a11y), §8
  (definition of done).
- **Signal's executed plan:** `/var/www/signal/docs/superpowers/plans/2026-05-24-signal-forest-reskin.md`
  — concrete file-by-file diffs that landed in Signal. Useful as a template
  for the equivalent work here, but note the file layouts differ.

## Decisions already made (do not re-litigate)

1. **Each app's CSS is independent now.** Do NOT run any cross-app sync
   script. Edit this repo's own `theme-<app>.css` / `theme-core.css` /
   `app.css` directly. (User directive 2026-05-24: "I'd rather they carry
   independent CSS for every app. This way I can change specific apps
   independently of the others.")
2. **Full forest reskin** — strip any decorative palette tokens (peach,
   sky, violet, etc.) that the spec doesn't include. Don't preserve the
   old identity colours for nostalgia.
3. **Scope = tokens + spec §2 component upgrades** — not just the §4
   token swap. That means `.btn-primary` shadow + hover-lift, focus rings
   per §2.1 / §2.4, list-row hover halo per §2.5, success-green shift
   per §1.3.

## Shape of the work (template — adapt to this repo's actual files)

1. Update the contrast-test fixture (if this repo has one) to the new spec
   palette and confirm it still passes AA before touching CSS.
2. Swap palette tokens in `theme-<app>.css` per spec §4.<N>, add
   `--accent-soft #DEEBE2` and `--accent-deep #245C40`, repoint any rules
   that referenced removed tokens.
3. Apply the spec §2 component upgrades wherever this repo defines
   `.btn-primary`, inputs, focus styles, and list rows / cards.
4. Grep for the legacy literals listed in spec §5.3 plus any this app's
   palette specifically introduced (e.g. Retrospective: `C8252A`, `5B35D5`,
   `6845df`, `91, 53, 213`; Scrum Poker: `6B4FE8`, `F5D87E`, `FFCFB0`).
5. Run the full spec §5 verification locally.
6. Ship per this repo's existing deploy flow.

## When done

Delete this handover.md before merging — it's a session-bootstrap note, not
durable docs. Then create the equivalent handover.md in the third app's
repo for the final session.
```

- [ ] **Step 3: Confirm with the user**

Tell the user the handover is in place and remind them to start a fresh
Claude session in `/var/www/<NEXT_APP>` for the next leg.

---

## Self-review checklist

- [x] Spec §1 token target → covered in Task 2 Step 1 + Task 3 Step 1.
- [x] Spec §2.1 primary button → Task 3 Step 2.
- [x] Spec §2.2 secondary button → Task 3 Step 2 (`.btn:hover` redesign).
- [x] Spec §2.3 ghost button → Task 3 Step 2 (`.btn-ghost` upgrade).
- [x] Spec §2.4 inputs → Task 3 Step 2 (placeholder colour + accent-soft focus halo).
- [x] Spec §2.5 list row / card → Task 3 Step 3 (`.card:hover`) + Task 2 Step 2 (`.postcard-tile:hover`).
- [x] Spec §2.6 status pills — already implemented in theme-core via `.tag-ok`/`.tag-warn`/etc; new `--ok`/`--ok-bg` values flow through automatically (Task 3 Step 1).
- [x] Spec §3 motion + reduced-motion → Task 3 Step 4.
- [x] Spec §4.2 Signal-specific token swap → Task 2 Step 1.
- [x] Spec §5 verification → Task 5.
- [x] Spec §6 a11y → covered (min-height 38px on buttons, focus rings, AA test).
- [x] Spec §8 definition of done — every box maps to one of the tasks above.

No placeholders. Type/property names consistent across tasks (`--accent-soft` not `--accent-tint`; `.btn-primary` not `.primary-btn`).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-24-signal-forest-reskin.md`. Recommended execution:

**Inline Execution (recommended for this scope)** — Five logical commits across CSS files, no parallelisable independent work, and Task 6 + 7 need real-time user interaction (SSH handoff, next-app pick). Subagent-driven would add round-trip overhead with no benefit here.

Awaiting user go-ahead before starting Task 2.
