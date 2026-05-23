# Shared "Playful Pastel" Theme — Design

**Date:** 2026-05-23
**Scope:** `/var/www/retrospective`, `/var/www/scrumpoker`, `/var/www/signal`
**Status:** Approved during brainstorming; ready for implementation planning.

---

## 1. Goal

Replace the current "plain dashboard SaaS" look across all three apps with a single shared design system that gives each app its own personality while reading as siblings. Non-corporate, playful but not childish, targeted at engineering / product / design teams using these tools internally.

The user's brief: "nice fun theme across all three… not corporate".

## 2. Direction

**Family:** Playful Pastel — soft daylight palettes on a shared cream/paper foundation, paper-craft illustration, friendly typography.

**Per-app metaphor:** each app commits to one real-world thing it resembles.

| App | Metaphor | One-line tagline |
|---|---|---|
| Retrospective | **Pinboard** — a cork board where the team pins polaroids and notes from the sprint | *"Pin your moments."* |
| Scrum Poker | **Sticker Album** — story-point stickers placed into an album, revealed together | *"Stick a value."* |
| Signal | **Weather Postcards** — each teammate sends a postcard with a weather glyph; the dashboard is a team-weather map | *"Send your postcard."* |

**Metaphor depth:** medium. The metaphor lives in hero pages (landing/login/empty states), one or two key moments per app (the reveal in Poker, the postcard send in Signal, the pin-up in Retrospective), and the per-app palette + iconography. Everyday dense screens (admin tables, account pages, long forms) stay clean — they inherit only chrome, type, components, and the palette.

## 3. Shared design system

These elements are **identical** across all three apps. They make the apps read as a family.

### 3.1 Type

| Role | Family | Notes |
|---|---|---|
| Headlines | **Fraunces** (variable, opsz 9–144, weights 400/600/700) | Warm, slightly playful serif. Carries the "paper-craft" feel. |
| UI / body | **Inter** (400/500/600/700) | Workhorse; already used by two of the apps. |
| Data / mono | **JetBrains Mono** (400/600) | Codes, IDs, timestamps, vote counts. |

**Self-hosted** as woff2 files at `/public/fonts/` in each app. All three apps run a strict CSP (`style-src 'self'`, `font-src 'self'` — retrospective even forbids `data:`), so Google Fonts CDN is not an option and no inline `<style>` blocks may be used. Fallback chain for the brief moment before the woff2s load: `Fraunces → Georgia → serif`, `Inter → system-ui → sans-serif`, `JetBrains Mono → ui-monospace → monospace`.

### 3.2 Illustration vocabulary

**Paper-cut / Risograph style.** Chunky shapes, mix-blend-mode overprints, sparing detail, hand-feeling but disciplined. One shared set of primitives used across all three apps:

- Pins, washi tape, polaroid frames (Retrospective)
- Stickers, album pages (Scrum Poker)
- Postcards, stamps, weather glyphs — sun, cloud, rain, wind, snow (Signal)
- Shared utility glyphs (check, cross, arrow, plus, dot) drawn in the same style

All illustrations live as inline SVG so they can take the per-app palette via `currentColor` or CSS variables.

### 3.3 Components

Same shape language everywhere. The same `.card` from Retrospective should look at home in Scrum Poker once the palette swaps.

- **Card:** 12px radius, 1.5px border, soft elevated shadow (`0 1px 0 rgba(ink, 0.04), 0 8px 24px rgba(ink, 0.06)`)
- **Button:** pill shape (999px radius), 8/16 padding, 700 weight, Inter
- **Input:** 8px radius, 1.5px border, paper-cream fill
- **Kicker:** Inter 0.66rem, weight 700, tracking 0.12em, uppercase, in the per-app `--muted` token (see §4)
- **Title:** Fraunces 1.15rem (small) → 2.2rem (hero), weight 600, tracking -0.01em
- **Tag/pill:** 6px radius, Inter 0.7rem, weight 700, tracking 0.06em, uppercase
- **Field hint / help:** Inter 0.85rem, muted

**Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 (px). Same as Signal's current `--sig-space-*` tokens.

### 3.4 Chrome (top bar, footer, account, login, license)

Identical across all three apps. Each app shows its own brand mark + accent in the top-bar, but the layout, footer, account/license/login pages share one template.

- **Top bar:** white surface, 1px bottom border, brand mark left (app name in Fraunces + small paper-cut glyph), user/actions right
- **Footer:** centered, faint, JetBrains Mono build tag + license link
- **Login / account / license:** narrow card on the cream background, same form styling everywhere

### 3.5 Motion

Light and physical, never excessive:

- Modal in: 160ms ease-out, 6px translateY + 0.98 scale (already used in Signal)
- Hover lift on cards: `transform: translateY(-1px)` over 120ms
- Sticker placement (Poker): 240ms spring with slight rotation
- Postcard arrival (Signal): 280ms slide-in from off-canvas + slight rotation
- Pin-up (Retrospective): 200ms scale-bounce on add

Respect `prefers-reduced-motion: reduce` — disable all transforms, keep opacity transitions only.

## 4. Per-app palettes

All three live on a shared paper foundation (`#FDF8EB` / `#FDF4E3`) so they read as siblings.

### 4.1 Retrospective — "Cork & Ember"

| Role | Hex | Use |
|---|---|---|
| Surface | `#FDF4E3` | Page background |
| Surface-warm | `#E8C9A0` | Cork / hero areas |
| Accent | `#E5484D` | Primary action, pin heads |
| Accent-2 | `#5B35D5` | Secondary pin head, links |
| Accent-3 | `#F59E0B` | Tag colour, washi |
| Ink | `#2A1F12` | Text, buttons |
| Muted | `#8B5E36` | Kicker, secondary text |

### 4.2 Scrum Poker — "Sticker Cream"

| Role | Hex | Use |
|---|---|---|
| Surface | `#FDF8EB` | Page background |
| Surface-warm | `#F4ECE0` | Album pages |
| Accent | `#6B4FE8` | Primary action |
| Accent-2 | `#F5D87E` | Hero stickers |
| Accent-3 | `#FFCFB0` | Secondary stickers |
| Ink | `#2A2118` | Text |
| Muted | `#8E6E4A` | Kicker, secondary text |

### 4.3 Signal — "Sky & Peach"

| Role | Hex | Use |
|---|---|---|
| Surface | `#FDF8EB` | Page background |
| Surface-sky | `#BFD8EE` | Hero areas, sky gradient top |
| Accent | `#1F2C4C` | Primary action, ink |
| Accent-2 | `#E8A47D` | Sky-gradient bottom, warm accent |
| Accent-3 | `#DCE9DA` | Calm/positive weather tag |
| Ink | `#1F2C4C` | Text, buttons (same as Accent) |
| Muted | `#466091` | Kicker, secondary text |

### 4.4 Status colours (shared)

| Role | Hex |
|---|---|
| Success | `#2A5A2A` |
| Warning | `#B8780A` |
| Error | `#B4232A` |
| Info | `#2D5FAA` |

## 5. Per-app "key moments"

The medium-depth metaphor lives in these specific places. Everywhere else inherits only the shared system.

### Retrospective — Pinboard
- **Login & landing:** cork-textured background, washi-taped sign-in card
- **Lobby:** sprint as a cork board; each retro = a polaroid frame
- **Empty board:** "Nothing pinned yet" with an illustrated empty pin
- **Adding a note:** scale-bounce as the note pin-ups onto the board
- **Pinboard view:** notes appear as polaroids/index cards with a coloured pin head; washi tape connects related notes

### Scrum Poker — Sticker Album
- **Login & landing:** open-album hero, illustrated sticker sheet on the side
- **Lobby:** room list rendered as album spreads
- **Estimation round:** point values are stickers (1, 2, 3, 5, 8, 13, 21); picking = peel-and-place animation
- **Reveal:** album page "fills in" — everyone's sticker fades up at once
- **Consensus:** if all match, a small celebratory paper-cut burst

### Signal — Weather Postcards
- **Login & landing:** dusk-sky gradient hero, illustrated postcards floating
- **Dashboard:** each survey result = a postcard tile with a weather glyph for its overall mood
- **Take-survey flow:** each question is one side of a postcard; answer "writes" on the card
- **Submit:** slide-out animation — postcard sent
- **Report:** the existing radar chart sits inside a "weather report" card; axes become labelled weather conditions

## 6. Implementation approach

### 6.1 Shared CSS

A single theme stylesheet is the source of truth. Two options to discuss at review time:

- **(A) Shared file copied between repos.** One canonical copy lives in `signal/public/css/theme-core.css`; a small shell script in each of the other two repos pulls the latest version (`scripts/sync-theme.sh`). Simplest; no new infrastructure; the user (sole maintainer) runs the sync when the theme changes.
- **(B) NPM package.** Publish `@dj/playful-theme` and let each app `npm install` it. Cleaner long-term but adds publishing overhead for three small personal apps.

**Recommendation:** (A). The apps are small, the user is the only maintainer, and changes will be infrequent once the theme is shipped.

### 6.2 What lives in `theme-core.css`

- All design tokens (colour scales, type, spacing, radii, shadows)
- All shared components (button, input, card, kicker, tag, modal, pill, top-bar, footer)
- Motion utilities and `prefers-reduced-motion` overrides
- All shared paper-cut SVG primitives as background-image data URIs OR a sibling `theme-illos.svg` sprite

### 6.3 What lives per-app

- `app.css` for app-specific layouts (board grid in Retrospective, sticker album grid in Poker, postcard tile grid in Signal)
- App-specific palette overrides (set `--ink`, `--accent`, etc. on `:root` so the shared components automatically take the per-app colours)
- App-specific key-moment animations and illustrations
- Hero scene markup

### 6.4 Fonts

Each app self-hosts the woff2 files under `/public/fonts/`. `@font-face` declarations live in `theme-core.css` so any page that loads the stylesheet automatically gets the fonts. Variable-font flavours where available (Fraunces variable, Inter variable, JetBrains Mono variable). One file per axis to keep page weight reasonable (~300 KB total).

### 6.5 Accessibility

- All palette pairings meet WCAG AA (4.5:1) for body text, 3:1 for large text — to be checked at implementation time.
- Focus rings use accent colour + 2px outline + 1px offset (already Signal's pattern).
- Motion respects `prefers-reduced-motion`.

## 7. Out of scope

- Dark mode. Defer to a follow-up theme spec.
- Mobile redesign beyond making the current layouts work at small widths.
- New features. This is a re-skin only.
- Brand work (logos, marketing sites, social cards). Limited to the apps themselves.
- Custom illustration of mascot characters — paper-cut primitives only.

## 8. Open questions

1. **Sync mechanism (§6.1):** confirm option A (copied file + sync script) is acceptable, or prefer B (NPM package) for cleaner versioning.
2. **Brand mark:** does each app need a small custom paper-cut glyph next to its name in the top-bar (a pin / sticker / postcard), or just text?
3. **Roll-out order:** which app to ship first? Signal is the current cwd and has the cleanest current CSS, so it's the natural pilot — but the user may prefer to start with Retrospective or Scrum Poker.
4. **Existing pages we shouldn't touch:** any per-app pages that should be left alone (e.g. admin pages, dev-only screens)?
