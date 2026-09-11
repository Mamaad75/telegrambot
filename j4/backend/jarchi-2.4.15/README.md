# جارچی (Jarchi) — Backend 2.4.4

Jarchi is the control plane for a multi-site, multi-platform advertisement
service. WordPress sites send publication events to this backend, which applies
policy, formats each message per platform and delivers it to Telegram, Bale or
WhatsApp — while owning credentials, clients, subscriptions, billing and
diagnostics.

```
                    JARCHI BACKEND
                          │
            ┌─────────────┴─────────────┐
       WEB ADMIN                   TELEGRAM ADMIN
            └─────────────┬─────────────┘
                   SHARED SERVICES
        ┌─────────────────┼─────────────────┐
      CLIENTS          BILLING         PUBLICATIONS
        └─────────────────┼─────────────────┘
                  PLATFORM SERVICES
             Telegram / Bale / WhatsApp
                          │
                    WordPress Plugin
```

WordPress stays the customer-side content and event client. Secrets, delivery,
client management, subscriptions, billing and authorization stay here.

## What is included

- WordPress webhook accepting publication contract **1.3** (and older payloads)
- Field catalog fed by `field_meta`, with per-platform visibility policy
- Telegram publishing (post, edit on update, delete), Bale publishing, WhatsApp
  Cloud API delivery
- Durable, bounded **publication retry queue** for transport failures
- Client/site management: provisioning, platform targets, webhook secret
  rotation, connection testing, webhook diagnostics
- Customer accounts, 7-day trial, 1/3/6/12-month plans, Telegram Stars and
  ZarinPal checkout, expiry notices
- **Admin RBAC** (`super_admin`, `admin`, `support`, `viewer`) with an audit log
- **Admin web dashboard** (`/admin/`) and the **Mini App control centre**
  (`/app/`, backed by `/api/admin-mini`), both driven by the same service layer
  and the same RBAC; `/admin` in the Telegram bot hands over a signed link to it
- **Site teams**: an owner plus `admin` and `support` members, added by their
  Telegram or Bale id; support may work a site but never change who has access
- **Field control**: rename, reorder or route a field per platform without the
  next WordPress publication reverting the choice
- Telegram and Bale Mini Apps for customers (`/app/`)
- **AI product creation**: a customer supplies a name and a photo, the backend
  writes the listing and SEO, matches the store's own categories and tags, and
  publishes to WooCommerce after approval (off until `AI_ENABLED=true`)
- Structured JSON logging with secret and phone redaction
- Versioned SQL migrations with a checksum-aware runner

## Quick start

```bash
cp .env.example .env      # fill in DATABASE_URL, PLATFORM_CREDENTIAL_KEY, tokens
npm install
npm run db:migrate
npm test
npm start
```

Then open `/admin/` and log in with `ADMIN_BOOTSTRAP_USERNAME` /
`ADMIN_BOOTSTRAP_PASSWORD`. See [DEPLOYMENT.md](DEPLOYMENT.md) for production.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request paths, module map, design decisions |
| [docs/API.md](docs/API.md) | Webhook contract, customer API, admin API |
| [docs/ADMIN.md](docs/ADMIN.md) | Roles, permissions, web panel, client provisioning |
| [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) | Admin bot menu, flows, authorization |
| [docs/PLATFORMS.md](docs/PLATFORMS.md) | Telegram, Bale, WhatsApp configuration and limits |
| [docs/AI_PRODUCTS.md](docs/AI_PRODUCTS.md) | AI product creation: flow, lifecycle, validation, quotas, WooCommerce |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | Schema, migration policy, runner usage |
| [docs/SECURITY.md](docs/SECURITY.md) | Authentication, secrets, phone privacy, rate limits |
| [docs/TESTING.md](docs/TESTING.md) | Unit and integration suites, what is and is not covered |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Client provisioning

An admin creates a client from the web panel or the Telegram bot. The backend
generates a unique `site_id` and a random webhook secret; the customer enters
three values in the Jarchi WordPress plugin:

1. Webhook URL — `https://<your-host>/webhook`
2. Site ID
3. Webhook Secret

The secret is displayed **once**, at creation or rotation. Subscription status
controls whether publishing is allowed, so customers never have to edit
WordPress settings after a renewal.

## Publication contract 1.3

The backend accepts `contract_version`, `event_type`, `site_id`, `post_id`,
`fields`, `field_meta`, `images`, `author`, `taxonomy`, `publication_targets`
and `buttons`. Payloads without `publication_targets` (pre-1.2 plugins) fall
back to the client's configured channels, and `field_meta.visibility` is still
honoured where `field_meta.platforms` is absent. See
[docs/API.md](docs/API.md#wordpress-webhook).

## Security notes

Rotate any bot token that has been exposed. Never commit `.env`.
`PLATFORM_CREDENTIAL_KEY` is required — it encrypts platform credentials and
advertiser phone numbers at rest. Phone numbers are never returned in list
responses, never written to logs in full, and are shown to the Telegram bot only
in masked form.


## 2.0 remote access model

Jarchi WordPress Ticket Center is fully local and does not depend on the Mini App or backend to operate.
The Mini App is an optional client-admin control plane. A client may see their subscription and sites without a paid plan, but all remote site-changing actions require an active paid plan feature. Trial plans do not grant remote site control.

Paid entitlements include `site_control`, `remote_tickets`, `remote_announcements`, `remote_products`, and `analytics`.


### 2.3.0 production hardening

- Customer site roles are enforced server-side; support members are restricted to support workflows.
- AI entitlements and monthly AI quota are scoped to the active site subscription when a site context exists.
- Quota reservations use a PostgreSQL advisory transaction lock to prevent concurrent over-spend.
- JSON logs are asynchronous and rotated without synchronous writes in the request path.
- Admin Mini App exposes a read-only Monitoring page for process, PostgreSQL pool and recent logs.
- Mini App session query parameters are moved into `sessionStorage` and removed from browser history on first load.
- Security headers and bounded JSON request bodies are applied globally.
