# Administration

## Roles and permissions

Authorization lives in one place: `src/core/rbac.js`. Routes and bot handlers
ask `can(actor, permission)`; there are no scattered role conditions.

| Permission | viewer | support | admin | super_admin |
| --- | :-: | :-: | :-: | :-: |
| `dashboard.view` | ✅ | ✅ | ✅ | ✅ |
| `clients.view`, `platforms.view`, `webhooks.view` | ✅ | ✅ | ✅ | ✅ |
| `publications.view`, `fields.view` | ✅ | ✅ | ✅ | ✅ |
| `users.view`, `subscriptions.view`, `plans.view`, `invoices.view` | ✅ | ✅ | ✅ | ✅ |
| `publications.retry` | — | ✅ | ✅ | ✅ |
| `users.sessions.revoke` | — | ✅ | ✅ | ✅ |
| `platforms.test` | — | ✅ | ✅ | ✅ |
| `clients.create`, `clients.update`, `clients.disable` | — | — | ✅ | ✅ |
| `clients.rotate_secret`, `clients.secret_view` | — | — | ✅ | ✅ |
| `platforms.update` | — | — | ✅ | ✅ |
| `users.update`, `users.phone.view` | — | — | ✅ | ✅ |
| `subscriptions.manage`, `plans.manage` | — | — | ✅ | ✅ |
| `audit.view`, `settings.view` | — | — | ✅ | ✅ |
| `admins.view`, `admins.manage`, `settings.manage` | — | — | — | ✅ |

Notes:

- **Phone numbers** need `users.phone.view`. Lists never include them at all;
  detail responses fall back to a masked value; the Telegram bot only ever
  shows the masked form, whatever the admin's role.
- A **disabled** account loses every permission immediately, and disabling or
  changing an admin's role revokes their live sessions.
- The instance refuses to demote or disable the **last active super admin**.

## First boot

With no admin accounts, the backend creates one super admin from
`ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` (and `ADMIN_TELEGRAM_ID`
when set). On later boots, `ADMIN_TELEGRAM_ID` is attached to the first super
admin that has no Telegram identity yet, so the 1.2.0 setup keeps working.

Change the bootstrap password after the first login (Settings → «تغییر گذرواژه»).

## Web panel — `/admin/`

Sessions are HttpOnly cookies. The panel keeps only a CSRF token in memory:
nothing sensitive is written to `localStorage` (only the light/dark preference).

- **Dashboard** — clients, users, subscriptions, invoices, publication counters,
  a 14-day volume chart, platform distribution, recent failures and publications.
  Aggregates are cached for `DASHBOARD_CACHE_MS`; «تازه‌سازی» forces a refresh.
- **Clients** — searchable, filterable, paginated list; detail with tabs for
  overview, platforms, fields, publications and webhook diagnostics.
- **Publications** — filter by client, post, platform, event, status and date;
  detail modal with error, error class, duration, message ids and retry state.
- **Retry queue** — queue state, manual run, cancel.
- **Users** — search, detail (subscriptions, invoices, sites, sessions),
  suspend/activate, revoke sessions.
- **Subscriptions / Plans / Invoices** — extend, expire, cancel, grant; plan
  editing; invoice search with provider reference and metadata.
- **Platforms** — configuration status of the shared bots, with masked token
  fingerprints only.
- **Admins** — accounts, roles, session revocation, and the full permission map.
- **Audit** — who did what, from which channel, with the result.

## Client provisioning

1. **Clients → «کلاینت جدید»**. Name and WordPress URL are required; owner
   Telegram id, Telegram channel and Bale chat are optional.
2. The backend generates `site_id` and a webhook secret and, when an owner is
   given, starts their 7-day trial.
3. The credentials dialog shows Site ID, Webhook URL and Webhook Secret — the
   only time the secret is displayed. Hand these to the customer for the plugin.
4. Verify with **Platforms → «تست اتصال»** (read-only) or «ارسال پیام تست»
   (posts a visible message; asks for confirmation first).

### Rotating a webhook secret

Rotation is immediate: the old secret stops working, so the customer's site
cannot publish until the new value is entered in the plugin. The panel and the
bot both confirm before rotating, show the new value once, and audit the action.

## Failure handling

The client detail «وبهوک» tab shows the last requests with HTTP status,
authentication result, duration and error — enough to tell "the plugin is not
calling us", "the secret is wrong" and "delivery failed" apart.

For delivery failures, the publication detail shows the platform error class:

| Class | Meaning | Retried automatically |
| --- | --- | --- |
| `timeout`, `network` | Transport problem | yes |
| `rate_limited` | Platform throttling (honours `retry_after`) | yes |
| `server_error` | Platform 5xx | yes |
| `auth` | Bot token rejected | no |
| `config` | Channel missing, bot not a member, target unset | no |
| `invalid_request` | Payload rejected by the platform | no |

Non-retryable classes need a fix (correct the channel, re-add the bot, adjust
the payload); then use «تلاش مجدد» on the publication.
