import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validateTelegramInitData } from "../src/auth/telegram.js";

const TOKEN = "123:ABC";

function buildInitData({ token = TOKEN, authDate = Math.floor(Date.now() / 1000), user = { id: 42, first_name: "Test" }, extra = {} } = {}) {
  const params = { auth_date: String(authDate), user: JSON.stringify(user), ...extra };
  const checkString = Object.keys(params).sort()
    .map((key) => `${key}=${params[key]}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  const query = new URLSearchParams({ ...params, hash });
  return query.toString();
}

test("valid Telegram init data resolves the user", () => {
  const parsed = validateTelegramInitData(buildInitData(), TOKEN);
  assert.equal(parsed.id, 42);
  assert.equal(parsed.first_name, "Test");
});

test("extra signed parameters are accepted", () => {
  const initData = buildInitData({ extra: { query_id: "AAH", chat_type: "private" } });
  assert.equal(validateTelegramInitData(initData, TOKEN).id, 42);
});

test("a signature from another bot token is rejected", () => {
  const initData = buildInitData({ token: "999:XYZ" });
  assert.throws(() => validateTelegramInitData(initData, TOKEN), /signature invalid/);
});

test("tampering with a signed field invalidates the signature", () => {
  const initData = buildInitData();
  const tampered = initData.replace(/user=[^&]+/, `user=${encodeURIComponent(JSON.stringify({ id: 99, first_name: "Mallory" }))}`);
  assert.throws(() => validateTelegramInitData(tampered, TOKEN), /signature invalid/);
});

test("expired init data is rejected", () => {
  const old = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 90000 });
  assert.throws(() => validateTelegramInitData(old, TOKEN), /expired/);
  // Still valid inside the window.
  assert.equal(validateTelegramInitData(buildInitData({ authDate: Math.floor(Date.now() / 1000) - 600 }), TOKEN).id, 42);
});

test("init data dated in the future is rejected", () => {
  const future = buildInitData({ authDate: Math.floor(Date.now() / 1000) + 5000 });
  assert.throws(() => validateTelegramInitData(future, TOKEN), /expired/);
});

test("missing or malformed init data is rejected", () => {
  assert.throws(() => validateTelegramInitData("", TOKEN), /Missing Telegram hash/);
  assert.throws(() => validateTelegramInitData("auth_date=1&user=%7B%7D", TOKEN), /Missing Telegram hash/);
  assert.throws(() => validateTelegramInitData(`${buildInitData()}x`, TOKEN), /signature invalid/);
});

test("a custom max age can shorten the window", () => {
  const initData = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 120 });
  assert.equal(validateTelegramInitData(initData, TOKEN, 300).id, 42);
  assert.throws(() => validateTelegramInitData(initData, TOKEN, 60), /expired/);
});
