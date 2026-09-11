import { config } from "../config.js";
import { can, AuthorizationError } from "../core/rbac.js";
import { safeRequestPath } from "../utils/http.js";
import { resolveSession, shouldRotate, rotateSession } from "../services/adminUsers.js";
import { permissionsForRole } from "../core/rbac.js";
import { safeEqual, sha256 } from "../utils/security.js";
import { fail } from "./respond.js";
import { recordAudit } from "../services/audit.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function parseCookies(header = "") {
  const jar = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function setSessionCookie(res, session) {
  const attributes = [
    `${config.admin.cookieName}=${encodeURIComponent(session.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(60, config.admin.sessionAbsoluteHours * 3600)}`,
  ];
  if (config.admin.cookieSecure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearSessionCookie(res) {
  const attributes = [
    `${config.admin.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (config.admin.cookieSecure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

/**
 * Resolves the admin actor for a request, in order of preference:
 *  1. session cookie   — the web panel (short-lived, rotating, CSRF-protected)
 *  2. Bearer session   — same sessions, for API clients that cannot hold cookies
 *  3. ADMIN_API_TOKEN  — legacy 1.2.0 machine token, mapped to a synthetic
 *                        super_admin actor and clearly labelled in the audit log
 */
export function adminAuth({ optional = false } = {}) {
  return async (req, res, next) => {
    try {
      if (req.miniAppAdmin && req.admin) {
        return next();
      }
      const cookies = parseCookies(req.get("Cookie") || "");
      const bearer = String(req.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const cookieToken = cookies[config.admin.cookieName] || "";

      if (cookieToken || (bearer && !isLegacyToken(bearer))) {
        const token = cookieToken || bearer;
        const resolved = await resolveSession(token);
        if (!resolved) {
          if (cookieToken) clearSessionCookie(res);
          if (optional) return next();
          return fail(res, 401, "unauthenticated", "نشست معتبر نیست یا منقضی شده است");
        }

        req.admin = resolved.actor;
        req.adminSession = resolved.session;
        req.adminAuthMethod = cookieToken ? "cookie" : "bearer";

        // Cookie sessions carry state-changing requests from a browser, so they
        // must also present the CSRF token issued with the session.
        if (cookieToken && !SAFE_METHODS.has(req.method)) {
          const supplied = String(req.get("X-CSRF-Token") || "");
          if (!supplied || !safeEqual(sha256(supplied), resolved.session.csrf_hash)) {
            return fail(res, 403, "csrf_failed", "توکن CSRF نامعتبر است");
          }
        }

        if (cookieToken && shouldRotate(resolved.session)) {
          const rotated = await rotateSession(resolved.session, resolved.actor.id, {
            ip: req.ip, userAgent: req.get("User-Agent") || "",
          });
          setSessionCookie(res, rotated);
          res.setHeader("X-CSRF-Token", rotated.csrf);
          req.adminSession = { ...req.adminSession, id: rotated.id, csrf_hash: sha256(rotated.csrf) };
        }
        return next();
      }

      if (bearer && isLegacyToken(bearer)) {
        req.admin = {
          id: null,
          username: "api-token",
          display_name: "Legacy API token",
          role: "super_admin",
          status: "active",
          permissions: permissionsForRole("super_admin"),
          channel: "api_token",
        };
        req.adminAuthMethod = "api_token";
        return next();
      }

      if (optional) return next();
      return fail(res, 401, "unauthenticated", "برای دسترسی باید وارد شوید");
    } catch (error) {
      return next(error);
    }
  };
}

function isLegacyToken(token) {
  return Boolean(config.admin.apiToken) && safeEqual(token, config.admin.apiToken);
}

/**
 * Route-level permission gate. Denials are audited: a 403 is a security event,
 * not just a failed request.
 */
export function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.admin) return fail(res, 401, "unauthenticated", "برای دسترسی باید وارد شوید");
    if (can(req.admin, permission)) return next();

    await recordAudit({
      actor: req.admin,
      action: "authorization.denied",
      targetType: "permission",
      targetId: permission,
      success: false,
      requestId: req.requestId,
      ip: req.ip,
      channel: req.adminAuthMethod === "api_token" ? "api_token" : "web",
      metadata: { method: req.method, path: safeRequestPath(req.originalUrl) },
    });
    return next(new AuthorizationError(permission));
  };
}
