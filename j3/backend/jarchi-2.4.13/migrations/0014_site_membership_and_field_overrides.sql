/*
 * Mini App control centre (2.2.0).
 *
 * Two additions, both deliberately additive so an already-deployed 2.1.x keeps
 * working while the new screens roll out:
 *
 *  1. site_members gains a fixed role vocabulary. 0013 left `role` free-form
 *     and the admin API accepted admin/manager/viewer, while the customer API
 *     only ever distinguished "owner" from "a member". The Mini App needs two
 *     member roles with different authority, so the values are normalized and
 *     constrained here rather than validated in three separate route handlers.
 *
 *  2. site_field_catalog gains an override layer. WordPress stays the source of
 *     truth for what fields exist and what the plugin calls them: the webhook
 *     upsert keeps overwriting label/field_order/visibility/field_meta on every
 *     post. The columns added here are written only by an operator and are
 *     never touched by that upsert, so an operator's label or ordering choice
 *     survives the next publication instead of being silently reverted.
 */

/* ------------------------------ site members ------------------------------ */

/* 0013 shipped without a vocabulary, so normalize whatever is already stored
 * before the constraint goes on. `manager` was the write-capable role and
 * `viewer` the read-only one, which map onto admin and support respectively. */
UPDATE site_members SET role = 'admin'   WHERE role IN ('manager', 'owner');
UPDATE site_members SET role = 'support' WHERE role NOT IN ('admin', 'support');

ALTER TABLE site_members DROP CONSTRAINT IF EXISTS site_members_role_check;
ALTER TABLE site_members ADD CONSTRAINT site_members_role_check
  CHECK (role IN ('admin', 'support'));

ALTER TABLE site_members DROP CONSTRAINT IF EXISTS site_members_status_check;
ALTER TABLE site_members ADD CONSTRAINT site_members_status_check
  CHECK (status IN ('active', 'disabled'));

/* The owner is never a row in site_members (sites.owner_user_id holds them), so
 * a member row for the owner would be a second, contradictory source of truth. */
DELETE FROM site_members m USING sites s
 WHERE s.id = m.site_id AND s.owner_user_id = m.user_id;

/* --------------------------- field override layer -------------------------- */

ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS label_override      TEXT;
ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS order_override      INTEGER;
ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS platform_overrides  JSONB;
ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS hidden              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS overridden_at       TIMESTAMPTZ;
ALTER TABLE site_field_catalog ADD COLUMN IF NOT EXISTS overridden_by       TEXT;

/* The effective order the Mini App and the publication engine both sort by. */
CREATE INDEX IF NOT EXISTS site_field_catalog_effective_order_idx
  ON site_field_catalog(site_id, COALESCE(order_override, field_order), field_key);
