# Security

## Administrator authentication

| Mechanism | Where | Notes |
| --- | --- | --- |
| Session cookie | Web panel | HttpOnly, SameSite=Strict, `Secure` in production. Idle timeout `ADMIN_SESSION_IDLE_MINUTES`, hard cap `ADMIN_SESSION_ABSOLUTE_HOURS`, token rotated every `ADMIN_SESSION_ROTATE_MINUTES`. |
| Bearer session token | API clients | Same sessions; no CSRF requirement because no cookie is involved. |
| `ADMIN_API_TOKEN` | Legacy automation | Maps to a synthetic `super_admin` actor labelled `api-token` in the audit log. Leave the variable empty to disable. |
| Telegram identity | Admin bot | `admin_users.telegram_user_id`, active accounts only. |

Passwords are stored with scrypt (N=16384, r=8, p=1, 64-byte key, per-password
salt). An unknown username still performs a verification so response time does
not distinguish "no such account" from "wrong password". After
`ADMIN_LOGIN_MAX_ATTEMPTS` failures an account locks for
`ADMIN_LOGIN_LOCK_MINUTES`.

Only session token *hashes* are stored. The CSRF token is derived from the
session's identity (HMAC with `PLATFORM_CREDENTIAL_KEY`), so login and a later
`/auth/me` return the same value and a reloaded panel keeps working; it changes
whenever the session rotates.

Nothing sensitive is written to browser storage: the panel keeps the CSRF token
in memory and only persists the light/dark preference.

## Webhook authentication

Per-client secrets, compared in constant time, transported in
`X-Webhook-Secret` (or `X-API-Key`). Every rejection is recorded in
`site_webhook_events` with the reason (`unknown_site`, `site_disabled`,
`invalid_secret`), which is what makes "the customer's plugin is misconfigured"
visible instead of silent.

Set `TELEGRAM_WEBHOOK_SECRET_TOKEN` to have Telegram echo a secret on every
update; the backend rejects updates without it.

## Secrets at rest

- Platform credentials (WhatsApp access tokens, Bale connection settings) are
  encrypted with AES-256-GCM using `PLATFORM_CREDENTIAL_KEY`.
- Advertiser phone numbers on publications are encrypted with the same key and
  decrypted only when the contact button is pressed.
- Retry payloads are encrypted, because a queued ad may contain a phone number.
- Bot tokens live only in the environment. The admin surfaces show a masked
  fingerprint (`1234••••••wxyz`), never the value.
- Webhook secrets are shown exactly once, at creation or rotation. A client
  detail request can reveal one only with `clients.secret_view`, and that read is
  audited.

Rotating `PLATFORM_CREDENTIAL_KEY` makes existing encrypted values unreadable —
re-enter platform credentials after changing it.

## Phone privacy

1. List responses never contain a phone number, whatever the caller's role.
2. Detail responses include one only with `users.phone.view`; otherwise a masked
   value plus a `has_phone` flag.
3. The Telegram bot always shows the masked form — a chat is not a controlled
   surface.
4. Logs mask phone-shaped keys (`0912***4567`) and redact secrets entirely.
5. Publication metadata is stripped of phone- and credential-shaped keys before
   leaving the service layer; the pre-1.3 plaintext copy in
   `publications.metadata` is deleted by migration `0006`.
6. A phone is only published when field policy allows it for that platform.

## Rate limiting

| Limiter | Default | Key |
| --- | --- | --- |
| Admin API | 240 / minute | client IP |
| Admin login | 10 / 5 minutes | IP + username |
| WordPress webhook | 120 / minute | site id |
| Customer API | 120 / minute | client IP |
| Telegram admin bot | 60 / minute | admin Telegram id |

Counters are per process. Jarchi ships as a single PM2 fork instance
(`ecosystem.config.cjs`), so that is the whole picture; **running several
instances behind a load balancer would need a shared store** — treat the current
limiter as per-instance until then.

## Audit log

`admin_audit_log` records actor, role, channel (`web` / `telegram` /
`api_token`), action, target, success, request id, IP and descriptive metadata
for: login and logout, permission denials, client create/update/enable/disable,
secret rotation and secret reveal, platform configuration and tests, publication
retries, user suspension and session revocation, subscription and plan changes,
and administrator management. Secrets are never recorded.

## Input validation

`src/middleware/validate.js` is used by both the HTTP API and the bot flows:
URLs must be absolute `http(s)` (no `javascript:`), site ids must match the
generated shape, Telegram ids are numeric, channel targets accept only
`@username`, `t.me` links or numeric chat ids, phone numbers are normalized
msisdns, and enums/integers/dates are checked rather than coerced. All SQL is
parameterized, including filters (`Filters` in `src/utils/pagination.js`).

Untrusted inputs — WordPress payloads, browser requests, Telegram callback data
— are all treated as hostile: nothing from them selects a code path without
validation, and callback data never carries authorization.

## Known limitations

- Rate limiting and the dashboard cache are per process (see above).
- The legacy `ADMIN_API_TOKEN` is a full-power credential with no expiry; prefer
  admin accounts and disable it when nothing depends on it.
- WhatsApp cannot delete a delivered message; deletion reports `unsupported`.

## AI product automation (1.4.0)

### Untrusted in both directions

Model output is treated exactly like a webhook payload: hostile until validated.
It is parsed, type-checked, length-bounded and sanitized in
`ai/schemas/generatedProduct.js` before it is stored, and structurally unusable
output is discarded rather than saved.

Customer input and store data are equally untrusted on the way *in*. They never
join the system message; they travel as JSON in the user message under a key the
prompt describes as untrusted, and instruction-shaped phrases
("ignore previous instructions", `<|im_start|>`, the Persian equivalents) are
replaced with `[removed]` first. When that filter fires, the draft carries a
`prompt_injection_filtered` warning, so it is visible rather than silent.

**AI output never becomes an instruction.** There is no tool-calling loop, no
eval, no dynamic route; the model returns data that is validated and stored.

### Uploads

The declared `Content-Type` is ignored in favour of the file's magic bytes, and
the container header is parsed for real dimensions — a PHP payload named
`.png` is rejected on content. Size, dimensions and per-draft count are bounded.
Files are written under `AI_MEDIA_DIR` with a random, backend-generated name
(never anything customer-supplied), and every read resolves the path and refuses
anything outside the media root.

### SSRF

A customer supplies their own store address, so every outbound URL is vetted in
`utils/safeUrl.js`: http(s) only, no embedded credentials, no blocked hostname,
and no resolution into loopback, link-local, RFC1918, carrier-grade NAT or
metadata ranges. The check runs when the connection is saved **and** on every
request, so a DNS record changed later cannot turn a public host into an
internal one. The base URL is additionally pinned to the hostname already
registered for the site. `WOOCOMMERCE_ALLOW_PRIVATE_HOSTS=true` disables the
private-range check and is for staging only.

### Credentials

WooCommerce consumer keys and WordPress application passwords are encrypted with
`PLATFORM_CREDENTIAL_KEY` and decrypted only inside `services/woocommerce.js`,
immediately before a request. No route returns them: `getConnectionView` exposes
status, the last test result and a masked key hint. The AI provider key lives in
the environment and is read only inside `ai/providers/openai.js`.

Provider and store error messages are logged in full and **never** returned to
the customer — the response carries a safe message plus an error code, so an
"Incorrect API key provided: sk-live-…" from a provider cannot reach a browser.

### Ownership

Every AI route resolves the site through `requireOwnedSite`, which reads the
owner from the database; `site_id` in a request is a lookup key, never a claim.
Drafts, jobs and images are loaded through service functions that take the
caller's user id and throw `PERMISSION_ERROR` on a mismatch, so a guessed
identifier gains nothing.

### Abuse

AI endpoints are rate limited per user (not per IP, since Mini App addresses
change constantly): generation, image generation, upload and publish each have
their own window. Quota is enforced on top, atomically, so a burst cannot spend
more credits than the plan allows.
