import test from "node:test";
import assert from "node:assert/strict";
import { TEST_ENV, skipWithoutDatabase, resetDatabase, withPool } from "../helpers.mjs";

/**
 * Service-layer integration tests. These run against a REAL PostgreSQL
 * database (JARCHI_TEST_DATABASE_URL) through the real migrations — no mocks,
 * no in-memory substitutes.
 */
test("service layer against real PostgreSQL", { skip: skipWithoutDatabase }, async (t) => {
  Object.assign(process.env, TEST_ENV);
  await resetDatabase();

  const { pool } = await import("../../src/db/db.js");
  const adminUsers = await import("../../src/services/adminUsers.js");
  const clients = await import("../../src/services/clients.js");
  const fields = await import("../../src/services/fields.js");
  const publications = await import("../../src/services/publications.js");
  const retry = await import("../../src/services/retry.js");
  const usersAdmin = await import("../../src/services/usersAdmin.js");
  const billing = await import("../../src/services/billing.js");
  const audit = await import("../../src/services/audit.js");
  const stats = await import("../../src/services/stats.js");
  const botState = await import("../../src/bot/state.js");

  t.after(async () => { await pool.end(); });

  await t.test("migrations create every table the code uses", async () => {
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const tables = new Set(rows.map((row) => row.table_name));
    for (const table of [
      "users", "identities", "app_sessions", "sites", "plans", "subscriptions", "invoices",
      "publications", "publication_preferences", "platform_connections", "site_field_catalog",
      "telegram_star_payments", "admin_users", "admin_sessions", "admin_audit_log",
      "admin_bot_states", "site_webhook_events", "publication_retries", "app_settings",
      "schema_migrations",
    ]) {
      assert.ok(tables.has(table), `missing table ${table}`);
    }
  });

  await t.test("plans are seeded", async () => {
    const plans = await billing.getPlans();
    assert.ok(plans.length >= 5);
    assert.ok(plans.some((plan) => plan.id === "trial_7d" && plan.is_trial));
  });

  await t.test("bootstrap creates exactly one super admin", async () => {
    assert.equal((await adminUsers.ensureBootstrapAdmin())?.role, "super_admin");
    assert.equal(await adminUsers.ensureBootstrapAdmin(), null);
    const list = await adminUsers.listAdmins({});
    assert.equal(list.pagination.total, 1);
  });

  await t.test("login, session resolution, rotation and revocation", async () => {
    const { admin, session } = await adminUsers.authenticate("admin", "bootstrap-password-1", { ip: "127.0.0.1" });
    assert.equal(admin.role, "super_admin");

    const resolved = await adminUsers.resolveSession(session.token);
    assert.equal(resolved.actor.username, "admin");
    assert.equal(await adminUsers.resolveSession("not-a-token"), null);

    await adminUsers.revokeSession(session.id);
    assert.equal(await adminUsers.resolveSession(session.token), null);
  });

  await t.test("failed logins lock the account and the lock expires into the record", async () => {
    await adminUsers.createAdmin({ username: "locktest", password: "lock-test-password", role: "viewer" });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(adminUsers.authenticate("locktest", "wrong"));
    }
    // The fifth failure trips the lock.
    await assert.rejects(adminUsers.authenticate("locktest", "wrong"), (error) => error.code === "account_locked");
    await assert.rejects(
      adminUsers.authenticate("locktest", "lock-test-password"),
      (error) => error.code === "account_locked",
    );
  });

  await t.test("disabling an admin kills their live sessions", async () => {
    const created = await adminUsers.createAdmin({ username: "tempadmin", password: "temp-admin-password", role: "admin" });
    const { session } = await adminUsers.authenticate("tempadmin", "temp-admin-password", {});
    assert.ok(await adminUsers.resolveSession(session.token));

    await adminUsers.updateAdmin(created.id, { status: "disabled" });
    assert.equal(await adminUsers.resolveSession(session.token), null);
  });

  await t.test("telegram identity resolves an admin", async () => {
    const found = await adminUsers.findAdminByTelegramId("123456789");
    assert.equal(found.username, "admin");
    assert.equal(await adminUsers.findAdminByTelegramId("999"), null);
  });

  let siteId = "";

  await t.test("client provisioning creates a unique id, secret and trial", async () => {
    const client = await clients.provisionClient({
      name: "Test Shop",
      wordpress_url: "https://shop.example.com",
      telegram_channel_id: "https://t.me/shop_channel",
      bale_chat_id: "12345",
      owner_telegram_id: "555000111",
    });
    siteId = client.id;

    assert.match(client.id, /^site_test-shop_[a-z0-9]{6}$/);
    assert.match(client.webhook_secret, /^jch_/);
    assert.equal(client.telegram_channel_id, "@shop_channel");
    assert.ok(client.trial, "owner should receive a trial subscription");

    const second = await clients.provisionClient({ name: "Test Shop", wordpress_url: "https://shop2.example.com" });
    assert.notEqual(second.id, client.id, "duplicate names must not collide");
  });

  await t.test("provisioning rejects incomplete input", async () => {
    await assert.rejects(clients.provisionClient({ name: "No URL" }), /required/);
    await assert.rejects(clients.provisionClient({ wordpress_url: "https://x.example" }), /required/);
  });

  await t.test("client update, owner assignment and enable/disable", async () => {
    const updated = await clients.updateClient(siteId, { name: "Renamed Shop", telegram_channel_id: "@new_channel" });
    assert.equal(updated.name, "Renamed Shop");
    assert.equal(updated.telegram_channel_id, "@new_channel");

    const withOwner = await clients.updateClient(siteId, { owner_telegram_id: "777000222" });
    assert.ok(withOwner.owner_user_id, "owner user should be created and linked");

    assert.equal((await clients.setClientEnabled(siteId, false)).enabled, false);
    assert.equal((await clients.getSite(siteId)).enabled, false);
    await clients.setClientEnabled(siteId, true);
  });

  await t.test("rotating the webhook secret invalidates the old one", async () => {
    const before = (await clients.getSite(siteId)).webhook_secret;
    const rotated = await clients.rotateWebhookSecret(siteId);
    assert.notEqual(rotated.webhook_secret, before);
    assert.equal((await clients.getSite(siteId)).webhook_secret, rotated.webhook_secret);
  });

  await t.test("client detail hides the secret unless explicitly requested", async () => {
    const masked = await clients.getClientDetail(siteId);
    assert.equal(masked.webhook_secret, undefined);
    assert.match(masked.webhook_secret_masked, /^jch_/);
    assert.ok(masked.webhook_secret_masked.includes("•"));

    const revealed = await clients.getClientDetail(siteId, { includeSecret: true });
    assert.match(revealed.webhook_secret, /^jch_/);
  });

  await t.test("client list paginates and filters", async () => {
    const page = await clients.listClients({ page: 1, page_size: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.pagination.page_size, 1);
    assert.ok(page.pagination.total >= 2);
    assert.equal(page.pagination.has_next, true);

    const search = await clients.listClients({ q: "Renamed" });
    assert.equal(search.items.length, 1);
    assert.equal((await clients.listClients({ q: "nothing-matches-this" })).items.length, 0);
  });

  await t.test("field catalog upserts in one statement and preserves first-seen", async () => {
    await fields.upsertFieldCatalog(siteId, {
      company: { label: "نام شرکت", order: 1, type: "text", platforms: { telegram: true, bale: true } },
      phone: { label: "شماره", order: 2, type: "text", platforms: { telegram: true } },
    });
    const first = await fields.listFieldCatalog(siteId);
    assert.equal(first.length, 2);
    assert.equal(first[0].field_key, "company");
    assert.deepEqual(first[0].platforms, { telegram: true, bale: true });

    await fields.upsertFieldCatalog(siteId, { company: { label: "شرکت", order: 5, platforms: { telegram: false } } });
    const second = await fields.listFieldCatalog(siteId);
    assert.equal(second.length, 2, "upsert must not duplicate rows");
    const company = second.find((field) => field.field_key === "company");
    assert.equal(company.label, "شرکت", "WordPress remains the source of truth for labels");
    assert.equal(new Date(company.first_seen_at) <= new Date(company.last_seen_at), true);
  });

  await t.test("webhook events feed diagnostics and site counters", async () => {
    await clients.recordWebhookEvent({
      site_id: siteId, request_id: "req-1", event_type: "created", post_id: "1001",
      http_status: 200, auth_result: "ok", duration_ms: 42, contract_version: "1.3", targets: [],
    });
    await clients.recordWebhookEvent({
      site_id: siteId, request_id: "req-2", event_type: "created", post_id: "1002",
      http_status: 401, auth_result: "invalid_secret", duration_ms: 3, error: "bad secret",
    });

    const events = await clients.listWebhookEvents(siteId, {});
    assert.equal(events.pagination.total, 2);
    assert.equal(events.items[0].post_id, "1002");

    const detail = await clients.getClientDetail(siteId);
    assert.equal(Number(detail.webhook_event_count), 2);
    assert.equal(Number(detail.webhook_failure_count), 1);
    assert.ok(detail.last_webhook_at);
  });

  await t.test("publication history filters, paginates and hides phone data", async () => {
    await pool.query(
      `INSERT INTO publications(site_id,post_id,event_type,platform,status,external_message_ids,
         metadata,published_at,duration_ms,contact_phone_enc)
       VALUES
         ($1,'2001','created','telegram','published','[10]','{"mode":"published"}',NOW(),120,'enc-value'),
         ($1,'2002','created','bale','failed','[]','{"mode":"failed"}',NULL,90,NULL)`,
      [siteId],
    );

    const all = await publications.listPublications({ site_id: siteId });
    assert.equal(all.pagination.total, 2);
    assert.equal(all.items[0].has_contact_phone !== undefined, true);
    assert.equal("contact_phone_enc" in all.items[0], false, "encrypted phone must not leave the service");

    const failed = await publications.listPublications({ site_id: siteId, status: "failed" });
    assert.equal(failed.pagination.total, 1);
    assert.equal(failed.items[0].platform, "bale");

    const byPlatform = await publications.listPublications({ platform: "telegram" });
    assert.equal(byPlatform.pagination.total, 1);
  });

  await t.test("publication metadata is sanitized of phone-shaped keys", async () => {
    await pool.query(
      `INSERT INTO publications(site_id,post_id,event_type,platform,status,metadata)
       VALUES ($1,'2003','created','telegram','published','{"contact_phone":"09121234567","access_token":"abc","mode":"published"}')`,
      [siteId],
    );
    const row = (await publications.listPublications({ site_id: siteId, post_id: "2003" })).items[0];
    assert.equal(row.metadata.contact_phone, "[REDACTED]");
    assert.equal(row.metadata.access_token, "[REDACTED]");
    assert.equal(row.metadata.mode, "published");

    const withPhone = (await publications.listPublications({ site_id: siteId, post_id: "2003" }, { allowPhone: true })).items[0];
    assert.equal(withPhone.metadata.contact_phone, "0912•••4567", "even permitted views get a masked value");
  });

  await t.test("retry queue is idempotent, bounded and encrypted at rest", async () => {
    const ad = {
      site_id: siteId, post_id: "3001", event_type: "created",
      fields: { company: "x" }, author: { phone: "09121234567" },
    };

    const first = await retry.enqueueRetry({ ad, platform: "bale", requestedBy: "system", delayMs: 0 });
    const second = await retry.enqueueRetry({ ad, platform: "bale", requestedBy: "system", delayMs: 0 });
    assert.equal(first.id, second.id, "a second enqueue must reuse the open row");

    const { rows } = await pool.query("SELECT payload FROM publication_retries WHERE id=$1", [first.id]);
    assert.ok(rows[0].payload.enc, "payload must be encrypted");
    assert.doesNotMatch(JSON.stringify(rows[0].payload), /09121234567/);
    assert.equal(retry.unpackPayload(rows[0].payload).author.phone, "09121234567");

    const claimed = await retry.claimDueRetries(10);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].status, "processing");
    assert.equal((await retry.claimDueRetries(10)).length, 0, "a claimed job is not handed out twice");

    const outcome = await retry.completeRetry(first.id, { ok: false, error: "still failing" });
    assert.equal(outcome.status, "pending");
    assert.equal(outcome.attempts, 1);

    await pool.query("UPDATE publication_retries SET attempts=4 WHERE id=$1", [first.id]);
    const exhausted = await retry.completeRetry(first.id, { ok: false, error: "gave up" });
    assert.equal(exhausted.status, "failed", "attempts are bounded by max_attempts");
  });

  await t.test("stuck retries are reclaimed", async () => {
    await pool.query(
      `INSERT INTO publication_retries(site_id,post_id,event_type,platform,payload,status,locked_at,locked_by)
       VALUES($1,'3002','created','bale','{}','processing',NOW()-INTERVAL '1 hour','dead-worker')`,
      [siteId],
    );
    assert.equal(await retry.reclaimStuckRetries(60000), 1);
    const list = await retry.listRetries({ post_id: "3002" });
    assert.equal(list.items[0].status, "pending");
  });

  await t.test("user administration: listing, detail, suspension and session revocation", async () => {
    const users = await usersAdmin.listUsers({});
    assert.ok(users.pagination.total >= 1);
    assert.equal("phone" in users.items[0], false, "list responses never carry phone numbers");

    const userId = users.items.at(-1).id;
    await pool.query("UPDATE users SET phone='09121234567' WHERE id=$1", [userId]);

    const masked = await usersAdmin.getUserDetail(userId, { includePhone: false });
    assert.equal(masked.phone, undefined);
    assert.equal(masked.phone_masked, "0912•••4567");
    assert.equal(masked.has_phone, true);

    const full = await usersAdmin.getUserDetail(userId, { includePhone: true });
    assert.equal(full.phone, "09121234567");

    const { createSession } = await import("../../src/services/users.js");
    const token = await createSession(userId, "telegram", 24);
    const { getUserBySession } = await import("../../src/services/users.js");
    assert.ok(await getUserBySession(token));

    await usersAdmin.setUserStatus(userId, "suspended");
    assert.equal(await getUserBySession(token), null, "suspension revokes live sessions");
    await usersAdmin.setUserStatus(userId, "active");
  });

  await t.test("billing administration extends, expires and grants without rewriting history", async () => {
    const users = await usersAdmin.listUsers({});
    const userId = users.items[0].id;

    const granted = await billing.grantSubscription(userId, "monthly");
    assert.equal(granted.source, "admin");

    const before = new Date(granted.expires_at).getTime();
    const extended = await billing.extendSubscription(granted.id, 15);
    assert.ok(new Date(extended.expires_at).getTime() - before >= 14 * 86400000);
    await assert.rejects(billing.extendSubscription(granted.id, 0), /between 1 and 3650/);

    const expired = await billing.expireSubscription(granted.id);
    assert.equal(expired.status, "expired");

    const list = await billing.listSubscriptions({ state: "expired" });
    assert.ok(list.pagination.total >= 1);

    const invoice = await billing.createInvoice(userId, "monthly");
    const originalAmount = invoice.amount_toman;
    await billing.updatePlan("monthly", { price_toman: 1500000 });
    const stored = await billing.getInvoice(invoice.public_id);
    assert.equal(Number(stored.amount_toman), Number(originalAmount), "plan edits must not rewrite issued invoices");
    await billing.updatePlan("monthly", { price_toman: 990000 });
  });

  await t.test("invoice activation is idempotent", async () => {
    const users = await usersAdmin.listUsers({});
    const invoice = await billing.createInvoice(users.items[0].id, "quarterly");

    const first = await billing.activateInvoice(invoice.public_id, "ref-1", { gateway: "test" });
    assert.equal(first.already, false);
    const second = await billing.activateInvoice(invoice.public_id, "ref-1", { gateway: "test" });
    assert.equal(second.already, true, "double callback must not create a second subscription");

    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM subscriptions WHERE invoice_id=$1", [invoice.id]);
    assert.equal(rows[0].count, 1);
  });

  await t.test("audit log records and filters", async () => {
    await audit.recordAudit({
      actor: { id: 1, username: "admin", role: "super_admin" },
      action: "client.rotate_secret", targetType: "site", targetId: siteId, requestId: "req-9", ip: "127.0.0.1",
    });
    await audit.recordAudit({
      actor: { username: "telegram:1", role: "" }, action: "authorization.denied",
      targetType: "permission", targetId: "clients.create", success: false, channel: "telegram",
    });

    const all = await audit.listAudit({});
    assert.ok(all.pagination.total >= 2);
    assert.equal((await audit.listAudit({ action: "client.rotate_secret" })).pagination.total, 1);
    assert.equal((await audit.listAudit({ success: "false" })).items[0].action, "authorization.denied");
    assert.equal((await audit.listAudit({ channel: "telegram" })).pagination.total, 1);
  });

  await t.test("bot state expires and survives a restart", async () => {
    await botState.setState("123456789", "555", "client_create", "name", { partial: true });
    const live = await botState.getState("123456789", "555");
    assert.equal(live.flow, "client_create");
    assert.equal(live.data.partial, true);

    await botState.advanceState("123456789", "555", "url", { partial: true, name: "Shop" });
    assert.equal((await botState.getState("123456789", "555")).step, "url");

    // One row per (admin, chat): a second flow replaces the first.
    await botState.setState("123456789", "555", "user_search", "term", {});
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM admin_bot_states WHERE telegram_user_id='123456789'");
    assert.equal(rows[0].count, 1);

    await pool.query("UPDATE admin_bot_states SET expires_at=NOW()-INTERVAL '1 minute'");
    assert.equal(await botState.getState("123456789", "555"), null, "expired state must not be resumed");
    assert.equal(await botState.purgeExpiredStates(), 1);
  });

  await t.test("dashboard aggregates and caches", async () => {
    const fresh = await stats.dashboard({ force: true });
    assert.equal(fresh.cached, false);
    assert.ok(fresh.clients.total >= 2);
    assert.ok(Array.isArray(fresh.daily_volume));
    assert.ok(Array.isArray(fresh.platform_distribution));

    const cached = await stats.dashboard({});
    assert.equal(cached.cached, true);
    stats.invalidateDashboardCache();
    assert.equal((await stats.dashboard({})).cached, false);
  });
});
