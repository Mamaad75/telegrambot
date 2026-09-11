# Changelog

## 2.4.13 — Bale legacy JavaScript compatibility bundle

- Keeps Telegram on the unchanged modern Mini App bundle.
- Serves Bale a prebuilt ES5-compatible bundle so older Bale WebView engines do not fail parsing optional chaining, nullish coalescing, async syntax transforms, or other modern syntax before Jarchi can start.
- Adds small runtime polyfills used by the Mini App (`replaceAll`, `Object.fromEntries`, `crypto.randomUUID`).
- Preserves the 2.4.10 field-schema reconciliation and all later Bale framing/session hardening.

## 2.4.12 — Bale Web non-blocking SDK + session-first bootstrap

- Keeps the official Bale SDK as the first script but loads it asynchronously, so an unreachable/slow `tapi.bale.ai` can never parser-block Jarchi.
- Bale `/panel` links now prefer the server-minted launch session over SDK `initData`; direct Mini App launches still fall back to validated `initData`.
- Retries SDK attachment in the background and calls `ready()`/`expand()` as soon as `Bale.WebApp` becomes available.
- Telegram behavior and the 2.4.10 schema reconciliation remain unchanged.

## 2.4.11 — Bale canonical SDK/bootstrap fix

- Restores a dedicated Bale HTML entry with the official Bale Mini App SDK loaded synchronously before every other script.
- Calls `Bale.WebApp.ready()` / `expand()` as soon as the SDK is available, including late SDK initialization.
- Uses Bale `initData` as the primary authentication credential; bot session tokens remain only as an in-memory fallback.
- Avoids `history.replaceState` and sessionStorage routing state in Bale Web iframe mode.
- Adds Bale's documented `frame-src https://*.bale.ai` CSP allowance while retaining the restricted `frame-ancestors` policy and no `X-Frame-Options` on the Bale entry.
- Leaves Telegram behavior from 2.4.10 unchanged.

## 2.4.10 — legacy schema reconciliation + Bale main-entry restore

- Fixed the Super Admin Fields 500 on installations whose legacy `site_field_catalog` table predates the baseline `created_at` column.
- Added migration `0017_legacy_schema_reconciliation.sql` to reconcile `site_field_catalog.created_at`, `site_field_catalog.updated_at`, and the historically missing `subscriptions.updated_at` column.
- Made field-catalog reads defensive against absent timestamp columns even before reconciliation completes.
- Restored Bale launches to the proven main `/app/?platform=bale&session=…` Mini App entry used successfully by older production releases.
- The main app entry is frameable only when explicitly launched with `platform=bale`, and still only by official Bale origins. Telegram and normal web routes remain `X-Frame-Options: DENY`.
- Legacy `/app/bale.html` buttons now redirect to the main entry, so old chat buttons are not stranded.

# Jarchi 2.4.8

- Fix Bale Web/Desktop authentication inside the cross-site embedded Mini App.
- Keep the validated Bale launch token only for the lifetime of the active WebView/tab so API calls do not depend on third-party cookie delivery.
- Continue exchanging the token into the HttpOnly cookie for compatible clients while preserving the Telegram cookie-only behavior.

# 2.4.7

- Fix Bale Web/Desktop Mini App rendering blocked by the global `X-Frame-Options: DENY`.
- Allow only `/app/bale.html` to be framed by official Bale origins via CSP `frame-ancestors`.
- Keep every other Jarchi route non-frameable.

# Changelog

## 2.4.7

- Fixed Bale Mini App launch compatibility by restoring the launch session to the HTTP query string for Bale only; Bale clients may reserve/replace URL fragments while constructing the Mini App WebView URL.
- Added a dedicated `/app/bale.html` entry point that loads `https://tapi.bale.ai/miniapp.js?3` synchronously before Jarchi application scripts, matching Bale Mini App SDK requirements.
- Telegram keeps the safer fragment-based launch token flow introduced in 2.4.4/2.4.5.
- Existing query-session redaction and immediate `history.replaceState` cleanup remain in place, so Jarchi application logs/UI do not retain the Bale launch token.

## 2.4.5

- Hotfix: third-party Telegram/Bale SDKs load asynchronously and can no longer block the local Mini App bundle.
- Telegram customer launch links now carry `platform=telegram` explicitly.
- Direct platform launches briefly wait for SDK initData only when no bot session token is available.

# Changelog

## 2.4.4 — 2026-08-30

- Fixed Mini App session-to-cookie exchange and removed bearer persistence after a successful exchange.
- Moved new launch-session links into URL fragments and redacted legacy launch/session credentials from application logs.
- Ignored opaque cross-origin `Script error.` bootstrap noise.
- Made field platform overrides partial/atomic and fixed read-only effective field state.
- Isolated expiry notification failures per subscription.
- Added safe loopback reverse-proxy trust for production defaults.
- Derived runtime version from `package.json`; added `.env.example` and session housekeeping.
- Hardened customer ticket identity handling and HTTP timeout cleanup.

# 2.4.3

- Fix Mini App field catalog failures on partially migrated installations by falling back to the baseline field schema.
- Prevent generic cross-origin `Script error.` events from replacing the Mini App during startup.
- Bump Mini App asset cache version to 2.4.3.

# 2.4.1

- Fix Mini App bootstrap compatibility with legacy `?session=` launch URLs.
- Exchange the legacy session URL token into an HttpOnly `jarchi_session` cookie.
- Add a boot watchdog and fatal runtime/unhandled-rejection screen instead of an infinite skeleton.
- Cache-bust Mini App assets to `v=2.4.1`.
- Keep Telegram/Bale Bearer and signed initData authentication unchanged.

## 2.4.0

- Added unified Telegram/Bale account linking with one Jarchi user as the canonical account.
- Added one-time, short-lived, hashed link challenges with platform binding and replay protection.
- Linked identities share the same subscription, site memberships, roles, tickets and AI state.
- Added Mini App Account screen to connect/disconnect Telegram and Bale and show the canonical account status.
- Completing a cross-platform link from either bot now opens the same Jarchi account Mini App on the target platform.
- Super-admin records are synchronized across linked Telegram/Bale identities when safe and only when the other identity slot is empty.
- Added 0016_unified_account_links.sql with one-identity-per-platform invariant per Jarchi user.

## 2.3.1

- Fixed publication-field visibility: owners/admins can inspect WordPress-provided publication fields without a paid entitlement; editing/routing remains gated by `site_control`.
- Added Super Admin Users screen in Mini App with search, user details, and manual plan grants.
- Manual admin grants now replace an active trial/subscription by default so the selected plan is effective immediately; the action is audited with a reason.
- Added `AUTO_TRIAL_ON_START` (default `false`) and gated all onboarding/auth paths so trials are not silently created through Mini App auth or WordPress service auth.

## 2.3.0

- Central site-role enforcement for customer Mini App operations.
- Site-scoped AI entitlements and quotas; legacy user-only quota remains supported when no site is selected.
- Asynchronous rotating JSON logs with sensitive-field redaction.
- Admin Mini App observability screen with database pool, memory and log tail.
- Safer Mini App session URLs: session token is moved to sessionStorage and removed from browser history.
- Security response headers, request timeout protection, DB pool tuning and a 1000-user load harness.
- AI/site usage indexes and graceful database shutdown.

## 2.2.0

### Fixed

- `/api/admin/*` and `/api/admin-mini/*` returned `400 siteId is required` before
  authentication ran. The site-scoped routers were mounted at `/api` with
  router-level guards, which Express runs for every `/api` path; `siteAi`'s own
  routes were affected too, since a bare `use()` receives no params from a mount
  path that declares none. Each guard is now bound to the paths its router owns.
- Deleting the trial plan is refused. `ensureTrial()` puts every new customer on
  it by id, so removing it broke signup with nothing yet subscribed to warn us.

### Site membership

- One service decides who may act on a site, used by the admin panel, the
  customer API and the Mini App alike. Roles are `owner`, `admin` and `support`,
  constrained in the database; 0013 left them free-form and the admin API was
  accepting a third vocabulary (`manager`, `viewer`), which is migrated over.
- Members are added by Telegram or Bale id. An id nobody has claimed is refused
  with an instruction to open the bot, not a generic failure.
- Support may see the team but never change it. Nobody can remove their own
  access. The owner is never also a member row.
- Quick assign (`POST /api/admin/clients/assign`, super admin only) grants access
  in one step; `owner` transfers the site and keeps the previous owner as admin.

### Field control

- Labels, ordering and per-platform routing can be overridden per site. The
  overrides live in their own columns, untouched by the webhook upsert, so a
  choice survives the next publication instead of being reverted by the plugin.
- The publication engine folds overrides into `field_meta` once, before policy
  runs, so formatters keep a single source for visibility.
- Editing fields needs the new `fields.manage` permission (admin and above);
  `fields.view` stays read-only.

### Plans

- `features` is carried through create and edit against a closed capability
  list, and an unknown key is rejected rather than silently dropped.
- Plans can be deleted only when nothing is subscribed and nothing was billed;
  the refusal names deactivation as the alternative.

### Mini App

- Rewritten for the control centre: site management with per-site tabs, team
  management, quick assign, plan pricing and field control, alongside the
  existing product and ticket screens.
- Brand palette as CSS custom properties with a light/dark toggle that persists
  and follows the system default until a choice is made; Vazirmatn with a
  Tahoma/Arial fallback; sticky bar, bottom tabs and a drawer; card-based
  records instead of tables; slide-up sheets; skeletons; empty states.
- Credentials (site id, webhook URL, webhook secret) are shown once, copyable,
  and the dialog states that the secret cannot be recovered.

## 2.1.1

- Reworked Telegram/Bale publication formatter into a structured, dynamic renderer.
- Removed legacy hardcoded emoji/label layout from automatic messages.
- Added per-field icon, prefix and suffix support through field metadata.
- Structured mode is now the safe default; custom templates are explicit.
- Bale publications can send the configured image with a caption.
- Explicitly mapped custom fields named `status` are no longer suppressed as system fields.

# 1.9.0

- Ticket client API understands advanced Ticket Center metadata/custom fields.
- Preserves existing customer scoping, RBAC, bot, Mini App and multi-site behavior.

## 2.1.0
- Site-scoped Mini App entitlements are now automatic: active site members inherit the site owner's active paid plan.
- Trial subscriptions never grant remote site features.
- `/api/sites` now returns site-level entitlement state and `/api/entitlements/:siteId` exposes paywall-safe capability state.
- Remote ticket/product/site-control routes use site-aware entitlement checks.
- Added remote announcement creation endpoint gated by `remote_announcements`.
- Mini App refreshes subscription/site entitlement state automatically after checkout and when the app becomes visible again.
- Payment verification returns a fresh entitlement snapshot after successful activation.
