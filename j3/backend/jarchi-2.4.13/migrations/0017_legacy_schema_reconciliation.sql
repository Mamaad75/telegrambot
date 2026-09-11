/*
 * 2.4.10 legacy-schema reconciliation.
 *
 * Some early installations created these tables before the current baseline
 * shape existed. Because 0001 uses CREATE TABLE IF NOT EXISTS, marking 0001 as
 * applied cannot retrofit columns on an already-existing table. Add the two
 * columns that production logs proved can be absent while newer code expects
 * them. Both are additive and safe for fresh installs.
 */
ALTER TABLE site_field_catalog
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE site_field_catalog
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
