import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, withPool, startServer, startBaleDouble, createAdminClient,
} from "../helpers.mjs";

const packageVersion = JSON.parse(
  await (await import("node:fs/promises")).readFile(new URL("../../package.json", import.meta.url), "utf8"),
).version;

/**
 * HTTP integration tests: a real server process, a real PostgreSQL database and
 * a local Bale-protocol double so the publication path runs end to end through
 * the real adapter code.
 */
test("HTTP API end to end", { skip: skipWithoutDatabase }, async (t) => {
  await resetDatabase();

  const bale = await startBaleDouble();
  const server = await startServer({
    BALE_API_BASE: bale.baseUrl,
    BALE_BOT_TOKEN: "test-bale-token",
    RATE_LIMIT_LOGIN_MAX: "50",
  });
  const admin = createAdminClient(server.baseUrl);

  t.after(async () => {
    await server.stop();
    await bale.close();
  });

  let site = null;
  const webhook = (body, headers = {}) => fetch(`${server.baseUrl}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Site-ID": site?.id || "",
      "X-Webhook-Secret": site?.webhook_secret || "",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  await t.test("liveness does not depend on the database", async () => {
    const response = await fetch(`${server.baseUrl}/health`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.status, "ok");
    assert.equal(data.version, packageVersion, "the reported version tracks package.json");
    assert.equal("now" in data, false, "liveness must not run a query");
  });

  await t.test("legacy launch token exchanges into a cookie usable without Bearer auth", async () => {
    const token = "ses_integration_exchange_244";
    const tokenHash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
    const userId = await withPool(async (pool) => {
      const user = (await pool.query(
        "INSERT INTO users(display_name,username,status) VALUES('Session Test','session_test','active') RETURNING id",
      )).rows[0].id;
      await pool.query(
        `INSERT INTO app_sessions(user_id,token_hash,platform,expires_at)
         VALUES($1,$2,'telegram',NOW()+INTERVAL '1 hour')`,
        [user, tokenHash],
      );
      return user;
    });

    const exchange = await fetch(`${server.baseUrl}/api/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session: token }),
    });
    assert.equal(exchange.status, 200);
    const cookie = exchange.headers.get("set-cookie");
    assert.match(cookie || "", /jarchi_session=/);
    assert.match(cookie || "", /HttpOnly/);

    const me = await fetch(`${server.baseUrl}/api/me`, { headers: { cookie: String(cookie).split(";")[0] } });
    const meData = await me.json();
    assert.equal(me.status, 200, JSON.stringify(meData));
    assert.equal(String(meData.user.id), String(userId));
  });

  await t.test("readiness reports each dependency", async () => {
    const response = await fetch(`${server.baseUrl}/health/ready`);
    const data = await response.json();
    assert.equal(data.checks.database.ok, true);
    assert.equal(data.checks.credential_key.ok, true);
    // No Telegram token in the test environment, so the instance is not ready.
    assert.equal(data.checks.telegram.ok, false);
    assert.equal(response.status, 503);
    assert.equal(data.status, "not_ready");
  });

  await t.test("the account router guards only /api/account, not the whole /api tree", async () => {
    /*
     * accountRoutes is mounted at /api next to the admin router, so an unscoped
     * customerAuth on it answered every /api request — operator login included
     * — with a customer 401 before the real route was reached.
     */
    const unknown = await fetch(`${server.baseUrl}/api/nothing-is-mounted-here`);
    assert.equal(unknown.status, 404, "an unrouted /api path must 404, not 401");

    const identities = await fetch(`${server.baseUrl}/api/account/identities`);
    assert.equal(identities.status, 401, "the account routes themselves still require a customer session");
    assert.equal((await identities.json()).error, "Authentication required");
  });

  await t.test("admin endpoints reject anonymous callers", async () => {
    const response = await fetch(`${server.baseUrl}/api/admin/dashboard`);
    const data = await response.json();
    assert.equal(response.status, 401);
    assert.equal(data.error.code, "unauthenticated");
    assert.ok(data.request_id, "every response carries a request id");
  });

  await t.test("login rejects bad credentials and issues a session cookie on success", async () => {
    const bad = await admin.post("/api/admin/auth/login", { username: "admin", password: "wrong" });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.error.code, "invalid_credentials");

    const good = await admin.login();
    assert.equal(good.status, 200);
    assert.equal(good.data.admin.role, "super_admin");
    assert.ok(good.data.csrf_token);
    const cookie = good.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  await t.test("state-changing requests require the CSRF token", async () => {
    admin.dropCsrf();
    const denied = await admin.post("/api/admin/clients", { name: "X", wordpress_url: "https://x.example" });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, "csrf_failed");
    await admin.login();
  });

  await t.test("input validation rejects hostile values", async () => {
    for (const payload of [
      { name: "X", wordpress_url: "javascript:alert(1)" },
      { name: "", wordpress_url: "https://x.example" },
      { name: "X", wordpress_url: "https://x.example", owner_telegram_id: "not-a-number" },
      { name: "X", wordpress_url: "https://x.example", telegram_channel_id: "not a channel" },
    ]) {
      const response = await admin.post("/api/admin/clients", payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.data.error.code, "bad_request");
    }
  });

  await t.test("client creation returns the webhook credentials exactly once", async () => {
    const response = await admin.post("/api/admin/clients", {
      name: "Integration Shop",
      wordpress_url: "https://shop.example.com",
      bale_chat_id: "12345",
    });
    assert.equal(response.status, 201);
    site = response.data.client;
    assert.match(site.webhook_secret, /^jch_/);
    assert.match(site.webhook_url, /\/webhook$/);

    const listed = await admin.get("/api/admin/clients");
    assert.equal(listed.data.items.length, 1);
    assert.equal("webhook_secret" in listed.data.items[0], false, "list views never carry secrets");

    const detail = await admin.get(`/api/admin/clients/${site.id}`);
    assert.equal(detail.data.client.webhook_secret, undefined);
    assert.ok(detail.data.client.webhook_secret_masked.includes("•"));
  });

  await t.test("webhook authentication is enforced", async () => {
    const noSecret = await webhook({ post_id: 1 }, { "X-Webhook-Secret": "" });
    assert.equal(noSecret.status, 401);

    const wrongSecret = await webhook({ post_id: 1 }, { "X-Webhook-Secret": "jch_wrong" });
    assert.equal(wrongSecret.status, 401);

    const unknownSite = await webhook({ post_id: 1 }, { "X-Site-ID": "site_missing_000000" });
    assert.equal(unknownSite.status, 403);

    const noSite = await fetch(`${server.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: 1 }),
    });
    assert.equal(noSite.status, 400);
  });

  await t.test("contract 1.3 payload publishes, applying field and button policy", async () => {
    const response = await webhook({
      contract_version: "1.3",
      event_type: "created",
      post_id: "1001",
      title: "آگهی تست",
      description: "توضیحات",
      url: "https://shop.example.com/ad/1001",
      fields: { company: "شرکت الف", phone: "09121234567", internal: "محرمانه" },
      field_meta: {
        company: { label: "نام شرکت", order: 1, platforms: { telegram: true, bale: true } },
        phone: { label: "شماره تماس", order: 2, platforms: { telegram: true, bale: false } },
        internal: { label: "داخلی", order: 3, visibility: "hidden" },
      },
      publication_targets: { telegram: { enabled: false }, bale: { enabled: true } },
      buttons: { view: { enabled: true, label: "مشاهده آگهی" }, contact: { enabled: true, label: "تماس" } },
      author: { name: "فروشنده", phone: "09121234567" },
      taxonomy: { category: { name: "خدمات" } },
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(data.platforms.map((item) => [item.platform, item.status]), [["bale", "published"]]);

    const sent = bale.requests.at(-1);
    assert.match(sent.text, /نام شرکت/);
    assert.doesNotMatch(sent.text, /09121234567/, "phone is hidden from Bale by field policy");
    assert.doesNotMatch(sent.text, /محرمانه/, "hidden fields never publish");
    assert.equal(sent.reply_markup.inline_keyboard[0].length, 1, "contact button is suppressed where the phone is hidden");
    assert.equal(sent.reply_markup.inline_keyboard[0][0].url, "https://shop.example.com/ad/1001");
  });

  await t.test("the field catalog and webhook diagnostics record the event", async () => {
    const fields = await admin.get(`/api/admin/clients/${site.id}/fields`);
    assert.deepEqual(fields.data.fields.map((field) => field.field_key), ["company", "phone", "internal"]);
    assert.equal(fields.data.fields[0].label, "نام شرکت");
    assert.deepEqual(fields.data.fields[0].platforms, { telegram: true, bale: true });

    const events = await admin.get(`/api/admin/clients/${site.id}/webhooks`);
    const successful = events.data.items.find((event) => event.http_status === 200);
    assert.equal(successful.event_type, "created");
    assert.ok(successful.duration_ms >= 0);
    assert.ok(events.data.items.some((event) => event.auth_result === "invalid_secret"));
  });

  await t.test("a transport failure is recorded and queued for retry", async () => {
    bale.setMode("fail");
    const response = await webhook({
      contract_version: "1.3", event_type: "created", post_id: "2002", title: "آگهی دوم",
      publication_targets: { bale: { enabled: true } },
    });
    const data = await response.json();

    assert.equal(data.platforms[0].status, "failed");
    assert.equal(data.platforms[0].error_code, "server_error");
    assert.equal(data.platforms[0].retry_queued, true);

    const retries = await admin.get("/api/admin/publications/retries");
    assert.equal(retries.data.items[0].post_id, "2002");
    assert.equal(retries.data.items[0].status, "pending");
  });

  await t.test("a configuration failure is not retried", async () => {
    bale.setMode("badchat");
    const response = await webhook({
      contract_version: "1.3", event_type: "created", post_id: "2003", title: "آگهی سوم",
      publication_targets: { bale: { enabled: true } },
    });
    const data = await response.json();

    assert.equal(data.platforms[0].status, "failed");
    assert.equal(data.platforms[0].error_code, "config");
    assert.equal(data.platforms[0].retry_queued, false);

    const retries = await admin.get("/api/admin/publications/retries?post_id=2003");
    assert.equal(retries.data.items.length, 0);
  });

  await t.test("running the retry queue republishes once the platform recovers", async () => {
    bale.setMode("ok");
    await withPool((pool) => pool.query("UPDATE publication_retries SET next_attempt_at=NOW() WHERE status='pending'"));

    const run = await admin.post("/api/admin/publications/retries/run", {});
    assert.equal(run.data.result.succeeded, 1);

    const publications = await admin.get("/api/admin/publications?post_id=2002");
    assert.equal(publications.data.items[0].status, "published");
    assert.ok(publications.data.items[0].attempt_count >= 2, "the retry counts as another attempt");
  });

  await t.test("publication history filters and paginates", async () => {
    const all = await admin.get("/api/admin/publications?page_size=2");
    assert.equal(all.data.items.length, 2);
    assert.equal(all.data.pagination.page_size, 2);
    assert.ok(all.data.pagination.total >= 3);

    const failed = await admin.get("/api/admin/publications?status=failed");
    assert.ok(failed.data.items.every((item) => item.status === "failed"));

    const byPlatform = await admin.get("/api/admin/publications?platform=bale");
    assert.ok(byPlatform.data.items.every((item) => item.platform === "bale"));

    const invalid = await admin.get("/api/admin/publications?status=not-a-status");
    assert.equal(invalid.status, 400);
  });

  await t.test("updates edit the existing message, deletions remove it", async () => {
    await webhook({
      contract_version: "1.3", event_type: "created", post_id: "4004", title: "قابل حذف",
      publication_targets: { bale: { enabled: true } },
    });

    const deletion = await webhook({
      contract_version: "1.3", event_type: "deleted", post_id: "4004",
    });
    const data = await deletion.json();
    assert.deepEqual(data.platforms.map((item) => [item.platform, item.status]), [["bale", "deleted"]]);

    const publications = await admin.get("/api/admin/publications?post_id=4004");
    assert.equal(publications.data.items[0].status, "deleted");
  });

  await t.test("deleting something that was never published is reported honestly", async () => {
    const response = await webhook({ contract_version: "1.3", event_type: "deleted", post_id: "9999" });
    const data = await response.json();
    assert.equal(data.platforms[0].status, "skipped");
    assert.equal(data.platforms[0].reason, "nothing_published");
  });

  await t.test("unsupported events are ignored, not failed", async () => {
    const response = await webhook({ event_type: "trashed", post_id: "5005" });
    const data = await response.json();
    assert.equal(data.platforms[0].status, "ignored");
    assert.equal(data.platforms[0].reason, "unsupported_event");
  });

  await t.test("legacy payloads without publication_targets still publish", async () => {
    const response = await webhook({
      event: "created",
      id: "7007",
      title: "آگهی قدیمی",
      fields: { company: "قدیمی" },
      field_meta: { company: { label: "شرکت", order: 1, visibility: "all" } },
    });
    const data = await response.json();
    assert.equal(data.event_type, "created");
    assert.equal(data.post_id, "7007");
    assert.equal(data.platforms[0].status, "published");
    assert.match(bale.requests.at(-1).text, /قدیمی/);
  });

  await t.test("a missing post_id is rejected", async () => {
    const response = await webhook({ event_type: "created", title: "no id" });
    assert.equal(response.status, 400);
  });

  await t.test("publishing stops when the owner's subscription lapses", async () => {
    const owned = await admin.post("/api/admin/clients", {
      name: "Expired Shop",
      wordpress_url: "https://expired.example.com",
      bale_chat_id: "12345",
      owner_telegram_id: "444555666",
    });
    const expiredSite = owned.data.client;

    await withPool((pool) => pool.query(
      "UPDATE subscriptions SET status='expired', expires_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",
      [expiredSite.owner_user_id],
    ));

    const response = await fetch(`${server.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Site-ID": expiredSite.id,
        "X-Webhook-Secret": expiredSite.webhook_secret,
      },
      body: JSON.stringify({
        contract_version: "1.3", event_type: "created", post_id: "8008", title: "blocked",
        publication_targets: { bale: { enabled: true } },
      }),
    });
    const data = await response.json();
    assert.deepEqual(data.platforms, [{ platform: "all", status: "blocked", reason: "subscription_expired" }]);
  });

  await t.test("a disabled client's webhook is refused", async () => {
    await admin.post(`/api/admin/clients/${site.id}/enabled`, { enabled: false });
    const response = await webhook({ contract_version: "1.3", event_type: "created", post_id: "9001" });
    assert.equal(response.status, 403);
    await admin.post(`/api/admin/clients/${site.id}/enabled`, { enabled: true });
  });

  await t.test("rotating the secret invalidates the old one immediately", async () => {
    const rotated = await admin.post(`/api/admin/clients/${site.id}/rotate-secret`, {});
    assert.match(rotated.data.client.webhook_secret, /^jch_/);

    const stale = await webhook({ contract_version: "1.3", event_type: "created", post_id: "9002" });
    assert.equal(stale.status, 401);

    site = { ...site, webhook_secret: rotated.data.client.webhook_secret };
    const fresh = await webhook({
      contract_version: "1.3", event_type: "created", post_id: "9003", title: "پس از چرخش",
      publication_targets: { bale: { enabled: true } },
    });
    assert.equal(fresh.status, 200);
  });

  await t.test("RBAC: a viewer may read but not act, and denials are audited", async () => {
    await admin.post("/api/admin/admins", {
      username: "viewer1", password: "viewer-password-1", role: "viewer",
    });

    const viewer = createAdminClient(server.baseUrl);
    await viewer.login("viewer1", "viewer-password-1");

    const dashboard = await viewer.get("/api/admin/dashboard");
    assert.equal(dashboard.status, 200);

    const create = await viewer.post("/api/admin/clients", { name: "Nope", wordpress_url: "https://nope.example" });
    assert.equal(create.status, 403);
    assert.equal(create.data.error.code, "forbidden");

    const rotate = await viewer.post(`/api/admin/clients/${site.id}/rotate-secret`, {});
    assert.equal(rotate.status, 403);

    const retryRun = await viewer.post("/api/admin/publications/retries/run", {});
    assert.equal(retryRun.status, 403);

    const admins = await viewer.get("/api/admin/admins");
    assert.equal(admins.status, 403);

    const audit = await admin.get("/api/admin/audit?action=authorization.denied");
    assert.ok(audit.data.pagination.total >= 4, "each denial is recorded");
    assert.equal(audit.data.items[0].success, false);
  });

  await t.test("support role gets support actions but not client management", async () => {
    await admin.post("/api/admin/admins", {
      username: "support1", password: "support-password-1", role: "support",
    });
    const support = createAdminClient(server.baseUrl);
    await support.login("support1", "support-password-1");

    assert.equal((await support.get("/api/admin/publications")).status, 200);
    assert.equal((await support.post("/api/admin/publications/retries/run", {})).status, 200);
    assert.equal((await support.patch(`/api/admin/clients/${site.id}`, { name: "Nope" })).status, 403);
    assert.equal((await support.post("/api/admin/subscriptions/1/extend", { days: 10 })).status, 403);
  });

  await t.test("phone numbers are gated by role in user detail", async () => {
    await withPool((pool) => pool.query("UPDATE users SET phone='09121234567' WHERE id=(SELECT MIN(id) FROM users)"));
    const users = await admin.get("/api/admin/users");
    const userId = users.data.items.at(-1).id;
    assert.equal("phone" in users.data.items[0], false);

    const asSuperAdmin = await admin.get(`/api/admin/users/${userId}`);
    const support = createAdminClient(server.baseUrl);
    await support.login("support1", "support-password-1");
    const asSupport = await support.get(`/api/admin/users/${userId}`);

    if (asSuperAdmin.data.user.has_phone) {
      assert.equal(typeof asSuperAdmin.data.user.phone, "string");
      assert.equal("phone" in asSupport.data.user, false, "support must not receive the raw number");
      assert.ok(asSupport.data.user.phone_masked.includes("•"));
    }
  });

  await t.test("the last active super admin cannot be locked out", async () => {
    const me = await admin.get("/api/admin/auth/me");
    const response = await admin.patch(`/api/admin/admins/${me.data.admin.id}`, { role: "viewer" });
    assert.equal(response.status, 409);
    assert.equal(response.data.error.code, "conflict");
  });

  await t.test("the legacy ADMIN_API_TOKEN still works for machine clients", async () => {
    const response = await fetch(`${server.baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${TEST_ENV.ADMIN_API_TOKEN}` },
    });
    assert.equal(response.status, 200);

    const rejected = await fetch(`${server.baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(rejected.status, 401);
  });

  await t.test("the dashboard aggregates real activity", async () => {
    const response = await admin.get("/api/admin/dashboard?refresh=true");
    const stats = response.data.stats;
    assert.ok(stats.clients.total >= 2);
    assert.ok(stats.publications.published >= 1);
    assert.ok(stats.publications.failed >= 1);
    assert.ok(stats.platform_distribution.some((row) => row.platform === "bale"));
    assert.equal(stats.timezone, "Asia/Tehran");
  });

  await t.test("logout ends the session", async () => {
    const fresh = createAdminClient(server.baseUrl);
    await fresh.login();
    assert.equal((await fresh.get("/api/admin/auth/me")).status, 200);
    await fresh.post("/api/admin/auth/logout", {});
    assert.equal((await fresh.get("/api/admin/auth/me")).status, 401);
  });

  await t.test("unknown routes answer with the standard error shape", async () => {
    const response = await fetch(`${server.baseUrl}/does-not-exist`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).success, false);
  });

  await t.test("no secret or phone value appears in the server log stream", () => {
    const logs = server.logs.join("");
    assert.doesNotMatch(logs, /jch_[A-Za-z0-9_-]{20,}/, "webhook secrets must never be logged");
    assert.doesNotMatch(logs, /09121234567/, "phone numbers must never be logged");
    assert.doesNotMatch(logs, /bootstrap-password-1/);
  });
});
