import express from "express";
import { adminAuth } from "../../middleware/adminAuth.js";
import { adminRateLimit } from "../../middleware/rateLimit.js";
import { errorMiddleware } from "../../middleware/respond.js";
import { authRoutes } from "./auth.js";
import { clientRoutes } from "./clients.js";
import { publicationRoutes } from "./publications.js";
import { userRoutes } from "./users.js";
import { subscriptionRoutes, planRoutes, invoiceRoutes } from "./billing.js";
import { systemRoutes } from "./system.js";
import { aiAdminRoutes } from "./ai.js";

/**
 * /api/admin/*
 *
 * Auth routes handle their own authentication (login is public, the rest use
 * adminAuth internally). Everything below them requires an authenticated actor,
 * and each route declares the permission it needs — no scattered role checks.
 */
export const admin = express.Router();

admin.use(adminRateLimit());
admin.use("/auth", authRoutes);

admin.use(adminAuth());

// Lightweight identity endpoint for the Mini App. It intentionally carries no
// permission requirement so support/admin roles can discover their own role and
// let the frontend render only the sections they are actually allowed to use.
admin.get("/me", (req, res) => {
  res.json({ success: true, admin: req.admin || null });
});
admin.use("/clients", clientRoutes);
// `sites` kept as an alias so 1.2.0 automation against /api/admin/sites works.
admin.use("/sites", clientRoutes);
admin.use("/publications", publicationRoutes);
admin.use("/users", userRoutes);
admin.use("/subscriptions", subscriptionRoutes);
admin.use("/plans", planRoutes);
admin.use("/invoices", invoiceRoutes);
admin.use("/ai", aiAdminRoutes);
admin.use("/", systemRoutes);

admin.use(errorMiddleware);
