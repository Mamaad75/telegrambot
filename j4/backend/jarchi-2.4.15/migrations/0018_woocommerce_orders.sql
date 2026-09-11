/*
 * WooCommerce orders (2.4.15).
 *
 * Three tables, all additive, so an already-deployed 2.4.14 keeps working
 * until the new routes are called.
 *
 * A deliberate non-goal: this is not a copy of the shop. WooCommerce remains
 * the system of record for an order, and every write goes back to it. What is
 * kept here is the minimum needed to answer three questions without a round
 * trip to WordPress for each one — what orders exist, what did the last
 * notification say, and have we already announced this event.
 *
 *  1. wc_orders is a snapshot. One row per (site, order), overwritten by the
 *     latest event, so the Mini App list renders from one indexed query
 *     instead of paging a remote REST API on every scroll. Order detail reads
 *     through to WooCommerce when it can, and falls back to this row when the
 *     shop is unreachable, which is the difference between a degraded screen
 *     and a broken one.
 *
 *  2. wc_order_events is the deduplication ledger, and the reason it is a
 *     table rather than a column is concurrency. WooCommerce raises the same
 *     transition more than once on its own — a gateway callback racing the
 *     thank-you page, a retried webhook, an admin re-saving an order — and a
 *     read-then-write check lets both callers through. A UNIQUE index with an
 *     INSERT ... ON CONFLICT DO NOTHING is arbitrated by the database, so
 *     exactly one caller is told it won and exactly one notification is sent.
 *
 *  3. site_order_settings holds which fields a site's notification may show.
 *     It follows the field-policy philosophy already used for advert fields:
 *     the catalogue is code, the per-site choice is data, and the absence of a
 *     row means "the shipped defaults", never "nothing".
 */

/* ------------------------------ order snapshot ----------------------------- */

CREATE TABLE IF NOT EXISTS wc_orders (
  id                BIGSERIAL PRIMARY KEY,
  site_id           TEXT NOT NULL,
  order_id          BIGINT NOT NULL,
  order_number      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '',
  currency          TEXT NOT NULL DEFAULT '',
  total             NUMERIC(18,2),
  customer_id       BIGINT,
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_phone    TEXT NOT NULL DEFAULT '',
  customer_email    TEXT NOT NULL DEFAULT '',
  payment_method    TEXT NOT NULL DEFAULT '',
  /*
   * Everything else the site sent, as it sent it. Keeping the long tail in one
   * JSONB column rather than forty nullable columns means a shop that reports
   * a field this version has never heard of still stores it, and the formatter
   * can start showing it without a migration.
   */
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_url         TEXT NOT NULL DEFAULT '',
  remote_created_at TIMESTAMPTZ,
  last_event_type   TEXT NOT NULL DEFAULT '',
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* One row per order per site. Also the conflict target for the snapshot upsert. */
CREATE UNIQUE INDEX IF NOT EXISTS wc_orders_site_order_key
  ON wc_orders(site_id, order_id);

/* The list screen's two orderings: newest first, and newest first within a
 * status filter. Both are site-scoped, because a query that is not is a
 * cross-site read waiting to happen. */
CREATE INDEX IF NOT EXISTS wc_orders_site_created_idx
  ON wc_orders(site_id, remote_created_at DESC NULLS LAST, order_id DESC);

CREATE INDEX IF NOT EXISTS wc_orders_site_status_idx
  ON wc_orders(site_id, status, remote_created_at DESC NULLS LAST);

/* Search by order number, which is what an operator has in front of them when
 * a customer telephones. */
CREATE INDEX IF NOT EXISTS wc_orders_site_number_idx
  ON wc_orders(site_id, order_number);

/* ---------------------------- deduplication ledger ------------------------- */

CREATE TABLE IF NOT EXISTS wc_order_events (
  id            BIGSERIAL PRIMARY KEY,
  site_id       TEXT NOT NULL,
  order_id      BIGINT NOT NULL,
  event_type    TEXT NOT NULL,
  /*
   * A status transition may legitimately happen twice for one order —
   * pending to processing, later processing to completed — so the key includes
   * the status the event is about. Creation events carry '' and therefore
   * collapse to one per order, which is the intent.
   */
  event_status  TEXT NOT NULL DEFAULT '',
  notified_at   TIMESTAMPTZ,
  notify_error  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS wc_order_events_key
  ON wc_order_events(site_id, order_id, event_type, event_status);

CREATE INDEX IF NOT EXISTS wc_order_events_site_created_idx
  ON wc_order_events(site_id, created_at DESC);

/* --------------------------- per-site field policy ------------------------- */

CREATE TABLE IF NOT EXISTS site_order_settings (
  site_id       TEXT PRIMARY KEY,
  /* Notifications on/off for the whole site, separately from which fields a
   * notification may carry. */
  notify_enabled BOOLEAN NOT NULL DEFAULT true,
  /*
   * A partial map of field_key => boolean. Partial on purpose: a key absent
   * here takes the shipped default, so adding a field in a later version does
   * not require rewriting every site's row, and a site that has never opened
   * the screen is not treated as having switched everything off.
   */
  fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by    TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
