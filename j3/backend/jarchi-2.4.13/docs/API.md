# API reference

Every response carries `success` and `request_id`. Admin endpoints use:

```json
{ "success": true,  "request_id": "…", "…": "payload" }
{ "success": false, "request_id": "…", "error": { "code": "bad_request", "message": "…" } }
```

Error codes: `bad_request`, `unauthenticated`, `forbidden`, `csrf_failed`,
`not_found`, `conflict`, `rate_limited`, `internal_error`.

Lists are paginated:

```json
{ "items": [ … ], "pagination": { "page": 1, "page_size": 25, "total": 57,
  "pages": 3, "has_next": true, "has_previous": false } }
```

Query parameters `page` and `page_size` (capped by `PAGE_SIZE_MAX`) apply to
every list endpoint.

## Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness. No database access; always fast. |
| GET | `/health/ready` | Readiness: database, Telegram token, credential key; optional platforms reported but not required. `503` when not ready. |

## WordPress webhook

```
POST /webhook            (alias: POST /webhooks/wordpress)
X-Site-ID: site_shop_ab12cd
X-Webhook-Secret: jch_…          (X-API-Key also accepted)
```

Accepted body (contract 1.3; every field optional unless marked):

```jsonc
{
  "contract_version": "1.3",
  "event_type": "created",        // created | published | updated | deleted | deleted_from_trash
  "site_id": "site_shop_ab12cd",
  "post_id": "1001",              // required
  "title": "…",
  "description": "…",
  "url": "https://example.com/ad/1001",
  "fields":     { "company": "…", "phone": "…" },
  "field_meta": {
    "company": { "label": "نام شرکت", "order": 1, "type": "text",
                 "platforms": { "telegram": true, "bale": true, "whatsapp": false } },
    "phone":   { "label": "شماره تماس", "order": 2, "visibility": "telegram" }
  },
  "images": ["https://…"],
  "author": { "id": 3, "name": "…", "username": "…", "phone": "…" },
  "taxonomy": { "category": { "name": "خدمات" } },
  "publication_targets": {
    "telegram": { "enabled": true },
    "bale":     { "enabled": false },
    "whatsapp": { "enabled": false, "recipient": "989121234567" }
  },
  "buttons": {
    "view":    { "enabled": true,  "label": "مشاهده آگهی" },
    "contact": { "enabled": false, "label": "تماس با آگهی‌دهنده" }
  }
}
```

Response:

```json
{ "success": true, "site_id": "…", "post_id": "1001", "event_type": "created",
  "platforms": [ { "platform": "telegram", "status": "published",
                   "publication_id": 42, "result": { "message_ids": [101] } } ] }
```

Platform result statuses: `published`, `failed` (with `error`, `error_code`,
`retryable`, `retry_queued`), `skipped` (with `reason`), `deleted`,
`unsupported`, `blocked` (subscription lapsed), `ignored` (unsupported event).

### Backward compatibility

| Payload shape | Behaviour |
| --- | --- |
| No `contract_version` | Treated as `1.0` |
| `event` instead of `event_type`, `id` instead of `post_id` | Accepted |
| No `publication_targets` | Publishes to every channel the client has configured |
| `field_meta.visibility` without `platforms` | Legacy visibility rules apply |
| `featured_image.url` / `media.images` | Mapped into `images` |

### Deletion

`deleted` and `deleted_from_trash` remove previously published messages where
the platform supports it. Telegram and Bale messages are deleted; WhatsApp
reports `unsupported` (the Cloud API cannot recall a delivered message) and the
attempt is recorded in the publication's metadata rather than reported as
success. A deletion for a post that was never published returns
`skipped / nothing_published`.

### WordPress/plugin AI integration — `/api/sites/:siteId/ai/*`

These endpoints are intended for the first-party Jarchi WordPress plugin. They use the site's existing webhook secret (`X-Webhook-Secret` or `X-API-Key`) and resolve the site owner from
the database; the plugin must never send a user id. This lets future WordPress features use the
same AI product pipeline as the Mini App without creating a second business-logic stack.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sites/:siteId/ai/status` | AI availability, settings and quota |
| POST | `/api/sites/:siteId/ai/products` | Create an AI product draft from WordPress data; supports `source.type/id/key/metadata` |
| GET | `/api/sites/:siteId/ai/products` | List drafts for the site owner |
| GET | `/api/sites/:siteId/ai/products/:id` | Read draft, images, versions and latest job |
| PATCH | `/api/sites/:siteId/ai/products/:id` | Edit generated fields |
| POST | `/api/sites/:siteId/ai/products/:id/generate` | Queue full generation |
| POST | `/api/sites/:siteId/ai/products/:id/regenerate` | Queue targeted regeneration |
| POST | `/api/sites/:siteId/ai/products/:id/images` | Upload a WordPress image to the draft |
| POST | `/api/sites/:siteId/ai/products/:id/images/generate` | Queue generated marketing image |
| POST | `/api/sites/:siteId/ai/products/:id/approve` | Approve current version |
| POST | `/api/sites/:siteId/ai/products/:id/reject` | Reject current version |
| POST | `/api/sites/:siteId/ai/products/:id/publish` | Queue WooCommerce publication |
| GET | `/api/sites/:siteId/ai/jobs/:id` | Poll job status and resulting product |

For WordPress posts/products, use a deterministic `source.key` such as `post:123` or
`product:123`. The backend stores it with a unique index per site/source type so duplicate
webhook delivery or a plugin retry returns the existing draft instead of generating another one.

## Customer API (Mini App) — `/api/*`

Authentication: `Authorization: Bearer <session>` (issued by the bot) or
`X-Telegram-Init-Data` (verified HMAC, max age 24h). Response shapes are
unchanged from 1.2.0.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Service banner |
| GET | `/api/plans` | Active plans |
| GET | `/api/me` | Account and current subscription |
| GET | `/api/sites` | Clients owned by the caller |
| GET | `/api/fields/:siteId` | Field catalog for an owned client |
| GET | `/api/sites/:siteId/members` | Team on a site the caller belongs to |
| POST | `/api/sites/:siteId/members` | Add a member by platform id (owner/site-admin only) |
| PATCH | `/api/sites/:siteId/members/:userId` | Change a member's role (owner/site-admin only) |
| DELETE | `/api/sites/:siteId/members/:userId` | Remove a member (owner/site-admin only) |
| GET | `/api/sites/:siteId/member-lookup/:platform/:platformUserId` | Resolve a Telegram/Bale id before adding |
| PUT | `/api/preferences` | Per-platform enable + selected field keys |
| POST | `/api/connections/whatsapp` | Store WhatsApp credentials (encrypted) |
| POST | `/api/connections/bale` | Store Bale connection settings |
| POST | `/api/billing/zarinpal` | Start a ZarinPal checkout |

## Admin API — `/api/admin/*`

Authentication, in order: session cookie (web panel, CSRF required on writes),
`Authorization: Bearer <session token>`, or the legacy `ADMIN_API_TOKEN`.
Each endpoint lists the permission it requires.

### The same router inside the Mini App — `/api/admin-mini/*`

Every path below is also served under `/api/admin-mini`, where the caller is
identified by Telegram/Bale Mini App credentials instead of a panel session:
the platform id is resolved to an `admin_users` row and the same RBAC applies.
Nothing is granted by being in the Mini App — a person with no admin row gets
403 there exactly as they would on `/api/admin`.

### Plan capabilities

`features` is a closed set of booleans: `site_control`, `remote_tickets`,
`remote_announcements`, `remote_products`, `analytics`. An unknown key is
rejected rather than dropped, and every known key is always stored, so a plan
never carries an undefined capability. An omitted key is `false`.

### Auth

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | Sets the session cookie, returns `csrf_token` |
| POST | `/auth/logout` | authenticated | Revokes the current session |
| GET | `/auth/me` | authenticated | Actor, permissions, server info, fresh CSRF token |
| GET | `/auth/sessions` | authenticated | The caller's sessions |
| POST | `/auth/sessions/revoke-all` | authenticated | Revoke all of the caller's sessions |
| POST | `/auth/password` | authenticated | Change own password (revokes sessions) |

### Clients (`/clients`, alias `/sites`)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/clients` | `clients.view` — filters: `q`, `enabled`, `platform`, `owner_user_id`, `sort`, `direction` |
| POST | `/clients` | `clients.create` — returns the webhook secret once |
| GET | `/clients/:siteId` | `clients.view` (`?reveal_secret=true` needs `clients.secret_view`) |
| PATCH | `/clients/:siteId` | `clients.update` — `name`, `wordpress_url`, `telegram_channel_id`, `bale_chat_id`, `owner_telegram_id`, `notes` |
| POST | `/clients/:siteId/enabled` | `clients.disable` |
| POST | `/clients/:siteId/rotate-secret` | `clients.rotate_secret` |
| GET | `/clients/:siteId/fields` | `fields.view` |
| PATCH | `/clients/:siteId/fields/:fieldKey` | `fields.manage` — `label_override`, `order_override`, `hidden`, `platforms` |
| POST | `/clients/:siteId/fields/reorder` | `fields.manage` — `{ "order": ["field_key", …] }` |
| GET | `/clients/:siteId/members` | `clients.view` — owner plus members, with their platform ids |
| POST | `/clients/:siteId/members` | `clients.update` — by `platform`+`platform_user_id`, or legacy `user_id` |
| PATCH | `/clients/:siteId/members/:userId` | `clients.update` — role is `admin` or `support` |
| DELETE | `/clients/:siteId/members/:userId` | `clients.update` |
| POST | `/clients/assign` | `admins.manage` — quick assign, role is `owner`, `admin` or `support` |
| GET | `/clients/assignments` | `clients.view` — the recent role changes (`?limit=`, max 50) |
| GET | `/clients/lookup/:platform/:platformUserId` | `clients.view` — resolve an id to an account |
| GET | `/clients/:siteId/publications` | `publications.view` |
| GET | `/clients/:siteId/webhooks` | `webhooks.view` |
| POST | `/clients/:siteId/test` | `platforms.test` — `{ "mode": "check" \| "send" }` |
| POST | `/clients/:siteId/test/:platform` | `platforms.test` |

### Publications

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/publications` | `publications.view` — filters: `site_id`, `post_id`, `platform`, `event_type`, `status`, `from`, `to`, `q`, `only_failed` |
| GET | `/publications/stats` | `publications.view` |
| GET | `/publications/:id` | `publications.view` |
| POST | `/publications/:id/retry` | `publications.retry` |
| GET | `/publications/retries` | `publications.view` |
| POST | `/publications/retries/run` | `publications.retry` |
| POST | `/publications/retries/:id/cancel` | `publications.retry` |

### Users, billing, system

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/users` | `users.view` — filters: `q`, `status`, `subscription`, `telegram_id` |
| GET | `/users/:id` | `users.view` (phone only with `users.phone.view`) |
| POST | `/users/:id/status` | `users.update` |
| POST | `/users/:id/sessions/revoke` | `users.sessions.revoke` |
| GET | `/subscriptions` | `subscriptions.view` — filters: `state`, `plan_id`, `user_id`, `q` |
| GET | `/subscriptions/:id` | `subscriptions.view` |
| POST | `/subscriptions/:id/extend` | `subscriptions.manage` |
| POST | `/subscriptions/:id/expire` | `subscriptions.manage` |
| POST | `/subscriptions/:id/cancel` | `subscriptions.manage` |
| POST | `/subscriptions/grant` | `subscriptions.manage` |
| GET | `/plans` | `plans.view` — `?include_inactive=true`; rows carry `subscription_count`, `active_subscription_count`, `invoice_count` |
| POST | `/plans` | `plans.manage` — accepts `features` |
| PATCH | `/plans/:id` | `plans.manage` — accepts `features` |
| DELETE | `/plans/:id` | `plans.manage` — 409 with `error_code` `trial_plan`, `active_subscriptions` or `has_invoices` |
| GET | `/invoices` | `invoices.view` — filters: `status`, `user_id`, `q`, `from`, `to` |
| GET | `/invoices/:id` | `invoices.view` (accepts numeric id or `public_id`) |
| GET | `/dashboard` | `dashboard.view` (`?refresh=true` bypasses the cache) |
| GET | `/platforms` | `platforms.view` (`?probe=true` calls `getMe`) |
| GET | `/audit` | `audit.view` — filters: `action`, `channel`, `target_type`, `target_id`, `success`, `q` |
| GET | `/settings` | `settings.view` |
| GET | `/roles` | `admins.view` |
| GET | `/admins` | `admins.view` |
| POST | `/admins` | `admins.manage` |
| GET | `/admins/:id` | `admins.view` |
| PATCH | `/admins/:id` | `admins.manage` |
| POST | `/admins/:id/sessions/revoke` | `admins.manage` |

Secrets are never returned by list endpoints. Webhook secrets appear only in the
create and rotate responses, and in a client detail request that explicitly asks
for them with `clients.secret_view` — which is itself audited.

## AI product API — `/api/ai/*`

Same authentication as the rest of the customer API (session bearer token,
Telegram initData, or Bale initData) and the same response shape. Available only
when `AI_ENABLED=true`; otherwise every route answers `503` with
`error_code: "AI_DISABLED"`.

Errors carry a machine-readable code alongside the customer-facing message:

```json
{ "success": false, "error": "سهمیه تولید محصول شما در این دوره تمام شده است.", "error_code": "AI_QUOTA_ERROR" }
```

Codes: `AI_PROVIDER_ERROR`, `AI_VALIDATION_ERROR`, `AI_QUOTA_ERROR`,
`AI_DISABLED`, `IMAGE_VALIDATION_ERROR`, `MEDIA_UPLOAD_ERROR`,
`WORDPRESS_AUTH_ERROR`, `WORDPRESS_API_ERROR`, `WOOCOMMERCE_API_ERROR`,
`PRODUCT_VALIDATION_ERROR`, `JOB_ERROR`, `PERMISSION_ERROR`, `NOT_FOUND`,
`CONFLICT`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/ai/status` | Whether AI is available, limits, and the caller's quota |
| GET | `/api/ai/usage` | Quota and consumption for the current period |
| POST | `/api/ai/products` | Create a draft and (unless `generate: false`) queue generation. Honours `Idempotency-Key` |
| GET | `/api/ai/products` | List the caller's drafts (`site_id`, `status`, `page`, `page_size`) |
| GET | `/api/ai/products/:id` | Draft with input, generated result, warnings, images, versions, current job |
| PATCH | `/api/ai/products/:id` | Edit generated fields; edited fields become locked |
| GET | `/api/ai/products/:id/versions` | Version history (`?version=n` for one) |
| POST | `/api/ai/products/:id/generate` | Queue a full generation |
| POST | `/api/ai/products/:id/regenerate` | Queue a targeted regeneration (`section`) |
| POST | `/api/ai/products/:id/images` | Upload an image (raw bytes or `{ "image": "data:…" }`) |
| DELETE | `/api/ai/products/:id/images/:imageId` | Remove an image |
| POST | `/api/ai/products/:id/images/generate` | Queue image generation |
| POST | `/api/ai/products/:id/approve` | Approve the current version |
| POST | `/api/ai/products/:id/reject` | Reject with an optional reason |
| POST | `/api/ai/products/:id/publish` | Queue publication to WooCommerce (idempotent) |
| POST | `/api/ai/products/:id/cancel` | Cancel a draft that has not been published |
| GET | `/api/ai/jobs/:id` | Job status and progress for polling |

Job responses are designed for polling and for a later push transport: the panel
reads `{ id, type, status, progress, attempts, error }`, which is exactly what a
WebSocket or SSE frame would carry.

### Site configuration

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/sites/:siteId/product-settings` | Automation rules for the site |
| PUT | `/api/sites/:siteId/product-settings` | Update them |
| GET | `/api/sites/:siteId/woocommerce` | Connection status and a masked key hint |
| POST | `/api/sites/:siteId/woocommerce` | Save credentials, then test them |
| POST | `/api/sites/:siteId/woocommerce/test` | Re-test the connection |
| DELETE | `/api/sites/:siteId/woocommerce` | Remove the connection |
| GET | `/api/sites/:siteId/woocommerce/categories` | Store categories |
| GET | `/api/sites/:siteId/woocommerce/tags` | Store tags |
| GET | `/api/sites/:siteId/woocommerce/attributes` | Global attributes |

Every one of these verifies that the authenticated customer owns the site; the
`site_id` in the request is only a lookup key, never a claim of ownership.

### Admin — `/api/admin/ai/*`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/ai/overview` | `ai.view` — job counts, draft states, recent failures, failing connections |
| GET | `/api/admin/ai/jobs` | `ai.view` — filter by `status`, `type`, `user_id`, `site_id` |
| GET | `/api/admin/ai/jobs/:id` | `ai.view` |
| POST | `/api/admin/ai/jobs/:id/retry` | `ai.manage` |
| POST | `/api/admin/ai/jobs/:id/cancel` | `ai.manage` |
| POST | `/api/admin/ai/jobs/run` | `ai.manage` — run a worker batch now |
| GET | `/api/admin/ai/drafts` | `ai.view` — status only, not the customer's copy |
| GET | `/api/admin/ai/usage` | `ai.view` — usage per customer for a period |
| GET | `/api/admin/ai/connections` | `ai.view` — WooCommerce connection health (no credentials) |
| POST | `/api/admin/ai/media/purge` | `ai.manage` — sweep abandoned uploads |
