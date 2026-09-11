import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, createBotDouble, callbackQuery, message,
} from "../helpers.mjs";

/**
 * Telegram admin bot behaviour, driven through the real handlers with a bot
 * double in place of a live Telegram connection.
 *
 * Since 2.1.0 the bot is no longer an administrative surface of its own: it
 * authenticates the admin and hands over a signed Mini App link, and the panel
 * itself lives at /api/admin-mini. These tests therefore assert two things —
 * that the handover works and is correctly scoped, and that the legacy `a:*`
 * callbacks left over from 1.3.x can no longer perform any administrative
 * action, which is the property an attacker replaying an old button would
 * attack.
 */
test("telegram admin bot", { skip: skipWithoutDatabase }, async (t) => {
  // Telegram only accepts an absolute URL for a web_app button, so the handover
  // is exercised the way it is actually deployed.
  Object.assign(process.env, TEST_ENV, { PUBLIC_BASE_URL: "https://jarchi.test" });
  await resetDatabase();

  const { pool } = await import("../../src/db/db.js");
  const adminUsers = await import("../../src/services/adminUsers.js");
  const clients = await import("../../src/services/clients.js");
  const botState = await import("../../src/bot/state.js");
  const users = await import("../../src/services/users.js");
  const { handleAdminCommand, handleAdminCallback, handleAdminMessage } = await import("../../src/bot/admin/index.js");

  t.after(async () => { await pool.end(); });

  await adminUsers.ensureBootstrapAdmin();            // telegram id 123456789, super_admin
  await adminUsers.createAdmin({ username: "botviewer", role: "viewer", telegram_user_id: "222222222" });
  await adminUsers.createAdmin({ username: "botsupport", role: "support", telegram_user_id: "333333333" });
  const disabled = await adminUsers.createAdmin({ username: "botdisabled", role: "admin", telegram_user_id: "444444444" });
  await adminUsers.updateAdmin(disabled.id, { status: "disabled" });

  const client = await clients.provisionClient({
    name: "Bot Shop", wordpress_url: "https://botshop.example.com", bale_chat_id: "12345",
  });

  /** Pulls the Mini App URL out of whatever the bot last sent. */
  const miniAppUrl = (bot) => {
    const buttons = (bot.last()?.options?.reply_markup?.inline_keyboard || []).flat();
    return buttons.find((button) => button.web_app)?.web_app?.url || "";
  };
  const sessionToken = (bot) => new URL(miniAppUrl(bot)).searchParams.get("session");

  await t.test("an unknown Telegram user gets no admin surface", async () => {
    const bot = createBotDouble();
    await handleAdminCommand(bot, message("/admin", { fromId: "999999999" }));
    assert.match(bot.calls.messages[0].text, /دسترسی ندارید/);
    assert.equal(bot.calls.messages[0].options?.reply_markup, undefined, "no Mini App link is handed to a non-admin");
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM app_sessions");
    assert.equal(rows[0].n, 0, "no session is minted for a stranger");
  });

  await t.test("a disabled admin account is refused", async () => {
    const bot = createBotDouble();
    await handleAdminCommand(bot, message("/admin", { fromId: "444444444" }));
    assert.match(bot.calls.messages[0].text, /دسترسی ندارید/);
    assert.equal(miniAppUrl(bot), "", "a disabled account gets no Mini App link");
  });

  await t.test("/admin hands an authorized admin a signed Mini App link", async () => {
    const bot = createBotDouble();
    await handleAdminCommand(bot, message("/admin"));

    const url = miniAppUrl(bot);
    assert.ok(url, "the admin is offered a Mini App button");
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:", "Telegram rejects a non-HTTPS web_app URL");
    assert.equal(parsed.origin, "https://jarchi.test");
    assert.equal(parsed.pathname, "/app/");
    assert.equal(parsed.searchParams.get("platform"), "telegram");

    const token = parsed.searchParams.get("session");
    assert.ok(token && token.length >= 32, "a session token is embedded in the link");
    // The token must be a real, live session bound to this Telegram identity.
    const resolved = await users.getUserBySession(token);
    assert.ok(resolved, "the handed-over token authenticates");
    assert.equal(resolved.platform, "telegram");
    const identity = await pool.query(
      "SELECT platform, platform_user_id FROM identities WHERE user_id=$1",
      [resolved.id],
    );
    assert.deepEqual(
      identity.rows.map((row) => `${row.platform}:${row.platform_user_id}`),
      ["telegram:123456789"],
    );
  });

  await t.test("the Mini App session is a customer session, not an admin grant", async () => {
    // A viewer and a super admin both receive a session; what each may do is
    // decided by admin_users at /api/admin-mini time, never by the token.
    const bot = createBotDouble();
    await handleAdminCommand(bot, message("/admin", { fromId: "222222222" }));
    const token = sessionToken(bot);
    assert.ok(token);

    const resolved = await users.getUserBySession(token);
    assert.ok(resolved, "the token resolves to a customer user");
    assert.equal(resolved.platform, "telegram");
    assert.equal(
      Object.prototype.hasOwnProperty.call(resolved, "role"), false,
      "the session row carries no role of its own",
    );

    const admin = await adminUsers.findAdminByTelegramId("222222222");
    assert.equal(admin.role, "viewer", "authority stays in admin_users, where the panel re-reads it");
  });

  await t.test("legacy admin callbacks no longer execute administrative actions", async () => {
    const before = await clients.getSite(client.id);

    for (const action of [`a:cl:rot:${client.id}`, `a:cl:off:${client.id}`, `a:cl:offy:${client.id}`, "a:cl:new"]) {
      const bot = createBotDouble();
      const handled = await handleAdminCallback(bot, callbackQuery(action));
      assert.equal(handled, true, `${action} is claimed by the admin handler`);
      assert.ok(miniAppUrl(bot), `${action} redirects to the Mini App`);
      assert.equal(await botState.getState("123456789", "555"), null, `${action} starts no flow`);
    }

    const after = await clients.getSite(client.id);
    assert.equal(after.webhook_secret, before.webhook_secret, "a replayed rotate button rotates nothing");
    assert.equal(after.enabled, before.enabled, "a replayed disable button disables nothing");
    assert.equal((await clients.listClients({ q: "Bot Shop" })).items.length, 1, "no client was created");
  });

  await t.test("the redirect is still authorized: strangers get nothing", async () => {
    const stranger = createBotDouble();
    const handled = await handleAdminCallback(stranger, callbackQuery("a:cl:l:1", { fromId: "999999999" }));
    assert.equal(handled, true);
    assert.match(stranger.calls.answers.at(-1).text, /دسترسی ندارید/);
    assert.equal(stranger.calls.messages.length, 0, "no Mini App link is minted for a stranger");

    const disabledBot = createBotDouble();
    await handleAdminCallback(disabledBot, callbackQuery("a:dash", { fromId: "444444444" }));
    assert.match(disabledBot.calls.answers.at(-1).text, /دسترسی ندارید/);
    assert.equal(disabledBot.calls.messages.length, 0);
  });

  await t.test("customer callbacks pass through to their own handlers", async () => {
    const bot = createBotDouble();
    assert.equal(await handleAdminCallback(bot, callbackQuery("contact:xyz")), false);
    assert.equal(bot.calls.answers.length, 0);
  });

  await t.test("a message with no stored flow is not captured", async () => {
    const bot = createBotDouble();
    assert.equal(await handleAdminMessage(bot, message("some unrelated text")), false);
  });

  await t.test("a flow left over from an older version stops when permission is gone", async () => {
    // 1.3.x could leave flow state behind in the database. It must not become a
    // way to run an administrative action after an upgrade or a demotion.
    await botState.setState("123456789", "555", "client_create", "name", {});
    const { rows } = await pool.query("SELECT id FROM admin_users WHERE username='admin'");
    await pool.query("UPDATE admin_users SET status='disabled' WHERE id=$1", [rows[0].id]);

    const bot = createBotDouble();
    assert.equal(await handleAdminMessage(bot, message("Ghost Shop")), false);
    assert.equal(await botState.getState("123456789", "555"), null, "the stale flow is discarded");
    assert.equal((await clients.listClients({ q: "Ghost Shop" })).items.length, 0);

    await pool.query("UPDATE admin_users SET status='active' WHERE id=$1", [rows[0].id]);
  });

  await t.test("an expired flow does not resume", async () => {
    await botState.setState("123456789", "555", "client_create", "name", {});
    await pool.query("UPDATE admin_bot_states SET expires_at=NOW()-INTERVAL '1 minute'");

    const bot = createBotDouble();
    assert.equal(await handleAdminMessage(bot, message("Too Late Shop")), false);
    assert.equal((await clients.listClients({ q: "Too Late Shop" })).items.length, 0);
  });

  await t.test("rate limiting protects the bot from a flood", async () => {
    const { resetRateLimits } = await import("../../src/middleware/rateLimit.js");
    resetRateLimits();

    const bot = createBotDouble();
    let limited = 0;
    for (let index = 0; index < 70; index += 1) {
      await handleAdminCallback(bot, callbackQuery("a:dash"));
      if (bot.calls.answers.at(-1)?.text?.includes("درخواست‌ها زیاد")) limited += 1;
    }
    assert.ok(limited > 0, "the per-admin limit must engage");
    resetRateLimits();
  });
});
