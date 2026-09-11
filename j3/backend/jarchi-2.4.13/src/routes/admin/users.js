import express from "express";
import { ok, handler, notFound } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS, can } from "../../core/rbac.js";
import { recordAudit } from "../../services/audit.js";
import { listUsers, getUserDetail, setUserStatus, revokeUserSessions } from "../../services/usersAdmin.js";
import * as siteMembers from "../../services/siteMembers.js";
import { requireSiteId } from "../../middleware/validate.js";
import { requireInt, requireEnum } from "../../middleware/validate.js";

export const userRoutes = express.Router();

userRoutes.get("/", requirePermission(PERMISSIONS.USERS_VIEW), handler(async (req, res) => {
  return ok(res, await listUsers(req.query));
}));

userRoutes.get("/:id", requirePermission(PERMISSIONS.USERS_VIEW), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  // Phone numbers require their own permission; everyone else sees a mask.
  const includePhone = can(req.admin, PERMISSIONS.USERS_PHONE_VIEW);
  const user = await getUserDetail(id, { includePhone });
  if (!user) throw notFound("کاربر یافت نشد");

  if (includePhone && user.has_phone) {
    await recordAudit({
      actor: req.admin, action: "user.phone.view", targetType: "user", targetId: id,
      requestId: req.requestId, ip: req.ip, channel: "web",
    });
  }
  return ok(res, { user });
}));


userRoutes.post("/:id/site-access", requirePermission(PERMISSIONS.USERS_UPDATE), handler(async (req, res) => {
  const userId = requireInt(req.params.id, "id", { min: 1 });
  const siteId = requireSiteId(req.body?.site_id);
  const role = requireEnum(req.body?.role, ["admin", "support"], "role");
  try {
    const member = await siteMembers.addMemberByUserId(siteId, userId, role, { actor: req.admin?.username });
    await recordAudit({
      actor: req.admin, action: "user.site_access.grant", targetType: "user", targetId: userId,
      requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
      metadata: { site_id: siteId, role },
    });
    return ok(res, { member }, 201);
  } catch (error) {
    if (error instanceof siteMembers.MemberError) {
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
}));

userRoutes.delete("/:id/site-access/:siteId", requirePermission(PERMISSIONS.USERS_UPDATE), handler(async (req, res) => {
  const userId = requireInt(req.params.id, "id", { min: 1 });
  const siteId = requireSiteId(req.params.siteId);
  try {
    const result = await siteMembers.removeMember(siteId, userId, { actor: req.admin?.username });
    await recordAudit({
      actor: req.admin, action: "user.site_access.revoke", targetType: "user", targetId: userId,
      requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
      metadata: { site_id: siteId },
    });
    return ok(res, { result });
  } catch (error) {
    if (error instanceof siteMembers.MemberError) {
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
}));

userRoutes.post("/:id/status", requirePermission(PERMISSIONS.USERS_UPDATE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const status = requireEnum(req.body?.status, ["active", "suspended"], "status");
  const user = await setUserStatus(id, status);
  if (!user) throw notFound("کاربر یافت نشد");

  await recordAudit({
    actor: req.admin, action: status === "suspended" ? "user.suspend" : "user.activate",
    targetType: "user", targetId: id, requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { user });
}));

userRoutes.post("/:id/sessions/revoke", requirePermission(PERMISSIONS.USERS_SESSIONS_REVOKE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const revoked = await revokeUserSessions(id);
  await recordAudit({
    actor: req.admin, action: "user.sessions.revoke", targetType: "user", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { revoked },
  });
  return ok(res, { revoked });
}));
