import express from "express";
import { ok, handler, notFound, badRequest } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS, can } from "../../core/rbac.js";
import { recordAudit } from "../../services/audit.js";
import {
  listClients, getClientDetail, updateClient, setClientEnabled, rotateWebhookSecret,
  provisionClient, listWebhookEvents, getSite,
} from "../../services/clients.js";
import { listFieldCatalog, setFieldOverride, reorderFields } from "../../services/fields.js";
import * as members from "../../services/siteMembers.js";
import { listPublications } from "../../services/publications.js";
import { testClientPlatform, testClientConnections } from "../../services/diagnostics.js";
import { query } from "../../db/db.js";
import {
  requireString, requireUrl, optionalUrl, optionalString, optionalTelegramTarget,
  optionalBaleTarget, optionalTelegramUserId, requireSiteId, requireBoolean, requirePlatform,
  requireEnum,
} from "../../middleware/validate.js";

export const clientRoutes = express.Router();

clientRoutes.get("/", requirePermission(PERMISSIONS.CLIENTS_VIEW), handler(async (req, res) => {
  return ok(res, await listClients(req.query));
}));

clientRoutes.post("/", requirePermission(PERMISSIONS.CLIENTS_CREATE), handler(async (req, res) => {
  const payload = {
    name: requireString(req.body?.name, "name", { max: 190 }),
    wordpress_url: requireUrl(req.body?.wordpress_url, "wordpress_url"),
    telegram_channel_id: optionalTelegramTarget(req.body?.telegram_channel_id),
    bale_chat_id: optionalBaleTarget(req.body?.bale_chat_id),
    owner_telegram_id: optionalTelegramUserId(req.body?.owner_telegram_id, "owner_telegram_id"),
  };

  const client = await provisionClient(payload);
  await recordAudit({
    actor: req.admin, action: "client.create", targetType: "site", targetId: client.id,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod === "api_token" ? "api_token" : "web",
    metadata: {
      name: payload.name,
      wordpress_url: payload.wordpress_url,
      telegram_configured: Boolean(payload.telegram_channel_id),
      bale_configured: Boolean(payload.bale_chat_id),
    },
  });

  // The plaintext secret is returned exactly once, at creation.
  return ok(res, { client }, 201);
}));

/* ------------------------------ quick assign ------------------------------ */

/*
 * Registered before /:siteId so these literal paths are not swallowed by the
 * site-id parameter.
 */

/**
 * Grants someone access to a site in one step, addressed by the id an operator
 * actually has in front of them: a Telegram or Bale user id.
 *
 * Only a super admin may do this. Handing out `owner` moves the site to a new
 * account, which is not something a day-to-day admin should be able to do from
 * a single form, and the two lesser roles are grouped with it so there is one
 * rule to reason about rather than three.
 */
clientRoutes.post("/assign", requirePermission(PERMISSIONS.ADMINS_MANAGE), handler(async (req, res) => {
  const siteId = requireSiteId(req.body?.site_id);
  const role = String(req.body?.role || "");
  try {
    const result = await members.assignRole({
      platform: req.body?.platform || "telegram",
      platform_user_id: req.body?.platform_user_id,
      site_id: siteId,
      role,
      actor: req.admin?.username,
    });
    await recordAudit({
      actor: req.admin, action: "site.role.assign", targetType: "site", targetId: siteId,
      requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
      metadata: {
        user_id: result.user_id,
        role: result.role,
        platform: String(req.body?.platform || "telegram"),
        previous_owner_user_id: result.previous_owner_user_id,
      },
    });
    return ok(res, { assignment: result }, 201);
  } catch (error) {
    if (error instanceof members.MemberError) {
      await recordAudit({
        actor: req.admin, action: "site.role.assign", targetType: "site", targetId: siteId,
        success: false, requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
        metadata: { role, error_code: error.code },
      });
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
}));

/** The recent grants, so an operator can see that the last one landed. */
clientRoutes.get("/assignments", requirePermission(PERMISSIONS.CLIENTS_VIEW), handler(async (req, res) => {
  return ok(res, { assignments: await members.recentAssignments(req.query?.limit) });
}));

/**
 * Resolves a platform id to a Jarchi account before anything is granted, so the
 * form can say "this is who you are about to add" or "they have not started the
 * bot yet" instead of failing on submit.
 */
clientRoutes.get("/lookup/:platform/:platformUserId", requirePermission(PERMISSIONS.CLIENTS_VIEW), handler(async (req, res) => {
  try {
    const user = await members.findUserByPlatformId(req.params.platform, req.params.platformUserId);
    return ok(res, {
      user: {
        id: Number(user.id),
        display_name: user.display_name,
        username: user.username,
        platform: user.platform,
        platform_user_id: user.platform_user_id,
      },
    });
  } catch (error) {
    if (error instanceof members.MemberError) {
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
}));

clientRoutes.get("/:siteId", requirePermission(PERMISSIONS.CLIENTS_VIEW), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const client = await getClientDetail(siteId, {
    includeSecret: req.query.reveal_secret === "true" && can(req.admin, PERMISSIONS.CLIENTS_SECRET_VIEW),
  });
  if (!client) throw notFound("کلاینت یافت نشد");

  if (client.webhook_secret) {
    await recordAudit({
      actor: req.admin, action: "client.secret.view", targetType: "site", targetId: siteId,
      requestId: req.requestId, ip: req.ip, channel: "web",
    });
  }
  return ok(res, { client });
}));

clientRoutes.patch("/:siteId", requirePermission(PERMISSIONS.CLIENTS_UPDATE), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const patch = {};
  if (req.body?.name !== undefined) patch.name = requireString(req.body.name, "name", { max: 190 });
  if (req.body?.wordpress_url !== undefined) patch.wordpress_url = optionalUrl(req.body.wordpress_url, "wordpress_url");
  if (req.body?.telegram_channel_id !== undefined) patch.telegram_channel_id = optionalTelegramTarget(req.body.telegram_channel_id);
  if (req.body?.bale_chat_id !== undefined) patch.bale_chat_id = optionalBaleTarget(req.body.bale_chat_id);
  if (req.body?.owner_telegram_id !== undefined) patch.owner_telegram_id = optionalTelegramUserId(req.body.owner_telegram_id, "owner_telegram_id");
  if (req.body?.notes !== undefined) patch.notes = optionalString(req.body.notes, "notes", { max: 2000 });
  if (!Object.keys(patch).length) throw badRequest("No supported fields to update");

  const client = await updateClient(siteId, patch);
  if (!client) throw notFound("کلاینت یافت نشد");

  await recordAudit({
    actor: req.admin, action: "client.update", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { fields: Object.keys(patch) },
  });
  return ok(res, { client });
}));

clientRoutes.post("/:siteId/enabled", requirePermission(PERMISSIONS.CLIENTS_DISABLE), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const enabled = requireBoolean(req.body?.enabled, "enabled");
  const result = await setClientEnabled(siteId, enabled);
  if (!result) throw notFound("کلاینت یافت نشد");

  await recordAudit({
    actor: req.admin, action: enabled ? "client.enable" : "client.disable",
    targetType: "site", targetId: siteId, requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { client: result });
}));

/**
 * Rotating the webhook secret breaks the customer's WordPress plugin until the
 * new value is entered there, so the plaintext is returned once and the action
 * is always audited.
 */
clientRoutes.post("/:siteId/rotate-secret", requirePermission(PERMISSIONS.CLIENTS_ROTATE_SECRET), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const result = await rotateWebhookSecret(siteId);
  if (!result) throw notFound("کلاینت یافت نشد");

  await recordAudit({
    actor: req.admin, action: "client.rotate_secret", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { client: result, warning: "پلاگین وردپرس مشتری تا وارد کردن رمز جدید کار نخواهد کرد" });
}));

/* ------------------------------ site members ------------------------------ */

/**
 * Membership is delegated to services/siteMembers.js so the admin panel, the
 * Mini App and the customer API cannot disagree about who may do what. These
 * routes only translate its errors into the panel's response shape.
 */
const memberAction = (run) => handler(async (req, res) => {
  try {
    return await run(req, res);
  } catch (error) {
    if (error instanceof members.MemberError) {
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
});

clientRoutes.get("/:siteId/members", requirePermission(PERMISSIONS.CLIENTS_VIEW), memberAction(async (req, res) => {
  return ok(res, await members.listMembers(requireSiteId(req.params.siteId)));
}));

/**
 * Adds a member. Accepts either a platform id (what an operator actually has)
 * or an internal user id, which is what the 2.1.x panel sent.
 */
clientRoutes.post("/:siteId/members", requirePermission(PERMISSIONS.CLIENTS_UPDATE), memberAction(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  // An unstated role means the lesser one: adding a teammate should not hand
  // out the ability to change who else has access as a side effect.
  const role = String(req.body?.role || "support");

  let member;
  if (req.body?.platform_user_id) {
    member = await members.addMember(siteId, {
      platform: req.body?.platform || "telegram",
      platform_user_id: req.body.platform_user_id,
      role,
      actor: req.admin?.username,
    });
  } else {
    const userId = Number(req.body?.user_id || 0);
    if (!Number.isInteger(userId) || userId < 1) throw badRequest("platform_user_id یا user_id لازم است");
    member = await members.addMemberByUserId(siteId, userId, role, { actor: req.admin?.username });
  }

  await recordAudit({
    actor: req.admin, action: "site.member.add", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { user_id: member.user_id, role: member.role },
  });
  return ok(res, { site_id: siteId, member }, 201);
}));

clientRoutes.patch("/:siteId/members/:userId", requirePermission(PERMISSIONS.CLIENTS_UPDATE), memberAction(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const member = await members.setMemberRole(siteId, req.params.userId, req.body?.role, {
    actor: req.admin?.username,
  });
  await recordAudit({
    actor: req.admin, action: "site.member.role", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { user_id: member.user_id, role: member.role },
  });
  return ok(res, { site_id: siteId, member });
}));

clientRoutes.delete("/:siteId/members/:userId", requirePermission(PERMISSIONS.CLIENTS_UPDATE), memberAction(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const result = await members.removeMember(siteId, req.params.userId, { actor: req.admin?.username });
  await recordAudit({
    actor: req.admin, action: "site.member.remove", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { user_id: result.user_id },
  });
  return ok(res, result);
}));

clientRoutes.get("/:siteId/fields", requirePermission(PERMISSIONS.FIELDS_VIEW), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  return ok(res, { site_id: siteId, fields: await listFieldCatalog(siteId) });
}));

/**
 * Field overrides.
 *
 * WordPress remains the source of truth for which fields exist: nothing here
 * creates a field, and an unknown key is a 404 rather than a new row. What an
 * operator controls is presentation and routing — the label shown, the order,
 * and which platforms a field reaches — and those choices survive the next
 * webhook, which overwrites everything the plugin owns.
 */
clientRoutes.patch("/:siteId/fields/:fieldKey", requirePermission(PERMISSIONS.FIELDS_MANAGE), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const fieldKey = requireString(req.params.fieldKey, "field_key", { max: 190 });

  const patch = {};
  if (req.body?.label_override !== undefined) {
    patch.label_override = req.body.label_override === null ? null : requireString(req.body.label_override, "label_override", { max: 255 });
  }
  if (req.body?.order_override !== undefined) patch.order_override = req.body.order_override;
  if (req.body?.hidden !== undefined) patch.hidden = requireBoolean(req.body.hidden, "hidden");
  if (req.body?.platforms !== undefined) {
    if (req.body.platforms !== null && (typeof req.body.platforms !== "object" || Array.isArray(req.body.platforms))) {
      throw badRequest("platforms must be an object");
    }
    patch.platform_overrides = req.body.platforms;
  }
  if (!Object.keys(patch).length) throw badRequest("No supported fields to update");

  const field = await setFieldOverride(siteId, fieldKey, patch, { actor: req.admin?.username || "" });
  if (!field) throw notFound("فیلد یافت نشد");

  await recordAudit({
    actor: req.admin, action: "client.field.override", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { field_key: fieldKey, fields: Object.keys(patch) },
  });
  return ok(res, { site_id: siteId, field });
}));

clientRoutes.post("/:siteId/fields/reorder", requirePermission(PERMISSIONS.FIELDS_MANAGE), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const order = Array.isArray(req.body?.order) ? req.body.order : null;
  if (!order || !order.length) throw badRequest("order must be a non-empty array of field keys");
  if (order.length > 500) throw badRequest("order is too long");

  const updated = await reorderFields(siteId, order, { actor: req.admin?.username || "" });
  await recordAudit({
    actor: req.admin, action: "client.field.reorder", targetType: "site", targetId: siteId,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { updated },
  });
  return ok(res, { site_id: siteId, updated, fields: await listFieldCatalog(siteId) });
}));

clientRoutes.get("/:siteId/publications", requirePermission(PERMISSIONS.PUBLICATIONS_VIEW), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  return ok(res, await listPublications({ ...req.query, site_id: siteId }));
}));

clientRoutes.get("/:siteId/webhooks", requirePermission(PERMISSIONS.WEBHOOKS_VIEW), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  return ok(res, await listWebhookEvents(siteId, req.query));
}));

/**
 * Connection testing. `check` reads the target through the platform API;
 * `send` posts a visible probe message into the customer's channel, so it is
 * an explicit choice rather than the default.
 */
clientRoutes.post("/:siteId/test/:platform", requirePermission(PERMISSIONS.PLATFORMS_TEST), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const platform = requirePlatform(req.params.platform);
  const mode = requireEnum(req.body?.mode || "check", ["check", "send"], "mode");

  const result = await testClientPlatform(siteId, platform, { mode });
  await recordAudit({
    actor: req.admin, action: "client.platform.test", targetType: "site", targetId: siteId,
    success: result.ok, requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { platform, mode, error_code: result.error_code || null },
  });
  return ok(res, { test: result });
}));

clientRoutes.post("/:siteId/test", requirePermission(PERMISSIONS.PLATFORMS_TEST), handler(async (req, res) => {
  const siteId = requireSiteId(req.params.siteId);
  const mode = requireEnum(req.body?.mode || "check", ["check", "send"], "mode");
  const result = await testClientConnections(siteId, { mode });

  await recordAudit({
    actor: req.admin, action: "client.connection.test", targetType: "site", targetId: siteId,
    success: result.results.every((item) => item.ok), requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { mode, tested: result.tested },
  });
  return ok(res, { test: result });
}));


/* ----------------------------- tickets ----------------------------- */
clientRoutes.get("/:siteId/tickets", requirePermission(PERMISSIONS.TICKETS_VIEW), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.listTickets(site, req.query));
}));

clientRoutes.get("/:siteId/tickets/:ticketId", requirePermission(PERMISSIONS.TICKETS_VIEW), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.getTicket(site, req.params.ticketId));
}));

clientRoutes.post("/:siteId/tickets/:ticketId/reply", requirePermission(PERMISSIONS.TICKETS_REPLY), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  const result = await wordpressTickets.replyTicket(site, req.params.ticketId, {
    body: String(req.body?.body || ""),
    agent_name: String(req.body?.agent_name || req.admin.display_name || "پشتیبان جارچی"),
  });
  await recordAudit({ actor:req.admin, action:"ticket.reply", targetType:"ticket", targetId:req.params.ticketId, requestId:req.requestId, ip:req.ip, channel:"web", metadata:{site_id:site.id} });
  return ok(res, result);
}));

clientRoutes.post("/:siteId/tickets/:ticketId/status", requirePermission(PERMISSIONS.TICKETS_MANAGE), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  const status = String(req.body?.status || "waiting");
  const result = await wordpressTickets.setTicketStatus(site, req.params.ticketId, status);
  await recordAudit({ actor:req.admin, action:"ticket.status", targetType:"ticket", targetId:req.params.ticketId, requestId:req.requestId, ip:req.ip, channel:"web", metadata:{site_id:site.id,status} });
  return ok(res, result);
}));

clientRoutes.post("/:siteId/tickets/:ticketId/assign", requirePermission(PERMISSIONS.TICKETS_MANAGE), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  const userId = Number(req.body?.user_id || 0);
  const result = await wordpressTickets.assignTicket(site, req.params.ticketId, userId);
  await recordAudit({ actor:req.admin, action:"ticket.assign", targetType:"ticket", targetId:req.params.ticketId, requestId:req.requestId, ip:req.ip, channel:"web", metadata:{site_id:site.id,user_id:userId} });
  return ok(res, result);
}));

clientRoutes.get("/:siteId/ticket-agents", requirePermission(PERMISSIONS.TICKETS_VIEW), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.listAgents(site));
}));

clientRoutes.post("/:siteId/ticket-agents", requirePermission(PERMISSIONS.TICKET_AGENTS_MANAGE), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.updateAgent(site, Number(req.body?.user_id || 0), String(req.body?.action || "add")));
}));

clientRoutes.post("/:siteId/tickets", requirePermission(PERMISSIONS.TICKETS_CREATE), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  const customerId = Number(req.body?.customer_id || 0);
  if (!Number.isInteger(customerId) || customerId < 1) return res.status(400).json({ success: false, error: "customer_id is required" });
  const result = await wordpressTickets.createTicket(site, {
    subject: req.body?.subject,
    body: req.body?.body,
    customer_id: customerId,
    priority: req.body?.priority || "normal",
    department: Number(req.body?.department || 0),
    category: Number(req.body?.category || 0),
    sender_type: "admin",
    sender_name: req.admin.display_name || "پشتیبانی جارچی",
  });
  await recordAudit({ actor:req.admin, action:"ticket.create", targetType:"ticket", targetId:result?.ticket?.id || null, requestId:req.requestId, ip:req.ip, channel:"web", metadata:{site_id:site.id,customer_id:customerId,priority:req.body?.priority||"normal"} });
  return ok(res, result, 201);
}));

clientRoutes.get("/:siteId/ticket-customers", requirePermission(PERMISSIONS.TICKETS_CREATE), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.listCustomers(site, req.query));
}));

clientRoutes.get("/:siteId/ticket-unread", requirePermission(PERMISSIONS.TICKETS_VIEW), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  return ok(res, await wordpressTickets.getUnread(site));
}));

clientRoutes.post("/:siteId/tickets/:ticketId/mark-read", requirePermission(PERMISSIONS.TICKETS_REPLY), handler(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site) throw notFound("کلاینت یافت نشد");
  const result = await wordpressTickets.markTicketRead(site, req.params.ticketId);
  await recordAudit({ actor:req.admin, action:"ticket.mark_read", targetType:"ticket", targetId:req.params.ticketId, requestId:req.requestId, ip:req.ip, channel:"web", metadata:{site_id:site.id} });
  return ok(res, result);
}));

