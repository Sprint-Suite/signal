# Signal — Deployment

Signal runs as a single Node process behind Apache, managed by systemd. It is
independent of Scrum Poker and Retrospective — no shared services.

## Prerequisites

- Node.js 20.x on the host (CI targets Node 24).
- Apache (with `mod_proxy`, `mod_proxy_http`, `mod_headers`) for TLS
  termination and as a reverse proxy.
- Port **3002** free (3000 = Scrum Poker, 3001 = Retrospective).

## 1. Place the code

```bash
sudo mkdir -p /var/www/signal
sudo chown -R davidj:www-data /var/www/signal
sudo chmod -R 2775 /var/www/signal           # setgid: new files inherit www-data
# deploy the repository into /var/www/signal, then:
cd /var/www/signal
npm ci --omit=dev
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `SESSION_SECRET` — generate with `openssl rand -hex 32`. **Required.**
- `NODE_ENV=production` — enables the Secure cookie flag and binds 127.0.0.1.
- `DB_PATH=/var/lib/signal/signal.db` — keep the database outside the Git tree.
- `APP_BASE_URL=https://signal.example.com` — used to build verify/reset links.

```bash
sudo mkdir -p /var/lib/signal
sudo chown signal:signal /var/lib/signal
```

## 3. Database

Migrations run automatically on boot. To run them by hand:

```bash
npm run db:migrate
```

## 4. Seed the first admin

There is no public registration.

```bash
node manageKeys.js create-admin --email you@example.com
```

This prints a verification link. Start the server, then open the link to
verify the account. Further admins are invited from within the app.

## 5. systemd service

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin signal
sudo cp deploy/systemd/signal.service /etc/systemd/system/signal.service
sudo systemctl daemon-reload
sudo systemctl enable --now signal
systemctl status signal
```

## 6. Apache

```bash
sudo a2enmod proxy proxy_http headers
sudo cp deploy/apache/signal.conf /etc/apache2/sites-available/signal.conf
sudo a2ensite signal
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Provision TLS (e.g. Certbot) and switch to the commented `*:443` vhost in the
config — it sets `X-Forwarded-Proto https` so the app marks the session cookie
Secure.

## Health check

```bash
curl -s http://127.0.0.1:3002/health
# {"status":"ok","version":"1.0.0","commit":"…","schemaVersion":1,"uptime":…}
```

## Housekeeping

```bash
npm run db:vacuum                 # reclaim space
npm run db:retention 365          # drop surveys closed over a year ago
```

## Static assets

### Fonts (added 2026-05-23)

Three self-hosted woff2 files live in `public/fonts/`. They are committed
to the repo (~420 KB total). No CDN or build step is needed — Express
serves them directly. If you switch CDNs or asset hosts, make sure the
`/fonts/` path is preserved.

## Email delivery (deferred to v1.1)

`MAIL_TRANSPORT=log` writes verification and reset links to the service log
instead of sending email:

```bash
journalctl -u signal -f
```

Swapping in a real transport (SMTP or an API) is a change to `lib/mailer.js`
only.
