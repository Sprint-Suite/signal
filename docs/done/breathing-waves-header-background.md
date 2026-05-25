# Build Doc: Breathing Waves Header Background

**Component:** Animated "breathing waves" canvas, placed in the cream header band on every page.
**Targets:** sprintsignal.uk, sprintretro.uk, sprintpoker.uk (three separate vanilla HTML/CSS/JS codebases).
**Goal:** One shared, drop-in component. Identical behaviour across all three sites. Per-site accent colour is themeable via CSS variables / a config object, with no code changes.

This doc is complete enough to build from with zero guesswork. Build in the order given under "Build order" at the end.

---

## 1. What this is (plain language)

A `<canvas>` sits behind the page title in the cream header band. Five faint green lines drift across it. Each line moves on its own (own speed, direction, vertical drift, wave shape), fades in and out on its own cycle, and thickens and thins on its own cycle. Nothing is synchronised, so the composition never settles. It is deliberately subtle so title text stays fully legible.

It is hand-written canvas (no library, no dependencies, no build step). It respects `prefers-reduced-motion`.

---

## 2. Design tokens

### 2.1 Colour palette

Shared across all three sites unless a site overrides `--accent-set` (see 2.2).

| Semantic name      | Hex       | Use                                  |
|--------------------|-----------|--------------------------------------|
| `--cream`          | `#faf3e6` | Page background, header band base    |
| `--cream-deep`     | `#f6edda` | Card/inset background                 |
| `--card`           | `#ffffff` | Panels, cards                         |
| `--ink`            | `#2a2118` | Primary text, headings                |
| `--muted`          | `#8a7a5e` | Secondary text, eyebrow labels        |
| `--line`           | `#e5d9bf` | Borders, hairlines                    |
| `--green`          | `#2f6b43` | Primary brand green, buttons, links   |
| `--green-deep`     | `#245235` | Hover/active green                    |
| `--green-soft`     | `#8fbf9f` | Light green accent                    |

### 2.2 Wave line colours (the five greens)

The animation draws from a 5-colour array. Default is the Signal green family. Each site may override.

**Default (`signal`) RGB triples:**

```
[47,107,67]    // --green
[143,191,159]  // --green-soft
[36,82,53]     // --green-deep
[99,150,112]   // mid green
[60,120,80]    // deep-mid green
```

These are passed as RGB triples (not hex) because the canvas builds `rgba(...)` strings at runtime to animate opacity. Keep them as arrays of `[r,g,b]`.

**Per-site overrides (optional).** If you want each app visually distinct, define a palette per site. Same structure, different hues. Example shells (tune to taste later, these are starting points that stay in the same lightness range so opacity behaviour is unchanged):

- `signal` (green, default): as above.
- `retro` (warmer green-teal): `[46,110,99]`, `[140,196,184]`, `[33,84,75]`, `[92,150,138]`, `[58,122,110]`
- `poker` (cooler green-blue): `[44,104,112]`, `[138,190,196]`, `[31,80,86]`, `[88,148,156]`, `[55,118,126]`

If you would rather all three look identical, use `signal` everywhere and skip per-site palettes.

### 2.3 Animation constants

These are the exact values the approved demo used. Do not substitute vague values.

| Constant            | Value            | Meaning                                                   |
|---------------------|------------------|-----------------------------------------------------------|
| Line count          | `5`              | Number of wave lines                                      |
| Time step           | `0.02` per frame | Master clock increment (`t += 0.02`)                      |
| x sample step       | `5` px           | Horizontal resolution of each polyline                    |
| Amplitude           | `12` to `28` px  | Per line: `12 + random*16`                                |
| Spatial frequency   | `0.006` to `0.018` | Per line: `0.006 + random*0.012`                        |
| Phase speed         | `0.25` to `0.95` | Per line: `(0.25 + random*0.7)`, sign randomised          |
| Direction           | `+1` or `-1`     | 50/50 random, multiplies phase speed                      |
| Vertical drift speed| `-0.2` to `0.2`  | Per line: `(random-0.5)*0.4`                              |
| Vertical drift amp  | `18` to `40` px  | Per line: `18 + random*22`                                |
| Vertical offset     | spread `-0.5..0.5` | `(i/(n-1) - 0.5)`, multiplied by `80` px in layout      |
| Opacity floor       | `0.08`           | Minimum line alpha                                        |
| Opacity range       | `0.37`           | Max alpha = floor + range = `0.45`                        |
| Opacity cycle speed | `0.2` to `0.7`   | Per line: `0.2 + random*0.5`                              |
| Thickness min       | `2` px           | Thinnest stroke                                           |
| Thickness max       | `9` px nominal   | Per line: `7 + random*3` as the swell ceiling             |
| Thickness cycle speed | `0.18` to `0.63` | Per line: `0.18 + random*0.45`                          |
| Line cap            | `round`          | Canvas `lineCap`                                          |
| devicePixelRatio cap| `2`              | `Math.min(dpr, 2)` to limit retina cost                  |

**Header context tweak:** in the in-app placement, opacity is intentionally faint. If the waves read too quietly behind the title on real content, raise the floor to `0.12` and range to `0.40` (max `0.52`). Treat this as the only sanctioned variant.

### 2.4 Layout tokens for the header band

| Token            | Value                       |
|------------------|-----------------------------|
| Band background  | `var(--cream)`              |
| Band min-height  | `clamp(120px, 22vw, 180px)` |
| Title font       | Georgia / your serif, `clamp(32px, 8vw, 44px)` |
| Eyebrow          | 12px, 700, `letter-spacing: 0.09em`, uppercase, `--muted` |
| Content padding  | `26px 22px 30px`            |
| Content z-index   | above canvas (canvas `z-index: 0`, content `z-index: 1`) |

---

## 3. Files to add (per site)

No build tooling. Two new files plus small edits to your existing header markup and stylesheet.

```
/assets/
  /js/
    breathing-waves.js      <- the component (identical across all 3 sites)
  /css/
    breathing-waves.css     <- header band + canvas styles (identical)
```

Because the three sites are separate codebases, copy both files into each. They are framework-free and self-contained. See section 7 for the optional "host once, share" alternative.

---

## 4. The component: `breathing-waves.js`

Drop this in as-is. It auto-initialises any element with `data-breathing-waves`. Palette is chosen via a `data-wave-palette` attribute (`signal` | `retro` | `poker`), defaulting to `signal`.

```js
/* breathing-waves.js
   Animated header background. No dependencies. Respects prefers-reduced-motion.
   Usage:
     <div class="header-band" data-breathing-waves data-wave-palette="signal">
       <canvas></canvas>             // optional; created if absent
       <div class="header-content"> ... </div>
     </div>
*/
(function () {
  'use strict';

  var PALETTES = {
    signal: [[47,107,67],[143,191,159],[36,82,53],[99,150,112],[60,120,80]],
    retro:  [[46,110,99],[140,196,184],[33,84,75],[92,150,138],[58,122,110]],
    poker:  [[44,104,112],[138,190,196],[31,80,86],[88,148,156],[55,118,126]]
  };

  // Tunable in one place. Matches the approved demo.
  var CFG = {
    lineCount: 5,
    timeStep: 0.02,
    xStep: 5,
    opacityFloor: 0.08,   // header tweak: 0.12
    opacityRange: 0.37,   // header tweak: 0.40
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
      draw(); // one static frame, no animation loop
    } else {
      frame();
      // Pause when tab is hidden to save battery.
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

**Notes for the builder**
- Pauses the animation loop when the browser tab is hidden (battery).
- Under reduced motion it paints a single static frame and never loops.
- The `data-wave-palette` attribute is the only per-site difference. To make all three identical, omit it everywhere.

---

## 5. The styles: `breathing-waves.css`

```css
/* breathing-waves.css */

.header-band {
  position: relative;
  background: var(--cream, #faf3e6);
  overflow: hidden;
  min-height: clamp(120px, 22vw, 180px);
  isolation: isolate; /* keeps canvas blend contained */
}

.header-band > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none; /* clicks pass through to content */
}

.header-band > .header-content {
  position: relative;
  z-index: 1;
  padding: 26px 22px 30px;
}

.header-band .eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted, #8a7a5e);
  margin: 0 0 8px;
}

.header-band .header-title {
  font-family: Georgia, 'Times New Roman', serif; /* swap to your serif */
  font-size: clamp(32px, 8vw, 44px);
  letter-spacing: -0.02em;
  line-height: 1.02;
  color: var(--ink, #2a2118);
  margin: 0;
}

.header-band .header-subtitle {
  font-family: Georgia, serif;
  color: var(--muted, #8a7a5e);
  font-size: 17px;
  margin: 8px 0 0;
}
```

---

## 6. HTML integration (each page, each site)

Wrap your existing page heading in the band. Minimal change: add the wrapper, the `data-` attributes, and an empty `<canvas>`.

```html
<!-- In <head>, once per page -->
<link rel="stylesheet" href="/assets/css/breathing-waves.css">

<!-- The header band, replacing your current title block -->
<header class="header-band" data-breathing-waves data-wave-palette="signal">
  <canvas></canvas>
  <div class="header-content">
    <p class="eyebrow">Create</p>
    <h1 class="header-title">New survey</h1>
    <p class="header-subtitle">Pick a team and a template to generate a link.</p>
  </div>
</header>

<!-- Before </body>, once per page -->
<script src="/assets/js/breathing-waves.js" defer></script>
```

**Per site, set the palette attribute:**
- sprintsignal.uk: `data-wave-palette="signal"`
- sprintretro.uk: `data-wave-palette="retro"`
- sprintpoker.uk: `data-wave-palette="poker"`

(Or omit on all three for an identical look.)

**Eyebrow text per page** is just static copy: `Create`, `Health check report`, `Teams & admins`, etc. The component does not touch it.

---

## 7. Sharing across three codebases

You have two routes. Pick one.

**Route A: Copy into each repo (recommended for vanilla, zero infra).**
Drop the two files into each site's `/assets`. When you change the component, update three copies. Simple, no dependencies, no network coupling. Best if the sites deploy independently.

**Route B: Host once, link everywhere.**
Put `breathing-waves.js` and `.css` on one origin (or a small shared static bucket / CDN) and reference the same URL from all three sites. One update propagates everywhere. Trade-off: a runtime dependency between sites, plus a cross-origin request. Only worth it if you expect frequent tweaks.

For three small sites that already deploy separately, Route A is the lower-risk default. Revisit B only if maintaining three copies becomes annoying.

---

## 8. Accessibility requirements

- **Reduced motion:** handled in JS. Under `prefers-reduced-motion: reduce`, paint one static frame, no loop. Already implemented.
- **Contrast:** the waves are decorative and sit behind text. Title text (`--ink` on `--cream`) must meet WCAG AA. `#2a2118` on `#faf3e6` is ~13:1, well clear. Do not place body text directly over the densest part of the waves; keep text in `.header-content` which sits above and on the solid cream base.
- **Decorative, not semantic:** the canvas carries no information. Leave it out of the accessibility tree. Add `aria-hidden="true"` to the `<canvas>` (add this to the created element in JS, or to a pre-placed canvas in markup).
- **Keyboard / focus:** canvas is `pointer-events: none` and non-interactive, so it never takes focus. No focus styling needed.
- **Motion intensity:** opacity stays under 0.52 and motion is slow, which keeps it gentle for vestibular sensitivity even in the non-reduced state.

**Action for builder:** add `aria-hidden="true"` to the canvas. In the JS, when creating the canvas, also set `canvas.setAttribute('aria-hidden','true')`.

---

## 9. Performance notes

- Single `<canvas>`, five polylines, ~`width/5` points each. Trivial GPU load.
- `devicePixelRatio` capped at 2 so retina phones do not over-render.
- Animation loop pauses on hidden tab.
- No layout thrash: `resize` only runs on window resize, reads `getBoundingClientRect` once per event.
- Expected cost: negligible on modern phones. If you ever stack multiple bands on one page, init only the one in view.

---

## 10. Build order (do this, in this order)

1. **Add `breathing-waves.css`** to one site. Confirm the header band renders with the cream background and correct padding (no canvas yet).
2. **Add `breathing-waves.js`** and an empty `<canvas>` plus `data-breathing-waves`. Confirm waves animate behind the title and text stays crisp.
3. **Add `aria-hidden="true"`** to the canvas. Verify with a screen reader or the accessibility inspector that the canvas is ignored.
4. **Test reduced motion:** toggle the OS setting, reload, confirm a single static frame with no animation.
5. **Tune opacity if needed:** if too faint over real content, switch floor/range to the header tweak values (0.12 / 0.40).
6. **Roll to the other two sites:** copy both files, set `data-wave-palette` per site (or omit for identical look).
7. **Cross-check on a real phone** (battery and legibility), portrait and landscape.

---

## 11. Acceptance checklist

- [ ] Waves animate behind the title on every page of all three sites.
- [ ] Each line moves, fades, and changes thickness independently.
- [ ] Title and subtitle remain fully legible (AA contrast).
- [ ] Reduced motion shows a static frame, no loop.
- [ ] Canvas is `aria-hidden` and non-interactive.
- [ ] Animation pauses on hidden tab.
- [ ] No console errors, no layout shift on load or resize.
- [ ] Per-site palette applied (or intentionally identical).
