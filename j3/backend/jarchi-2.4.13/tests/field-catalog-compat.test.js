import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFieldCatalogQuery } from "../src/services/fieldCatalogSql.js";

test("field catalog query tolerates legacy tables without created_at", () => {
  const columns = new Set([
    "field_key", "label", "field_order", "field_type", "visibility", "field_meta",
    "updated_at", "label_override", "order_override", "platform_overrides", "hidden",
    "overridden_at", "overridden_by",
  ]);
  const sql = buildFieldCatalogQuery(columns);
  assert.match(sql, /NULL::timestamptz AS first_seen_at/);
  assert.match(sql, /updated_at AS last_seen_at/);
  assert.doesNotMatch(sql, /created_at AS first_seen_at/);
});

test("field catalog query tolerates legacy tables without either timestamp", () => {
  const columns = new Set([
    "field_key", "label", "field_order", "field_type", "visibility", "field_meta",
  ]);
  const sql = buildFieldCatalogQuery(columns);
  assert.match(sql, /NULL::timestamptz AS first_seen_at/);
  assert.match(sql, /NULL::timestamptz AS last_seen_at/);
});

test("2.4.10 migration reconciles proven production schema drift", () => {
  const migration = fs.readFileSync(new URL("../migrations/0017_legacy_schema_reconciliation.sql", import.meta.url), "utf8");
  assert.match(migration, /site_field_catalog[\s\S]*created_at/i);
  assert.match(migration, /site_field_catalog[\s\S]*updated_at/i);
  assert.match(migration, /subscriptions[\s\S]*updated_at/i);
});
