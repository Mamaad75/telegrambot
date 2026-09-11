# Testing

```bash
npm test                                   # unit suites, no database needed
JARCHI_TEST_DATABASE_URL=postgresql://user@host/jarchi_test npm run test:integration
npm run test:all                           # both
```

Integration suites only ever touch the database named by
**`JARCHI_TEST_DATABASE_URL`** — never `DATABASE_URL` — because the harness
drops and recreates the `public` schema. Without that variable they report
`NOT TESTED` and skip rather than pretending to pass.

## Unit suites (`tests/*.test.js`)

| File | Covers |
| --- | --- |
| `auth.test.js` | Telegram initData: valid, extra signed fields, wrong bot token, tampered payload, expired, future-dated, missing hash, custom max age |
| `rbac.test.js` | Role matrix, monotonic permission growth, inactive accounts, unknown permissions, `assertCan` |
| `fieldPolicy.test.js` | Explicit platform visibility, legacy `visibility`, hidden/admin/backend, empty values, system keys, selected keys, contact-phone rule |
| `publicationPolicy.test.js` | Per-post targets, site defaults, legacy fallback, zero targets, multiple targets, t.me normalization |
| `formatter.test.js` | Labels/order from `field_meta`, per-platform visibility, buttons, caption vs message limits, HTML sanitization and escaping, plain-text output, normalizer contract 1.0→1.3 |
| `security.test.js` | scrypt hashing, constant-time compare, AES-256-GCM round trip, tamper and wrong-key rejection, masking |
| `validation.test.js` | URL/site id/Telegram id/target/phone/int/bool/enum/date validators |
| `pagination.test.js` | Page clamping, metadata, parameterized filter building |
| `retry.test.js` | Backoff growth and ceiling, retryable classification, HTTP status mapping, thrown-error categorization |
| `logger.test.js` | Secret redaction, phone masking, nested/array redaction, error serialization, file output |
| `plans.test.js` | Plan durations |
| `ai-validation.test.js` | Accepting valid AI output; rejecting unusable output; wrong types; markup stripping; price normalization; inferred-attribute flagging; tag deduplication; model warnings; SEO review and keyword stuffing; customer edit validation |
| `ai-security.test.js` | Prompt-injection neutralizing; HTML/text/slug sanitizing; image magic-byte sniffing and rejection of disguised payloads; size and dimension limits; SSRF blocking and hostname pinning; path-join escape; provider detail never reaching a customer response |
| `bale-auth.test.js`, `bale-platform.test.js` | Bale Mini App initData and platform adapter |

## Integration suites (`tests/integration/*.test.js`)

Run against a **real PostgreSQL** database through the real migrations,
sequentially (they share one database).

| File | Covers |
| --- | --- |
| `database.test.js` | Migrations create every table; plan seed; admin bootstrap, login, session resolution/rotation/revocation, lockout, disable-revokes-sessions; client provisioning, update, enable/disable, secret rotation, list filters; field catalog upsert; webhook diagnostics and counters; publication filters and metadata sanitization; retry queue idempotency, claiming, bounding, stuck reclaim, encrypted payload; user admin and phone gating; billing extend/expire/grant, invoice immutability and idempotent activation; audit filters; bot state expiry; dashboard cache |
| `api.test.js` | A real server process end to end: liveness vs readiness, anonymous rejection, login, CSRF enforcement, input validation, client creation and secret handling, webhook authentication, a contract-1.3 publication through the real adapter (field and button policy asserted on the delivered payload), field catalog and webhook diagnostics, transport failure → retry queue, config failure → no retry, retry run → published, publication filters, update/delete flows, unsupported and legacy payloads, subscription gating, disabled client, secret rotation invalidating the old secret, RBAC for viewer/support, phone gating, last-super-admin protection, legacy API token, dashboard, logout, 404 shape, and a scan of the server's own log stream for leaked secrets or phone numbers |
| `aiProducts.test.js` | AI domain against real PostgreSQL and a local WooCommerce double: credential encryption and masking, connection testing and failure reporting, safe automation defaults, idempotent draft creation, image storage and rejection, generation as a job, inferred-attribute flagging, edit-locking across regeneration, version history, publishing exactly once across duplicates, media uploaded once, adoption of a product orphaned by a lost attempt, retryable vs permanent failures, malformed output rejection, atomic quota enforcement, no-subscription refusal, cross-customer refusal, opt-in auto-publish, stale job reclaim, abandoned upload sweeping |
| `aiApi.test.js` | The AI API over HTTP against a real server process: authentication, cross-customer refusal on every verb, idempotent creation via `Idempotency-Key`, asynchronous generation through the background worker, job polling without leaking internals, image upload validation and size limits, edit-then-regenerate field locking, version history, approval gating, WooCommerce connection save/test with secrets hidden, concurrent publish creating one product, already-published reporting, settings validation, quota exhaustion, unchanged existing endpoints, readiness reporting, and a scan of the server log for leaked credentials |
| `bot.test.js` | Admin bot through the real handlers with a bot double: unknown/disabled admins refused, permission-filtered menu, callback authorization re-checked server-side, viewer denials, unknown callbacks, dashboard, client detail/fields/webhooks, confirmation before destructive actions, secret rotation audited and shown once, a full multi-step flow including validation failure and a simulated restart, cancellation, expiry, permission loss mid-flow, masked phone output, support vs viewer tooling, per-admin rate limiting |

## External services

| Dependency | Status | How |
| --- | --- | --- |
| PostgreSQL | **TESTED** | Real PostgreSQL 16 via `JARCHI_TEST_DATABASE_URL` |
| Bale API | **TESTED against a local protocol double** | `startBaleDouble()` speaks the Bale Bot API shape over real HTTP, so `src/platforms/bale.js`, error mapping and the retry path run for real. Not the Bale service itself. |
| WooCommerce / WordPress REST | **TESTED against a local protocol double** | `startWooCommerceDouble()` speaks the WC/WP REST shapes over real HTTP, so `services/woocommerce.js`, media upload, error mapping and the publisher run for real. Not a real WooCommerce installation. |
| AI provider (OpenAI) | **NOT TESTED against a live provider** | Tests use `MockAiProvider` (`AI_PROVIDER=mock`), which is deterministic and can be told to fail in specific ways. The OpenAI HTTP client itself is not exercised against OpenAI. |
| Telegram Bot API | **NOT TESTED against Telegram** | No test bot token available in this environment. Bot logic is covered through the real handlers with a bot double; the adapter's HTTP behaviour is not exercised against Telegram. |
| WhatsApp Cloud API | **NOT TESTED** | Requires Meta Business credentials. |
| ZarinPal | **NOT TESTED** | Requires sandbox merchant credentials. |
| Telegram Stars | **NOT TESTED** | Requires a live bot and a real purchase. |

To exercise the untested paths, set the corresponding credentials in a staging
`.env`, run `npm start`, then use the admin panel's connection tests
(«تست اتصال» / «ارسال پیام تست») and a sandbox checkout.

## Browser check

The admin panel was driven with Playwright (Chromium) during development:
login, every section, client creation through the UI, the credentials dialog,
tab navigation, a write after a page reload (CSRF path), confirmation dialogs,
light/dark themes and a 390px viewport with no horizontal overflow. That check
is a development tool, not part of `npm test`.
