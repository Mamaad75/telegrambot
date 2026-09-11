# Jarchi 2.4.4

Stability and security release for the Mini App/control plane.

## Fixed

- Mini App legacy launch-session exchange now reliably issues the HttpOnly cookie and no longer depends on a bearer token after exchange.
- New bot launch links carry the session in the URL fragment (never sent to Nginx/HTTP logs), while legacy `?session=` remains supported and is redacted from application logs.
- Generic cross-origin `Script error.` events no longer replace the Mini App during bootstrap.
- Field platform toggles are merged atomically, so changing Telegram cannot erase Bale/WhatsApp overrides.
- Read-only field screens receive effective label/order/platform state.
- Expiry scanning isolates Telegram recipient failures; one invalid/bot recipient no longer aborts the entire scan, and expired subscriptions are still transitioned.
- Production reverse-proxy trust defaults to loopback, preventing all proxied users from sharing one rate-limit identity on the standard local-Nginx deployment.
- Runtime version is derived from `package.json`, eliminating health/UI version drift.
- Expired/revoked customer Mini App sessions are purged by housekeeping.
- Existing platform identities refresh non-empty profile fields instead of staying permanently stale.
- Customer ticket creation no longer accepts browser-supplied WordPress customer identity fields.
- WordPress ticket HTTP timeout timers are always cleaned up.
- Added the missing `.env.example` referenced by deployment documentation.

## Tests added/strengthened

- Behavioural integration coverage for session exchange cookie -> `/api/me` without Bearer auth.
- Regression coverage for partial field-platform merges.
- URL credential-redaction tests and stronger Mini App compatibility assertions.
