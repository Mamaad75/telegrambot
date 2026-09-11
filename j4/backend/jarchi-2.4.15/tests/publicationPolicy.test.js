import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicationTargets, normalizeTelegramTarget } from "../src/core/publicationPolicy.js";

const site = { telegram_channel_id: "@shop_channel", bale_chat_id: "12345" };
const find = (targets, platform) => targets.find((target) => target.platform === platform);

test("per-post targets win over site defaults", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { telegram: { enabled: true }, bale: { enabled: false } } },
    site,
  );
  assert.equal(find(targets, "telegram").enabled, true);
  assert.equal(find(targets, "bale").enabled, false);
});

test("a per-post target cannot invent a channel the client lacks", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { telegram: { enabled: true }, bale: { enabled: true } } },
    { telegram_channel_id: "", bale_chat_id: "" },
  );
  assert.equal(find(targets, "telegram").enabled, false);
  assert.equal(find(targets, "bale").enabled, false);
});

test("legacy payloads without publication_targets publish to every configured channel", () => {
  const targets = resolvePublicationTargets({ event_type: "created" }, site);
  assert.equal(find(targets, "telegram").enabled, true);
  assert.equal(find(targets, "bale").enabled, true);
});

test("legacy payload with only one configured channel enables only that one", () => {
  const targets = resolvePublicationTargets({}, { telegram_channel_id: "@only", bale_chat_id: "" });
  assert.equal(find(targets, "telegram").enabled, true);
  assert.equal(find(targets, "bale").enabled, false);
});

test("zero targets yields no enabled platform", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { telegram: { enabled: false }, bale: { enabled: false }, whatsapp: { enabled: false } } },
    site,
  );
  assert.deepEqual(targets.filter((target) => target.enabled), []);
});

test("multiple targets are all resolved with their channel", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { telegram: { enabled: true }, bale: { enabled: true } } },
    site,
  );
  const enabled = targets.filter((target) => target.enabled);
  assert.equal(enabled.length, 2);
  assert.equal(find(targets, "telegram").target, "@shop_channel");
  assert.equal(find(targets, "bale").target, "12345");
});

test("whatsapp stays disabled while the installation has it off", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { whatsapp: { enabled: true, recipient: "989121234567" } } },
    site,
  );
  // config.whatsapp.enabled is false by default in the test environment.
  assert.equal(find(targets, "whatsapp").enabled, false);
});

test("t.me links normalize to @username", () => {
  assert.equal(normalizeTelegramTarget("https://t.me/loot_loop"), "@loot_loop");
  assert.equal(normalizeTelegramTarget("t.me/loot_loop/"), "@loot_loop");
  assert.equal(normalizeTelegramTarget("@already"), "@already");
  assert.equal(normalizeTelegramTarget("-1001234567890"), "-1001234567890");
  assert.equal(normalizeTelegramTarget(""), "");
});


test("WhatsApp recipient is never taken from the WordPress payload", () => {
  const targets = resolvePublicationTargets(
    { publication_targets: { whatsapp: { enabled: true, recipient: "989121234567" } } },
    site,
  );
  assert.equal(find(targets, "whatsapp").target, "");
});
