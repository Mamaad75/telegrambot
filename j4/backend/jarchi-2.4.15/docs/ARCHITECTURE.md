# Architecture

## Layers

```
HTTP / Telegram
  ├── src/server.js            express wiring, webhook, health, schedulers
  ├── src/routes/api.js        customer API for the Mini App
  ├── src/routes/aiProducts.js AI product API (same auth, same conventions)
  ├── src/routes/admin/*       admin API, one module per domain
  └── src/bot/*                Telegram bot: customer + admin interfaces
        │
        ▼
  src/services/*               the ONLY place business logic lives
        │
        ▼
  src/core/*                   publication engine, policies, RBAC, normalizer
        │
        ▼
  src/ai/*                     AI providers, prompts, schemas, policies
  src/workers/*                AI job worker
  src/platforms/*              Telegram, Bale, WhatsApp adapters
  src/db/*                     pool, transactions, migration runner
```

Rule that keeps the two admin surfaces consistent: **the web panel and the
Telegram bot call the same services.** Neither writes its own SQL for a
domain concern. `src/routes/admin/clients.js` and `src/bot/admin/index.js` both
call `services/clients.js`; the bot renders text, the panel renders HTML.

## Request paths

### WordPress webhook — `POST /webhook`

1. Rate limit per `X-Site-ID`.
2. `siteAuth` loads the client and compares the webhook secret in constant time.
   Rejections are recorded in `site_webhook_events` with the auth result.
3. `normalizeAd` flattens the payload into the internal ad shape (contract 1.0
   through 1.3).
4. `upsertFieldCatalog` writes the whole `field_meta` map in one statement.
5. `publishAd` resolves targets, applies field policy, formats and delivers.
6. The response reports one entry per platform. A `site_webhook_events` row and
   the client's counters are updated in a `finally` block, so diagnostics can
   never change the webhook's outcome.

Publication runs **synchronously** inside the request, as in 1.2.0, because the
response body reports per-platform results that the WordPress plugin displays.
Failures that a repeat could fix are handed to the retry queue instead of being
lost, which keeps the response contract while removing the "silently dropped"
case. The heavy per-field database work that used to run inline was removed.

### Admin API — `/api/admin/*`

1. Rate limit.
2. `adminAuth` resolves the actor: session cookie → bearer session →
   legacy `ADMIN_API_TOKEN`. Cookie sessions also require a CSRF token on
   writes, and their token rotates every `ADMIN_SESSION_ROTATE_MINUTES`.
3. `requirePermission(...)` checks one explicit permission. Denials are audited.
4. The handler validates its input, calls a service and records an audit entry
   for anything that changes state.
5. `errorMiddleware` maps errors to a single response shape and never leaks a
   database message.

### Mini App admin — `/api/admin-mini/*`

The same RBAC router as `/api/admin`, mounted behind `miniAppAdminAuth`: the
customer is authenticated the usual way, their platform id is looked up in
`admin_users`, and `req.admin` is built from that row. Being inside the Mini App
grants nothing — a customer with no admin row is refused there exactly as they
would be on `/api/admin`, and every route still declares its own permission.

Router mounting matters here. `siteAi` and `ticketRoutes` are mounted at `/api`
and own only `/api/sites/:siteId/...` paths, so their guards are bound to those
paths rather than applied with a bare `use()`. An unscoped `use()` runs for
every `/api` request, which is how 2.1.1 came to reject `/api/admin` with
"siteId is required" before authentication ran.

### Telegram admin — `/admin` and callbacks

Since 2.1.0 the bot is not an administrative surface of its own: `/admin`
authenticates the operator and hands over a signed Mini App link, and the panel
lives at `/api/admin-mini`. Legacy `a:*` callbacks from 1.3.x are kept only as a
bridge — they are still authorized, but they open the Mini App instead of
performing the action they name, so a replayed button cannot rotate a secret or
disable a client. Flow state in `admin_bot_states` (durable, expiring, one row
per admin+chat) is still honoured and still re-checks permission on every
message, so a flow left behind by an upgrade cannot outlive the access that
started it.

## Publication engine

`src/core/publication.js`

```
publishAd(ad, site)
  ├── subscription gate (owner must have an active subscription)
  ├── deletion events → core/deletionService.js
  ├── resolvePublicationTargets(ad, site)      per-post → site default → legacy
  └── for each enabled target: publishToTarget()
        ├── customer preference (enabled, selected field keys)
        ├── field policy      → fields visible on this platform
        ├── contact phone     → resolveContactPhone(ad, platform)
        ├── formatter         → text + buttons for this platform
        ├── adapter           → send / edit / delete
        └── persistence       → publications row (+ retry enqueue on failure)
```

`republishTarget(ad, platform)` re-runs one platform for the retry worker and
the admin "retry" action. It re-resolves targets from current client
configuration, so a channel fixed after the failure takes effect.

### Field policy

`src/core/fieldPolicy.js` is the single source of truth for what may be
published where:

- explicit `field_meta.platforms[platform] === true` wins;
- otherwise legacy `visibility` (`all`/`public`/platform name) applies;
- `hidden`, `admin`, `backend` and empty visibility never publish;
- empty values and system keys never publish;
- a customer's selected field keys can narrow the result, never widen it.

`resolveContactPhone` applies the same rule to the advertiser phone, and both
the engine and the formatters call it — a formatter cannot render a contact
button for a platform the policy hides the number from.

### Retry queue

`publication_retries` is the only queue in the system. One open row per
`(site, post, event, platform)` makes enqueueing idempotent; the publish path
upserts on the same key, so a repeat never forks history. Only transport-class
failures (timeout, network, rate limit, platform 5xx) are enqueued
automatically; configuration errors wait for an admin. Payloads are encrypted
with `PLATFORM_CREDENTIAL_KEY` because they may contain an advertiser phone.

## Site membership

`sites.owner_user_id` holds the owner; `site_members` holds everyone else. The
owner is never also a member row, so there is one answer to "who owns this".
`services/siteMembers.js` is the only place that reads or writes this — the
admin panel, the customer API and the Mini App all go through it, because three
copies of "may this person do that" would drift.

Roles are `owner`, `admin` and `support`. Support can work a site but cannot
change who has access; that separation is enforced in the service and again at
the route, so a hidden button and a forged request fail the same way.

Members are addressed by Telegram or Bale id and resolved through `identities`.
An id with no identity is refused rather than provisioned: creating an account
for an unclaimed number would let anyone grant access to a stranger, and would
make the "they have not started the bot yet" case invisible.

## Field overrides

WordPress owns the field catalog: `upsertFieldCatalog` overwrites label, order,
type, visibility and `field_meta` on every webhook. Operator choices therefore
cannot live in those columns — they would be reverted by the next publication.
They live in `label_override`, `order_override`, `platform_overrides` and
`hidden`, which nothing but an operator writes.

`applyFieldOverrides` merges them into `field_meta` once, at the top of
`publishAd` and `republishTarget`, before any policy runs. Formatters and the
field policy keep a single source for visibility, and a site with no overrides
pays nothing beyond the lookup.

## Data model

| Table | Purpose |
| --- | --- |
| `sites` | clients: credentials, targets, counters, last webhook/publication/failure |
| `users`, `identities`, `app_sessions` | customers and Mini App sessions |
| `plans`, `subscriptions`, `invoices`, `telegram_star_payments` | billing |
| `publications` | one row per (site, post, event, platform) |
| `publication_retries` | durable retry queue |
| `site_field_catalog` | field metadata from WordPress, plus the operator override columns |
| `site_members` | who may act on a site, and with which role |
| `site_webhook_events` | webhook diagnostics |
| `publication_preferences` | per-customer platform/field selection |
| `platform_connections` | encrypted per-customer platform credentials |
| `admin_users`, `admin_sessions`, `admin_audit_log` | administration |
| `admin_bot_states` | Telegram admin flow state |
| `app_settings` | operator-configurable settings |

## Performance decisions

- Field catalog: one multi-row upsert per webhook instead of one query per field.
- Client list: subscription and owner joined with `LEFT JOIN LATERAL`, not per row.
- Dashboard: grouped aggregates behind a `DASHBOARD_CACHE_MS` in-process cache.
- Every admin list is paginated (`PAGE_SIZE_DEFAULT`, capped by `PAGE_SIZE_MAX`);
  no endpoint returns an unbounded set.
- Indexes were added from the actual query shapes in `routes/` and `services/`
  (see `migrations/0008_performance_indexes.sql`), not speculatively.
- Every platform call has a timeout, so a hung platform cannot hold a request.
- `/health` performs no I/O; `/health/ready` performs the dependency checks.

## AI product automation (1.4.0)

An additional domain rather than a change to the existing one. It reuses the
customer authentication, the site ownership model, the subscription system, the
logger, the rate limiter and the migration runner; it adds no second copy of any
of them.

```
POST /api/ai/products ──▶ ai_product_drafts ──▶ ai_jobs (pending)
                                                    │
                                     src/workers/productWorker.js
                                                    │
              ┌──────────────┬──────────────────────┼───────────────┐
        image analysis   content+SEO          taxonomy match     publish
        (vision)         (structured JSON)    (store's terms)    (WooCommerce)
                                                    │
                                          ai_product_versions
```

Two decisions worth stating:

**Why a second queue table.** `publication_retries` re-sends one ad to one
platform and is keyed by `(site, post, event, platform)`. AI jobs are multi-step
workflows keyed by draft, with progress, results and their own retry budget.
Overloading one table would have made both harder to reason about. The *claiming
pattern* is shared, not duplicated: `ai_jobs` uses the same `FOR UPDATE SKIP
LOCKED` approach and imports `backoffMs` from `services/retry.js`, so both
queues age the same way.

**Why publishing is not part of the webhook path.** The existing publication
pipeline sends an ad to Telegram/Bale/WhatsApp on a WordPress event. AI product
publishing goes the other way — Jarchi writes into WooCommerce over REST. They
share no code path, so neither can regress the other.

The publication engine, formatters, field policy, webhook contract and the
Telegram/Bale bots are untouched by this feature.
