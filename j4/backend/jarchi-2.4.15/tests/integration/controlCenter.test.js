import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, startServer, createAdminClient, seedCustomer,
} from "../helpers.mjs";

/**
 * The control-centre surfaces the Mini App drives: site membership, role
 * assignment by platform id, plan pricing and field overrides.
 *
 * Everything runs against a real server and a real database, over HTTP, because
 * the properties worth testing here are authorization ones and those live in
 * the middleware chain rather than in the services.
 */
test("mini app control centre", { skip: skipWithoutDatabase }, async (t) => {
  Object.assign(process.env, TEST_ENV);
  await resetDatabase();

  const { pool } = await import("../../src/db/db.js");
  const adminUsers = await import("../../src/services/adminUsers.js");
  await adminUsers.ensureBootstrapAdmin();

  const server = await startServer();
  const admin = createAdminClient(server.baseUrl);
  await admin.login();

  t.after(async () => { await server.stop(); await pool.end(); });

  const { user: owner, site } = await seedCustomer(pool, {
    telegramId: "700000001", siteId: "site_control_test01",
  });

  /** A second person who has started the bot, and one who has not. */
  const teammate = (await pool.query(
    "INSERT INTO users(display_name, username, status) VALUES('همکار','teammate','active') RETURNING *",
  )).rows[0];
  await pool.query(
    "INSERT INTO identities(user_id, platform, platform_user_id) VALUES($1,'telegram','700000002')",
    [teammate.id],
  );
  const baleMate = (await pool.query(
    "INSERT INTO users(display_name, username, status) VALUES('همکار بله','balemate','active') RETURNING *",
  )).rows[0];
  await pool.query(
    "INSERT INTO identities(user_id, platform, platform_user_id) VALUES($1,'bale','700000003')",
    [baleMate.id],
  );

  const asOwner = (path, options = {}) => fetch(`${server.baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}`, ...(options.headers || {}) },
  });
  let ownerToken = "";

  /* ------------------------------ membership ------------------------------ */

  await t.test("a member is added by the platform id an operator actually has", async () => {
    const created = await admin.post(`/api/admin/clients/${site.id}/members`, {
      platform: "telegram", platform_user_id: "700000002", role: "admin",
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.member.user_id, Number(teammate.id));
    assert.equal(created.data.member.role, "admin");

    const listed = await admin.get(`/api/admin/clients/${site.id}/members`);
    assert.equal(listed.data.owner.user_id, Number(owner.id));
    assert.equal(listed.data.members.length, 1);
    // The screen shows the id the operator recognises, not just a row number.
    assert.deepEqual(listed.data.members[0].identities, [{ platform: "telegram", platform_user_id: "700000002" }]);
  });

  await t.test("someone who has not started the bot cannot be added", async () => {
    const result = await admin.post(`/api/admin/clients/${site.id}/members`, {
      platform: "telegram", platform_user_id: "999000111", role: "support",
    });
    assert.equal(result.status, 404);
    assert.equal(result.data.error_code, "identity_not_found");
    assert.match(result.data.error, /ربات/, "the message tells the operator what to do about it");
  });

  await t.test("only admin and support are accepted as member roles", async () => {
    for (const role of ["owner", "manager", "viewer", "superuser"]) {
      const result = await admin.post(`/api/admin/clients/${site.id}/members`, {
        platform: "telegram", platform_user_id: "700000002", role,
      });
      assert.equal(result.status, 400, `accepted role: ${role}`);
      assert.equal(result.data.error_code, "invalid_role");
    }
    // The database refuses it too, so a direct write cannot invent a role.
    await assert.rejects(
      pool.query("INSERT INTO site_members(site_id,user_id,role) VALUES($1,$2,'root')", [site.id, teammate.id]),
      /site_members_role_check/,
    );

    // Leaving the role out gives the lesser role, never the managing one.
    const defaulted = await admin.post(`/api/admin/clients/${site.id}/members`, {
      platform: "telegram", platform_user_id: "700000002",
    });
    assert.equal(defaulted.status, 201);
    assert.equal(defaulted.data.member.role, "support");
  });

  await t.test("the owner is never also a member row", async () => {
    const result = await admin.post(`/api/admin/clients/${site.id}/members`, {
      platform: "telegram", platform_user_id: "700000001", role: "admin",
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.error_code, "already_owner");
  });

  await t.test("a member's role can be changed and the member removed", async () => {
    const changed = await admin.patch(`/api/admin/clients/${site.id}/members/${teammate.id}`, { role: "support" });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.member.role, "support");

    const removed = await admin.del(`/api/admin/clients/${site.id}/members/${teammate.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await admin.get(`/api/admin/clients/${site.id}/members`)).data.members.length, 0);

    const again = await admin.del(`/api/admin/clients/${site.id}/members/${teammate.id}`);
    assert.equal(again.status, 404, "removing a non-member is reported, not silently accepted");
  });

  /* ---------------------------- customer surface --------------------------- */

  await t.test("a site owner manages their own team without an admin account", async () => {
    ownerToken = (await pool.query(
      `SELECT token_hash FROM app_sessions WHERE user_id=$1`, [owner.id],
    )).rows.length ? await freshSession(pool, owner.id) : await freshSession(pool, owner.id);

    const added = await (await asOwner(`/api/sites/${site.id}/members`, {
      method: "POST",
      body: JSON.stringify({ platform: "telegram", platform_user_id: "700000002", role: "support" }),
    })).json();
    assert.equal(added.success, true, JSON.stringify(added));
    assert.equal(added.member.role, "support");

    const listed = await (await asOwner(`/api/sites/${site.id}/members`)).json();
    assert.equal(listed.site_role, "owner");
    assert.equal(listed.can_manage, true);
    assert.equal(listed.members.length, 1);
  });

  await t.test("a support member may see the team but may not change it", async () => {
    const supportToken = await freshSession(pool, teammate.id);
    const call = (path, options = {}) => fetch(`${server.baseUrl}${path}`, {
      ...options,
      headers: { "content-type": "application/json", authorization: `Bearer ${supportToken}`, ...(options.headers || {}) },
    });

    const listed = await (await call(`/api/sites/${site.id}/members`)).json();
    assert.equal(listed.success, true);
    assert.equal(listed.site_role, "support");
    assert.equal(listed.can_manage, false);

    for (const attempt of [
      { method: "POST", path: `/api/sites/${site.id}/members`, body: { platform: "bale", platform_user_id: "700000003", role: "admin" } },
      { method: "PATCH", path: `/api/sites/${site.id}/members/${teammate.id}`, body: { role: "admin" } },
      { method: "DELETE", path: `/api/sites/${site.id}/members/${teammate.id}`, body: {} },
    ]) {
      const response = await call(attempt.path, { method: attempt.method, body: JSON.stringify(attempt.body) });
      assert.equal(response.status, 403, `${attempt.method} ${attempt.path}`);
      assert.equal((await response.json()).error_code, "member_management_forbidden");
    }
    // And nothing changed as a side effect of trying.
    assert.equal((await admin.get(`/api/admin/clients/${site.id}/members`)).data.members[0].role, "support");
  });

  await t.test("a site admin may manage the team; an outsider sees nothing", async () => {
    await admin.patch(`/api/admin/clients/${site.id}/members/${teammate.id}`, { role: "admin" });
    const token = await freshSession(pool, teammate.id);
    const added = await fetch(`${server.baseUrl}/api/sites/${site.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: "bale", platform_user_id: "700000003", role: "support" }),
    });
    assert.equal(added.status, 201, await added.clone().text());

    const outsiderToken = await freshSession(pool, baleMate.id);
    await admin.del(`/api/admin/clients/${site.id}/members/${baleMate.id}`);
    const denied = await fetch(`${server.baseUrl}/api/sites/${site.id}/members`, {
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    assert.equal(denied.status, 403);
  });

  await t.test("a member cannot remove their own access", async () => {
    const token = await freshSession(pool, teammate.id);
    const response = await fetch(`${server.baseUrl}/api/sites/${site.id}/members/${teammate.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error_code, "cannot_remove_self");
  });

  /* ------------------------------ quick assign ----------------------------- */

  await t.test("quick assign grants access by platform id and records it", async () => {
    const result = await admin.post("/api/admin/clients/assign", {
      platform: "bale", platform_user_id: "700000003", site_id: site.id, role: "support",
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.assignment.role, "support");
    assert.equal(result.data.assignment.user_id, Number(baleMate.id));

    const recent = await admin.get("/api/admin/clients/assignments?limit=10");
    assert.equal(recent.status, 200);
    assert.ok(recent.data.assignments.length > 0);
    assert.equal(recent.data.assignments[0].action, "site.role.assign");
    assert.equal(recent.data.assignments[0].site_id, site.id);
  });

  await t.test("assigning ownership transfers the site and keeps the old owner as admin", async () => {
    const before = (await pool.query("SELECT owner_user_id FROM sites WHERE id=$1", [site.id])).rows[0].owner_user_id;

    const result = await admin.post("/api/admin/clients/assign", {
      platform: "telegram", platform_user_id: "700000002", site_id: site.id, role: "owner",
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));

    const after = (await pool.query("SELECT owner_user_id FROM sites WHERE id=$1", [site.id])).rows[0];
    assert.equal(Number(after.owner_user_id), Number(teammate.id));

    const members = (await admin.get(`/api/admin/clients/${site.id}/members`)).data;
    assert.equal(members.owner.user_id, Number(teammate.id));
    assert.ok(
      members.members.some((m) => m.user_id === Number(before) && m.role === "admin"),
      "the previous owner keeps access as an admin",
    );
    assert.ok(
      !members.members.some((m) => m.user_id === Number(teammate.id)),
      "the new owner has no leftover member row",
    );

    // Put it back so later subtests read the original arrangement.
    await admin.post("/api/admin/clients/assign", {
      platform: "telegram", platform_user_id: "700000001", site_id: site.id, role: "owner",
    });
  });

  await t.test("quick assign is limited to super admins", async () => {
    await adminUsers.createAdmin({ username: "ccadmin", password: "another-password-9", role: "admin" });
    const lesser = createAdminClient(server.baseUrl);
    await lesser.login("ccadmin", "another-password-9");

    const denied = await lesser.post("/api/admin/clients/assign", {
      platform: "telegram", platform_user_id: "700000002", site_id: site.id, role: "owner",
    });
    assert.equal(denied.status, 403);
    // A plain admin can still do the everyday thing: manage members.
    assert.equal((await lesser.get(`/api/admin/clients/${site.id}/members`)).status, 200);
  });

  await t.test("lookup answers before anything is granted", async () => {
    const found = await admin.get("/api/admin/clients/lookup/telegram/700000002");
    assert.equal(found.status, 200);
    assert.equal(found.data.user.id, Number(teammate.id));

    const missing = await admin.get("/api/admin/clients/lookup/telegram/700000999");
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error_code, "identity_not_found");

    const bad = await admin.get("/api/admin/clients/lookup/signal/700000002");
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error_code, "invalid_platform");
  });

  /* --------------------------------- plans -------------------------------- */

  await t.test("plan capabilities are set on create and edit", async () => {
    const created = await admin.post("/api/admin/plans", {
      id: "cc_pro", name: "کنترل حرفه‌ای", duration_days: 30, price_toman: 500000,
      features: { site_control: true, remote_tickets: true, analytics: true },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    // Every known capability is present, so nothing is left undefined.
    assert.deepEqual(created.data.plan.features, {
      site_control: true, remote_tickets: true, remote_announcements: false,
      remote_products: false, analytics: true,
    });

    const edited = await admin.patch("/api/admin/plans/cc_pro", {
      features: { site_control: true, remote_products: true },
    });
    assert.equal(edited.data.plan.features.remote_products, true);
    assert.equal(edited.data.plan.features.remote_tickets, false, "an omitted flag is off, not remembered");
  });

  await t.test("an unknown capability is rejected rather than silently dropped", async () => {
    const result = await admin.patch("/api/admin/plans/cc_pro", { features: { site_controll: true } });
    assert.equal(result.status, 400);
    assert.match(JSON.stringify(result.data), /site_controll/);
  });

  await t.test("plans report how many subscriptions they carry", async () => {
    const listed = await admin.get("/api/admin/plans?include_inactive=true");
    const monthly = listed.data.plans.find((plan) => plan.id === "monthly");
    assert.ok(Number.isInteger(monthly.subscription_count));
    assert.ok(Number.isInteger(monthly.active_subscription_count));
    assert.ok(monthly.active_subscription_count >= 1, "the seeded customer is on it");
  });

  await t.test("a plan in use cannot be deleted, only deactivated", async () => {
    const refused = await admin.del("/api/admin/plans/monthly");
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error_code, "active_subscriptions");
    assert.match(refused.data.error, /غیرفعال/, "the message names the alternative");
    assert.ok((await admin.get("/api/admin/plans?include_inactive=true")).data.plans.some((p) => p.id === "monthly"));

    const deactivated = await admin.patch("/api/admin/plans/monthly", { active: false });
    assert.equal(deactivated.data.plan.active, false);
    await admin.patch("/api/admin/plans/monthly", { active: true });

    // The trial plan is what ensureTrial() puts every new customer on, so it
    // is refused even though nothing is billed against it.
    const trial = await admin.del("/api/admin/plans/trial_7d");
    assert.equal(trial.status, 409);
    assert.equal(trial.data.error_code, "trial_plan");
    assert.ok((await admin.get("/api/admin/plans?include_inactive=true")).data.plans.some((p) => p.id === "trial_7d"));

    const deleted = await admin.del("/api/admin/plans/cc_pro");
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.ok(!(await admin.get("/api/admin/plans?include_inactive=true")).data.plans.some((p) => p.id === "cc_pro"));

    assert.equal((await admin.del("/api/admin/plans/cc_pro")).status, 404);
  });

  /* -------------------------------- fields -------------------------------- */

  await t.test("field overrides survive the next WordPress webhook", async () => {
    const { upsertFieldCatalog } = await import("../../src/services/fields.js");
    await upsertFieldCatalog(site.id, {
      price: { label: "قیمت", order: 1, platforms: { telegram: true, bale: true } },
      salary: { label: "حقوق", order: 2, platforms: { telegram: true, bale: false } },
      secret_note: { label: "یادداشت", order: 3, visibility: "all" },
    });

    const renamed = await admin.patch(`/api/admin/clients/${site.id}/fields/price`, {
      label_override: "قیمت نهایی",
      platforms: { bale: false },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(renamed.data.field.effective_label, "قیمت نهایی");
    assert.equal(renamed.data.field.label, "قیمت", "the plugin's own label is still visible");
    assert.equal(renamed.data.field.effective_platforms.bale, false);
    assert.equal(renamed.data.field.effective_platforms.telegram, true, "an untouched platform keeps the plugin's answer");

    // The plugin sends the same field again on the next post.
    await upsertFieldCatalog(site.id, {
      price: { label: "قیمت", order: 1, platforms: { telegram: true, bale: true } },
    });
    const after = (await admin.get(`/api/admin/clients/${site.id}/fields`)).data.fields
      .find((field) => field.field_key === "price");
    assert.equal(after.effective_label, "قیمت نهایی", "the override was not overwritten");
    assert.equal(after.effective_platforms.bale, false);

    // A later partial toggle must merge, not replace the previous Bale override.
    const second = await admin.patch(`/api/admin/clients/${site.id}/fields/price`, {
      platforms: { whatsapp: true },
    });
    assert.equal(second.data.field.effective_platforms.whatsapp, true);
    assert.equal(second.data.field.effective_platforms.bale, false, "partial platform patches preserve earlier overrides");
    assert.equal(second.data.field.platform_overrides.bale, false);
    assert.equal(second.data.field.platform_overrides.whatsapp, true);
  });

  await t.test("hiding a field takes it off every platform", async () => {
    const hidden = await admin.patch(`/api/admin/clients/${site.id}/fields/secret_note`, { hidden: true });
    assert.deepEqual(hidden.data.field.effective_platforms, { telegram: false, bale: false, whatsapp: false });

    const { applyFieldOverrides, getFieldsForPlatform } = await import("../../src/core/fieldPolicy.js");
    const { getFieldOverrides } = await import("../../src/services/fields.js");
    const ad = applyFieldOverrides(
      {
        fields: { price: "۱۰۰", secret_note: "محرمانه" },
        field_meta: { price: { platforms: { telegram: true, bale: true } }, secret_note: { visibility: "all" } },
      },
      await getFieldOverrides(site.id),
    );
    assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "telegram")), ["price"], "the hidden field never reaches Telegram");
    assert.deepEqual(Object.keys(getFieldsForPlatform(ad, "bale")), [], "and price is off Bale by its override");
  });

  await t.test("reordering is explicit and only touches this site's fields", async () => {
    const result = await admin.post(`/api/admin/clients/${site.id}/fields/reorder`, {
      order: ["salary", "secret_note", "price", "not_a_field"],
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.updated, 3, "an unknown key is ignored, not inserted");
    assert.deepEqual(result.data.fields.map((field) => field.field_key), ["salary", "secret_note", "price"]);
  });

  await t.test("field editing needs more than read access", async () => {
    await adminUsers.createAdmin({ username: "ccsupport", password: "support-password-7", role: "support" });
    const support = createAdminClient(server.baseUrl);
    await support.login("ccsupport", "support-password-7");

    assert.equal((await support.get(`/api/admin/clients/${site.id}/fields`)).status, 200);
    assert.equal((await support.patch(`/api/admin/clients/${site.id}/fields/price`, { hidden: true })).status, 403);
    assert.equal((await support.post(`/api/admin/clients/${site.id}/fields/reorder`, { order: ["price"] })).status, 403);
    assert.equal(
      (await admin.get(`/api/admin/clients/${site.id}/fields`)).data.fields.find((f) => f.field_key === "price").hidden,
      false,
      "the refused edit changed nothing",
    );
  });
});

/** A fresh Mini App bearer token for a user, the way the bots hand one out. */
async function freshSession(pool, userId) {
  const { createHash } = await import("node:crypto");
  const token = `ses_test_${Math.random().toString(36).slice(2)}${Date.now()}`;
  await pool.query(
    `INSERT INTO app_sessions(user_id, token_hash, platform, expires_at)
     VALUES($1,$2,'telegram',NOW()+INTERVAL '1 day')`,
    [Number(userId), createHash("sha256").update(token).digest("hex")],
  );
  return token;
}
