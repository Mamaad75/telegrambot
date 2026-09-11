# Deployment

## Requirements

- Node.js 20+ (developed and tested on 22)
- PostgreSQL 13+ (tested on 16)
- A public HTTPS origin — Telegram webhooks and the Mini App require TLS

## First install

```bash
cp .env.example .env
nano .env                 # DATABASE_URL, PLATFORM_CREDENTIAL_KEY, bot tokens,
                          # ADMIN_BOOTSTRAP_PASSWORD and/or ADMIN_TELEGRAM_ID
npm install --omit=dev
npm run db:migrate
npm test
pm2 start ecosystem.config.cjs
pm2 save
```

Then open `https://<host>/admin/` and sign in with the bootstrap credentials.
Change that password immediately (Settings → «تغییر گذرواژه»).

### Required values

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `PLATFORM_CREDENTIAL_KEY` | Encrypts platform credentials and advertiser phones; readiness fails without it |
| `PUBLIC_BASE_URL` | Used in webhook URLs, Mini App links and payment callbacks |
| `TELEGRAM_BOT_TOKEN` | Publishing, Mini App entry, admin bot |
| `ADMIN_BOOTSTRAP_PASSWORD` and/or `ADMIN_TELEGRAM_ID` | Creates the first super admin |

## Public paths

| Path | Purpose |
| --- | --- |
| `/webhook` | WordPress clients (alias `/webhooks/wordpress`) |
| `/telegram-webhook` | Telegram updates |
| `/api/*` | Customer API (Mini App) |
| `/api/admin/*` | Admin API |
| `/app/` | Telegram Mini App |
| `/admin/` | Admin dashboard |
| `/api/ai/*` | AI product API (customer) |
| `/api/admin/ai/*` | AI administration |
| `/health`, `/health/ready` | Liveness / readiness |

## Reverse proxy

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

Production defaults to `TRUST_PROXY=loopback`, which is safe for a local Nginx proxy.
If your proxy is not on loopback, set `TRUST_PROXY` explicitly so rate limiting and the audit log record the real client IP, and keep `ADMIN_COOKIE_SECURE=true` (the default in production) so the admin
session cookie is only sent over HTTPS.

## Health checks

Point process supervisors and load balancers at **`/health`** — it performs no
I/O, so a slow database cannot cause a restart loop. Use **`/health/ready`** for
deployment gates and alerting: it returns `503` with a per-dependency breakdown
when the database is unreachable, the Telegram token is missing or
`PLATFORM_CREDENTIAL_KEY` is unset.

## Upgrading from 1.2.0

```bash
pg_dump "$DATABASE_URL" > backup-before-1.3.0.sql
git pull && npm install --omit=dev
# add the new required variables before restarting:
#   PLATFORM_CREDENTIAL_KEY, ADMIN_BOOTSTRAP_PASSWORD and/or ADMIN_TELEGRAM_ID
npm run db:status         # everything shows as pending on a 1.2.0 database
npm run db:migrate
npm test
pm2 restart jarchi --update-env
curl -s https://<host>/health/ready | jq
```

The 1.2.0 database is upgraded in place: `0001` adds only what is missing, and
`0006` moves advertiser phone numbers out of publication metadata into an
encrypted column. Existing clients, subscriptions and publication history are
preserved. `SITES_JSON` and `ADMIN_API_TOKEN` keep working; both are now
bootstrap/compatibility mechanisms rather than the primary model.

## Operations

**Logs** — structured JSON to stdout and `./logs/jarchi.log`, rotated at
`LOG_MAX_BYTES` with `LOG_BACKUPS` copies. Tokens, secrets, passwords,
credentials and authorization headers are redacted; phone numbers are masked.

```bash
pm2 logs jarchi
grep '"level":"error"' logs/jarchi.log | tail -20
grep '"message":"publication failed"' logs/jarchi.log | tail
```

**Retry queue** — runs every `PUBLICATION_RETRY_INTERVAL_MS`. Inspect and drive
it from the panel («صف تلاش مجدد») or the bot («🧰 ابزارها»).

**Scheduled work** — subscription expiry scan
(`EXPIRY_SCAN_INTERVAL_MS`), retry worker, and hourly housekeeping that purges
expired admin sessions and abandoned bot flows.

**Backups** — `pg_dump` covers everything except `.env`. Store
`PLATFORM_CREDENTIAL_KEY` with the backups: without it, encrypted platform
credentials and phone numbers in a restored dump cannot be read.

**Scaling** — the process is single-instance by design
(`instances: 1, exec_mode: fork`). Rate limiting and the dashboard cache are
per process, and the retry worker claims jobs with `FOR UPDATE SKIP LOCKED`, so
several instances would not corrupt the queue but would multiply the effective
rate limits. Move those to a shared store before scaling out.

## Enabling AI product creation (1.4.1)

The feature ships **off**. Turning it on is additive: nothing about publishing,
the bots or the webhook changes.

```bash
pg_dump "$DATABASE_URL" > backup-before-1.4.0.sql
git pull && npm install --omit=dev
npm run db:status          # 0010_ai_products should be the only pending migration
npm run db:migrate
npm test
```

Then set, in `.env`:

```env
AI_ENABLED=true
AI_PROVIDER=openai
AI_API_KEY=sk-…                  # never committed, never returned by any route
AI_TEXT_MODEL=gpt-4o-mini
AI_VISION_MODEL=gpt-4o-mini
AI_MEDIA_DIR=/var/lib/jarchi/ai-media
AI_ENABLE_IMAGE_GENERATION=false  # turn on only when image credits are wanted
```

```bash
mkdir -p /var/lib/jarchi/ai-media && chown jarchi:jarchi /var/lib/jarchi/ai-media
pm2 restart jarchi --update-env
curl -s https://<host>/health/ready | jq '.checks.ai'
```

`PLATFORM_CREDENTIAL_KEY` must already be set — it now also encrypts WooCommerce
credentials. Back up `AI_MEDIA_DIR` alongside the database if uploaded product
photos matter to you; a lost media directory costs the images, not the drafts.

### Per-customer setup

1. The customer creates WooCommerce REST keys (read/write) in their store and a
   WordPress application password for the account that will own the media.
2. They save both in the panel (`POST /api/sites/:siteId/woocommerce`), which
   immediately tests the connection.
3. Automation rules default to assisted mode: content is generated, nothing is
   published without approval.

### Plan quotas

`0010` seeds `ai_products_per_month` / `ai_images_per_month` for the standard
plans (trial 3, monthly 20, quarterly 60, semiannual 120, annual 300). Adjust
them per plan from the admin panel's plan editor; `-1` means unlimited and `0`
means the plan does not include AI.

### Operating it

- Worker: runs in-process every `AI_WORKER_INTERVAL_MS`. Watch it with
  `/api/admin/ai/overview`, run a batch by hand with `POST /api/admin/ai/jobs/run`.
- Failed jobs: `/api/admin/ai/jobs?status=failed`, retried with
  `POST /api/admin/ai/jobs/:id/retry`.
- Media: abandoned uploads are swept every six hours;
  `POST /api/admin/ai/media/purge` forces it.
- Turning AI off again is a single variable — in-flight jobs stop being claimed
  and the endpoints answer `503`; no data is lost.


### WordPress plugin AI integration
The first-party plugin uses the existing site webhook secret to call `/api/sites/:siteId/ai/*`.
No additional plugin credential is required. The site must have an owner user and an active
subscription for quota-controlled AI operations. Apply migration `0011_ai_plugin_integration.sql`
before enabling this integration.

### Recommended 500-user baseline

For ~500 registered users with tens (not hundreds) of simultaneous active sessions, start with:
- 4 vCPU
- 8 GB RAM
- 80–120 GB NVMe SSD
- PostgreSQL 16+
- `DATABASE_POOL_MAX=20`
- Nginx reverse proxy
- PM2 single instance

The application is I/O bound by PostgreSQL and WordPress calls, not CPU-bound under normal ticket/publication traffic. If the 500 users are concurrently active, or AI generation and image processing are heavy, move PostgreSQL to a separate 2–4 vCPU / 8–16 GB instance and scale the Node process independently.


## 2.3.0 production notes

- Run `npm run db:migrate` before restart; migration `0015_ai_site_usage_indexes.sql` is included.
- Prefer `LOG_LEVEL=info`, `LOG_HTTP_SUCCESS=true`, and inspect `logs/jarchi.log`.
- `/health` is liveness; `/health/ready` is readiness.
- Admin Mini App -> Monitoring opens `/api/admin-mini/observability`.
- Use `node tools/load-test-1000.mjs` against a staging or private health endpoint before changing production capacity.
- Keep the integrated Telegram/Bale bot on a single active process unless bot leadership is separated; the DB-backed AI/publication queues already use row locking, but scheduled bot/event handlers should not be multiplied blindly.
