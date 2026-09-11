/**
 * Centralized authorization model.
 *
 * Every admin surface — HTTP routes and Telegram callbacks alike — asks this
 * module "may this actor do X?". Route handlers and bot handlers never carry
 * their own role conditions.
 */

export const ROLES = Object.freeze(["super_admin", "admin", "support", "viewer"]);

export const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: "dashboard.view",

  CLIENTS_VIEW: "clients.view",
  CLIENTS_CREATE: "clients.create",
  CLIENTS_UPDATE: "clients.update",
  CLIENTS_DISABLE: "clients.disable",
  CLIENTS_ROTATE_SECRET: "clients.rotate_secret",
  CLIENTS_SECRET_VIEW: "clients.secret_view",

  PLATFORMS_VIEW: "platforms.view",
  PLATFORMS_UPDATE: "platforms.update",
  PLATFORMS_TEST: "platforms.test",

  WEBHOOKS_VIEW: "webhooks.view",

  PUBLICATIONS_VIEW: "publications.view",
  PUBLICATIONS_RETRY: "publications.retry",

  FIELDS_VIEW: "fields.view",
  /** Renaming, reordering or hiding a field changes what gets published. */
  FIELDS_MANAGE: "fields.manage",

  USERS_VIEW: "users.view",
  USERS_UPDATE: "users.update",
  USERS_SESSIONS_REVOKE: "users.sessions.revoke",
  /** Seeing an advertiser/customer phone number is its own permission. */
  USERS_PHONE_VIEW: "users.phone.view",

  SUBSCRIPTIONS_VIEW: "subscriptions.view",
  SUBSCRIPTIONS_MANAGE: "subscriptions.manage",

  PLANS_VIEW: "plans.view",
  PLANS_MANAGE: "plans.manage",

  INVOICES_VIEW: "invoices.view",

  AUDIT_VIEW: "audit.view",

  ADMINS_VIEW: "admins.view",
  ADMINS_MANAGE: "admins.manage",

  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",

  /** AI product automation: inspection is read-only; manage can retry/cancel. */
  AI_VIEW: "ai.view",
  AI_MANAGE: "ai.manage",

  TICKETS_VIEW: "tickets.view",
  TICKETS_REPLY: "tickets.reply",
  TICKETS_MANAGE: "tickets.manage",
  TICKETS_CREATE: "tickets.create",
  TICKET_AGENTS_MANAGE: "ticket_agents.manage",
});

const P = PERMISSIONS;

const VIEWER = Object.freeze([
  P.DASHBOARD_VIEW,
  P.CLIENTS_VIEW,
  P.PLATFORMS_VIEW,
  P.WEBHOOKS_VIEW,
  P.PUBLICATIONS_VIEW,
  P.FIELDS_VIEW,
  P.USERS_VIEW,
  P.SUBSCRIPTIONS_VIEW,
  P.PLANS_VIEW,
  P.INVOICES_VIEW,
  P.AI_VIEW,
  P.TICKETS_VIEW,
]);

/** Support keeps viewer's reach plus the customer-support actions. */
const SUPPORT = Object.freeze([
  ...VIEWER,
  P.PUBLICATIONS_RETRY,
  P.USERS_SESSIONS_REVOKE,
  P.PLATFORMS_TEST,
  P.TICKETS_REPLY,
  P.TICKETS_MANAGE,
]);

/** Admin runs the business day to day but cannot manage administrators. */
const ADMIN = Object.freeze([
  ...SUPPORT,
  P.CLIENTS_CREATE,
  P.CLIENTS_UPDATE,
  P.CLIENTS_DISABLE,
  P.CLIENTS_ROTATE_SECRET,
  P.CLIENTS_SECRET_VIEW,
  P.PLATFORMS_UPDATE,
  P.FIELDS_MANAGE,
  P.USERS_UPDATE,
  P.USERS_PHONE_VIEW,
  P.SUBSCRIPTIONS_MANAGE,
  P.PLANS_MANAGE,
  P.AUDIT_VIEW,
  P.SETTINGS_VIEW,
  P.AI_MANAGE,
  P.TICKETS_CREATE,
  P.TICKET_AGENTS_MANAGE,
]);

const ROLE_PERMISSIONS = Object.freeze({
  viewer: new Set(VIEWER),
  support: new Set(SUPPORT),
  admin: new Set(ADMIN),
  super_admin: new Set([
    ...ADMIN,
    P.ADMINS_VIEW,
    P.ADMINS_MANAGE,
    P.SETTINGS_MANAGE,
  ]),
});

export function isRole(role) {
  return ROLES.includes(String(role || ""));
}

export function permissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[String(role || "")] || [])].sort();
}

/** The single authorization predicate used by every admin surface. */
export function can(actor, permission) {
  if (!actor || actor.status === "disabled" || actor.status === "inactive") return false;
  const granted = ROLE_PERMISSIONS[String(actor.role || "")];
  return Boolean(granted && granted.has(permission));
}

export function canAll(actor, permissions = []) {
  return permissions.every((permission) => can(actor, permission));
}

export function canAny(actor, permissions = []) {
  return permissions.some((permission) => can(actor, permission));
}

export class AuthorizationError extends Error {
  constructor(permission) {
    super(`Missing permission: ${permission}`);
    this.name = "AuthorizationError";
    this.status = 403;
    this.code = "forbidden";
    this.permission = permission;
  }
}

export function assertCan(actor, permission) {
  if (!can(actor, permission)) throw new AuthorizationError(permission);
}

/** Roles an actor is allowed to assign — nobody may create a peer above them. */
export function assignableRoles(actor) {
  if (can(actor, P.ADMINS_MANAGE)) return [...ROLES];
  return [];
}
