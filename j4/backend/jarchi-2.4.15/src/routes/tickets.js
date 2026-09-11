import express from "express";
import { customerAuth, requireOwnedSite } from "../middleware/customerAuth.js";
import { requireSiteRole } from "../middleware/siteRole.js";
import { customerApiRateLimit } from "../middleware/rateLimit.js";
import * as tickets from "../services/wordpressTickets.js";
import { handler } from "../middleware/respond.js";
import { requireRemoteFeatureForSite } from "../middleware/siteEntitlement.js";

export const ticketRoutes = express.Router();

const site = async (req, res) => requireOwnedSite(req, res, req.params.siteId || req.body?.site_id);
const ensureRole = (req, res, roles) => { if (roles.includes(req.siteRole)) return true; res.status(403).json({ success:false, error:"دسترسی شما برای این عملیات کافی نیست", error_code:"site_role_forbidden" }); return false; };

// Mounted at /api, so the guard is bound to the ticket paths themselves. An
// unscoped use() would demand a customer session and the remote_tickets
// entitlement from every other /api route, admin ones included.
ticketRoutes.use(
  [
    "/sites/:siteId/tickets",
    "/sites/:siteId/ticket-agents",
    "/sites/:siteId/ticket-meta",
    "/sites/:siteId/ticket-canned-replies",
    "/sites/:siteId/ticket-unread",
  ],
  customerAuth,
  customerApiRateLimit(),
  requireRemoteFeatureForSite("remote_tickets"),
);

ticketRoutes.get("/sites/:siteId/tickets", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json({ success: true, ...(await tickets.listTickets(target, { ...req.query, customer_email: req.user.email || '' })) });
}));

ticketRoutes.get("/sites/:siteId/tickets/:ticketId", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json({ success: true, ...(await tickets.getTicket(target, req.params.ticketId, { customer_email: req.user.email || '' })) });
}));

ticketRoutes.post("/sites/:siteId/tickets/:ticketId/reply", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json({ success: true, ...(await tickets.replyTicket(target, req.params.ticketId, {
    body: String(req.body?.body || ""),
    customer_email: String(req.user?.email || ''),
    scope: 'customer',
    agent_name: String(req.body?.agent_name || req.user.display_name || "پشتیبان جارچی"),
  })) });
}));

ticketRoutes.post("/sites/:siteId/tickets/:ticketId/status", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json({ success: true, ...(await tickets.setTicketStatus(target, req.params.ticketId, String(req.body?.status || "waiting"), { customer_email: req.user.email || '', scope: 'customer' })) });
}));

ticketRoutes.post("/sites/:siteId/tickets/:ticketId/assign", handler(async (req, res) => {
  const target = await site(req, res); if (!target || !ensureRole(req,res,["owner","admin"])) return;
  res.json({ success: true, ...(await tickets.assignTicket(target, req.params.ticketId, Number(req.body?.user_id || 0))) });
}));

ticketRoutes.post("/sites/:siteId/tickets/:ticketId/rating", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json({ success: true, ...(await tickets.rateTicket(target, req.params.ticketId, {
    customer_email: String(req.user?.email || ""),
    rating: Number(req.body?.rating || 0),
    comment: String(req.body?.comment || ""),
  })) });
}));

// Customer Mini App may create a ticket only when a WordPress customer mapping
// is present. Never trust a client-supplied customer_id; the backend must resolve
// the current WordPress identity before using this endpoint. Until that mapping
// exists, creation is intentionally disabled rather than allowing impersonation.
ticketRoutes.post("/sites/:siteId/tickets", handler(async (req, res) => {
  const target = await site(req, res); if (!target || !ensureRole(req,res,["owner","admin"])) return;
  const user = req.user || {};
  const body = {
    scope: "customer",
    subject: String(req.body?.subject || ""),
    body: String(req.body?.body || ""),
    // Never accept a browser-supplied WordPress customer identity. Until a
    // first-class WP customer mapping exists, only server-owned profile data is
    // forwarded. The current Mini App does not send these identity fields.
    customer_id: 0,
    customer_email: String(user.email || ""),
    customer_phone: String(user.phone || ""),
    priority: String(req.body?.priority || "normal"),
    department: Number(req.body?.department || 0) || 0,
    category: Number(req.body?.category || 0) || 0,
    custom_fields: (req.body?.custom_fields && typeof req.body.custom_fields === "object") ? req.body.custom_fields : {},
    sender_type: "user",
    sender_name: String(user.display_name || user.username || "کاربر جارچی"),
  };
  res.status(201).json({ success: true, ...(await tickets.createTicket(target, body)) });
}));

ticketRoutes.get("/sites/:siteId/ticket-agents", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json(await tickets.listAgents(target));
}));

ticketRoutes.post("/sites/:siteId/ticket-agents", handler(async (req, res) => {
  const target = await site(req, res); if (!target || !ensureRole(req,res,["owner","admin"])) return;
  res.json(await tickets.updateAgent(target, Number(req.body?.user_id || 0), String(req.body?.action || "add")));
}));

ticketRoutes.get("/sites/:siteId/ticket-meta", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json(await tickets.listTicketMeta(target));
}));

ticketRoutes.get("/sites/:siteId/ticket-canned-replies", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json(await tickets.listCannedReplies(target));
}));

ticketRoutes.get("/sites/:siteId/ticket-unread", handler(async (req, res) => {
  const target = await site(req, res); if (!target) return;
  res.json(await tickets.getUnread(target, { customer_email: req.user.email || "" }));
}));
