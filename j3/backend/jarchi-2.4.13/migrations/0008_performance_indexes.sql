-- Indexes chosen from the actual query shapes in routes/ and services/:
-- publication history filters, dashboard aggregation windows, field catalog
-- ordering and user lookups. No speculative indexes.

-- publication history: ordered pages, and the platform/date facets.
CREATE INDEX IF NOT EXISTS publications_created_idx ON publications(created_at DESC);
CREATE INDEX IF NOT EXISTS publications_platform_idx ON publications(platform, status);
CREATE INDEX IF NOT EXISTS publications_post_idx ON publications(post_id);
CREATE INDEX IF NOT EXISTS publications_event_type_idx ON publications(event_type);
-- dashboard "recent failures" and retry eligibility scans.
CREATE INDEX IF NOT EXISTS publications_failed_idx
  ON publications(created_at DESC) WHERE status = 'failed';

-- field catalog is always read as "one site, ordered".
CREATE INDEX IF NOT EXISTS site_field_catalog_order_idx
  ON site_field_catalog(site_id, field_order, field_key);

-- user search by name/username in the admin users screen.
CREATE INDEX IF NOT EXISTS users_username_idx ON users(lower(username));
CREATE INDEX IF NOT EXISTS users_created_idx ON users(created_at DESC);

-- invoice history pages.
CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at DESC);
