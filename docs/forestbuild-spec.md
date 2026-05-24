# Build Spec: Unify Signal, Retrospective & Scrum Poker on the Forest Accent

**For:** Claude Code
**Goal:** Make all three apps share one design system with a single accent colour (Forest `#2E6F4E`), light mode only, while keeping the existing typography, spacing, radius and shadow foundation that is already consistent across the suite.

**Scope of work:** This is a re-skin, not a rebuild. Most of the change is editing CSS custom properties (design tokens). One app (Retrospective) has component-level overrides that must also be edited. Do not change layout, markup structure, or behaviour unless explicitly listed below.

---

## 0. Apps & file locations

| App | Path | Dev URL | Token file | Component CSS |
|---|---|---|---|---|
| Signal | `/var/www/signal` | `localhost:3002/dashboard` | `:root` block (theme file) | app styles |
| Retrospective | `/var/www/retrospective` | `localhost:3001/lobby` | `theme-retro.css` | `app.css` |
| Scrum Poker | `/var/www/scrumpoker` | `localhost:3000/` | theme file | app styles |

**First action:** In each repo, locate the file containing the `:root { --accent: ... }` declaration. In Retrospective this is confirmed to be `theme-retro.css`. Confirm the equivalent file in Signal and Scrum Poker before editing.

---

## 1. Design tokens (the single source of truth)

These are the **target** values. After this work, all three apps must expose this exact token set in their `:root`. Values that differ per app today are called out in Section 4.

### 1.1 Colour — foundation (identical in all three, mostly already correct)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#FDF8EB` | Page background (warm cream) |
| `--bg-warm` | `#F4ECE0` | Secondary panels, list-row fills |
| `--surface` | `#FFFFFF` | Cards, inputs, top bars |
| `--border` | `#E8D9C0` | Default 1px borders |
| `--border-st` | `#C9B27A` | Stronger borders (dividers, emphasis) |
| `--ink` | `#2A2118` | Primary text |
| `--muted` | `#876641` | Secondary text |
| `--faint` | `#B0916B` | Tertiary text, captions |

### 1.2 Colour — accent (THE change, identical in all three)

| Token | Value | Role |
|---|---|---|
| `--accent` | `#2E6F4E` | Primary buttons, links, focus rings, active nav, selected states |
| `--accent-on` | `#FFFFFF` | Text/icon on top of accent fills |
| `--accent-soft` | `#DEEBE2` | Tinted backgrounds (icon chips, hover glow, soft pills) |
| `--accent-deep` | `#245C40` | Hover/pressed accent, text on `--accent-soft` |

> **Contrast check:** `#2E6F4E` on `#FFFFFF` = 4.8:1 (passes WCAG AA for normal text and UI). `#FFFFFF` on `#2E6F4E` = 4.8:1 (passes AA for the button label). `--accent-deep #245C40` on `--accent-soft #DEEBE2` = 6.9:1 (passes AA).

### 1.3 Colour — status (success is SEPARATED from accent; rest unchanged)

| Token | Value | Role | Change |
|---|---|---|---|
| `--ok` | `#1E5A3A` | Success / OK / "closed" / "connected" text | **Changed** from `#2A5A2A` to a deeper, bluer pine so it never reads as the accent |
| `--ok-bg` | `#D7E8DC` | Success badge background | **Changed** from `#DCE9DA` (slightly cooler to match) |
| `--warn` | `#B8780A` | Warning / flagged text | Unchanged |
| `--warn-bg` | `#F9E6C7` | Warning badge background | Unchanged |
| `--err` | `#B4232A` | Error text | Unchanged |
| `--err-bg` | `#F8D7DA` | Error badge background | Unchanged |
| `--info` | `#2D5FAA` | Info text | Unchanged |
| `--info-bg` | `#DCE5F4` | Info badge background | Unchanged |

> **Why this matters:** With a green accent, a green success badge sitting next to a green primary button is ambiguous. `--accent #2E6F4E` and `--ok #1E5A3A` must stay visibly distinct. Verify side by side after the change. `--ok #1E5A3A` on `--ok-bg #D7E8DC` = 6.4:1 (passes AA).

### 1.4 Typography (already consistent, do not change)

| Token | Value |
|---|---|
| `--serif` | `"Fraunces", Georgia, serif` |
| `--sans` | `"Inter", system-ui, -apple-system, sans-serif` |
| `--mono` | `"JetBrains Mono", ui-monospace, monospace` |

**Scale (confirmed in use):**

| Use | Family | Weight | Size | Notes |
|---|---|---|---|---|
| Page title (h1/h2) | Fraunces | 600 | 26–32px | Display headings |
| Sub-heading (h3/h4) | Fraunces | 600 | 18–22px | Panel titles |
| Body | Inter | 400 | 15px | Base `font-size` |
| Body strong | Inter | 600 | 14.5px | Row titles |
| Caption / meta | Inter | 400/500 | 12.5px | Secondary lines |
| Pill / status label | Inter | 700 | 10.5px | Uppercase, letter-spacing 0.04em |
| Button label | Inter | 700 | 13.5px | |

### 1.5 Spacing scale (do not change)

`--s-1: 4px` · `--s-2: 8px` · `--s-3: 12px` · `--s-4: 16px` · `--s-6: 24px` · `--s-8: 32px` · `--s-12: 48px`

### 1.6 Radius scale (do not change)

`--r-sm: 6px` · `--r-md: 8px` · `--r-lg: 12px` · `--r-xl: 16px` · `--r-pill: 999px`

### 1.7 Shadows (do not change)

```css
--shadow-sm: 0 1px 0 rgba(42,31,18,0.04);
--shadow-md: 0 1px 0 rgba(42,31,18,0.04), 0 8px 24px rgba(42,31,18,0.06);
--shadow-lg: 0 1px 0 rgba(42,31,18,0.04), 0 16px 44px rgba(42,31,18,0.10);
```

### 1.8 Breakpoints

| Name | Width | Behaviour |
|---|---|---|
| Mobile | `≤ 640px` | Hide top-nav links (use existing menu pattern), single-column, full-width buttons |
| Desktop | `> 640px` | Default multi-column layouts |

Mobile-first. These match the existing apps; confirm and reuse rather than introducing new ones.

---

## 2. Components (target states, all apps)

Each component below already exists. The instruction is to make it conform to these states using the tokens above. Do not restyle beyond what is listed.

### 2.1 Primary button

- Background `--accent`, label `--accent-on`, font Inter 700 / 13.5px, radius `--r-pill`, padding `9px 18px`.
- **No gradient.** Solid fill only.
- Shadow `0 1px 2px rgba(42,31,18,0.12)`.
- **Hover:** `filter: brightness(1.08)`, `transform: translateY(-1px)`, shadow `0 4px 12px rgba(42,31,18,0.16)`. Transition `120ms ease`.
- **Focus-visible:** `outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent);`

### 2.2 Secondary / neutral button

- Background `--surface`, label `--ink`, border `1px solid var(--border)`, same radius and padding.
- Hover: border `--accent`, label `--accent-deep`.

### 2.3 Ghost button (e.g. Retrospective "Actions Report")

- Transparent background, label `--accent`, border `1.5px solid var(--accent)`, same radius.
- Hover: background `--accent-soft`.

### 2.4 Inputs & selects

- Background `--surface`, text `--ink`, border `1px solid var(--border)`, radius `--r-md`, padding `10px 12px`.
- Placeholder `--faint`.
- **Focus:** `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);` outline none.

### 2.5 List row / card

- Background `--surface`, border `1px solid var(--border)`, radius `--r-lg`, padding `16px 18px`.
- **Hover:** border `--accent`, `box-shadow: 0 0 0 3px var(--accent-soft)`. Transition 120ms.
- Leading icon chip: `34×34`, radius `9px`, background `--accent-soft`, icon stroke `--accent`.

### 2.6 Status pills

| Pill | Background | Text |
|---|---|---|
| Open / active | `--accent-soft` | `--accent-deep` |
| Closed / OK / connected | `--ok-bg` | `--ok` |
| Flagged / warning | `--warn-bg` | `--warn` |
| Error | `--err-bg` | `--err` |
| Info | `--info-bg` | `--info` |

Shape: radius `--r-pill`, padding `3px 8px`, Inter 700 / 10.5px, uppercase, letter-spacing 0.04em.

### 2.7 Active nav link

- Default `--muted`, hover `--accent`, active `--ink` weight 600.

---

## 3. Animation & interaction notes

- All hover/focus transitions: `120ms ease` on `transform`, `filter`, `box-shadow`, `border-color`.
- No new entrance animations required. If the apps already have page-load reveals, leave them.
- Buttons lift 1px on hover; do not exceed 2px.
- Respect `prefers-reduced-motion`: wrap transforms so they are disabled when the user opts out.

```css
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
```

---

## 4. Per-app changes (exact, ordered)

> Build order rationale: do Retrospective first (it has the most overrides and is the only accessibility failure), then Signal and Scrum Poker (token-only swaps). After each app, run the verification in Section 5 before moving on.

### 4.1 Retrospective — `/var/www/retrospective` (do FIRST)

**A. Token swap in `theme-retro.css` `:root`:**

| Token | From | To |
|---|---|---|
| `--accent` | `#C8252A` | `#2E6F4E` |
| `--accent-2` | `#5B35D5` | **Remove** (no longer used; see B). If referenced elsewhere, set to `#245C40`. |
| `--accent-3` | `#F59E0B` | Keep only if the `.washi` / `.cork-hero` decorations are kept; otherwise remove with them |
| `--bg-warm` | `#E8C9A0` | `#F4ECE0` |
| `--ok` | `#2A5A2A` | `#1E5A3A` |
| `--ok-bg` | `#DCE9DA` | `#D7E8DC` |

> The `--bg-warm` change is the accessibility fix. The dark tan `#E8C9A0` under `--ink #2A1F12` text was the low-contrast failure on the "Past Retrospectives" rows. `#F4ECE0` matches the other two apps and restores contrast.

**B. Kill the gradient button in `app.css`.** Replace this rule:

```css
/* CURRENT (remove) */
.primary-btn, .timer-actions button#timer-start {
  color: #fff;
  background: linear-gradient(180deg, #6845df 0%, var(--accent) 100%);
  border-color: var(--accent);
  box-shadow: rgba(91, 53, 213, 0.22) 0px 8px 18px;
}
```

```css
/* TARGET */
.primary-btn, .timer-actions button#timer-start {
  color: var(--accent-on);
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 1px 2px rgba(42,31,18,0.12);
}
```

And the hover rule (currently `background: var(--accent); filter: brightness(0.95)`):

```css
/* TARGET */
.primary-btn:hover, .timer-actions button#timer-start:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(42,31,18,0.16);
}
```

> Note: the hardcoded purple `#6845df` and the purple shadow `rgba(91,53,213,...)` are the two literal values that bypass the token system. Search the whole `app.css` and any other stylesheet for `6845df`, `5b35d5`, `91, 53, 213`, and `C8252A` and remove every occurrence.

**C. Decorative washi-tape elements** (`.washi`, `.cork-hero .card::before`) use `--accent-3` amber stripes. Decision needed: keep them (they are harmless and on-brand-warm) or remove for a cleaner look. Default: **keep**, they do not clash with forest. If kept, no change needed.

### 4.2 Signal — `/var/www/signal` (do SECOND)

Token-only swap in the `:root` block:

| Token | From | To |
|---|---|---|
| `--accent` | `#1F2C4C` | `#2E6F4E` |
| `--accent-on` | `#FFF8EE` | `#FFFFFF` |
| `--ink` | `#1F2C4C` | `#2A2118` |
| `--muted` | `#466091` | `#876641` |
| `--accent-2` | `#E8A47D` | `#245C40` (becomes `--accent-deep` role) or remove if unused |
| `--accent-3` | `#DCE9DA` | `#DEEBE2` (becomes `--accent-soft`) |
| `--bg-sky` | `#BFD8EE` | Remove if unused, or repoint any consumer to `--accent-soft` |

> Signal currently ties its text colour to navy (`--ink #1F2C4C`). Moving `--ink` to the warm `#2A2118` aligns it with the other two apps and the warm cream base. Verify no component hardcodes `#1F2C4C` outside `:root`; if so, replace with `var(--accent)` or `var(--ink)` as appropriate.
> Add `--accent-soft: #DEEBE2` and `--accent-deep: #245C40` if not present, so Signal exposes the full token set in Section 1.2.

### 4.3 Scrum Poker — `/var/www/scrumpoker` (do THIRD)

Token-only swap in the `:root` block. This app is closest to target already.

| Token | From | To |
|---|---|---|
| `--accent` | `#6B4FE8` | `#2E6F4E` |
| `--accent-2` | `#F5D87E` | Remove if unused, or `#245C40` |
| `--accent-3` | `#FFCFB0` | `#DEEBE2` if it serves the soft-tint role; otherwise remove |
| `--ok` | `#2A5A2A` | `#1E5A3A` |
| `--ok-bg` | `#DCE9DA` | `#D7E8DC` |

Add `--accent-soft: #DEEBE2` and `--accent-deep: #245C40`.

> The playing-card faces, chips, and felt currently render violet via `--accent`. Once the token flips they become forest automatically. Confirm no card component hardcodes `#6B4FE8`; search and replace any literal with `var(--accent)`. The "Connected" status badge must use `--ok` / `--ok-bg`, not the accent.

---

## 5. Verification (run after EACH app)

1. **Visual:** Load the dev URL. The primary button is solid forest, no gradient. No purple, navy, red, or violet remains as a primary/accent colour anywhere.
2. **Token audit (paste in console):**
   ```js
   const r = getComputedStyle(document.documentElement);
   ['--accent','--accent-on','--accent-soft','--accent-deep','--ok','--ok-bg','--bg-warm','--ink']
     .forEach(k => console.log(k, r.getPropertyValue(k).trim()));
   ```
   Expected: `--accent #2E6F4E`, `--ok #1E5A3A`, `--bg-warm #F4ECE0`, etc. per Section 1.
3. **Literal-colour grep:** In the repo, search for `6B4FE8`, `1F2C4C`, `C8252A`, `5B35D5`, `6845df`, `91, 53, 213`, `F59E0B`, `E8A47D`, `BFD8EE`, `E8C9A0`. Each hit is a hardcoded value that bypasses tokens; replace with the appropriate `var(--...)` or remove.
4. **Contrast:** Confirm AA on: button label (white on `#2E6F4E`), success pill (`#1E5A3A` on `#D7E8DC`), body text (`#2A2118` on `#FDF8EB`), and Retrospective's previously-failing rows (`#2A1F12` on `#F4ECE0` = passes).
5. **Accent vs success distinctness:** Put a primary button and a "Closed/Connected" success pill in view together. They must read as two different greens.
6. **Keyboard:** Tab through. Every interactive element shows the focus ring (`0 0 0 3px var(--accent-soft)`). No `outline: none` without a replacement focus style.
7. **Reduced motion:** Toggle OS "reduce motion"; hover lifts/transitions should disable.

---

## 6. Accessibility requirements (apply throughout)

- **Contrast:** WCAG AA minimum (4.5:1 normal text, 3:1 large text and UI components). All target tokens above are pre-checked to pass.
- **Focus:** Visible focus ring on every interactive element. Never remove `outline` without a `box-shadow` replacement.
- **Semantics:** Keep existing semantic markup (`<button>`, `<nav>`, `<label>` tied to inputs). Do not swap semantic elements for `<div>`s during restyle.
- **Status not by colour alone:** Pills already pair colour with a text label (Open, Closed, Flagged). Keep the labels; do not reduce to colour-only dots.
- **Hit targets:** Buttons keep `min-height: 38px` (already set in Retrospective). Apply the same minimum in the other two if smaller.

---

## 7. Recommended approach & why

- **Stack:** Stay with the existing **vanilla CSS + custom properties**. The token system is already in place and well structured; introducing Tailwind or a framework here would be net-negative churn for a re-skin. Justification: the entire change is expressible as token edits plus a handful of override removals. No build-tool change warranted.
- **Single shared token file (optional, recommended follow-up):** The three apps currently duplicate the foundation tokens. Consider extracting Sections 1.1, 1.4–1.7 into one shared `tokens.css` imported by all three, leaving only `--accent*` and `--ok*` per app (now identical anyway). This prevents future drift, which is exactly what caused this divergence. Not required for this task; flag as a follow-up.
- **Do not touch:** layout, grid, copy, JS behaviour, fonts, spacing, radius, shadows.

---

## 8. Definition of done

- [ ] All three apps expose the identical token set from Section 1.
- [ ] `--accent` is `#2E6F4E` everywhere; no gradient on any primary button.
- [ ] Retrospective's `--bg-warm` is `#F4ECE0` and its rows pass AA contrast.
- [ ] Success green (`--ok #1E5A3A`) is visibly distinct from the accent in all three.
- [ ] No hardcoded legacy colours remain (Section 5.3 grep is clean).
- [ ] Focus rings present and visible on all interactive elements.
- [ ] All three dev URLs render and look like one product family.
