import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validateBaleInitData } from "../src/auth/bale.js";

const BOT_TOKEN = "123456:TEST_BALE_TOKEN";
const now = Math.floor(Date.now() / 1000);

function sign(params, token = BOT_TOKEN) {
  const entries = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  return crypto.createHmac("sha256", secret).update(entries).digest("hex");
}

test("Bale Mini App initData validates and returns the signed user", () => {
  const user = { id: 123456789, first_name: "Mohammad", username: "jarchi_test" };
  const params = {
    auth_date: String(now),
    user: JSON.stringify(user),
    query_id: "bale-test-query",
  };
  const raw = new URLSearchParams({ ...params, hash: sign(params) }).toString();

  assert.deepEqual(validateBaleInitData(raw, BOT_TOKEN, 3600), user);
});

test("Bale Mini App rejects tampered initData", () => {
  const params = {
    auth_date: String(now),
    user: JSON.stringify({ id: 123 }),
    query_id: "bale-test-query",
  };
  const raw = new URLSearchParams({ ...params, hash: sign(params) }).toString();
  const tampered = raw.replace("id%22%3A123", "id%22%3A999");

  assert.throws(
    () => validateBaleInitData(tampered, BOT_TOKEN, 3600),
    /signature invalid|user payload invalid/,
  );
});

test("Bale Mini App rejects expired initData", () => {
  const params = {
    auth_date: String(now - 3700),
    user: JSON.stringify({ id: 123 }),
  };
  const raw = new URLSearchParams({ ...params, hash: sign(params) }).toString();

  assert.throws(
    () => validateBaleInitData(raw, BOT_TOKEN, 3600),
    /expired/,
  );
});
