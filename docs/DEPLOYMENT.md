# Deployment

Target: a single VPS with **2 CPU, 4 GB RAM, 40–80 GB SSD**. That is enough for the whole
stack — database, cache, API, worker, dashboard and reverse proxy.

## 1. Prepare the server

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh

# 2 GB of swap: the Next.js build is the only memory-hungry step, and swap keeps it
# from being OOM-killed on a 4 GB machine.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Only 80/443 need to be open. Postgres and Redis are not published in the
# production compose file.
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## 2. Configure

```bash
git clone <this-repo> /opt/baimar && cd /opt/baimar
cp .env.example .env
```

Edit `.env`. The values that must not keep their defaults:

```bash
NODE_ENV=production
POSTGRES_USER=baimar
POSTGRES_PASSWORD=$(openssl rand -hex 24)     # put the generated value in the file
POSTGRES_DB=baimar

JWT_SECRET=$(openssl rand -hex 32)
APP_ENCRYPTION_KEY=$(openssl rand -hex 32)

WEB_ORIGIN=https://baimar.example.ir
NEXT_PUBLIC_API_URL=https://baimar.example.ir
TRUST_PROXY=true

SEED_ADMIN_EMAIL=you@baimar.ir
SEED_ADMIN_PASSWORD=<a strong password you will change on first login>
```

`APP_ENCRYPTION_KEY` encrypts provider credentials at rest. **Changing it makes existing
stored credentials unreadable** — they would have to be re-entered. Back it up with the
same care as a database password.

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle at build time, so it must be the
URL the *browser* uses, not an internal hostname. Changing it requires a rebuild.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s localhost/health
```

Migrations and the service-catalogue seed run automatically in the API container's
entrypoint. Both are idempotent and safe on every restart.

## 4. TLS

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d baimar.example.ir   # stop nginx first, or use webroot
sudo cp /etc/letsencrypt/live/baimar.example.ir/fullchain.pem /opt/baimar/nginx/certs/
sudo cp /etc/letsencrypt/live/baimar.example.ir/privkey.pem  /opt/baimar/nginx/certs/
```

Then uncomment the HTTPS server block and the HTTP→HTTPS redirect in `nginx/nginx.conf`
and restart Nginx:

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

Renewal (add to cron, monthly):

```bash
certbot renew --quiet \
  --deploy-hook 'cp /etc/letsencrypt/live/*/fullchain.pem /etc/letsencrypt/live/*/privkey.pem /opt/baimar/nginx/certs/ && docker compose -f /opt/baimar/docker-compose.prod.yml restart nginx'
```

## 5. First login

Open the site, sign in with the seeded administrator, and immediately:

1. **Change the administrator password** (Account → Change password).
2. Create real user accounts with the right roles (Settings → Users).
3. Review Settings → Integrations. OpenStreetMap is on by default; everything else shows
   what it needs.
4. Review Settings → Scoring if Baimar's priorities differ from the defaults.

---

## Backups

### What is the source of truth

**PostgreSQL, and only PostgreSQL.**

Redis holds queues, caches and rate-limit counters. Losing it costs in-flight jobs — a
campaign run that has to be started again — and nothing else. Nothing in Redis is
authoritative, nothing there is unrecoverable, and the platform is designed so that a
flushed Redis degrades the system rather than corrupting it:

* queue counters are rebuilt from the `CampaignRun` row when the key is missing;
* a scheduled sweep closes runs whose jobs were lost, so no run can hang forever;
* the audit cache falls back to re-crawling;
* rate-limit counters simply start again.

So the backup policy is: **back up Postgres, and back up `.env`.** Do not attempt to
back up Redis — restoring a stale queue would replay work that has already happened.

### What to back up

| Thing | Why | How |
| --- | --- | --- |
| PostgreSQL | Every lead, audit, score, brief, call and note | `pg_dump`, below |
| `.env` | `APP_ENCRYPTION_KEY` — without it, stored provider credentials cannot be decrypted, ever | copy to a password manager or an encrypted vault, **not** to the same disk |
| `nginx/certs` | TLS certificates, if not managed by certbot | copy with the rest of `/opt/baimar` |

Losing `APP_ENCRYPTION_KEY` does not lose your leads — it loses the API keys stored in
Settings → Integrations, which then have to be entered again. Losing the database loses
the work of the sales team.

```bash
# /etc/cron.daily/baimar-backup
#!/bin/sh
set -e
cd /opt/baimar
STAMP=$(date +%F)
mkdir -p /var/backups/baimar
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "/var/backups/baimar/db-$STAMP.sql.gz"
# Keep 30 days
find /var/backups/baimar -name 'db-*.sql.gz' -mtime +30 -delete
```

### Restore

A backup nobody has restored is a hope, not a backup. Test this on a scratch database
before you need it.

```bash
# 1. Stop the application, leaving Postgres up.
docker compose -f docker-compose.prod.yml stop api worker web

# 2. Restore into a clean database.
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -c 'DROP DATABASE IF EXISTS baimar_restore;'
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -c 'CREATE DATABASE baimar_restore OWNER '"$POSTGRES_USER"';'
gunzip -c /var/backups/baimar/db-2026-09-08.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" baimar_restore

# 3. Check it before promoting it.
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" baimar_restore -c 'SELECT count(*) FROM "Lead";'

# 4. Promote: point DATABASE_URL at baimar_restore, or rename the databases.
# 5. Bring the application back up and run the readiness gate.
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api npm run production:check -w @baimar/api
```

Redis needs no restore step. Start it empty; the first campaign run repopulates whatever
it needs.

### Retention

Operational tables are trimmed automatically by a daily job — job logs after 14 days,
provider usage after 180, read notifications after 90, crawled page bodies after 90, audit
logs after a year. All configurable (`RETENTION_*`).

**CRM records are never deleted automatically.** Leads, calls, notes, activities,
follow-ups and sales briefs are the record of what the sales team did; a cleanup job that
could remove one of those would be a worse failure than running out of disk.

---

## Updating

```bash
cd /opt/baimar
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations apply automatically. Take a database dump first for anything that changes the
schema.

---

## Monitoring

- `GET /health` — reports database and Redis independently. A `redis: down` response still
  returns 200 with `status: degraded`: the API serves reads without Redis, but queues and
  caching stop.
- **Settings → Logs** — background job history, queue depth, failures in the last 24 hours.
- **Settings → Integrations → Usage** — request counts, failures and estimated AI spend.
- **Settings → Logs → User activity** — the audit log.

```bash
docker compose -f docker-compose.prod.yml logs -f api worker
docker stats
```

---

## Tuning for a small VPS

The defaults are already sized for 2 CPU / 4 GB. If the machine is under pressure:

| Symptom | Change |
| --- | --- |
| Crawling saturates the CPU | Lower `CRAWLER_CONCURRENCY` (default 3) |
| Crawling saturates the network | Raise `CRAWLER_DELAY_MS`, lower `CRAWLER_MAX_PAGES` |
| AI spend too high | Raise `AI_MIN_LEAD_SCORE`, lower `AI_MONTHLY_BUDGET_USD` |
| Postgres slow on large lead tables | Raise `shared_buffers` to ~25% of RAM |
| Next.js build OOMs | Ensure swap is on, or build the image on a larger machine and push it |

Scaling past one machine: move Postgres to a managed instance, then run additional worker
containers (they are stateless and coordinate through Redis).

---

## Troubleshooting

Start here:

```bash
docker compose -f docker-compose.prod.yml exec api npm run production:check -w @baimar/api
docker compose -f docker-compose.prod.yml exec api npm run providers:check -w @baimar/api
curl -s localhost/ready | jq
```

**`Refusing to start — invalid configuration`** — the API validates its environment before
it opens a socket, and names every problem. Under `NODE_ENV=production` this includes
development secrets, placeholders, secrets under 32 characters, `JWT_SECRET` equal to
`APP_ENCRYPTION_KEY`, a plain-HTTP `WEB_ORIGIN`, wildcard CORS, and `DEMO_MODE=true`.
That refusal is deliberate: a weak secret that "works" is worse than a boot failure,
because nobody notices it.

**`/ready` returns 503 but `/health` returns 200** — by design. `/health` says the process
is alive; `/ready` says it should receive traffic, and fails when mandatory infrastructure
or configuration is broken. The body names the failing check.

**Campaign stays QUEUED** — the worker is not running or Redis is unreachable. Check
`docker compose logs worker` and `GET /health`.

**Campaign stuck in RUNNING** — it should not be possible for long: a sweep runs every 15
minutes and closes runs that stopped making progress, marking them
`COMPLETED_WITH_ERRORS` and counting the leads that never finished. If a run is stuck for
more than an hour, the worker is not running at all.

**A run finished as `COMPLETED_WITH_ERRORS`** — this is a normal outcome, not a failure:
some leads failed their pipeline or some providers were unavailable. The campaign page
lists which providers failed and how many leads never completed. The counters always add
up: `unique = qualified + rejected + failed`.

**A website was attached to the wrong business** — open the lead's Sources tab. The match
confidence and every signal behind it are shown. Raise
`WEBSITE_MATCH_MIN_CONFIDENCE` if the threshold is too permissive for your data; below it,
candidates are listed as suggestions rather than attached.

**Core Web Vitals show "not measured"** — expected. The browser layer is off by default
because Chromium needs ~400 MB of RAM. Set `BROWSER_AUDIT_ENABLED=true` and install
Playwright (`npm i -w @baimar/api playwright && npx playwright install chromium`). These
metrics are never estimated from the HTTP audit, so "not measured" is the honest answer
until you turn it on.

**The crawler refuses a URL** — check the message. `blocked-address` and
`blocked-hostname` mean the SSRF guard stopped a request to a private or internal
address, which is correct behaviour. `CRAWLER_ALLOW_PRIVATE_HOSTS` exists only for local
test fixtures; `production:check` fails the deployment if it is on.

**"No lead source provider is enabled and configured"** — enable OpenStreetMap in
Settings → Integrations, or add a Google Places key, or import a CSV.

**Website audits all return "blocked by robots.txt"** — expected for sites that decline
crawling. The lead is still scored on everything else. Do not disable
`CRAWLER_RESPECT_ROBOTS` in production.

**AI analysis reports "budget reached"** — the monthly ceiling in Settings → AI was hit.
Raise it, or wait for the next month; the deterministic brief keeps working meanwhile.

**Persian text renders as boxes** — the Vazirmatn webfont could not load. It falls back to
Tahoma/system fonts; to remove the CDN dependency entirely, self-host the font files and
point the `@font-face` in `apps/web/src/app/globals.css` at them.
