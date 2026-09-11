import express from "express";
import { config } from "../../config.js";
import { poolStats } from "../../db/db.js";
import { readLogTail } from "../../logger.js";
import { ok, handler, notFound, badRequest, conflict } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS, ROLES, permissionsForRole } from "../../core/rbac.js";
import { recordAudit, listAudit } from "../../services/audit.js";
import { dashboard } from "../../services/stats.js";
import { platformHealth } from "../../services/diagnostics.js";
import {
  listAdmins, getAdmin, createAdmin, updateAdmin, countActiveSuperAdmins,
  revokeAllSessions, listSessions,
} from "../../services/adminUsers.js";
import {
  requireString, requireEnum, requireInt, optionalTelegramUserId, optionalString,
} from "../../middleware/validate.js";

export const systemRoutes = express.Router();

systemRoutes.get("/dashboard", requirePermission(PERMISSIONS.DASHBOARD_VIEW), handler(async (req, res) => {
  const stats = await dashboard({ force: req.query.refresh === "true" });
  return ok(res, { stats });
}));

systemRoutes.get("/platforms", requirePermission(PERMISSIONS.PLATFORMS_VIEW), handler(async (req, res) => {
  // `probe=true` calls getMe on each configured bot; tokens are never returned.
  return ok(res, { platforms: await platformHealth({ probe: req.query.probe === "true" }) });
}));

systemRoutes.get("/audit", requirePermission(PERMISSIONS.AUDIT_VIEW), handler(async (req, res) => {
  return ok(res, await listAudit(req.query));
}));

systemRoutes.get("/observability", requirePermission(PERMISSIONS.AUDIT_VIEW), handler(async (req, res) => ok(res, {
  metrics: {
    version: config.version,
    uptime_s: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    database: poolStats(),
    node: process.version,
  },
  logs: await readLogTail({ lines: req.query.lines || 100, level: req.query.level || "", queryText: req.query.q || "" }),
})));

systemRoutes.get("/settings", requirePermission(PERMISSIONS.SETTINGS_VIEW), handler(async (req, res) => ok(res, {
  settings: {
    version: config.version,
    contract_version: config.contractVersion,
    min_contract_version: config.minContractVersion,
    environment: config.env,
    timezone: config.timezone,
    public_base_url: config.publicBaseUrl,
    webhook_url: `${config.publicBaseUrl}/webhook`,
    pagination: config.pagination,
    retry: {
      enabled: config.retry.enabled,
      auto_enqueue: config.retry.autoEnqueue,
      max_attempts: config.retry.maxAttempts,
      interval_ms: config.retry.intervalMs,
    },
    rate_limit: config.rateLimit,
    session: {
      idle_minutes: config.admin.sessionIdleMinutes,
      absolute_hours: config.admin.sessionAbsoluteHours,
      rotate_minutes: config.admin.sessionRotateMinutes,
    },
    legacy_api_token_enabled: Boolean(config.admin.apiToken),
    whatsapp_enabled: config.whatsapp.enabled,
    zarinpal_enabled: config.zarinpal.enabled,
    telegram_stars_enabled: config.telegram.starsEnabled,
  },
})));

/* ------------------------- administrator accounts ------------------------- */

systemRoutes.get("/roles", requirePermission(PERMISSIONS.ADMINS_VIEW), handler(async (req, res) => ok(res, {
  roles: ROLES.map((role) => ({ role, permissions: permissionsForRole(role) })),
})));

systemRoutes.get("/admins", requirePermission(PERMISSIONS.ADMINS_VIEW), handler(async (req, res) => {
  return ok(res, await listAdmins(req.query));
}));

systemRoutes.post("/admins", requirePermission(PERMISSIONS.ADMINS_MANAGE), handler(async (req, res) => {
  const admin = await createAdmin({
    username: requireString(req.body?.username, "username", { max: 40 }),
    password: req.body?.password ? requireString(req.body.password, "password", { min: 10, max: 200 }) : null,
    role: requireEnum(req.body?.role, ROLES, "role"),
    display_name: optionalString(req.body?.display_name, "display_name", { max: 120 }),
    telegram_user_id: optionalTelegramUserId(req.body?.telegram_user_id, "telegram_user_id") || null,
    bale_user_id: req.body?.bale_user_id ? String(req.body.bale_user_id).trim() : null,
    created_by: req.admin.id,
  });
  await recordAudit({
    actor: req.admin, action: "admin.create", targetType: "admin", targetId: admin.id,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { username: admin.username, role: admin.role },
  });
  return ok(res, { admin }, 201);
}));

systemRoutes.get("/admins/:id", requirePermission(PERMISSIONS.ADMINS_VIEW), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const admin = await getAdmin(id);
  if (!admin) throw notFound("مدیر یافت نشد");
  return ok(res, { admin, sessions: await listSessions(id) });
}));

systemRoutes.patch("/admins/:id", requirePermission(PERMISSIONS.ADMINS_MANAGE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const target = await getAdmin(id);
  if (!target) throw notFound("مدیر یافت نشد");

  const patch = {};
  if (req.body?.display_name !== undefined) patch.display_name = optionalString(req.body.display_name, "display_name", { max: 120 });
  if (req.body?.role !== undefined) patch.role = requireEnum(req.body.role, ROLES, "role");
  if (req.body?.status !== undefined) patch.status = requireEnum(req.body.status, ["active", "disabled"], "status");
  if (req.body?.telegram_user_id !== undefined) {
    patch.telegram_user_id = optionalTelegramUserId(req.body.telegram_user_id, "telegram_user_id") || null;
  }
  if (req.body?.bale_user_id !== undefined) {
    patch.bale_user_id = req.body.bale_user_id ? String(req.body.bale_user_id).trim() : null;
  }
  if (req.body?.password !== undefined) patch.password = requireString(req.body.password, "password", { min: 10, max: 200 });
  if (!Object.keys(patch).length) throw badRequest("No supported fields to update");

  /*
   * The instance must never be left without a way in: refuse to demote or
   * disable the last active super admin.
   */
  const losesSuperAdmin = target.role === "super_admin"
    && ((patch.role && patch.role !== "super_admin") || patch.status === "disabled");
  if (losesSuperAdmin && (await countActiveSuperAdmins(id)) === 0) {
    throw conflict("آخرین مدیر ارشد فعال را نمی‌توان غیرفعال یا تنزل داد");
  }
  if (Number(req.admin.id) === id && patch.status === "disabled") {
    throw conflict("نمی‌توانید حساب خودتان را غیرفعال کنید");
  }

  const admin = await updateAdmin(id, patch);
  await recordAudit({
    actor: req.admin, action: "admin.update", targetType: "admin", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { fields: Object.keys(patch), role: admin.role, status: admin.status },
  });
  return ok(res, { admin });
}));

systemRoutes.post("/admins/:id/sessions/revoke", requirePermission(PERMISSIONS.ADMINS_MANAGE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const revoked = await revokeAllSessions(id);
  await recordAudit({
    actor: req.admin, action: "admin.sessions.revoke", targetType: "admin", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { revoked },
  });
  return ok(res, { revoked });
}));
