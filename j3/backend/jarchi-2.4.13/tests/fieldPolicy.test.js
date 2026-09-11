import test from "node:test";
import assert from "node:assert/strict";
import { getFieldsForPlatform, getMetaForPlatform, isFieldVisible, isSystemField } from "../src/core/fieldPolicy.js";

const ad = {
  fields: {
    company: "شرکت الف",
    phone: "09121234567",
    internal: "یادداشت داخلی",
    empty: "   ",
    legacy_all: "همه‌جا",
    legacy_bale: "فقط بله",
    post_id: "123",
  },
  field_meta: {
    company: { label: "نام شرکت", order: 1, platforms: { telegram: true, bale: true, whatsapp: false } },
    phone: { label: "شماره", order: 2, platforms: { telegram: true, bale: false, whatsapp: false } },
    internal: { label: "داخلی", order: 3, platforms: { telegram: false, bale: false, whatsapp: false } },
    empty: { label: "خالی", order: 4, platforms: { telegram: true } },
    legacy_all: { label: "عمومی", order: 5, visibility: "all" },
    legacy_bale: { label: "بله", order: 6, visibility: "bale" },
    post_id: { label: "شناسه", order: 7, platforms: { telegram: true } },
  },
};

test("explicit platform visibility decides per platform", () => {
  assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "telegram")), ["company", "phone", "legacy_all"]);
  assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "bale")), ["company", "legacy_all", "legacy_bale"]);
  assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "whatsapp")), ["legacy_all"]);
});

test("a field hidden everywhere never surfaces", () => {
  for (const platform of ["telegram", "bale", "whatsapp"]) {
    assert.equal(isFieldVisible(ad, platform, "internal"), false);
  }
});

test("legacy visibility keeps working when platforms is absent", () => {
  assert.equal(isFieldVisible(ad, "bale", "legacy_bale"), true);
  assert.equal(isFieldVisible(ad, "telegram", "legacy_bale"), false);
  assert.equal(isFieldVisible(ad, "telegram", "legacy_all"), true);
});

test("hidden / admin / backend visibility values stay hidden", () => {
  for (const visibility of ["hidden", "admin", "backend", ""]) {
    const sample = { fields: { x: "v" }, field_meta: { x: { visibility } } };
    assert.equal(isFieldVisible(sample, "telegram", "x"), false, visibility);
  }
});

test("empty values are not published", () => {
  assert.equal("empty" in getFieldsForPlatform(ad, "telegram"), false);
  const blanks = { fields: { a: "", b: null, c: undefined, d: "  " }, field_meta: {} };
  assert.deepEqual(getFieldsForPlatform(blanks, "telegram"), {});
});

test("system keys are never treated as publishable fields", () => {
  assert.equal(isSystemField("post_id"), true);
  assert.equal("post_id" in getFieldsForPlatform(ad, "telegram"), false);
  assert.equal("post_id" in getMetaForPlatform(ad, "telegram"), false);
});

test("customer field selection narrows the result", () => {
  const selected = getFieldsForPlatform(ad, "telegram", ["company"]);
  assert.deepEqual(Object.keys(selected), ["company"]);
  // A selection may not widen visibility.
  assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "bale", ["phone", "company"])), ["company"]);
});

test("an empty selection means no selection, not zero fields", () => {
  assert.ok(Object.keys(getFieldsForPlatform(ad, "telegram", [])).length > 0);
  assert.ok(Object.keys(getFieldsForPlatform(ad, "telegram", null)).length > 0);
});

test("meta for platform mirrors field visibility", () => {
  const meta = getMetaForPlatform(ad, "bale");
  assert.deepEqual(Object.keys(meta).sort(), ["company", "legacy_all", "legacy_bale"]);
  assert.equal(meta.company.label, "نام شرکت");
});

test("contact phone follows the same policy as any other field", async () => {
  const { resolveContactPhone } = await import("../src/core/fieldPolicy.js");

  const explicit = {
    author: { phone: "09121234567" },
    field_meta: { phone: { platforms: { telegram: true, bale: false, whatsapp: false } } },
  };
  assert.equal(resolveContactPhone(explicit, "telegram"), "09121234567");
  assert.equal(resolveContactPhone(explicit, "bale"), "");
  assert.equal(resolveContactPhone(explicit, "whatsapp"), "");

  const legacy = { fields: { phone: "09120000000" }, field_meta: { phone: { visibility: "telegram" } } };
  assert.equal(resolveContactPhone(legacy, "telegram"), "09120000000");
  assert.equal(resolveContactPhone(legacy, "bale"), "");

  const hidden = { author: { phone: "09121234567" }, field_meta: { phone: { visibility: "hidden" } } };
  assert.equal(resolveContactPhone(hidden, "telegram"), "");

  // No phone metadata at all keeps the pre-1.3 behaviour.
  assert.equal(resolveContactPhone({ author: { phone: "09121234567" } }, "telegram"), "09121234567");
  assert.equal(resolveContactPhone({}, "telegram"), "");
});
