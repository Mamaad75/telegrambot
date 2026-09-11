# Database and migrations

## Runner

```bash
npm run db:migrate     # apply pending migrations
npm run db:status      # list applied / pending / changed, change nothing
npm run db:validate    # run each pending migration in a rolled-back transaction
```

Properties:

- ordered by filename and applied exactly once, recorded in `schema_migrations`
  (name, checksum, duration);
- each migration runs in its own transaction — PostgreSQL DDL is transactional,
  so a failure leaves no half-applied schema;
- a session advisory lock prevents two deploys from racing;
- checksums detect a migration file edited after it was applied, and the run
  aborts instead of silently diverging.

## Policy

- Migrations are **append-only**. Never edit an applied file; add a new one.
- Every migration must be **idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT
  EXISTS`, `ON CONFLICT DO NOTHING`) so it is safe to re-run against a database
  that already has parts of the change.
- Migrations must be **safe on existing production data**: no destructive
  rewrite without an explicit, documented reason. The one deletion in this
  history — `0006` dropping `publications.metadata.contact_phone` — is a privacy
  fix, and the value is preserved going forward in an encrypted column.
- Reversibility: PostgreSQL DDL rolls back inside a failed run. There are no
  `down` scripts; roll back by restoring a backup or writing a new forward
  migration. Take a dump before deploying a schema change.

## History

| File | Contents |
| --- | --- |
| `0001_baseline.sql` | Every table 1.2.x assumed: users, identities, app_sessions, plans, invoices, subscriptions, telegram_star_payments, sites, platform_connections, publication_preferences, publications, site_field_catalog — including the unique key the publication upsert depends on |
| `0002_plans_seed.sql` | Trial + 1/3/6/12-month plans (`ON CONFLICT DO NOTHING`, so edited prices survive) |
| `0003_admin_rbac.sql` | `admin_users`, `admin_sessions`, `admin_audit_log` |
| `0004_admin_bot_state.sql` | `admin_bot_states` for durable Telegram flows |
| `0005_webhook_diagnostics.sql` | `site_webhook_events` + per-client counters and last-seen timestamps |
| `0006_publication_retry.sql` | `publication_retries`; publication `duration_ms`, `attempt_count`, `error_code`, `contact_phone_enc`; removes the plaintext phone from metadata |
| `0007_app_settings.sql` | `app_settings` key/value store |
| `0008_performance_indexes.sql` | Indexes derived from the actual query shapes |
| `0009_publication_safety.sql` | Non-destructive guard: ensures `contact_phone_enc`, `updated_at` and the open-retry unique index exist on databases that missed parts of 0006 |
| `0011_ai_plugin_integration.sql` | WordPress/plugin source metadata and source-level idempotency for AI drafts; machine integration job tracing. |
| `0010_ai_products.sql` | AI product automation: `woocommerce_connections`, `site_product_settings`, `ai_product_drafts`, `ai_product_versions`, `ai_jobs`, `ai_usage`, `ai_product_images`, plus `plans.ai_products_per_month` / `plans.ai_images_per_month` |

`0001` is written so an existing 1.2.0 database converges on the same schema
without data loss: tables it already has are skipped, columns it lacks are
added.

## Upgrading from 1.2.0

```bash
git pull && npm install
pg_dump "$DATABASE_URL" > backup-before-1.3.0.sql
npm run db:status      # everything should show as pending on a 1.2.0 database
npm run db:migrate
npm test
pm2 restart jarchi --update-env
```

Set `PLATFORM_CREDENTIAL_KEY` (now required) and either
`ADMIN_BOOTSTRAP_PASSWORD` or `ADMIN_TELEGRAM_ID` before restarting, so an
admin account exists on first boot.

## 0010 in detail

Everything references the existing `users`, `sites` and `plans` tables — there is
no `ai_users`, `ai_sites` or `ai_subscriptions`. JSONB is used only for
model-shaped data (generated content, job payloads, provider metadata); anything
filtered, sorted or constrained is a real column.

| Table | Purpose | Notable constraints |
| --- | --- | --- |
| `woocommerce_connections` | Encrypted store credentials, one per site | unique on `site_id` |
| `site_product_settings` | Per-site automation rules | safe defaults; `auto_publish` off |
| `ai_product_drafts` | The reviewable unit | unique `(user_id, idempotency_key)`; unique `(site_id, wc_product_id)` so one product cannot belong to two drafts |
| `ai_product_versions` | Full history, append-only | unique `(draft_id, version)` |
| `ai_jobs` | Generation/publish queue | partial unique `(draft_id, type)` while `pending`/`processing` — the core idempotency guard |
| `ai_usage` | Reserve/commit/release accounting | indexed by `(user_id, period, operation, status)` for the quota check |
| `ai_product_images` | Image metadata and WordPress media ids | unique `(site_id, wp_media_id)` so a file is uploaded once |

The plan columns default to `0` (AI not included) and are then set for the
seeded plans only where an operator has not already set a value, so a database
with customised plans is left alone.

Adding this migration to a 1.3.x database is additive: no existing table is
rewritten and no data is deleted.
