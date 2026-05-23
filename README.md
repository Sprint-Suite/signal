# Signal — Agile Health Check App

Signal is an Agile health check survey app. A team admin creates a survey from a
question template, shares an **anonymous link** with the team, and reviews the
results as a radar chart with curated improvement insights. Surveys can be
re-run and compared against a baseline to show change over time.

Third app in the internal agile suite alongside Scrum Poker and Retrospective —
**independent codebase**, shared patterns only.

## Stack

- Node.js + Express 5, SQLite (`better-sqlite3`), `argon2` for admin passwords.
- Vanilla HTML/CSS/JS frontend — no framework, no build step.
- Hand-drawn SVG radar chart, strict CSP (external scripts only).
- No WebSockets — surveys are async request/response.

## Running locally

```bash
npm install
cp .env.example .env          # then edit: set SESSION_SECRET (openssl rand -hex 32)
npm run dev                   # http://localhost:3002
```

There is no public registration. Seed the first admin before logging in:

```bash
node manageKeys.js create-admin --email you@example.com
```

## Tests

```bash
npm test          # unit tests (node --test)
npm run test:e2e  # Playwright end-to-end
```

## Layout

- `server.js` — thin composition root.
- `lib/` — survey logic, auth, DB, routes (new) plus copied house plumbing.
- `public/` — static frontend.
- `docs/` — build spec (`signal-spec.md`) and tech stack overview.
- `deploy/` — systemd unit and Nginx config.

See [docs/signal-spec.md](docs/signal-spec.md) for the full build specification.

## Design system

Signal is the canonical home of the shared `theme-core` design system used
by the Scrum Poker and Retrospective sister apps. See
`docs/theme-core/README.md` for what to edit and how downstream repos
sync it.
