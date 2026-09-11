import test from "node:test";
import assert from "node:assert/strict";
import {
  requireUrl, optionalUrl, requireSiteId, requireTelegramUserId, optionalTelegramTarget,
  optionalBaleTarget, optionalPhone, requireInt, requireBoolean, requireEnum, requireString,
  optionalDate, requirePlatform,
} from "../src/middleware/validate.js";

test("URLs must be absolute http(s)", () => {
  assert.equal(requireUrl("https://shop.example.com/"), "https://shop.example.com");
  assert.equal(requireUrl("http://shop.example.com"), "http://shop.example.com");
  for (const bad of ["javascript:alert(1)", "ftp://x.com", "/relative", "not a url", "", "data:text/html,x"]) {
    assert.throws(() => requireUrl(bad, "wordpress_url"), /wordpress_url/, `accepted ${bad}`);
  }
  assert.equal(optionalUrl(""), "");
});

test("site ids only accept the generated shape", () => {
  assert.equal(requireSiteId("site_shop_ab12cd"), "site_shop_ab12cd");
  for (const bad of ["", "ab", "site id", "site/../etc", "site';DROP TABLE sites;--"]) {
    assert.throws(() => requireSiteId(bad));
  }
});

test("telegram ids are numeric", () => {
  assert.equal(requireTelegramUserId("123456789"), "123456789");
  for (const bad of ["", "abc", "12", "-100123", "123456789012345678901"]) {
    assert.throws(() => requireTelegramUserId(bad), undefined, `accepted ${bad}`);
  }
});

test("telegram targets accept @username, t.me links and chat ids", () => {
  assert.equal(optionalTelegramTarget("https://t.me/shop_channel"), "@shop_channel");
  assert.equal(optionalTelegramTarget("@shop_channel"), "@shop_channel");
  assert.equal(optionalTelegramTarget("-1001234567890"), "-1001234567890");
  assert.equal(optionalTelegramTarget(""), "");
  for (const bad of ["@a", "shop channel", "https://example.com/x", "@bad-name!"]) {
    assert.throws(() => optionalTelegramTarget(bad), undefined, `accepted ${bad}`);
  }
});

test("bale targets accept @username and chat ids", () => {
  assert.equal(optionalBaleTarget("@bale_channel"), "@bale_channel");
  assert.equal(optionalBaleTarget("12345"), "12345");
  assert.throws(() => optionalBaleTarget("bale channel"));
});

test("phones are normalized and bounded", () => {
  assert.equal(optionalPhone("0912 123 4567"), "09121234567");
  assert.equal(optionalPhone("+98 912 123 4567"), "+989121234567");
  assert.equal(optionalPhone(""), "");
  assert.throws(() => optionalPhone("12"));
  assert.throws(() => optionalPhone("phone-number"));
});

test("integers, booleans, enums and dates are validated, not coerced silently", () => {
  assert.equal(requireInt("42", "days", { min: 1, max: 100 }), 42);
  assert.throws(() => requireInt("4.5", "days"));
  assert.throws(() => requireInt("abc", "days"));
  assert.throws(() => requireInt(200, "days", { min: 1, max: 100 }));

  assert.equal(requireBoolean("true", "enabled"), true);
  assert.equal(requireBoolean(false, "enabled"), false);
  assert.throws(() => requireBoolean("maybe", "enabled"));

  assert.equal(requireEnum("check", ["check", "send"], "mode"), "check");
  assert.throws(() => requireEnum("delete", ["check", "send"], "mode"));

  assert.equal(requirePlatform("telegram"), "telegram");
  assert.throws(() => requirePlatform("sms"));

  assert.equal(optionalDate("2026-01-01T00:00:00Z", "from"), "2026-01-01T00:00:00.000Z");
  assert.throws(() => optionalDate("yesterday", "from"));
  assert.equal(optionalDate("", "from"), undefined);
});

test("strings enforce bounds", () => {
  assert.equal(requireString("  name  ", "name"), "name");
  assert.throws(() => requireString("", "name"));
  assert.throws(() => requireString("x".repeat(300), "name", { max: 190 }));
});
