import express from "express";
import { config } from "../../config.js";
import { ok, fail, handler } from "../../middleware/respond.js";
import { loginRateLimit } from "../../middleware/rateLimit.js";
import { adminAuth, setSessionCookie, clearSessionCookie } from "../../middleware/adminAuth.js";
import {
  authenticate, AuthenticationError, revokeSession, revokeAllSessions, listSessions, updateAdmin, csrfForSession,
} from "../../services/adminUsers.js";
import { recordAudit } from "../../services/audit.js";
import { requireString } from "../../middleware/validate.js";

export const authRoutes = express.Router();

/**
 * Web admin login.
 *
 * The session token lives in an HttpOnly cookie — never in localStorage — and
 * the CSRF token is returned in the body for the SPA to echo on writes.
 */
authRoutes.post("/login", loginRateLimit(), handler(async (req, res) => {
  const username = requireString(req.body?.username, "username", { max: 40 });
  const password = requireString(req.body?.password, "password", { max: 200 });

  try {
    const { admin, session } = await authenticate(username, password, {
      ip: req.ip,
      userAgent: req.get("User-Agent") || "",
    });
    setSessionCookie(res, session);
    await recordAudit({
      actor: admin, action: "admin.login", targetType: "admin", targetId: admin.id,
      requestId: req.requestId, ip: req.ip, channel: "web",
    });
    return ok(res, {
      admin,
      csrf_token: session.csrf,
      expires_at: session.expires_at,
      absolute_expires_at: session.absolute_expires_at,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await recordAudit({
        actor: { username, role: "" }, action: "admin.login", targetType: "admin", targetId: username,
        success: false, requestId: req.requestId, ip: req.ip, channel: "web",
        metadata: { reason: error.code },
      });
      return fail(res, 401, error.code, error.message);
    }
    throw error;
  }
}));

authRoutes.post("/logout", adminAuth(), handler(async (req, res) => {
  if (req.adminSession) await revokeSession(req.adminSession.id);
  clearSessionCookie(res);
  await recordAudit({
    actor: req.admin, action: "admin.logout", targetType: "admin", targetId: req.admin.id,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, {});
}));

/**
 * Current actor + the permission set the UI uses to hide what it may not do.
 * Cookie sessions also receive a fresh CSRF token here, so a reloaded panel can
 * perform writes without forcing the operator to log in again.
 */
authRoutes.get("/me", adminAuth(), handler(async (req, res) => ok(res, {
  admin: req.admin,
  auth_method: req.adminAuthMethod,
  csrf_token: req.adminAuthMethod === "cookie" ? csrfForSession(req.adminSession) : undefined,
  session: req.adminSession
    ? { expires_at: req.adminSession.expires_at, absolute_expires_at: req.adminSession.absolute_expires_at }
    : null,
  server: {
    version: config.version,
    contract_version: config.contractVersion,
    timezone: config.timezone,
    environment: config.env,
  },
})));

authRoutes.get("/sessions", adminAuth(), handler(async (req, res) => {
  if (!req.admin.id) return ok(res, { sessions: [] });
  return ok(res, { sessions: await listSessions(req.admin.id) });
}));

authRoutes.post("/sessions/revoke-all", adminAuth(), handler(async (req, res) => {
  if (!req.admin.id) return fail(res, 400, "bad_request", "این روش احراز هویت نشستی ندارد");
  const count = await revokeAllSessions(req.admin.id);
  clearSessionCookie(res);
  await recordAudit({
    actor: req.admin, action: "admin.sessions.revoke_all", targetType: "admin", targetId: req.admin.id,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { revoked: count },
  });
  return ok(res, { revoked: count });
}));

/** Self-service password change; rotates every session on success. */
authRoutes.post("/password", adminAuth(), handler(async (req, res) => {
  if (!req.admin.id) return fail(res, 400, "bad_request", "توکن ماشینی گذرواژه ندارد");
  const current = requireString(req.body?.current_password, "current_password", { max: 200 });
  const next = requireString(req.body?.new_password, "new_password", { min: 10, max: 200 });

  try {
    await authenticate(req.admin.username, current, { ip: req.ip });
  } catch {
    return fail(res, 401, "invalid_credentials", "گذرواژه فعلی نادرست است");
  }

  await updateAdmin(req.admin.id, { password: next });
  clearSessionCookie(res);
  await recordAudit({
    actor: req.admin, action: "admin.password.change", targetType: "admin", targetId: req.admin.id,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { changed: true, reauthentication_required: true });
}));
