# Theme Rollout — Scrum Poker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the shared `theme-core` design system (built in `/var/www/signal`) to `/var/www/scrumpoker` with its own "Sticker Album" palette and a sticker-place animation on the estimation reveal.

**Architecture:** Pull `theme-core.css`, `theme-illos.svg`, and the three woff2 fonts from the canonical Signal source via `scripts/sync-theme.sh`. Add a `public/css/theme-poker.css` palette overlay (Sticker-Cream colours + sticker grid layout). Slim the existing `app.css` to keep only Scrum Poker–specific layouts (planning room, vote cards, preview). Migrate all four HTML pages to the new stylesheet chain and add the Sticker Album hero on `index.html`.

**Tech Stack:** Same as Plan 1. Vanilla CSS, plain SVG, Express static serving, Playwright + `node:test`.

**Prereq:** Plan 1 (`2026-05-23-theme-core-and-signal-pilot.md`) is complete in `/var/www/signal` and the canonical assets exist there.

**Reference spec:** `docs/superpowers/specs/2026-05-23-shared-playful-pastel-theme-design.md` (lives in the Signal repo; consult §3, §4.2, §5 "Scrum Poker").

> **All paths below are relative to `/var/www/scrumpoker`.** Run commands from that directory.

---

### Task 1: Add the sync script and manifest

**Files:**
- Create: `scripts/sync-theme.sh`
- Create: `scripts/theme-manifest.txt`

- [ ] **Step 1: Create scripts dir if needed**

```bash
cd /var/www/scrumpoker
mkdir -p scripts
```

- [ ] **Step 2: Copy the sync script verbatim from Signal**

```bash
cp /var/www/signal/scripts/sync-theme.sh scripts/sync-theme.sh
chmod +x scripts/sync-theme.sh
```

- [ ] **Step 3: Write the manifest**

```text
public/css/theme-core.css
public/illos/theme-illos.svg
public/fonts/Fraunces.woff2
public/fonts/Inter.woff2
public/fonts/JetBrainsMono.woff2
```

(Save as `scripts/theme-manifest.txt`.)

- [ ] **Step 4: Run the sync once**

```bash
./scripts/sync-theme.sh /var/www/signal
```

Expected output: five `synced ...` lines, ending with "Theme sync complete."

- [ ] **Step 5: Verify the files landed**

```bash
ls -la public/css/theme-core.css public/illos/theme-illos.svg public/fonts/
```

Expected: all five files present, fonts ~100-500 KB each.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-theme.sh scripts/theme-manifest.txt public/css/theme-core.css public/illos/theme-illos.svg public/fonts
git commit -m "Pull theme-core assets from Signal canonical source"
```

---

### Task 2: Update CSP to allow self-hosted fonts (verify only — should already work)

**Files:**
- Modify: `lib/httpApp.js` (only if a regression is found)

- [ ] **Step 1: Verify the current CSP allows the new font path**

```bash
grep -n "font-src\|style-src" lib/httpApp.js
```

Expected: `font-src 'self' data:` and `style-src 'self'`. Both rules already cover `/fonts/*.woff2` and `/css/*.css` served from the same origin — no change needed.

- [ ] **Step 2: Confirm by curling a font once the server is up (deferred to Task 4)**

No file changes in this task. No commit.

---

### Task 3: Write Scrum Poker palette tests

**Files:**
- Create: `tests/theme-contrast.test.js`
- Create: `lib/contrast.js` (copy from Signal)

- [ ] **Step 1: Copy the contrast helper from Signal**

```bash
cp /var/www/signal/lib/contrast.js lib/contrast.js
```

- [ ] **Step 2: Write the palette test**

```javascript
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

const POKER = {
  bg:        "#FDF8EB",
  "bg-warm": "#F4ECE0",
  surface:   "#FFFFFF",
  ink:       "#2A2118",
  muted:     "#8E6E4A",
  accent:    "#6B4FE8",
  "accent-on": "#FFFFFF",
  "accent-2": "#F5D87E",
  "sticker-yellow-ink": "#6B4D10",
  "accent-3": "#FFCFB0",
  "sticker-peach-ink":  "#8B3A1A"
};

const PAIRS = [
  ["ink",   "bg"],
  ["ink",   "bg-warm"],
  ["ink",   "surface"],
  ["muted", "bg"],
  ["accent-on", "accent"],
  ["sticker-yellow-ink", "accent-2"],
  ["sticker-peach-ink",  "accent-3"]
];

for (const [fg, bg] of PAIRS) {
  test(`scrumpoker contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(POKER[fg], POKER[bg]);
    assert.ok(
      meetsAA(POKER[fg], POKER[bg]),
      `${fg} (${POKER[fg]}) on ${bg} (${POKER[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}
```

- [ ] **Step 3: Run the test**

```bash
npm test -- --test-name-pattern "scrumpoker contrast"
```

Expected: PASS for all pairs. If any fail, adjust the offending hex in the spec + the upcoming `theme-poker.css` before continuing.

- [ ] **Step 4: Commit**

```bash
git add lib/contrast.js tests/theme-contrast.test.js
git commit -m "Add WCAG contrast tests for Scrum Poker palette"
```

---

### Task 4: Create `theme-poker.css` — palette overlay + Sticker Album layouts

**Files:**
- Create: `public/css/theme-poker.css`

- [ ] **Step 1: Write the file**

```css
/* public/css/theme-poker.css
 *
 * Scrum Poker's "Sticker Album" overlay. Loaded AFTER theme-core.css.
 */

:root {
  /* --- Palette overrides — see spec §4.2 ---------------------------- */
  --bg:        #FDF8EB;
  --bg-warm:   #F4ECE0;
  --surface:   #FFFFFF;
  --border:    #E8D9C0;
  --border-st: #C9B27A;
  --ink:       #2A2118;
  --muted:     #8E6E4A;
  --faint:     #B0916B;
  --accent:    #6B4FE8;
  --accent-on: #FFFFFF;
  --accent-2:  #F5D87E;   /* hero sticker yellow */
  --accent-3:  #FFCFB0;   /* secondary sticker peach */

  /* Sticker-specific tokens (used by .vote-card and .sticker-grid) */
  --sticker-yellow-ink: #6B4D10;
  --sticker-peach-ink:  #8B3A1A;
}

/* Album hero — the sunny open-book scene used on index.html */
.album-hero {
  background:
    radial-gradient(ellipse at 20% 10%, rgba(245,216,126,0.4), transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(255,207,176,0.4), transparent 55%),
    var(--bg-warm);
  min-height: 100vh;
  padding: var(--s-6);
}

/* Vote card — restyled to look like a sticker */
.vote-sticker {
  aspect-ratio: 1;
  background: var(--accent-2);
  color: var(--sticker-yellow-ink);
  border-radius: var(--r-xl);
  border: 3px dashed var(--surface);
  font-family: var(--serif);
  font-weight: 700;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    0 3px 0 rgba(184, 145, 26, 0.4),
    0 8px 18px rgba(0,0,0,0.06);
  transition: transform 120ms ease;
}
.vote-sticker:hover  { transform: translateY(-2px) rotate(-2deg); }
.vote-sticker.picked {
  background: var(--accent-3);
  color: var(--sticker-peach-ink);
  transform: scale(1.06) rotate(2deg);
}
.vote-sticker.placed { animation: sticker-place 240ms cubic-bezier(.34,1.56,.64,1) both; }

/* Sticker grid — flexible row of value stickers */
.sticker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: var(--s-3);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-poker.css
git commit -m "Add Scrum Poker palette overlay + Sticker Album layouts"
```

---

### Task 5: Migrate `index.html` to new stylesheets + hero scene

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Swap stylesheet links**

Find:

```html
    <link rel="stylesheet" href="css/app.css">
```

Replace with:

```html
    <link rel="stylesheet" href="css/theme-core.css">
    <link rel="stylesheet" href="css/theme-poker.css">
    <link rel="stylesheet" href="css/app.css">
```

- [ ] **Step 2: Replace the `body` shell with the album hero**

Find:

```html
<body class="app-page">
```

Replace with:

```html
<body class="album-hero">
```

- [ ] **Step 3: Update the entry-kicker line to include the brand glyph**

`.brand` from `theme-core.css` is already `display: inline-flex`, so wrapping a span in it composes cleanly. Find:

```html
            <span class="entry-kicker">Planning room</span>
```

Replace with:

```html
            <span class="brand">
              <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#sticker-circle"/></svg>
              <span class="entry-kicker">Planning room</span>
            </span>
```

- [ ] **Step 4: Smoke-test**

```bash
npm start &
sleep 2
curl -sS -I http://localhost:3000/ | head -1
curl -sS http://localhost:3000/ | grep -q theme-core.css && echo "css linked OK"
curl -sS -I http://localhost:3000/fonts/Inter.woff2 | head -1
curl -sS -I http://localhost:3000/illos/theme-illos.svg | head -1
kill %1
```

Expected: 200 OK for the page, "css linked OK", 200 OK for the font, 200 OK for the SVG.

- [ ] **Step 5: Run the smoke E2E**

```bash
npx playwright test tests/e2e/scrum-poker-smoke.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/css/theme-poker.css public/index.html
git commit -m "Scrum Poker: migrate index.html to theme-core + album hero"
```

---

### Task 6: Migrate `admin.html` and `license.html` to new stylesheets

**Files:**
- Modify: `public/admin.html`
- Modify: `public/license.html`

- [ ] **Step 1: Swap stylesheet links in both**

In each file, find:

```html
  <link rel="stylesheet" href="css/app.css">
```

Replace with:

```html
  <link rel="stylesheet" href="css/theme-core.css">
  <link rel="stylesheet" href="css/theme-poker.css">
  <link rel="stylesheet" href="css/app.css">
```

- [ ] **Step 2: Wherever admin/license uses a brand line, add the glyph**

Find any `<h1>Team access</h1>` or `<h1>License</h1>` block. If it sits next to a kicker that doesn't yet carry the brand mark, prepend:

```html
<span class="brand">
  <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#sticker-circle"/></svg>
  <span>Scrum Poker</span>
</span>
```

- [ ] **Step 3: Run admin E2E**

```bash
npx playwright test tests/e2e/admin-key-management.spec.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/admin.html public/license.html
git commit -m "Scrum Poker: migrate admin + license to theme-core"
```

---

### Task 7: Slim `app.css` — keep only Scrum-Poker-specific layouts

**Files:**
- Modify: `public/css/app.css`

- [ ] **Step 1: Identify what to keep**

Scrum Poker–specific (keep):

- `.app-page`, `.admin-page` (top-level body shells)
- `.entry-shell`, `.entry-card`, `.entry-preview`, `.entry-heading`, `.entry-kicker`, `.entry-form` (login layout)
- `.preview-header`, `.preview-stage`, `.preview-card*`, `.preview-votes`, `.status-pill` (preview pane)
- `.room-shell`, `.room-header`, `.room-heading`, `.room-display`, `.room-userbar`, `.room-actions`, `.user-greeting`, `.room-admin-link` (planning room)
- Any vote-list / participant-list / timer / connection-status classes specific to the room
- `.admin-header`, `.admin-heading` (admin page layout)
- `.connecting`, `.connection-status` (websocket status indicator)

Shared (drop — now provided by theme-core):

- `.field*`, `.primary-action`, `.form-error` — replaced by theme-core's `.field`, `.btn-primary`, `.notice-error`
- Any `.card`, `.btn*`, `.kicker`, `.tag*`, `.modal*`, `.topbar*`, `.notice*` defined here

- [ ] **Step 2: Map old token names to new ones**

Replace throughout `app.css`:

| Old                  | New           |
| -------------------- | ------------- |
| `--page`             | `--bg`        |
| `--surface`          | `--surface`   |
| `--surface-soft`     | `--bg-warm`   |
| `--line`             | `--border`    |
| `--line-strong`      | `--border-st` |
| `--ink`              | `--ink`       |
| `--muted`            | `--muted`     |
| `--primary`          | `--accent`    |
| `--primary-strong`   | `--accent` (drop the strong variant; let filter:brightness handle hover) |
| `--primary-soft`     | `--accent-3`  |
| `--green`/`--green-soft` | `--ok`/`--ok-bg` |
| `--red`/`--red-soft` | `--err`/`--err-bg` |
| `--blue`/`--blue-soft` | `--info`/`--info-bg` |
| `--radius`           | `--r-md`      |
| `--shadow-sm`        | `--shadow-sm` |
| `--shadow-md`        | `--shadow-md` |
| `--font`             | `--sans`      |

- [ ] **Step 3: Rewrite `app.css` with only the kept classes, using the new tokens**

Add a leading comment:

```css
/* public/css/app.css
 *
 * Scrum Poker-specific layouts only. Shared tokens, base, and components
 * live in theme-core.css; palette + sticker-album specifics live in
 * theme-poker.css.
 */
```

Then keep only the classes from Step 1, with tokens renamed per Step 2.

- [ ] **Step 4: Replace the deprecated `.primary-action` selector globally**

```bash
grep -rln "primary-action" public/
```

For every match (likely in `public/index.html` and `public/js/*.js` that creates the button programmatically), replace `class="primary-action"` with `class="btn btn-primary"`.

- [ ] **Step 5: Run the full suite**

```bash
npm test && npx playwright test
```

Expected: all PASS. Visual: load the home page and the planning room, confirm buttons look right (purple pill), inputs focus correctly, cards have the new card shape.

- [ ] **Step 6: Commit**

```bash
git add public/css/app.css public/index.html public/admin.html public/js
git commit -m "Scrum Poker: drop shared CSS from app.css; remap token names"
```

---

### Task 8: Restyle vote cards as stickers + sticker-place animation

**Files:**
- Modify: `public/js/cardDeck.js` (or wherever vote cards are rendered)
- Modify: `public/index.html` (vote area markup) if hand-coded

- [ ] **Step 1: Find where vote cards are rendered**

```bash
grep -n "vote-card\|preview-card\|vote\|card-deck" public/js/cardDeck.js public/js/app.js public/index.html | head -30
```

- [ ] **Step 2: Update the rendered class to `vote-sticker` and the container to `sticker-grid`**

In `cardDeck.js` (or the appropriate file), find the per-card markup. It will look something like:

```javascript
const card = document.createElement("button");
card.className = "vote-card";
card.textContent = value;
```

Update to:

```javascript
const card = document.createElement("button");
card.className = "vote-sticker";
card.textContent = value;
```

In the parent container that holds the deck, change `vote-deck` (or whatever) to add the `sticker-grid` class.

- [ ] **Step 3: Trigger the `placed` animation when a vote is cast**

In the click handler that sets the vote:

```javascript
voteButton.classList.add("placed");
voteButton.addEventListener("animationend", () => voteButton.classList.remove("placed"), { once: true });
```

- [ ] **Step 4: Run multi-user E2E**

```bash
npx playwright test tests/e2e/multi-user-room.spec.js
```

Expected: PASS. The test asserts that a vote is registered; the visual change does not affect the assertion.

- [ ] **Step 5: Commit**

```bash
git add public/js/cardDeck.js public/index.html
git commit -m "Scrum Poker: vote cards become stickers with sticker-place animation"
```

---

### Task 9: Reveal animation — when all players reveal, the stickers settle in unison

**Files:**
- Modify: `public/js/app.js` (or wherever the reveal action runs)
- Modify: `public/css/theme-poker.css` (append the reveal animation)

- [ ] **Step 1: Add the reveal keyframe to `theme-poker.css`**

Append:

```css
@keyframes sticker-reveal {
  0%   { opacity: 0; transform: translateY(6px) rotate(-2deg); }
  100% { opacity: 1; transform: translateY(0) rotate(0); }
}
.revealed-sticker { animation: sticker-reveal 280ms cubic-bezier(.34,1.56,.64,1) both; }
```

- [ ] **Step 2: Find the reveal handler in `app.js`**

```bash
grep -n "reveal\|revealVotes\|onReveal" public/js/app.js
```

- [ ] **Step 3: When rendering each revealed vote, add the `revealed-sticker` class**

Find the function that builds the per-player revealed vote markup. Add the class to the element it creates:

```javascript
const slot = document.createElement("div");
slot.className = "revealed-sticker vote-sticker";
slot.textContent = player.vote;
```

- [ ] **Step 4: Confirm reduced-motion is honoured**

Already handled by the global rule from Plan 1, Task 7. No extra work.

- [ ] **Step 5: Run the suite**

```bash
npm test && npx playwright test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add public/css/theme-poker.css public/js/app.js
git commit -m "Scrum Poker: sticker-reveal animation on vote disclosure"
```

---

### Task 10: Final visual verification + commit deploy notes

**Files:**
- Modify: `README.md` (one line)

- [ ] **Step 1: Run everything**

```bash
npm test && npx playwright test
```

Expected: all PASS.

- [ ] **Step 2: Visually verify in a browser**

```bash
npm start
```

Visit `http://localhost:3000/` and walk:

1. Home page shows the album-hero background with the sticker-circle brand glyph.
2. Enter access key → join a room → confirm the vote cards are sticker-shaped (dashed border, rounded corners, yellow fill).
3. Cast a vote → confirm the sticker-place bounce.
4. Have a second tab join the same room → reveal → confirm the sticker-reveal staggered animation.
5. Admin and license pages also load with the new chrome.

Confirm: no console errors, fonts load (Fraunces visible on h1), palette is correct, brand glyph appears in the brand mark.

- [ ] **Step 3: Mention the theme in `README.md`**

Append a section after the existing project blurb:

```markdown
## Design

This app uses the shared `theme-core` design system. The canonical source
lives in `/var/www/signal`; we pull it via `./scripts/sync-theme.sh`. To
update the theme here after a change in Signal:

    ./scripts/sync-theme.sh /var/www/signal
    git add public/css/theme-core.css public/illos/theme-illos.svg public/fonts
    git commit -m "Sync theme-core from Signal"

Scrum Poker–specific styles live in `public/css/theme-poker.css` and
`public/css/app.css`.
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "Document theme rollout in README"
```
