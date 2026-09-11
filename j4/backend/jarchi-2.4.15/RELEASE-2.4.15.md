# Jarchi 2.4.15

## WooCommerce orders, end to end

WooCommerce order forwarding was switchable in the WordPress plugin but had no
destination: orders arrived at `/webhook/ad` and were rejected with
`Missing post_id`, which is why turning the setting on appeared to do nothing.
This release completes the round trip.

An order now travels: WooCommerce → Jarchi webhook → snapshot in Postgres →
Telegram direct message to the site's owner and admins → Mini App button →
order list and detail → status change → WooCommerce → the status WooCommerce
actually settled on, shown back in the Mini App.

The write-back is real. `PATCH /api/sites/:siteId/orders/:orderId/status` calls
WooCommerce `PUT wp-json/wc/v3/orders/{id}` with the site's own encrypted
consumer key, falls back to the Jarchi plugin route when no WooCommerce
connection exists, and reports success only when WordPress answers with a
status. A shop that is unreachable, refuses the change, or answers `200` without
naming a status is surfaced as a failure with the unchanged status — never as an
optimistic success.

### Exactly one notification per event

Order webhooks are delivered more than once in practice: WooCommerce retries,
and a status transition can fire from several paths. The claim is a single
statement against a unique index on
`(site_id, order_id, event_type, event_status)`, so the database decides the
winner. Ten simultaneous deliveries of the same event produce one Telegram
message; the snapshot is still refreshed by each of them, so the list never goes
stale because a duplicate arrived first.

### Site-level access, enforced server-side

Orders carry customer names, telephone numbers and addresses. Every order
endpoint resolves the site through `requireOwnedSite` with the `owner`/`admin`
roles and scopes the query by the resolved site in SQL. Altering a site or order
id in a request cannot reach another site's customers: an order belonging
elsewhere simply does not match, which answers `404` rather than confirming it
exists somewhere. The Mini App hides the tab for other roles, but that is
cosmetic — the server refuses regardless.

### What is shown in the notification

`site_order_settings` holds a per-site choice of which order fields appear in
the Telegram message. Address and email default to off because they are personal
data that most shops do not want in a channel; everything else follows the
shipped default, and an absent choice means the default rather than "off".

## Mini App

- **Orders** tab for site owners and admins: list with status filter and search,
  detail with items and totals, status change with the confirmed result, and a
  settings sheet for the notification fields.
- **Publication fields are editable by site owners again.** The field screen
  wrote through the platform-operator route, so a site owner saw switches that
  answered `403`. Owners and admins now write through customer-side endpoints
  that update the same column the publication formatter reads.
- **"پیشنهاد جارچی"** applies one sensible publication configuration across the
  catalogue. It is expressed as ordinary field overrides, so applying it and
  setting the toggles by hand produce the same state, and it is applied only
  when the button is pressed — never silently on upgrade.

## The Super Admin API was unreachable from a browser

Found while running the full integration suite, and unrelated to orders.
`accountRoutes` is mounted at `/api` and applied its customer authentication
with no path, so it ran for every `/api` request. An operator has no Mini App
customer session, which meant `POST /api/admin/auth/login` answered
`401 Authentication required` before the admin router was reached — logging in
to the web panel was impossible, and every unrouted `/api` path answered 401
instead of 404. Mini App traffic was unaffected, because those callers do
authenticate as customers, which is why it went unnoticed.

The guard now covers `/api/account` only. Nothing about who may call the
account endpoints changed.

## Bale bundle

`app-bale-legacy.js` is the ES5 transpile of `app.js` and had drifted: `app.js`
changed without it. It is rebuilt here, `scripts/build-bale-legacy.mjs` records
the recipe that produces it, and a test fails if the two go out of sync again.

## Preserved

Mini App and Telegram authentication, existing admin/owner permissions,
Formatter v3, Telegram and Bale publication formatting, the 2.4.14 contact
button behaviour, the Field Policy system, publication controls, webhook
authentication, and site/admin mapping are unchanged. Advert webhooks still
require `post_id` and still answer with exactly that message; ticket events
(`ticket_created`, `ticket_admin_replied`) are unaffected and are not mistaken
for orders.

## Migration

`migrations/0018_woocommerce_orders.sql` adds three tables and nothing else. It
is additive: an already-deployed 2.4.14 keeps working against a database that
has it.

```
npm run db:migrate
pm2 restart jarchi --update-env
```
