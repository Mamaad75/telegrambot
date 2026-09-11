import test from "node:test";
import assert from "node:assert/strict";

process.env.BALE_BOT_TOKEN = "test-bale-token";
process.env.BALE_API_BASE = "https://tapi.bale.ai";
process.env.BALE_WEBHOOK_URL = "https://example.com/bale-webhook";
process.env.BALE_TIMEOUT_MS = "5000";

const { setBaleWebhook, deleteBaleWebhook, sendBaleMessage, answerBaleCallbackQuery, getBaleWebhookInfo } =
  await import("../src/platforms/bale.js?test=" + Date.now());

function mockResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Bale webhook setup posts to the Bale Bot API", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return mockResponse({ ok: true, result: true });
  };

  try {
    assert.equal(await setBaleWebhook(), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://tapi.bale.ai/bottest-bale-token/setWebhook");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { url: "https://example.com/bale-webhook" });
  } finally {
    globalThis.fetch = original;
  }
});

test("Bale message/callback helpers use the expected Bot API methods", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return mockResponse({ ok: true, result: { message_id: 42 } });
  };

  try {
    await sendBaleMessage("123", "سلام", { parse_mode: "HTML" });
    await answerBaleCallbackQuery("cb-1", { text: "OK", show_alert: true });
    await deleteBaleWebhook(true);
    await getBaleWebhookInfo();

    assert.equal(calls.length, 4);
    assert.match(calls[0].url, /\/sendMessage$/);
    assert.deepEqual(JSON.parse(calls[0].init.body), { chat_id: "123", text: "سلام", parse_mode: "HTML" });
    assert.match(calls[1].url, /\/answerCallbackQuery$/);
    assert.deepEqual(JSON.parse(calls[1].init.body), { callback_query_id: "cb-1", text: "OK", show_alert: true });
    assert.match(calls[2].url, /\/deleteWebhook$/);
    assert.deepEqual(JSON.parse(calls[2].init.body), { drop_pending_updates: true });
    assert.match(calls[3].url, /\/getWebhookInfo$/);
  } finally {
    globalThis.fetch = original;
  }
});
