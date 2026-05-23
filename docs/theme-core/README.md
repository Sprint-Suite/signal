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
