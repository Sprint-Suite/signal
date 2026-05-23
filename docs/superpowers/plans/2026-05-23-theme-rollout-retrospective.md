# Theme Rollout — Retrospective Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the shared `theme-core` design system (built in `/var/www/signal`) to `/var/www/retrospective` with its own "Pinboard" palette, a cork-and-washi hero scene, polaroid-style retro cards with coloured pin heads, and a pin-up animation when a new note lands on the board.

**Architecture:** Pull `theme-core.css`, `theme-illos.svg`, and the three woff2 fonts from the canonical Signal source via `scripts/sync-theme.sh`. Add a `public/css/theme-retro.css` palette overlay (Cork-Ember colours + corkboard + polaroid layouts). Slim the existing `public/styles.css` into `public/css/app.css`, keeping only Retrospective-specific layouts (board columns, drag indicators, timer). Migrate all six HTML pages.

**Tech Stack:** Same as the other plans. Vanilla CSS, plain SVG, Express static serving, Dragula for drag-and-drop (untouched), Playwright + `node:test`.

**Prereq:** Plan 1 (`2026-05-23-theme-core-and-signal-pilot.md`) is complete in `/var/www/signal`.

**Reference spec:** `docs/superpowers/specs/2026-05-23-shared-playful-pastel-theme-design.md` (lives in Signal; consult §3, §4.1, §5 "Retrospective").

> **All paths below are relative to `/var/www/retrospective`.** Run commands from that directory.

---

### Task 1: Add the sync script and pull theme-core

**Files:**
- Create: `scripts/sync-theme.sh`
- Create: `scripts/theme-manifest.txt`

- [ ] **Step 1: Create scripts dir**

```bash
cd /var/www/retrospective
mkdir -p scripts
```

- [ ] **Step 2: Copy the sync script verbatim from Signal and make executable**

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

- [ ] **Step 4: Run the sync**

```bash
./scripts/sync-theme.sh /var/www/signal
ls public/css/theme-core.css public/illos/theme-illos.svg public/fonts/
```

Expected: all five files present.

- [ ] **Step 5: Verify the CSP allows them**

```bash
grep -n "font-src\|style-src\|img-src" server.js
```

Expected: `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`. All compatible — fonts are same-origin woff2, illustrations are same-origin SVG. No CSP change needed.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-theme.sh scripts/theme-manifest.txt public/css/theme-core.css public/illos/theme-illos.svg public/fonts
git commit -m "Pull theme-core assets from Signal canonical source"
```

---

### Task 2: Add Retrospective palette contrast tests

**Files:**
- Create: `lib/contrast.js`
- Create: `tests/theme-contrast.test.js`

- [ ] **Step 1: Copy the contrast helper from Signal**

```bash
mkdir -p lib
cp /var/www/signal/lib/contrast.js lib/contrast.js
```

- [ ] **Step 2: Write the test**

```javascript
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

const RETRO = {
  bg:        "#FDF4E3",
  "bg-warm": "#E8C9A0",
  surface:   "#FDF8EB",
  ink:       "#2A1F12",
  muted:     "#8B5E36",
  accent:    "#C8252A",
  "accent-on": "#FFFFFF",
  "accent-2": "#5B35D5",
  "accent-3": "#F59E0B",
  ok:   "#2A5A2A",
  err:  "#B4232A"
};

const PAIRS = [
  ["ink",   "bg"],
  ["ink",   "bg-warm"],
  ["ink",   "surface"],
  ["muted", "bg"],
  ["accent-on", "accent"],
  ["accent-on", "accent-2"],
  ["ink",   "accent-3"],
  ["ok",    "bg"],
  ["err",   "bg"]
];

for (const [fg, bg] of PAIRS) {
  test(`retrospective contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(RETRO[fg], RETRO[bg]);
    assert.ok(
      meetsAA(RETRO[fg], RETRO[bg]),
      `${fg} (${RETRO[fg]}) on ${bg} (${RETRO[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}
```

- [ ] **Step 3: Add a test script to package.json if not present, then run**

```bash
grep -q "\"test\":" package.json || echo "ADD a node:test script to package.json"
npm test -- --test-name-pattern "retrospective contrast" 2>&1 || \
  node --test tests/theme-contrast.test.js
```

Expected: all PASS. If any fail, adjust the offending hex in the spec + the upcoming `theme-retro.css` before continuing.

- [ ] **Step 4: Commit**

```bash
git add lib/contrast.js tests/theme-contrast.test.js
git commit -m "Add WCAG contrast tests for Retrospective palette"
```

---

### Task 3: Create `theme-retro.css` — palette overlay + Pinboard layouts

**Files:**
- Create: `public/css/theme-retro.css`

- [ ] **Step 1: Write the file**

```css
/* public/css/theme-retro.css
 *
 * Retrospective's "Pinboard" overlay. Loaded AFTER theme-core.css.
 */

:root {
  /* --- Palette overrides — see spec §4.1 ---------------------------- */
  --bg:        #FDF4E3;
  --bg-warm:   #E8C9A0;
  --surface:   #FDF8EB;
  --border:    #E8D9C0;
  --border-st: #C9B27A;
  --ink:       #2A1F12;
  --muted:     #8B5E36;
  --faint:     #B0916B;
  --accent:    #C8252A;
  --accent-on: #FFFFFF;
  --accent-2:  #5B35D5;   /* secondary pin head */
  --accent-3:  #F59E0B;   /* tag colour, washi */

  /* Pinboard-specific tokens */
  --pin-red:    #C8252A;
  --pin-blue:   #5B35D5;
  --pin-yellow: #F59E0B;
  --pin-green:  #2A5A2A;
}

/* Cork-textured background — used on board pages */
.cork-bg {
  background-color: var(--bg-warm);
  background-image:
    radial-gradient(circle, rgba(120, 80, 40, 0.18) 1.5px, transparent 1.5px),
    radial-gradient(circle, rgba(120, 80, 40, 0.10) 1px, transparent 1px);
  background-size: 7px 7px, 4px 4px;
  background-position: 0 0, 3px 3px;
}

/* Washi tape — a small accent ribbon */
.washi {
  display: inline-block;
  height: 18px;
  width: 60px;
  background: repeating-linear-gradient(45deg,
    var(--accent-3) 0 6px,
    rgba(245, 158, 11, 0.5) 6px 12px);
  transform: rotate(-12deg);
}

/* Polaroid — used for retro cards */
.polaroid {
  background: var(--surface);
  padding: var(--s-2) var(--s-2) var(--s-6);
  box-shadow: 0 6px 14px rgba(42, 31, 18, 0.18);
  position: relative;
  transition: transform 120ms ease;
}
.polaroid:hover { transform: translateY(-2px) rotate(0); }
.polaroid .polaroid-body {
  background: var(--bg);
  padding: var(--s-3);
  min-height: 80px;
  font-family: var(--sans);
}
.polaroid .polaroid-author {
  position: absolute;
  bottom: var(--s-2);
  left: 50%;
  transform: translateX(-50%);
  font-family: 'Fraunces', Georgia, serif;
  font-size: 0.78rem;
  color: var(--muted);
}

/* Pin head — sits on top of the polaroid */
.pin {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--pin-red);
  box-shadow:
    inset -2px -2px 0 rgba(0,0,0,0.18),
    0 2px 3px rgba(0,0,0,0.35);
  z-index: 2;
}
.pin-red    { background: var(--pin-red); }
.pin-blue   { background: var(--pin-blue); }
.pin-yellow { background: var(--pin-yellow); }
.pin-green  { background: var(--pin-green); }

/* Pin-up animation — bouncy scale when a new note lands */
.polaroid.fresh { animation: pin-up 200ms cubic-bezier(.34,1.56,.64,1) both; }

/* Login hero — washi-taped sign-in card on the corkboard */
.cork-hero {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-6);
}
.cork-hero .card {
  width: min(440px, 100%);
  position: relative;
}
.cork-hero .card::before {
  /* a strip of washi tape across the top of the sign-in card */
  content: "";
  position: absolute;
  top: -10px;
  left: 30%;
  width: 80px;
  height: 18px;
  background: repeating-linear-gradient(45deg,
    var(--accent-3) 0 6px,
    rgba(245, 158, 11, 0.5) 6px 12px);
  transform: rotate(-4deg);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-retro.css
git commit -m "Add Retrospective palette overlay + Pinboard layouts"
```

---

### Task 4: Migrate `login.html` to new stylesheets + cork-hero

**Files:**
- Modify: `public/login.html`

- [ ] **Step 1: Replace the stylesheet link**

Find:

```html
    <link rel="stylesheet" href="styles.css" />
```

Replace with:

```html
    <link rel="stylesheet" href="/css/theme-core.css" />
    <link rel="stylesheet" href="/css/theme-retro.css" />
    <link rel="stylesheet" href="/styles.css" />
```

(Keep the existing `styles.css` for now — Task 8 slims it down.)

- [ ] **Step 2: Replace the body class with cork-hero**

Find:

```html
  <body class="page login-page">
```

Replace with:

```html
  <body class="page login-page cork-bg">
```

Find the wrapping `<main>` element (probably `<main class="login-shell">`). Add `cork-hero` to its class list:

```html
    <main class="login-shell cork-hero">
```

- [ ] **Step 3: Add a brand mark line with the pin glyph**

Find any existing brand/heading line near the top of `<main>`. After the `eyebrow`, prepend:

```html
        <p class="brand">
          <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#pin"/></svg>
          <span>Retrospective</span>
        </p>
```

- [ ] **Step 4: Smoke-test**

```bash
npm start &
sleep 2
curl -sS -I http://localhost:3000/ | head -1
curl -sS http://localhost:3000/ | grep -q theme-core.css && echo "css linked OK"
curl -sS -I http://localhost:3000/fonts/Inter.woff2 | head -1
kill %1
```

Expected: 200 OK, "css linked OK", 200 OK for the font.

- [ ] **Step 5: Run smoke E2E**

```bash
npx playwright test tests/e2e/retro-smoke.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/login.html public/css/theme-retro.css
git commit -m "Retrospective: migrate login to theme-core + cork hero"
```

---

### Task 5: Migrate `lobby.html`, `actions.html`, `admin.html`, `license.html`

**Files:**
- Modify: `public/lobby.html`
- Modify: `public/actions.html`
- Modify: `public/admin.html`
- Modify: `public/license.html`

- [ ] **Step 1: For each of the four pages, swap the stylesheet link**

In each, find:

```html
    <link rel="stylesheet" href="styles.css" />
```

Replace with:

```html
    <link rel="stylesheet" href="/css/theme-core.css" />
    <link rel="stylesheet" href="/css/theme-retro.css" />
    <link rel="stylesheet" href="/styles.css" />
```

- [ ] **Step 2: For each page that has an `eyebrow` or `app-header`, add the pin brand glyph**

Find the `app-header`/`page-header` block. After the existing `eyebrow` (or `<h1>`), insert:

```html
        <p class="brand">
          <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#pin"/></svg>
          <span>Retrospective</span>
        </p>
```

- [ ] **Step 3: Run the page-shell test (visits every page once)**

```bash
npx playwright test tests/e2e/page-shell.spec.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/lobby.html public/actions.html public/admin.html public/license.html
git commit -m "Retrospective: migrate lobby, actions, admin, license to theme-core"
```

---

### Task 6: Migrate `retrospective.html` (board page) — keep Dragula stylesheet, add theme

**Files:**
- Modify: `public/retrospective.html`

- [ ] **Step 1: Adjust stylesheet links**

Find:

```html
    <link rel="stylesheet" href="vendor/dragula/dragula.min.css" />
    <link rel="stylesheet" href="styles.css" />
```

Replace with:

```html
    <link rel="stylesheet" href="vendor/dragula/dragula.min.css" />
    <link rel="stylesheet" href="/css/theme-core.css" />
    <link rel="stylesheet" href="/css/theme-retro.css" />
    <link rel="stylesheet" href="/styles.css" />
```

- [ ] **Step 2: Apply the cork background to the board**

Find:

```html
  <body class="retro-page">
```

Replace with:

```html
  <body class="retro-page cork-bg">
```

- [ ] **Step 3: Add the brand mark to the session header**

In the `session-header` block, immediately inside `.session-title`, prepend:

```html
        <p class="brand">
          <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#pin"/></svg>
          <span>Retrospective</span>
        </p>
```

- [ ] **Step 4: Smoke-test (board loads, Dragula still works)**

```bash
npm start &
sleep 2
curl -sS -I http://localhost:3000/retrospective.html | head -1
kill %1
```

Expected: 200 OK.

- [ ] **Step 5: Commit**

```bash
git add public/retrospective.html
git commit -m "Retrospective board: load theme-core, cork-bg, pin brand mark"
```

---

### Task 7: Render retro cards as polaroids with pins, pin-up animation on add

**Files:**
- Modify: `public/client.js` (where retro cards are rendered)
- Modify: `public/retrospective.html` (if the column markup is static)

- [ ] **Step 1: Find the per-card rendering**

```bash
grep -n "card\|note\|sticky\|retro-card\|column" public/client.js | head -20
```

Look for the function that builds a card element from a server-side note. It currently produces markup roughly like:

```javascript
const card = document.createElement("div");
card.className = "retro-card";
card.dataset.id = note.id;
card.innerHTML = `<p class="retro-card-body">${escapeHtml(note.text)}</p>`;
```

- [ ] **Step 2: Replace with the polaroid template**

```javascript
const card = document.createElement("div");
card.className = "polaroid";
card.dataset.id = note.id;
const pinColor = pinColorFor(note);   // helper defined in Step 3
card.innerHTML = `
  <div class="pin pin-${pinColor}"></div>
  <div class="polaroid-body">${escapeHtml(note.text)}</div>
  ${note.author ? `<div class="polaroid-author">— ${escapeHtml(note.author)}</div>` : ""}
`;
```

- [ ] **Step 3: Add the `pinColorFor` helper**

Near the top of `client.js` (top-level scope):

```javascript
/**
 * Pick a pin colour for a note. Hash on the note id so the same note
 * always has the same colour — feels stable on re-render.
 */
function pinColorFor(note) {
  const palette = ["red", "blue", "yellow", "green"];
  const seed = String(note.id || note.text || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
```

- [ ] **Step 4: Trigger the pin-up animation when a freshly-added note lands**

In the function that handles "note added" (or the path where a brand-new local note is created), add the `fresh` class:

```javascript
card.classList.add("fresh");
card.addEventListener("animationend", () => card.classList.remove("fresh"), { once: true });
```

- [ ] **Step 5: Run smoke and main retro E2E**

```bash
npx playwright test
```

Expected: PASS. The tests assert behaviour (drag-and-drop, persistence) which is unaffected by the visual change. Selectors that targeted `.retro-card` may need updating to `.polaroid`. If a test fails on selector, update the selector in the test (NOT the markup) — the new class is correct.

- [ ] **Step 6: Commit**

```bash
git add public/client.js public/retrospective.html tests/e2e
git commit -m "Retro cards rendered as polaroids with coloured pin heads + pin-up animation"
```

---

### Task 8: Slim `public/styles.css` → `public/css/app.css`; keep only Retrospective-specific layouts

**Files:**
- Delete: `public/styles.css`
- Create: `public/css/app.css`
- Modify: every `public/*.html` (point at the new path)

- [ ] **Step 1: Identify what to keep**

Retrospective–specific (keep in the new file):

- `.page` shell variants, `.app-header`, `.session-header`, `.session-title`, `.page-header` (page chrome unique to retro)
- `.login-shell`, `.login-hero`, `.lobby-page`, `.actions-page`, `.admin-page`, `.legal-page` background gradients
- Board layout: column grid, `.retro-column`, `.column-title`, `.column-body`, `.add-card`, `.gu-mirror` (dragula)
- Timer: `.timer*`, `.timer-actions`
- Action items: `.action-card`, `.action-field`, `.action-notes`
- Admin layout: `.admin-table`, etc.

Shared (drop):

- `.card`, `.panel`, `.field*`, `.primary-btn`, `.secondary-btn`, `.link-btn`, `.error-text` (replaced by theme-core's `.field`, `.btn*`, `.notice-error`)
- `.eyebrow` (replaced by `.kicker`)
- `.auth-card`, `.auth-header` (subsumed into `.card` + theme-core typography)
- Top-level page-background gradients can be simplified — the cork-bg / cork-hero classes from `theme-retro.css` now do the heavy lifting on login and the board.

- [ ] **Step 2: Map old tokens to new**

Replace throughout the new `app.css`:

| Old                  | New              |
| -------------------- | ---------------- |
| `--page`             | `--bg`           |
| `--surface`          | `--surface`      |
| `--surface-soft`     | `--bg-warm`      |
| `--line`             | `--border`       |
| `--line-strong`      | `--border-st`    |
| `--ink`              | `--ink`          |
| `--muted`            | `--muted`        |
| `--muted-2`          | `--faint`        |
| `--primary`          | `--accent`       |
| `--primary-strong`   | `--accent` (rely on `filter: brightness(0.95)` for hover) |
| `--primary-soft`     | `--accent-3`     |
| `--green`/`--green-soft`/`--green-line` | `--ok`/`--ok-bg`/`--border` |
| `--red`/`--red-soft`/`--red-line`       | `--err`/`--err-bg`/`--border` |
| `--blue`/`--blue-soft`/`--blue-line`    | `--info`/`--info-bg`/`--border` |
| `--warning`          | `--warn`         |
| `--radius`           | `--r-md`         |
| `--font`             | `--sans`         |
| `--shadow-sm`        | `--shadow-sm`    |
| `--shadow-md`        | `--shadow-md`    |

- [ ] **Step 3: Create the new file**

```bash
mkdir -p public/css
```

Then create `public/css/app.css` with a leading comment:

```css
/* public/css/app.css
 *
 * Retrospective-specific layouts only. Shared tokens, base, and components
 * live in theme-core.css; palette + Pinboard specifics live in
 * theme-retro.css.
 */
```

Copy across only the rules from Step 1 (kept ones), with tokens renamed per Step 2.

- [ ] **Step 4: Delete the legacy file**

```bash
git rm public/styles.css
```

- [ ] **Step 5: Update HTML files to load `app.css` from the new path**

In each `public/*.html`, change the last stylesheet line:

```html
    <link rel="stylesheet" href="/styles.css" />
```

to:

```html
    <link rel="stylesheet" href="/css/app.css" />
```

- [ ] **Step 6: Replace deprecated class names in HTML**

Find any references to `.eyebrow`, `.auth-card`, `.primary-btn`, `.secondary-btn`, `.error-text`, `.auth-header`:

```bash
grep -rn "eyebrow\|auth-card\|primary-btn\|secondary-btn\|error-text\|auth-header" public/*.html public/*.js
```

For each, replace with the theme-core equivalent (`kicker`, `card`, `btn btn-primary`, `btn`, `notice notice-error`, `card-title`).

- [ ] **Step 7: Run the full suite**

```bash
npx playwright test
```

Expected: all PASS. Visually open the board page and confirm:

- Cork background visible behind the columns
- Polaroids have coloured pins
- Buttons are pill-shaped purple/red
- Adding a new note shows the pin-up bounce

- [ ] **Step 8: Commit**

```bash
git add public/css/app.css public/*.html public/*.js
git commit -m "Retrospective: drop legacy styles.css, slim to app.css + token remap"
```

---

### Task 9: Final visual verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run everything**

```bash
npm test 2>&1 || node --test tests/*.test.js
npx playwright test
```

Expected: all PASS.

- [ ] **Step 2: Visual walkthrough**

```bash
npm start
```

Visit `http://localhost:3000/` and walk:

1. Login → corkboard background, washi-taped sign-in card, pin brand glyph.
2. Lobby → list of sessions; pin brand mark in header.
3. Open a session → cork board, columns visible, polaroids with coloured pins.
4. Add a note → confirm the pin-up bounce.
5. Drag a note between columns → Dragula still works.
6. Timer, actions, admin, license pages all load with the new theme.

Confirm no console errors and fonts load.

- [ ] **Step 3: Document the theme in `README.md`**

Append:

```markdown
## Design

This app uses the shared `theme-core` design system. The canonical source
lives in `/var/www/signal`. To update the theme here after a change in
Signal:

    ./scripts/sync-theme.sh /var/www/signal
    git add public/css/theme-core.css public/illos/theme-illos.svg public/fonts
    git commit -m "Sync theme-core from Signal"

Retrospective-specific styles live in `public/css/theme-retro.css` and
`public/css/app.css`.
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "Document theme rollout in README"
```
