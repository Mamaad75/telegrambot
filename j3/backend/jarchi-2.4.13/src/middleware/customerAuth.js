import { config } from "../config.js";
import { validateTelegramInitData } from "../auth/telegram.js";
import { validateBaleInitData } from "../auth/bale.js";
import { upsertIdentity, getUserBySession } from "../services/users.js";
import { ensureTrial } from "../services/billing.js";
import { getSite } from "../services/clients.js";
import { query } from "../db/db.js";

function cookieValue(req, name) {
  const raw = String(req.get("Cookie") || "");
  for (const chunk of raw.split(";")) {
    const [key, ...rest] = chunk.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return "";
}

function setCustomerSessionCookie(req, res, token) {
  if (!token || !res || typeof res.setHeader !== "function") return;
  const secure = config.env === "production" ? "; Secure" : "";
  const sameSite = "; SameSite=Lax";
  const value = `${config.customerSessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}${sameSite}; Max-Age=${24 * 60 * 60}`;
  if (typeof res.append === "function") res.append("Set-Cookie", value);
  else res.setHeader("Set-Cookie", value);
}

export async function authenticateCustomer(req, res) {
  const bearer = req.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const cookie = cookieValue(req, config.customerSessionCookieName);
  const querySession = String(req.query?.session || "").trim();
  const bodySession = String(req.body?.session || "").trim();
  const candidates = [...new Set([bearer, cookie, bodySession, querySession].filter(Boolean))];
  for (const token of candidates) {
    const user = await getUserBySession(token);
    if (user) {
      // A launch token supplied in the request body/query is being exchanged
      // into a first-party cookie. Set it even when the same token also arrived
      // as a legacy Bearer header; older Mini App builds sent both.
      if (token === querySession || token === bodySession) setCustomerSessionCookie(req, res, token);
      return { user, platform: user.platform || "session", sessionToken: token };
    }
  }

  const telegramInit = req.get("X-Telegram-Init-Data") || "";
  const baleInit = req.get("X-Bale-Init-Data") || "";
  const bodyInit = req.body?.initData || "";

  if (telegramInit || baleInit || bodyInit) {
    let platform = "";
    let profile = null;
    if (telegramInit) {
      platform = "telegram";
      profile = validateTelegramInitData(telegramInit, config.telegram.token);
    } else {
      platform = "bale";
      profile = validateBaleInitData(
        baleInit || bodyInit,
        config.bale.token,
        config.bale.miniAppInitDataMaxAgeSeconds,
      );
    }
    const user = await upsertIdentity(platform, profile.id, {
      display_name: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
      username: profile.username || "",
    });
    if (user.status !== "active") throw new Error("این حساب غیرفعال شده است");
    if (config.autoTrialOnStart) await ensureTrial(user.id);
    return { user, platform };
  }
  return null;
}

export async function customerAuth(req, res, next) {
  try {
    const resolved = await authenticateCustomer(req, res);
    if (!resolved) return res.status(401).json({ success: false, error: "Authentication required" });
    req.user = resolved.user;
    req.authPlatform = resolved.platform;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: error.message });
  }
}

export async function requireOwnedSite(req, res, siteId, { roles = null } = {}) {
  const id = String(siteId || "").trim();
  if (req.site && String(req.site.id) === id && (!roles || roles.includes(req.siteRole))) return req.site;
  if (!id) {
    res.status(400).json({ success: false, error: "site_id is required" });
    return null;
  }
  const site = await getSite(id);
  if (!site) {
    res.status(404).json({ success: false, error: "Site not found" });
    return null;
  }
  if (String(site.owner_user_id ?? "") !== String(req.user.id)) {
    const member = await getSiteMember(site.id, req.user.id);
    if (!member) {
      res.status(403).json({ success: false, error: "Site access denied" });
      return null;
    }
    req.siteRole = member.role;
  } else {
    req.siteRole = "owner";
  }
  if (roles && !roles.includes(req.siteRole)) {
    res.status(403).json({ success: false, error: "دسترسی شما برای این عملیات کافی نیست", error_code: "site_role_forbidden" });
    return null;
  }
  req.site = site;
  return site;
}

export async function assertSiteRole(userId, siteId, roles = []) {
  const site = await getSite(siteId);
  if (!site) { const e = new Error("Site not found"); e.status = 404; e.code = "not_found"; throw e; }
  let role = "";
  if (String(site.owner_user_id ?? "") === String(userId)) role = "owner";
  else role = (await getSiteMember(site.id, userId))?.role || "";
  if (!roles.includes(role)) { const e = new Error("Site role forbidden"); e.status = 403; e.code = "site_role_forbidden"; throw e; }
  return { site, role };
}

async function getSiteMember(siteId, userId) {
  return (await query(
    `SELECT role,status FROM site_members WHERE site_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [String(siteId), Number(userId)],
  )).rows[0] || null;
}
