import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, PERMISSIONS, can, permissionsForRole } from "../src/core/rbac.js";

test("site-support/global-support separation is explicit", () => {
  assert.ok(ROLES.includes("support"));
  const p = new Set(permissionsForRole("support"));
  assert.equal(p.has(PERMISSIONS.TICKETS_VIEW), true);
  assert.equal(p.has(PERMISSIONS.TICKETS_REPLY), true);
  assert.equal(p.has(PERMISSIONS.TICKETS_MANAGE), true);
  assert.equal(p.has(PERMISSIONS.TICKET_AGENTS_MANAGE), false);
  assert.equal(p.has(PERMISSIONS.CLIENTS_UPDATE), false);
});

test("support is never granted administrator management", () => {
  const actor = { role: "support", status: "active" };
  assert.equal(can(actor, PERMISSIONS.ADMINS_MANAGE), false);
  assert.equal(can(actor, PERMISSIONS.CLIENTS_ROTATE_SECRET), false);
});
