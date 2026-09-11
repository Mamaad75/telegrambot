import express from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { customerApiRateLimit } from "../middleware/rateLimit.js";
import { handler, errorMiddleware } from "../middleware/respond.js";
import { createLinkChallenge, getUnifiedAccount, unlinkIdentity } from "../services/unifiedIdentity.js";

export const accountRoutes = express.Router();

/*
 * Scoped to the paths this router actually serves.
 *
 * This router is mounted at /api alongside several others, so an unscoped
 * `use()` here runs for every /api request — including /api/admin/auth/login
 * and /api/admin/*, which authenticate as an operator and not as a Mini App
 * customer. Those callers have no customer session, so customerAuth answered
 * 401 "Authentication required" before the admin router was ever reached, and
 * the whole Super Admin API was unreachable from a browser.
 */
accountRoutes.use("/account", customerAuth, customerApiRateLimit());

accountRoutes.get("/account/identities", handler(async (req, res) => {
  return res.json({ success: true, account: await getUnifiedAccount(req.user.id) });
}));

accountRoutes.post("/account/identities/link", handler(async (req, res) => {
  const target = String(req.body?.target_platform || "").trim().toLowerCase();
  const result = await createLinkChallenge(req.user.id, req.authPlatform, target);
  return res.status(201).json({ success: true, ...result });
}));

accountRoutes.delete("/account/identities/:platform", handler(async (req, res) => {
  const result = await unlinkIdentity(req.user.id, req.params.platform);
  return res.json({ success: true, ...result });
}));

accountRoutes.use(errorMiddleware);
