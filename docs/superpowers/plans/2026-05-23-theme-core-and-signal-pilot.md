# theme-core + Signal Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared `theme-core` design system (tokens, components, chrome, illustrations, self-hosted fonts) in `/var/www/signal` and apply it end-to-end as the Signal "Weather Postcards" pilot — proving the system works before rolling it out to the other two apps.

**Architecture:** A single `public/css/theme-core.css` is the source of truth — all design tokens, base type, components, chrome, motion. A second `public/css/theme-signal.css` (loaded after) sets Signal-specific palette tokens and Weather-Postcards-specific layouts/hero. Fonts (Fraunces, Inter, JetBrains Mono variable woff2) self-hosted in `public/fonts/`. Shared illustration primitives live as inline `<symbol>` definitions in `public/illos/theme-illos.svg`, referenced via `<svg><use href="…"/></svg>`. Strict CSP (`style-src 'self'`) means no `<style>` blocks or `style=""` attributes anywhere — every rule lives in the linked stylesheets.

**Tech Stack:** Vanilla CSS (custom properties + `@font-face`), plain SVG, Express static serving, Playwright for browser tests, `node:test` for unit tests. No bundler, no preprocessor.

**Reference spec:** `docs/superpowers/specs/2026-05-23-shared-playful-pastel-theme-design.md`

---

## Phase A — Foundation: fonts, tokens, components

### Task 1: Self-host the three typefaces

**Files:**
- Create: `public/fonts/Fraunces.woff2`
- Create: `public/fonts/Inter.woff2`
- Create: `public/fonts/JetBrainsMono.woff2`
- Create: `public/fonts/README.md`

- [ ] **Step 1: Create the fonts directory**

```bash
mkdir -p public/fonts
```

- [ ] **Step 2: Download the three variable-font woff2 files**

```bash
# Fraunces variable (OFL) — from the official google/fonts repo
curl -L -o public/fonts/Fraunces.woff2 \
  "https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.woff2"

# Inter variable (OFL) — from rsms/inter releases
curl -L -o public/fonts/Inter.woff2 \
  "https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2"

# JetBrains Mono variable (OFL) — from JetBrains/JetBrainsMono repo
curl -L -o public/fonts/JetBrainsMono.woff2 \
  "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/variable/JetBrainsMono%5Bwght%5D.woff2"
```

- [ ] **Step 3: Verify the files downloaded and look sensible**

```bash
ls -lh public/fonts/
file public/fonts/*.woff2
```

Expected: three woff2 files, each between 100 KB and 500 KB; `file` reports them as "Web Open Font Format (Version 2)" or similar.

- [ ] **Step 4: Write the README documenting source + licence**

```markdown
# Fonts

All three faces are SIL Open Font Licence (OFL) and self-hosted to comply
with the strict CSP (`font-src 'self'`).

| File                  | Source                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Fraunces.woff2        | https://github.com/google/fonts/tree/main/ofl/fraunces                   |
| Inter.woff2           | https://github.com/rsms/inter (InterVariable.woff2)                      |
| JetBrainsMono.woff2   | https://github.com/JetBrains/JetBrainsMono (variable[wght].woff2)        |

To refresh, re-run the curl commands in Task 1 of
`docs/superpowers/plans/2026-05-23-theme-core-and-signal-pilot.md`.
```

- [ ] **Step 5: Commit**

```bash
git add public/fonts
git commit -m "Self-host Fraunces, Inter, JetBrains Mono woff2 fonts"
```

---

### Task 2: Add a contrast helper + first WCAG test (TDD harness for tokens)

**Files:**
- Create: `lib/contrast.js`
- Create: `tests/contrast.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

test("contrast: pure black on pure white is 21:1", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(2), "21.00");
});

test("contrast: identical colours are 1:1", () => {
  assert.equal(contrastRatio("#777777", "#777777"), 1);
});

test("meetsAA: WCAG AA body text requires 4.5:1", () => {
  assert.equal(meetsAA("#2A1F12", "#FDF4E3"), true);   // signal-ish pair
  assert.equal(meetsAA("#999999", "#FFFFFF"), false);  // too light
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "contrast"
```

Expected: FAIL — "Cannot find module '../lib/contrast'".

- [ ] **Step 3: Implement the helper**

```javascript
// lib/contrast.js
"use strict";

/**
 * WCAG 2.1 contrast helpers. Used to check palette pairs at test-time so
 * the design system stays accessible as it evolves.
 */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function relLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fgHex, bgHex) {
  const l1 = relLuminance(hexToRgb(fgHex));
  const l2 = relLuminance(hexToRgb(bgHex));
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

function meetsAA(fgHex, bgHex, { largeText = false } = {}) {
  const ratio = contrastRatio(fgHex, bgHex);
  return ratio >= (largeText ? 3 : 4.5);
}

module.exports = { contrastRatio, meetsAA };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --test-name-pattern "contrast"
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/contrast.js tests/contrast.test.js
git commit -m "Add WCAG contrast helper for palette verification"
```

---

### Task 3: Create `theme-core.css` — tokens + @font-face

**Files:**
- Create: `public/css/theme-core.css`

- [ ] **Step 1: Write the file**

```css
/* public/css/theme-core.css
 *
 * Shared design system for the Signal / Scrum Poker / Retrospective suite.
 * This file is the canonical source of truth. Per-app stylesheets layer a
 * palette + layout on top.
 *
 * Strict CSP forbids inline styles — every rule must live here or in
 * theme-<app>.css.
 */

/* ---------------------------------------------------------------------------
 * 1. Fonts — self-hosted variable woff2.
 * ------------------------------------------------------------------------ */
@font-face {
  font-family: "Fraunces";
  src: url("/fonts/Fraunces.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("/fonts/Inter.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

/* ---------------------------------------------------------------------------
 * 2. Tokens — defaults. Per-app stylesheets override the palette tokens.
 *    Spacing / radii / shadows / type tokens are shared across all apps.
 * ------------------------------------------------------------------------ */
:root {
  /* Type */
  --serif:  "Fraunces", Georgia, serif;
  --sans:   "Inter", system-ui, -apple-system, sans-serif;
  --mono:   "JetBrains Mono", ui-monospace, monospace;

  /* Spacing scale */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;
  --s-4: 16px; --s-6: 24px; --s-8: 32px; --s-12: 48px;

  /* Radii */
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --r-xl: 16px; --r-pill: 999px;

  /* Shadows (designed to sit on cream backgrounds) */
  --shadow-sm: 0 1px 0 rgba(42, 31, 18, 0.04);
  --shadow-md: 0 1px 0 rgba(42, 31, 18, 0.04), 0 8px 24px rgba(42, 31, 18, 0.06);
  --shadow-lg: 0 1px 0 rgba(42, 31, 18, 0.04), 0 16px 44px rgba(42, 31, 18, 0.10);

  /* Status colours — shared across all apps */
  --ok:    #2A5A2A;
  --warn:  #B8780A;
  --err:   #B4232A;
  --info:  #2D5FAA;
  --ok-bg:   #DCE9DA;
  --warn-bg: #F9E6C7;
  --err-bg:  #F8D7DA;
  --info-bg: #DCE5F4;

  /* Palette defaults — overridden by theme-<app>.css. Defined here so the
     components in section 4 are renderable even without an app overlay. */
  --bg:        #FDF8EB;
  --bg-warm:   #F4ECE0;
  --surface:   #FFFFFF;
  --border:    #E8D9C0;
  --border-st: #C9B27A;
  --ink:       #2A1F12;
  --muted:     #8E6E4A;
  --faint:     #B0916B;
  --accent:    #6B4FE8;
  --accent-on: #FFFFFF;
  --accent-2:  #F5D87E;
  --accent-3:  #FFCFB0;
}
```

- [ ] **Step 2: Commit (intermediate — file will keep growing in next tasks)**

```bash
git add public/css/theme-core.css
git commit -m "theme-core: tokens, @font-face, palette defaults"
```

---

### Task 4: Add base/global styles + typography to `theme-core.css`

**Files:**
- Modify: `public/css/theme-core.css` (append)

- [ ] **Step 1: Append the base + type block**

```css

/* ---------------------------------------------------------------------------
 * 3. Base & typography
 * ------------------------------------------------------------------------ */
*, *::before, *::after { box-sizing: border-box; }

html, body { height: 100%; margin: 0; }

body {
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
a:hover { text-decoration: none; }

h1, h2, h3, h4 {
  font-family: var(--serif);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 var(--s-3);
  color: var(--ink);
  /* Soft optical sizing for Fraunces variable axis */
  font-variation-settings: "opsz" 96, "SOFT" 60;
}
h1 { font-size: 2rem; }
h2 { font-size: 1.4rem; }
h3 { font-size: 1.15rem; }
h4 { font-size: 1rem; }

p { margin: 0 0 var(--s-3); }

.kicker {
  font-family: var(--sans);
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
}
.muted { color: var(--muted); }
.faint { color: var(--faint); font-size: 0.85rem; }
.mono  { font-family: var(--mono); }
.center { text-align: center; }
.hidden { display: none !important; }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-core.css
git commit -m "theme-core: base + typography"
```

---

### Task 5: Add components to `theme-core.css` (button, input, card, tag, pill, notice, modal)

**Files:**
- Modify: `public/css/theme-core.css` (append)

- [ ] **Step 1: Append the components block**

```css

/* ---------------------------------------------------------------------------
 * 4. Components
 * ------------------------------------------------------------------------ */

/* --- Card --- */
.card {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--s-6);
  box-shadow: var(--shadow-md);
}
.card + .card { margin-top: var(--s-4); }
.card-title { font-family: var(--serif); font-weight: 600; margin-bottom: var(--s-1); }

/* --- Button --- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 9px 18px;
  border-radius: var(--r-pill);
  border: 1.5px solid var(--border-st);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--sans);
  font-weight: 700;
  font-size: 0.92rem;
  cursor: pointer;
  text-decoration: none;
  transition: transform 120ms ease, background 120ms ease;
}
.btn:hover { background: var(--bg-warm); transform: translateY(-1px); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
}
.btn-primary:hover { background: var(--accent); filter: brightness(0.95); }
.btn-ghost { border-color: transparent; background: transparent; }
.btn-ghost:hover { background: var(--bg-warm); }
.btn-danger { color: var(--err); border-color: var(--border-st); }
.btn-danger:hover { background: var(--err-bg); }
.btn-sm { padding: 5px 12px; font-size: 0.82rem; }
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
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-color: var(--accent);
}

/* --- Tag & pill --- */
.tag {
  display: inline-block;
  padding: 3px 9px;
  border-radius: var(--r-sm);
  background: var(--bg-warm);
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.tag-ok   { background: var(--ok-bg);   color: var(--ok); }
.tag-warn { background: var(--warn-bg); color: var(--warn); }
.tag-err  { background: var(--err-bg);  color: var(--err); }
.tag-info { background: var(--info-bg); color: var(--info); }

.pill {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--bg-warm);
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* --- Notice --- */
.notice {
  padding: 10px 14px;
  border-radius: var(--r-md);
  font-size: 0.9rem;
  border: 1.5px solid var(--border);
  background: var(--bg-warm);
  color: var(--ink);
}
.notice-error { background: var(--err-bg);  border-color: var(--err);  color: var(--err); }
.notice-ok    { background: var(--ok-bg);   border-color: var(--ok);   color: var(--ok); }
.notice-info  { background: var(--info-bg); border-color: var(--info); color: var(--info); }

/* --- Modal --- */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(42, 31, 18, 0.48);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
  padding: var(--s-4);
}
.modal-overlay.hidden { display: none; }
.modal-content {
  width: min(420px, 100%);
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--s-6);
  animation: modal-in 160ms ease-out;
}
.modal-content h2 { margin: 0 0 var(--s-2); }
.modal-actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-6); }

@keyframes modal-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-core.css
git commit -m "theme-core: components (card, btn, field, tag, pill, notice, modal)"
```

---

### Task 6: Add chrome (topbar, footer, page layout) to `theme-core.css`

**Files:**
- Modify: `public/css/theme-core.css` (append)

- [ ] **Step 1: Append the chrome block**

```css

/* ---------------------------------------------------------------------------
 * 5. Chrome — topbar, footer, page shells
 * ------------------------------------------------------------------------ */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-6);
  background: var(--surface);
  border-bottom: 1.5px solid var(--border);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  font-family: var(--serif);
  font-weight: 600;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
}
.brand-glyph {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.topbar-actions { display: flex; gap: var(--s-2); align-items: center; }

.page { padding: var(--s-6); max-width: 1040px; margin: 0 auto; }
.page-narrow { max-width: 560px; }

.shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-6);
}

.stack > * + * { margin-top: var(--s-4); }
.row { display: flex; gap: var(--s-3); flex-wrap: wrap; align-items: center; }
.row-end { justify-content: flex-end; }
.spread { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); }

.app-footer {
  text-align: center;
  padding: var(--s-6);
  font-size: 0.8rem;
  color: var(--faint);
}
.app-footer a { color: var(--faint); }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-core.css
git commit -m "theme-core: chrome (topbar, footer, page shells)"
```

---

### Task 7: Add motion utilities + reduced-motion to `theme-core.css`

**Files:**
- Modify: `public/css/theme-core.css` (append)

- [ ] **Step 1: Append the motion block**

```css

/* ---------------------------------------------------------------------------
 * 6. Motion — keyframes + reduced-motion respect
 * ------------------------------------------------------------------------ */
@keyframes drift-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pin-up {
  0%   { opacity: 0; transform: scale(0.85) rotate(-4deg); }
  60%  { opacity: 1; transform: scale(1.05) rotate(2deg); }
  100% { transform: scale(1) rotate(0); }
}
@keyframes postcard-send {
  0%   { transform: translateX(0) rotate(0); opacity: 1; }
  100% { transform: translateX(120%) rotate(-6deg); opacity: 0; }
}
@keyframes sticker-place {
  0%   { transform: scale(0.6) rotate(-12deg); opacity: 0; }
  70%  { transform: scale(1.08) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}

.motion-drift-in    { animation: drift-in 240ms ease-out both; }
.motion-pin-up      { animation: pin-up 200ms cubic-bezier(.34,1.56,.64,1) both; }
.motion-send        { animation: postcard-send 280ms ease-in both; }
.motion-place       { animation: sticker-place 240ms cubic-bezier(.34,1.56,.64,1) both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .btn:hover { transform: none; }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-core.css
git commit -m "theme-core: motion utilities and reduced-motion overrides"
```

---

### Task 8: Build the shared illustration sprite

**Files:**
- Create: `public/illos/theme-illos.svg`

- [ ] **Step 1: Create the sprite file**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <!-- All shared paper-cut primitives. Use via:
       <svg><use href="/illos/theme-illos.svg#sun"/></svg>
       Colours inherit from currentColor so each app's palette flows in. -->

  <symbol id="pin" viewBox="0 0 24 28">
    <circle cx="12" cy="9" r="7" fill="currentColor"/>
    <rect x="10.5" y="13" width="3" height="14" fill="#2A1F12"/>
  </symbol>

  <symbol id="sticker-circle" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="#FDF8EB" stroke-width="1.5" stroke-dasharray="3 3"/>
  </symbol>

  <symbol id="postcard" viewBox="0 0 32 22">
    <rect x="0.75" y="0.75" width="30.5" height="20.5" rx="1.5" fill="#FDF8EB" stroke="currentColor" stroke-width="1.5"/>
    <rect x="22" y="3" width="6" height="7" fill="currentColor"/>
    <line x1="3" y1="14" x2="18" y2="14" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
    <line x1="3" y1="17" x2="14" y2="17" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
  </symbol>

  <symbol id="sun" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="5" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="12" y1="2"  x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="2"  y1="12" x2="5"  y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
      <line x1="5"  y1="5"  x2="7"  y2="7"/>
      <line x1="17" y1="17" x2="19" y2="19"/>
      <line x1="5"  y1="19" x2="7"  y2="17"/>
      <line x1="17" y1="7"  x2="19" y2="5"/>
    </g>
  </symbol>

  <symbol id="cloud" viewBox="0 0 32 24">
    <path d="M8 18 C 3 18, 3 11, 9 11 C 9 6, 17 4, 19 10 C 25 9, 28 14, 25 18 Z" fill="currentColor"/>
  </symbol>

  <symbol id="rain" viewBox="0 0 32 28">
    <path d="M8 14 C 3 14, 3 7, 9 7 C 9 2, 17 0, 19 6 C 25 5, 28 10, 25 14 Z" fill="currentColor"/>
    <line x1="10" y1="18" x2="8"  y2="24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="16" y1="18" x2="14" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="18" x2="20" y2="24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </symbol>

  <symbol id="wind" viewBox="0 0 32 24">
    <path d="M2 8 L 20 8 C 23 8, 24 4, 21 4 C 19 4, 19 6, 19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M2 13 L 26 13 C 30 13, 30 18, 26 18 C 24 18, 24 16, 24 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M2 18 L 14 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </symbol>

  <symbol id="snow" viewBox="0 0 24 24">
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
      <line x1="12" y1="3" x2="12" y2="21"/>
      <line x1="3"  y1="12" x2="21" y2="12"/>
      <line x1="5"  y1="5"  x2="19" y2="19"/>
      <line x1="5"  y1="19" x2="19" y2="5"/>
    </g>
  </symbol>

  <symbol id="check" viewBox="0 0 24 24">
    <path d="M4 12 L 10 18 L 20 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>

  <symbol id="cross" viewBox="0 0 24 24">
    <path d="M6 6 L 18 18 M 18 6 L 6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </symbol>

  <symbol id="arrow-right" viewBox="0 0 24 24">
    <path d="M4 12 H 20 M 14 6 L 20 12 L 14 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
</svg>
```

- [ ] **Step 2: Verify the SVG is well-formed**

```bash
xmllint --noout public/illos/theme-illos.svg && echo "OK"
```

Expected: prints "OK".

- [ ] **Step 3: Commit**

```bash
git add public/illos/theme-illos.svg
git commit -m "Add shared paper-cut illustration sprite (pin, postcard, weather glyphs, utility)"
```

---

### Task 9: Test all Signal palette pairs meet WCAG AA

**Files:**
- Create: `tests/theme-contrast.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

/**
 * Signal palette pairs that MUST meet WCAG AA (4.5:1 body text, 3:1 large
 * text). If a token gets recoloured later, this test catches regressions.
 */
const SIGNAL = {
  bg:        "#FDF8EB",
  "bg-sky":  "#BFD8EE",
  surface:   "#FDF8EB",
  ink:       "#1F2C4C",
  muted:     "#466091",
  accent:    "#1F2C4C",
  "accent-on": "#FFF8EE",
  "accent-2": "#E8A47D",
  "accent-3": "#DCE9DA",
  ok:   "#2A5A2A",
  err:  "#B4232A"
};

const BODY_PAIRS = [
  ["ink",   "bg"],
  ["ink",   "surface"],
  ["muted", "bg"],
  ["accent-on", "accent"],
  ["err",   "bg"],
  ["ok",    "bg"],
  ["ink",   "bg-sky"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`signal contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(SIGNAL[fg], SIGNAL[bg]);
    assert.ok(
      meetsAA(SIGNAL[fg], SIGNAL[bg]),
      `${fg} (${SIGNAL[fg]}) on ${bg} (${SIGNAL[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}
```

- [ ] **Step 2: Run the test**

```bash
npm test -- --test-name-pattern "signal contrast"
```

Expected: PASS for all pairs. If any fail, **stop and adjust the offending hex in the spec + theme-signal.css before continuing** — record the change in the spec's §4.3.

- [ ] **Step 3: Commit**

```bash
git add tests/theme-contrast.test.js
git commit -m "Add WCAG AA contrast tests for Signal palette"
```

---

## Phase B — Signal palette and chrome migration

### Task 10: Create `theme-signal.css` with palette overrides

**Files:**
- Create: `public/css/theme-signal.css`

- [ ] **Step 1: Write the file**

```css
/* public/css/theme-signal.css
 *
 * Signal's "Weather Postcards" overlay. Loaded AFTER theme-core.css to
 * override palette tokens and add app-specific layouts/animations.
 */

:root {
  /* --- Palette overrides — see spec §4.3 ---------------------------- */
  --bg:        #FDF8EB;
  --bg-warm:   #F4ECE0;
  --bg-sky:    #BFD8EE;
  --surface:   #FDF8EB;
  --border:    #E0CFB8;
  --border-st: #B89A78;
  --ink:       #1F2C4C;
  --muted:     #466091;
  --faint:     #8AA3C8;
  --accent:    #1F2C4C;
  --accent-on: #FFF8EE;
  --accent-2:  #E8A47D;
  --accent-3:  #DCE9DA;
}

/* Hero — sky-peach dusk gradient used on /index and respond/landing */
.sky-hero {
  background: linear-gradient(180deg, var(--bg-sky) 0%, var(--accent-2) 100%);
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
    radial-gradient(circle, rgba(255,248,238,0.9) 1px, transparent 1.5px);
  background-size: 80px 90px;
  background-position: 12px 24px;
  opacity: 0.35;
}
.sky-hero .card {
  background: var(--surface);
  color: var(--ink);
  position: relative;
  z-index: 1;
  width: min(440px, 100%);
}
.sky-hero .brand { color: var(--accent-on); }

/* Postcard tile — used on dashboard.html survey list */
.postcard-tile {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--s-4);
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: var(--s-4);
  align-items: center;
  text-decoration: none;
  color: inherit;
  box-shadow: var(--shadow-sm);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.postcard-tile + .postcard-tile { margin-top: var(--s-2); }
.postcard-tile:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.postcard-tile .glyph {
  width: 40px; height: 40px;
  color: var(--accent-2);
}
.postcard-tile .pt-team   { font-weight: 600; }
.postcard-tile .pt-meta   { font-size: 0.85rem; color: var(--muted); margin-top: 2px; }

/* Per-question postcard — used on respond.html */
.question-postcard {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--s-6);
  position: relative;
}
.question-postcard::after {
  /* stamp in the top-right corner */
  content: "";
  position: absolute;
  top: var(--s-3); right: var(--s-3);
  width: 28px; height: 36px;
  background: var(--accent-2);
  border: 1.5px dashed var(--surface);
  border-radius: 2px;
}

/* Axis-condition glyphs in the report — used on survey.html */
.axis-glyph {
  width: 22px; height: 22px;
  vertical-align: middle;
  margin-right: var(--s-2);
}
.axis-glyph-sun   { color: var(--accent-2); }
.axis-glyph-cloud { color: var(--muted); }
.axis-glyph-rain  { color: var(--info); }
.axis-glyph-wind  { color: var(--accent-3); }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/theme-signal.css
git commit -m "Add Signal palette overlay + Weather Postcards layouts"
```

---

### Task 11: Migrate `index.html` (sign-in) to new stylesheets and brand mark

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace the `<head>` stylesheet links and the body shell**

Find:

```html
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/app.css">
```

Replace with:

```html
  <link rel="stylesheet" href="/css/theme-core.css">
  <link rel="stylesheet" href="/css/theme-signal.css">
```

Find:

```html
  <main class="shell">
    <div class="card page-narrow">
      <p class="brand"><span class="brand-dot"></span>Signal</p>
      <h1>Sign in</h1>
```

Replace with:

```html
  <main class="sky-hero">
    <div class="sky-stars"></div>
    <div class="card page-narrow">
      <p class="brand">
        <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#postcard"/></svg>
        <span>Signal</span>
      </p>
      <h1>Sign in</h1>
```

- [ ] **Step 2: Smoke-test the page**

```bash
npm start &
SERVER_PID=$!
sleep 1
curl -sS -I http://localhost:3000/ | head -1
curl -sS http://localhost:3000/ | grep -q "theme-core.css" && echo "css linked OK"
kill $SERVER_PID
```

Expected: `HTTP/1.1 200 OK`, "css linked OK".

- [ ] **Step 3: Run the existing login Playwright test**

```bash
npx playwright test tests/e2e/smoke.spec.js -g "sign in and reach the dashboard"
```

Expected: PASS — the selectors (`#email`, `#password`, `#login-btn`) are untouched.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "Signal: migrate sign-in page to theme-core + sky-hero"
```

---

### Task 12: Migrate remaining Signal HTML pages to new stylesheets

**Files:**
- Modify: `public/account.html`
- Modify: `public/admin.html`
- Modify: `public/dashboard.html`
- Modify: `public/forgot.html`
- Modify: `public/license.html`
- Modify: `public/reset.html`
- Modify: `public/respond.html`
- Modify: `public/survey.html`
- Modify: `public/verify.html`

- [ ] **Step 1: For every file above, swap the stylesheet links**

In each file, find:

```html
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/app.css">
```

Replace with:

```html
  <link rel="stylesheet" href="/css/theme-core.css">
  <link rel="stylesheet" href="/css/theme-signal.css">
```

- [ ] **Step 2: For every page that uses the topbar (`account`, `admin`, `dashboard`, `survey`), replace the brand mark**

Find:

```html
    <span class="brand"><span class="brand-dot"></span>Signal</span>
```

Replace with:

```html
    <span class="brand">
      <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#postcard"/></svg>
      <span>Signal</span>
    </span>
```

- [ ] **Step 3: For respond.html, replace its inline brand line**

Find:

```html
      <p class="brand"><span class="brand-dot"></span>Signal health check</p>
```

Replace with:

```html
      <p class="brand">
        <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#postcard"/></svg>
        <span>Signal health check</span>
      </p>
```

- [ ] **Step 4: Run the full Playwright suite**

```bash
npx playwright test
```

Expected: all tests pass. If a selector regression appears, fix the test (NOT the markup — semantic selectors must stay).

- [ ] **Step 5: Commit**

```bash
git add public/account.html public/admin.html public/dashboard.html public/forgot.html public/license.html public/reset.html public/respond.html public/survey.html public/verify.html
git commit -m "Signal: migrate remaining pages to theme-core + brand glyph"
```

---

### Task 13: Remove legacy `tokens.css`; slim `app.css` to Signal-specific layouts

**Files:**
- Delete: `public/css/tokens.css`
- Modify: `public/css/app.css` (slim down — keep only Signal-specific layouts)

- [ ] **Step 1: Identify what's still Signal-specific in `app.css`**

Read through `public/css/app.css`. Anything that is NOT already provided by `theme-core.css` (button, card, kicker, tag, modal, topbar, etc.) belongs in `app.css`. The Signal-specific things to keep:

- `.detail-list` (account / license tables)
- `.key-box` (admin key reveal)
- `.report-head`, `.report-grid`, `.radar-wrap`, `.legend*`, `.focus-card*`, `.axes-grid`, `.axis-card*`, `.delta-*` (survey report)
- `.q-row`, `.q-text`, `.q-meta`, `.bar`, `.bar-fill`, `.q-score`, `.guidance` (per-question breakdown)
- `.respond-shell`, `.respond-card`, `.progress-track`, `.progress-fill`, `.question-text`, `.scale`, `.scale-option`, `.scale-num`, `.respond-nav` (respond flow — soon to be replaced by question-postcard in Task 15, but keep for now)
- `.survey-row` (dashboard list — soon to be replaced by postcard-tile in Task 14, but keep for now)
- `.license-text` (license page)
- `.footer-note`, `.footer-note-wide` (footer variants)

Everything else (`.btn*`, `.card*`, `.tag*`, `.pill*`, `.notice*`, `.kicker`, `.topbar*`, `.brand*`, `.field*`, `.modal*`, etc.) is now provided by `theme-core.css` — delete it.

- [ ] **Step 2: Rewrite `app.css` keeping ONLY the items above**

Use the existing rules verbatim — but swap any Signal-specific `--sig-*` token references to the new shared token names: `--sig-accent` → `--accent`, `--sig-text` → `--ink`, `--sig-text-muted` → `--muted`, `--sig-text-faint` → `--faint`, `--sig-border` → `--border`, `--sig-border-strong` → `--border-st`, `--sig-bg-subtle` → `--bg-warm`, `--sig-bg-inset` → `--bg-warm`, `--sig-bg` → `--surface`, `--sig-space-N` → `--s-N`, `--sig-radius-sm` → `--r-md`, `--sig-radius-md` → `--r-md`, `--sig-radius-lg` → `--r-lg`, `--sig-font` → `--sans`, `--sig-font-mono` → `--mono`, `--sig-ok` → `--ok`, `--sig-warn` → `--warn`, `--sig-info` → `--info`, `--sig-warn-bg` → `--warn-bg`, `--sig-info-bg` → `--info-bg`, `--sig-accent-weak` → `--accent-3`.

Add a leading comment to the file:

```css
/* public/css/app.css
 *
 * Signal-specific layouts only. Shared tokens, base styles, and
 * components live in theme-core.css; the Signal palette and Weather
 * Postcards specifics live in theme-signal.css.
 */
```

- [ ] **Step 3: Delete tokens.css**

```bash
git rm public/css/tokens.css
```

- [ ] **Step 4: Update every HTML page to load app.css after theme-signal.css**

In every `public/*.html` file, change:

```html
  <link rel="stylesheet" href="/css/theme-core.css">
  <link rel="stylesheet" href="/css/theme-signal.css">
```

to:

```html
  <link rel="stylesheet" href="/css/theme-core.css">
  <link rel="stylesheet" href="/css/theme-signal.css">
  <link rel="stylesheet" href="/css/app.css">
```

- [ ] **Step 5: Run the full Playwright suite**

```bash
npx playwright test
```

Expected: all tests pass. Visually open each page in a browser (you can use `verify` skill or `npm start` then visit `http://localhost:3000/`) and confirm nothing is broken.

- [ ] **Step 6: Commit**

```bash
git add public/css/app.css public/*.html
git commit -m "Signal: drop tokens.css; slim app.css to Signal-specific layouts"
```

---

## Phase C — Weather Postcards key moments

### Task 14: Dashboard — render survey list as postcard tiles

**Files:**
- Modify: `public/js/dashboard.js` (markup the JS generates for each row)
- Modify: `public/dashboard.html` (container class) — if needed

- [ ] **Step 1: Read the current dashboard markup**

```bash
grep -n "survey-row\|surveys-list\|survey list" public/js/dashboard.js public/dashboard.html
```

- [ ] **Step 2: Update `dashboard.js` to emit postcard-tile markup**

Find the function that builds a row for a survey. It currently produces something like:

```javascript
const row = document.createElement("a");
row.className = "survey-row";
row.href = `/survey?id=${survey.id}`;
row.innerHTML = `
  <div class="survey-row-main">
    <div class="survey-row-team">${escapeHtml(survey.team)}</div>
    <div class="muted">${formatDate(survey.opened_at)} · ${survey.responses} responses</div>
  </div>
  <span class="pill ${survey.status === 'open' ? 'pill-open' : 'pill-closed'}">${survey.status}</span>
`;
```

Replace the markup template with:

```javascript
const glyph = weatherGlyphFor(survey);  // helper defined in Step 3
row.className = "postcard-tile";
row.innerHTML = `
  <svg class="glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#${glyph}"/></svg>
  <div class="pt-main">
    <div class="pt-team">${escapeHtml(survey.team)}</div>
    <div class="pt-meta">${formatDate(survey.opened_at)} · ${survey.responses} responses</div>
  </div>
  <span class="pill ${survey.status === 'open' ? 'tag-ok' : 'tag'}">${survey.status}</span>
`;
```

- [ ] **Step 3: Add the `weatherGlyphFor` helper to `dashboard.js`**

Add near the top of the file (after the IIFE opening or top-level scope):

```javascript
/**
 * Pick a weather glyph that summarises a survey's status for the
 * dashboard tile. Closed surveys lean on their average score; open
 * surveys use a neutral cloud until results are in.
 */
function weatherGlyphFor(survey) {
  if (survey.status !== "closed") return "cloud";
  const avg = Number(survey.average_score);
  if (!Number.isFinite(avg)) return "cloud";
  if (avg >= 4)   return "sun";
  if (avg >= 3)   return "cloud";
  if (avg >= 2)   return "wind";
  return "rain";
}
```

- [ ] **Step 4: Run the dashboard E2E**

```bash
npx playwright test tests/e2e/survey.spec.js
```

Expected: PASS. The tile still has the team name and response count visible.

- [ ] **Step 5: Commit**

```bash
git add public/js/dashboard.js
git commit -m "Signal dashboard: render surveys as Weather Postcard tiles"
```

---

### Task 15: Respond flow — wrap each question in a question-postcard

**Files:**
- Modify: `public/respond.html`
- Modify: `public/js/respond.js`

- [ ] **Step 1: Update `respond.html` to wrap the question block**

Find:

```html
      <div id="respond-question" class="hidden">
        <div class="progress-track">
          <div id="progress-fill" class="progress-fill"></div>
        </div>
        <p id="progress-text" class="faint"></p>

        <p id="axis-label" class="kicker"></p>
        <p id="question-text" class="question-text"></p>

        <div id="scale" class="scale"></div>
```

Replace the inner block with the postcard wrapper:

```html
      <div id="respond-question" class="hidden">
        <div class="progress-track">
          <div id="progress-fill" class="progress-fill"></div>
        </div>
        <p id="progress-text" class="faint"></p>

        <div class="question-postcard">
          <p id="axis-label" class="kicker"></p>
          <p id="question-text" class="question-text"></p>
          <div id="scale" class="scale"></div>
        </div>
```

- [ ] **Step 2: Run the existing respond E2E**

```bash
npx playwright test tests/e2e/survey.spec.js -g "answer it"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add public/respond.html
git commit -m "Signal respond: wrap each question in a postcard"
```

---

### Task 16: Respond submit — postcard-send animation

**Files:**
- Modify: `public/js/respond.js`
- Modify: `public/respond.html` (add the thank-you content if not already there)

- [ ] **Step 1: Find the submit handler**

```bash
grep -n "submit\|thank\|respond-done" public/js/respond.js public/respond.html
```

- [ ] **Step 2: On successful submit, add the send animation**

In `respond.js`, find the block that hides the question UI and shows a "thanks" UI. Wrap the hide in the animation:

```javascript
// before showing the thank-you screen
const postcard = document.querySelector(".question-postcard");
if (postcard) {
  postcard.classList.add("motion-send");
  postcard.addEventListener("animationend", () => {
    document.getElementById("respond-question").classList.add("hidden");
    document.getElementById("respond-thanks").classList.remove("hidden");
  }, { once: true });
} else {
  document.getElementById("respond-question").classList.add("hidden");
  document.getElementById("respond-thanks").classList.remove("hidden");
}
```

(If the existing code already toggles `.hidden` directly without an animation hook, fold the toggle into the `animationend` callback as above.)

- [ ] **Step 3: Make sure prefers-reduced-motion is honoured**

The `motion-send` class is already neutered by the global `prefers-reduced-motion: reduce` rule from Task 7 — no extra work. Verify by running:

```bash
npx playwright test tests/e2e/survey.spec.js -g "answer it" -- \
  --grep-invert "reduced-motion"
```

then add (or extend) a reduced-motion test:

```javascript
// in tests/e2e/survey.spec.js, near the end of the file
test("respond: submit works under prefers-reduced-motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  // ... (re-use the existing respond flow, just confirm the thank-you appears)
});
```

- [ ] **Step 4: Run the suite**

```bash
npx playwright test
```

Expected: all tests pass, including the reduced-motion case.

- [ ] **Step 5: Commit**

```bash
git add public/js/respond.js public/respond.html tests/e2e/survey.spec.js
git commit -m "Signal respond: postcard-send animation on submit"
```

---

### Task 17: Survey report — weather glyphs on each axis

**Files:**
- Modify: `public/js/survey.js` (or wherever the axis rendering lives — likely the same file)

- [ ] **Step 1: Find where axis rows are rendered**

```bash
grep -n "axis-card\|axis-card-name\|axes-grid" public/js/survey.js
```

- [ ] **Step 2: Add a `weatherForScore` helper near the top of the file**

```javascript
/** Map an axis score (0–5) to a weather glyph id from theme-illos.svg. */
function weatherForScore(score) {
  if (!Number.isFinite(score)) return { glyph: "cloud", cls: "axis-glyph-cloud" };
  if (score >= 4)   return { glyph: "sun",   cls: "axis-glyph-sun" };
  if (score >= 3)   return { glyph: "cloud", cls: "axis-glyph-cloud" };
  if (score >= 2)   return { glyph: "wind",  cls: "axis-glyph-wind" };
  return                    { glyph: "rain",  cls: "axis-glyph-rain" };
}
```

- [ ] **Step 3: Update the axis-card markup to include the glyph**

Find the axis-card template (currently emits `.axis-card-name` and `.axis-card-score`). Prepend the glyph:

```javascript
const { glyph, cls } = weatherForScore(axis.score);
card.innerHTML = `
  <div class="axis-card-name">
    <svg class="axis-glyph ${cls}" aria-hidden="true"><use href="/illos/theme-illos.svg#${glyph}"/></svg>
    ${escapeHtml(axis.name)}
  </div>
  <div class="axis-card-score">${axis.score.toFixed(1)}</div>
  <div class="axis-delta delta-${axis.delta_dir}">${axis.delta_label}</div>
`;
```

- [ ] **Step 4: Run the report E2E**

```bash
npx playwright test tests/e2e/survey.spec.js -g "view the report"
```

Expected: PASS. The axis cards now carry a small weather glyph in their name row.

- [ ] **Step 5: Commit**

```bash
git add public/js/survey.js
git commit -m "Signal survey: weather glyph on each axis card"
```

---

## Phase D — Sync script, accessibility audit, deploy

### Task 18: Create the `sync-theme.sh` template (lives in Signal as canonical)

**Files:**
- Create: `scripts/sync-theme.sh`
- Create: `scripts/theme-manifest.txt`

- [ ] **Step 1: Write the manifest of files that get synced**

```text
public/css/theme-core.css
public/illos/theme-illos.svg
public/fonts/Fraunces.woff2
public/fonts/Inter.woff2
public/fonts/JetBrainsMono.woff2
```

(Save as `scripts/theme-manifest.txt`.)

- [ ] **Step 2: Write the script**

```bash
#!/usr/bin/env bash
# scripts/sync-theme.sh
#
# Pull the canonical theme-core assets from the Signal repo into the
# current repo. Run from the root of the consumer repo (scrumpoker or
# retrospective). Lives in Signal as the source; other repos copy it
# into their own scripts/ dir alongside their own theme manifest.
#
# Usage:  ./scripts/sync-theme.sh /path/to/signal

set -euo pipefail

SOURCE="${1:-/var/www/signal}"
MANIFEST="${SCRIPT_MANIFEST:-scripts/theme-manifest.txt}"

if [ ! -d "$SOURCE" ]; then
  echo "Source repo not found: $SOURCE" >&2
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

while IFS= read -r REL; do
  [ -z "$REL" ] && continue
  case "$REL" in \#*) continue ;; esac
  SRC="$SOURCE/$REL"
  DST="$REL"
  if [ ! -f "$SRC" ]; then
    echo "MISSING in source: $SRC" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$DST")"
  cp "$SRC" "$DST"
  echo "synced  $REL"
done < "$MANIFEST"

echo "Theme sync complete. Don't forget to commit the changed files."
```

```bash
chmod +x scripts/sync-theme.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-theme.sh scripts/theme-manifest.txt
git commit -m "Add sync-theme.sh template for downstream repos"
```

---

### Task 19: Document the theme for downstream repos

**Files:**
- Create: `docs/theme-core/README.md`

- [ ] **Step 1: Write the doc**

```markdown
# theme-core

The shared design system for the Signal / Scrum Poker / Retrospective suite.

Signal is the canonical source of truth. Scrum Poker and Retrospective copy
these files in via `scripts/sync-theme.sh`.

## What lives here

| File                                 | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `public/css/theme-core.css`          | Tokens, base type, components, chrome, motion      |
| `public/illos/theme-illos.svg`       | Shared paper-cut illustration sprite               |
| `public/fonts/Fraunces.woff2`        | Headline serif (variable)                          |
| `public/fonts/Inter.woff2`           | UI sans (variable)                                 |
| `public/fonts/JetBrainsMono.woff2`   | Mono for data (variable)                           |
| `scripts/sync-theme.sh`              | Pull script for downstream repos                   |
| `scripts/theme-manifest.txt`         | List of files synced                               |

## Adding a new shared component

1. Define it in `theme-core.css` under section 4.
2. Add per-app behaviour to `theme-<app>.css` if needed.
3. From each consumer repo:  `./scripts/sync-theme.sh /var/www/signal`
4. Commit the synced files in each consumer.

## Palette tokens (overridden per app)

`--bg`, `--bg-warm`, `--surface`, `--border`, `--border-st`, `--ink`,
`--muted`, `--faint`, `--accent`, `--accent-on`, `--accent-2`, `--accent-3`.

See `docs/superpowers/specs/2026-05-23-shared-playful-pastel-theme-design.md`
for per-app palette values.

## CSP constraints

All three apps run a strict CSP. **No inline `<style>` blocks.** **No
`style=""` attributes.** **No third-party font hosts** (Google Fonts CDN).
Anything you can't express in linked CSS belongs in a JS-driven class
toggle, not an inline style.
```

- [ ] **Step 2: Commit**

```bash
git add docs/theme-core/README.md
git commit -m "Document theme-core for downstream consumers"
```

---

### Task 20: Final accessibility + visual verification, then commit deploy notes

**Files:**
- Modify: `README.md` (one line referencing the theme)
- Modify: `docs/deployment.md` (note the new font assets)

- [ ] **Step 1: Run the full test suite**

```bash
npm test && npx playwright test
```

Expected: all passing.

- [ ] **Step 2: Visually verify in a browser**

Start the server and click through every page:

```bash
npm start
```

Then open `http://localhost:3000/` and walk:

- Sign-in → dashboard → /survey → create a survey → respond to it as a teammate → view the report
- Account, admin, license, forgot, reset, verify

For each: no console errors, fonts load (Fraunces visible on h1), palette is the Sky-Peach scheme, postcard glyph appears in the brand mark, weather glyphs appear on dashboard tiles and report axes.

- [ ] **Step 3: Note the new font assets in `docs/deployment.md`**

Find the section listing static files (or add one). Append:

```markdown
### Fonts (added 2026-05-23)

Three self-hosted woff2 files live in `public/fonts/`. They are committed
to the repo (~700 KB total). No CDN or build step is needed — Express
serves them directly. If you switch CDNs or asset hosts, make sure the
`/fonts/` path is preserved.
```

- [ ] **Step 4: Mention the theme in `README.md`**

After the existing project blurb, add:

```markdown
## Design system

Signal is the canonical home of the shared `theme-core` design system used
by the Scrum Poker and Retrospective sister apps. See
`docs/theme-core/README.md` for what to edit and how downstream repos
sync it.
```

- [ ] **Step 5: Final commit**

```bash
git add README.md docs/deployment.md
git commit -m "Document theme-core in README and deployment notes"
```

- [ ] **Step 6: Tag the milestone (optional but useful for the rollout)**

```bash
git tag -a theme-pilot-v1 -m "Signal pilot of shared playful-pastel theme"
```
