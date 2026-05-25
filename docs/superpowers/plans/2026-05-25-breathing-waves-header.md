# Breathing Waves Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the spec'd breathing-waves canvas component into Signal and wrap the page-title area of every page that has an `<h1>` (admin pages + license) in a cream "header band" with the animation behind it.

**Architecture:** Two new static assets (`public/js/breathing-waves.js`, `public/css/breathing-waves.css`) auto-initialise any element with `data-breathing-waves`. The CSS uses Signal's existing tokens (`--bg`, `--ink`, `--muted`, `--serif`) rather than inventing new ones; the JS keeps the signal-green RGB palette baked in. Each target HTML page gets the CSS/JS linked and its `<h1>` wrapped in a `<header class="header-band">…</header>`.

**Tech Stack:** Vanilla HTML/CSS/JS. No build step. Strict CSP (`script-src 'self'`, `style-src 'self'`) — all code lives in external files, no inline. Playwright for e2e smoke.

**Spec reference:** `docs/breathing-waves-header-background.md`. Read it before starting. Code blocks below are derived from it; deviations are flagged.

---

## File structure

**Create:**
- `public/js/breathing-waves.js` — the component (auto-init, prefers-reduced-motion, aria-hidden injected on created canvas)
- `public/css/breathing-waves.css` — `.header-band`, canvas positioning, `.eyebrow`, `.header-title`, `.header-subtitle`
- `tests/e2e/header-waves.spec.js` — Playwright smoke: visits each page, asserts the band + aria-hidden canvas exist, no console errors

**Modify (HTML — wrap page title in `<header class="header-band">`):**
- `public/dashboard.html` — wrap `<h1>Surveys</h1>` (sits inside `#main-content > .spread`)
- `public/account.html` — wrap `<h1>Your account</h1>`
- `public/admin.html` — wrap `<h1>Teams &amp; admins</h1>`
- `public/survey.html` — TWO bands: wrap `<h1>New survey</h1>` in `#builder`; convert `<div class="report-head">` to a header-band (preserves `#report-title`, `#report-sub` ids; renames `.kicker` → `.eyebrow`)
- `public/license.html` — pull `<h1>` out of `.card` into a band above the card

**Untouched (out of scope per user decision):** `index.html`, `forgot.html`, `reset.html`, `verify.html` (hero/auth flow), `respond.html` (respond shell).

---

### Task 1: Create `breathing-waves.js`

**Files:**
- Create: `public/js/breathing-waves.js`

- [ ] **Step 1: Write the JS file (spec verbatim + two additions)**

Two deltas from the spec's `breathing-waves.js`:
1. **Always set `aria-hidden="true"` on the canvas** (spec §8 says the builder must do this; safest to do it unconditionally in JS so pages with a pre-placed `<canvas>` still get it).
2. **Set `role="presentation"`** as belt-and-braces for screen readers.

Write `public/js/breathing-waves.js`:

```js
/* breathing-waves.js
   Animated header background. No dependencies. Respects prefers-reduced-motion.
   Spec: docs/breathing-waves-header-background.md
   Usage:
     <header class="header-band" data-breathing-waves data-wave-palette="signal">
       <canvas></canvas>             // optional; created if absent
       <div class="header-content"> ... </div>
     </header>
*/
(function () {
  'use strict';

  var PALETTES = {
    signal: [[47,107,67],[143,191,159],[36,82,53],[99,150,112],[60,120,80]],
    retro:  [[46,110,99],[140,196,184],[33,84,75],[92,150,138],[58,122,110]],
    poker:  [[44,104,112],[138,190,196],[31,80,86],[88,148,156],[55,118,126]]
  };

  var CFG = {
    lineCount: 5,
    timeStep: 0.02,
    xStep: 5,
    opacityFloor: 0.08,
    opacityRange: 0.37,
    offsetSpreadPx: 80,
    dprCap: 2
  };

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeLines(n, palette) {
    var lines = [];
    for (var i = 0; i < n; i++) {
      lines.push({
        amp:      12 + Math.random() * 16,
        freq:     0.006 + Math.random() * 0.012,
        speed:    (0.25 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
        drift:    (Math.random() - 0.5) * 0.4,
        driftAmp: 18 + Math.random() * 22,
        phase:    Math.random() * Math.PI * 2,
        offset:   n > 1 ? (i / (n - 1) - 0.5) : 0,
        opSpeed:  0.2 + Math.random() * 0.5,
        opPhase:  Math.random() * Math.PI * 2,
        thSpeed:  0.18 + Math.random() * 0.45,
        thPhase:  Math.random() * Math.PI * 2,
        thMin:    2,
        thMax:    7 + Math.random() * 3,
        col:      palette[i % palette.length]
      });
    }
    return lines;
  }

  function init(host) {
    var canvas = host.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      host.insertBefore(canvas, host.firstChild);
    }
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');

    var ctx = canvas.getContext('2d');
    var paletteName = host.getAttribute('data-wave-palette') || 'signal';
    var palette = PALETTES[paletteName] || PALETTES.signal;
    var lines = makeLines(CFG.lineCount, palette);
    var t = 0;
    var w = 0, h = 0;

    function resize() {
      var rect = host.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, CFG.dprCap);
      w = rect.width; h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (var k = 0; k < lines.length; k++) {
        var L = lines[k];
        var o = CFG.opacityFloor +
                (Math.sin(t * L.opSpeed + L.opPhase) * 0.5 + 0.5) * CFG.opacityRange;
        var th = L.thMin +
                 (Math.sin(t * L.thSpeed + L.thPhase) * 0.5 + 0.5) * (L.thMax - L.thMin);
        var baseY = h / 2 + L.offset * CFG.offsetSpreadPx +
                    Math.sin(t * L.drift + L.phase) * L.driftAmp;
        ctx.strokeStyle = 'rgba(' + L.col[0] + ',' + L.col[1] + ',' + L.col[2] + ',' + o + ')';
        ctx.lineWidth = th;
        ctx.beginPath();
        for (var x = 0; x <= w; x += CFG.xStep) {
          var y = baseY + Math.sin(x * L.freq + t * L.speed + L.phase) * L.amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    var rafId = null;
    function frame() {
      draw();
      t += CFG.timeStep;
      rafId = window.requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);

    if (reduceMotion) {
      draw();
    } else {
      frame();
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
        } else if (!rafId) {
          frame();
        }
      });
    }
  }

  function boot() {
    var hosts = document.querySelectorAll('[data-breathing-waves]');
    for (var i = 0; i < hosts.length; i++) init(hosts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 2: Sanity-check by linting visually**

No automated lint configured. Read through, confirm no syntax errors, no stray globals (everything is inside the IIFE).

---

### Task 2: Create `breathing-waves.css`

**Files:**
- Create: `public/css/breathing-waves.css`

- [ ] **Step 1: Write the CSS file (adapted to Signal tokens)**

Differences from the spec's CSS:
- Use Signal's tokens: `--bg` (not `--cream`), `--ink`, `--muted`, `--serif` (Fraunces).
- Drop hex fallbacks (Signal's `theme-core.css` always defines these tokens — no fallback needed).
- Preserve the `.header-band > canvas { pointer-events: none }` rule and `isolation: isolate`.

Write `public/css/breathing-waves.css`:

```css
/* breathing-waves.css
 * Spec: docs/breathing-waves-header-background.md
 * Cream header band with animated canvas behind the page title.
 * Loaded AFTER theme-core.css / theme-signal.css.
 */

.header-band {
  position: relative;
  background: var(--bg);
  overflow: hidden;
  min-height: clamp(120px, 22vw, 180px);
  isolation: isolate;
}

.header-band > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
}

.header-band > .header-content {
  position: relative;
  z-index: 1;
  padding: 26px 22px 30px;
}

.header-band .eyebrow {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 8px;
}

.header-band .header-title {
  font-family: var(--serif);
  font-size: clamp(32px, 8vw, 44px);
  letter-spacing: -0.02em;
  line-height: 1.02;
  color: var(--ink);
  margin: 0;
}

.header-band .header-subtitle {
  font-family: var(--serif);
  color: var(--muted);
  font-size: 17px;
  margin: 8px 0 0;
}
```

---

### Task 3: Wire `dashboard.html`

**Files:**
- Modify: `public/dashboard.html`

- [ ] **Step 1: Link the CSS in `<head>` and the JS at the end of `<body>`**

In `<head>`, after the existing `app.css` link, add:

```html
<link rel="stylesheet" href="/css/breathing-waves.css">
```

In `<head>`, after the existing `dashboard.js` script line, add:

```html
<script src="/js/breathing-waves.js" defer></script>
```

(Existing scripts already use `defer`, so this matches the pattern.)

- [ ] **Step 2: Wrap the page heading in a header band**

The current page structure (line ~39-43) is:

```html
<div id="main-content" class="hidden stack">
  <div class="spread">
    <h1>Surveys</h1>
    <a class="btn btn-primary" href="/survey">New survey</a>
  </div>
```

Replace it with the header-band above the `#main-content` container. The "New survey" CTA stays as a row inside `#main-content`. The band sits outside `#main-content` so it's visible even while the dashboard data is loading (a friendlier loading state).

Final markup (replace lines from `<main class="page">` through the existing `<h1>` row):

```html
<header class="header-band" data-breathing-waves data-wave-palette="signal">
  <canvas></canvas>
  <div class="header-content">
    <p class="eyebrow">Workspace</p>
    <h1 class="header-title">Surveys</h1>
  </div>
</header>

<main class="page">
  <div id="verify-banner" class="card hidden">
    <!-- ... existing verify banner unchanged ... -->
  </div>

  <div id="main-content" class="hidden stack">
    <div class="spread">
      <a class="btn btn-primary" href="/survey">New survey</a>
    </div>
    <!-- ... rest unchanged ... -->
```

Note: the original `<div class="spread">` had two children (`<h1>` + button), which left the button right-aligned. After removing the `<h1>` the button alone in a `.spread` will sit left-aligned. If `.spread` uses `justify-content: space-between`, a single child looks identical to `flex-start`. Verify visually in Task 9; if it's wrong, change `<div class="spread">` to `<div class="row">` or move the button to a more natural spot.

- [ ] **Step 3: Save**

No commit yet — batch with later tasks.

---

### Task 4: Wire `account.html`

**Files:**
- Modify: `public/account.html`

- [ ] **Step 1: Link CSS + JS** (same pattern as Task 3)

In `<head>`, after `app.css`:

```html
<link rel="stylesheet" href="/css/breathing-waves.css">
```

After the `account.js` script line:

```html
<script src="/js/breathing-waves.js" defer></script>
```

- [ ] **Step 2: Wrap the page heading**

Current (line 25-26):

```html
<main class="page page-narrow">
  <h1>Your account</h1>
```

Change to:

```html
<header class="header-band" data-breathing-waves data-wave-palette="signal">
  <canvas></canvas>
  <div class="header-content">
    <p class="eyebrow">Profile</p>
    <h1 class="header-title">Your account</h1>
  </div>
</header>

<main class="page page-narrow">
```

---

### Task 5: Wire `admin.html`

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Link CSS + JS**

In `<head>`, after `app.css`:

```html
<link rel="stylesheet" href="/css/breathing-waves.css">
```

After the `admin.js` script line:

```html
<script src="/js/breathing-waves.js" defer></script>
```

- [ ] **Step 2: Wrap the page heading**

Current (line 26-27):

```html
<main class="page">
  <h1>Teams &amp; admins</h1>
```

Change to:

```html
<header class="header-band" data-breathing-waves data-wave-palette="signal">
  <canvas></canvas>
  <div class="header-content">
    <p class="eyebrow">Workspace</p>
    <h1 class="header-title">Teams &amp; admins</h1>
  </div>
</header>

<main class="page">
```

---

### Task 6: Wire `survey.html` (two bands)

**Files:**
- Modify: `public/survey.html`

- [ ] **Step 1: Link CSS + JS**

In `<head>`, after `app.css`:

```html
<link rel="stylesheet" href="/css/breathing-waves.css">
```

After the `survey.js` script line (keep it AFTER `radar.js` and `survey.js` — order doesn't matter for these but keep defer ordering tidy):

```html
<script src="/js/breathing-waves.js" defer></script>
```

- [ ] **Step 2: Wrap the builder section's heading**

Current (line 32-33):

```html
<section id="builder" class="hidden">
  <h1>New survey</h1>
```

Change to:

```html
<section id="builder" class="hidden">
  <header class="header-band" data-breathing-waves data-wave-palette="signal">
    <canvas></canvas>
    <div class="header-content">
      <p class="eyebrow">Create</p>
      <h1 class="header-title">New survey</h1>
    </div>
  </header>
```

The closing `</section>` at line 81 stays where it is.

- [ ] **Step 3: Convert the report section's `.report-head` into a header band**

Current (line 84-89):

```html
<section id="report" class="hidden">
  <div class="report-head">
    <p class="kicker">Health check report</p>
    <h1 id="report-title">Survey</h1>
    <p id="report-sub" class="muted"></p>
  </div>
```

Change to:

```html
<section id="report" class="hidden">
  <header class="header-band" data-breathing-waves data-wave-palette="signal">
    <canvas></canvas>
    <div class="header-content">
      <p class="eyebrow">Health check report</p>
      <h1 id="report-title" class="header-title">Survey</h1>
      <p id="report-sub" class="header-subtitle"></p>
    </div>
  </header>
```

Critical: preserve `id="report-title"` and `id="report-sub"` — `public/js/survey.js` references both via `getElementById` (see survey.js:193, 200).

The CSS rule `.report-head { margin-bottom: var(--s-6); }` in `app.css` no longer applies to this markup. The header-band already has visual separation via its own background. Acceptable to leave the orphan rule in `app.css` for now; flag for cleanup in a follow-up if it bothers anyone.

Hidden-state behaviour: `#builder` and `#report` already use `class="hidden"` (display: none). Their child header-bands inherit that and the JS inside them will fall back to a zero-size canvas. When the section toggles visible, the canvas `resize()` runs on the next window resize — but we need it to run when shown. **Workaround:** the JS reads dimensions from `getBoundingClientRect()` at init time. If the section is hidden at init, the band will get 0x0. To handle this without changing the JS, the band must be initialised after the section is unhidden. Easiest fix is to rely on a window resize after section toggle, but that's brittle.

**Decision:** for survey.html, accept that the waves may not render on first reveal of a section if the section was hidden at page load. Verify in Task 9; if it's an issue, the fix is to dispatch a `resize` event from `survey.js` after toggling `.hidden`. That's a tiny addition — flag it as a Task 6 Step 4 only if Task 9 confirms the problem.

- [ ] **Step 4 (conditional, only if Task 9 reveals empty canvas on section toggle):**

In `public/js/survey.js`, find the place(s) that toggle `#builder` or `#report` from hidden to visible (search for `classList.remove("hidden")` near those ids) and add `window.dispatchEvent(new Event('resize'));` immediately after the toggle. This re-runs the canvas `resize()` and gives the bands the correct dimensions.

Don't do this step unless Task 9 surfaces the bug.

---

### Task 7: Wire `license.html`

**Files:**
- Modify: `public/license.html`

- [ ] **Step 1: Link CSS** (license has no other JS to follow; add JS line too)

In `<head>`, after `app.css`:

```html
<link rel="stylesheet" href="/css/breathing-waves.css">
<script src="/js/breathing-waves.js" defer></script>
```

- [ ] **Step 2: Move the heading out of the card into a header band**

Current (lines 12-21):

```html
<main class="page page-narrow">
  <div class="card">
    <p class="brand">
      <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#postcard"/></svg>
      <span>Signal</span>
    </p>
    <h1>Signal Free Use License</h1>
    <p>This tool is free to use, but it is not open source.</p>
    <!-- ... rest of card ... -->
```

Change to:

```html
<header class="header-band" data-breathing-waves data-wave-palette="signal">
  <canvas></canvas>
  <div class="header-content">
    <p class="eyebrow">Legal</p>
    <h1 class="header-title">Signal Free Use License</h1>
  </div>
</header>

<main class="page page-narrow">
  <div class="card">
    <p class="brand">
      <svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#postcard"/></svg>
      <span>Signal</span>
    </p>
    <p>This tool is free to use, but it is not open source.</p>
    <!-- ... rest of card ... -->
```

(Keep the brand chip inside the card — it's part of the document framing. Only the `<h1>` moves to the band.)

---

### Task 8: Add Playwright smoke test

**Files:**
- Create: `tests/e2e/header-waves.spec.js`

- [ ] **Step 1: Inspect existing e2e patterns**

Read `tests/e2e/smoke.spec.js` to see how Signal sets up sign-in, navigation, and the `credentials.js` helpers. Match its style (same imports, same auth flow).

- [ ] **Step 2: Write the failing test**

Write `tests/e2e/header-waves.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const { signInAsAdmin } = require("./credentials");

const PAGES_BEHIND_AUTH = [
  { path: "/dashboard", title: "Surveys" },
  { path: "/account", title: "Your account" },
  { path: "/admin", title: "Teams & admins" },
  { path: "/survey", title: "New survey" }
];

const PAGES_PUBLIC = [
  { path: "/license", title: "Signal Free Use License" }
];

test.describe("breathing waves header", () => {
  test("renders on public pages with canvas aria-hidden", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    for (const { path, title } of PAGES_PUBLIC) {
      await page.goto(path);
      const band = page.locator(".header-band[data-breathing-waves]").first();
      await expect(band).toBeVisible();
      const canvas = band.locator("canvas");
      await expect(canvas).toHaveAttribute("aria-hidden", "true");
      await expect(band.locator(".header-title")).toContainText(title);
    }
    expect(consoleErrors).toEqual([]);
  });

  test("renders on auth-gated pages with canvas aria-hidden", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await signInAsAdmin(page);

    for (const { path, title } of PAGES_BEHIND_AUTH) {
      await page.goto(path);
      const band = page.locator(".header-band[data-breathing-waves]").first();
      await expect(band).toBeVisible();
      const canvas = band.locator("canvas");
      await expect(canvas).toHaveAttribute("aria-hidden", "true");
      await expect(band.locator(".header-title").first()).toContainText(title);
    }
    expect(consoleErrors).toEqual([]);
  });
});
```

Note: if `signInAsAdmin` doesn't exist with that name in `credentials.js`, use whatever helper the existing specs use. Read `tests/e2e/smoke.spec.js` to confirm.

- [ ] **Step 3: Run the test and watch it fail (before HTML edits are saved, it'd fail; after they're saved, it should pass — so run AFTER tasks 3-7)**

Run: `npx playwright test tests/e2e/header-waves.spec.js`

Expected on the first run (after all edits): PASS for all assertions on all five pages.

If FAIL, read the trace in `test-results/` and fix the offending page.

- [ ] **Step 4: Run the full e2e suite to confirm no regressions**

Run: `npm run test:e2e`

Expected: all existing specs (smoke, survey, grouping) still pass.

---

### Task 9: Manual verification

**Files:** none — verifies the running app.

- [ ] **Step 1: Start the server**

Run: `node server.js` (or `npm start`)

Note from auto-memory: `npm run dev`'s `--watch` is unreliable for server-side edits on this WSL2 host, but we're not editing server code here — only static `/public/*` assets which are served straight from disk, so either command works.

- [ ] **Step 2: Visit each modified page in a browser**

Visit:
- `http://localhost:3000/license` (or whatever PORT the server prints)
- Sign in, then visit `/dashboard`, `/account`, `/admin`, `/survey`
- For `/survey`, also navigate to an existing survey's report URL (`/survey?id=...`) to verify the report header-band renders

For each page, confirm:
- Cream band with five faint forest-green wavy lines drifting
- Page title clearly legible (no contrast loss)
- No console errors / no layout shift
- Resize the window — band scales smoothly, no clipping

- [ ] **Step 3: Test reduced motion**

In Chrome devtools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → reduce. Reload the page. Confirm the waves render as a static frame and do not animate.

- [ ] **Step 4: Verify aria-hidden via accessibility tree**

In Chrome devtools → Elements → Accessibility tab, inspect the `<canvas>`. It should not appear in the a11y tree (because `aria-hidden="true"`).

- [ ] **Step 5: Test tab visibility pause**

Switch to another tab for a few seconds, switch back. The animation should resume seamlessly (no jump). Open devtools Performance tab and confirm raf does not run while the tab is hidden (optional sanity check).

- [ ] **Step 6: If survey.html sections show empty bands on toggle**

If Task 6 Step 3's concern bites — i.e. you click into the report view and see a band with no waves — do Task 6 Step 4 (dispatch resize after `.hidden` toggle in survey.js).

---

### Task 10: Commit

- [ ] **Step 1: Review the diff**

Run: `git status` and `git diff --stat`

Expected files changed:
- `public/css/breathing-waves.css` (new)
- `public/js/breathing-waves.js` (new)
- `public/dashboard.html`
- `public/account.html`
- `public/admin.html`
- `public/survey.html`
- `public/license.html`
- `tests/e2e/header-waves.spec.js` (new)

- [ ] **Step 2: Commit**

```bash
git add public/css/breathing-waves.css public/js/breathing-waves.js \
        public/dashboard.html public/account.html public/admin.html \
        public/survey.html public/license.html \
        tests/e2e/header-waves.spec.js
git commit -m "$(cat <<'EOF'
feat(ui): add breathing-waves header band to admin + license pages

Drop-in canvas animation behind the page title on dashboard, account,
admin, survey (builder + report), and license. Spec:
docs/breathing-waves-header-background.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Archive the spec**

Per auto-memory (`feedback-archive-executed-specs`): once a spec ships, `git mv` it to `docs/done/`.

```bash
git mv docs/breathing-waves-header-background.md docs/done/
git commit -m "docs: archive breathing-waves spec under docs/done

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify clean tree**

Run: `git status`
Expected: nothing to commit, working tree clean.

---

## Self-review notes (already applied)

- **Spec coverage:** §2 design tokens → CSS task; §3 file structure → Tasks 1+2; §4 JS → Task 1 (verbatim + aria-hidden tweak from §8); §5 CSS → Task 2 (adapted to Signal tokens); §6 HTML integration → Tasks 3-7; §7 sharing → N/A (single site); §8 a11y → Task 1 (aria-hidden), Task 9 step 4 (verify); §9 perf → Task 1 (dpr cap, visibility pause already in spec JS); §10 build order → matches task order; §11 acceptance checklist → Task 9 covers each item.
- **Type consistency:** `data-breathing-waves` attribute name, `.header-band` class, `.header-content` wrapper, `.eyebrow / .header-title / .header-subtitle` classes used identically in every page change.
- **No placeholders:** every step contains the actual code/markup; no "TBD".
- **Survey.html section-toggle risk** flagged in Task 6 with explicit conditional fix in Step 4 — not pre-emptively applied because the spec JS may handle it via the `resize` listener on first viewport tick after unhide (unverified). Task 9 confirms.
