# Jarchi 2.3.0 — Secure Mini App / Production Hardening

This release is based on the Jarchi Mini App Enhancement Prompt and the 2.2.0 codebase.

## Main changes
- Enforced site roles server-side for customer Mini App operations.
- Support members are limited to support workflows; owner/admin are required for site control, member management, AI product operations, connections and WooCommerce settings.
- Site-scoped AI entitlements and AI quota when a site context exists.
- PostgreSQL advisory transaction lock around AI quota reservations to prevent concurrent over-spend.
- Async JSON logging with rotation and sensitive-value redaction.
- Admin Mini App Monitoring screen: process memory, PostgreSQL pool stats and recent logs.
- Request IDs, slow-request logging and user/site/role context in HTTP logs.
- Referrer-Policy, nosniff, frame and Permissions-Policy headers.
- Bounded JSON request bodies and HTTP server timeouts.
- Mini App session query parameter moved to sessionStorage and removed from browser history after first load.
- AI/site usage indexes in migration 0015.
- Non-overlapping background scheduler to avoid worker pile-ups.
- Graceful database shutdown and fail-fast behavior for uncaught process errors.
- Added 1000-user load harness: tools/load-test-1000.mjs.
- Vazirmatn + requested Jarchi color system retained; UI adds monitoring cards and log viewer.

## Database
Run:
  npm run db:migrate

New migration:
  0015_ai_site_usage_indexes.sql

## Observability
- Liveness: GET /health
- Readiness: GET /health/ready
- Admin Mini App: Management → Monitoring
- Log file: logs/jarchi.log (configurable)

## Load test
Run against staging/private infrastructure:
  BACKEND_URL=https://staging.example.com node tools/load-test-1000.mjs

The load harness does not fabricate customer credentials; for protected API testing use a staging-only test account and a private endpoint.
