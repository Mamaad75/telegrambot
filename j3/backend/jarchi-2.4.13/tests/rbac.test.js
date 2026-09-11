import test from "node:test";
import assert from "node:assert/strict";
import { can, canAll, canAny, assertCan, permissionsForRole, isRole, ROLES, PERMISSIONS, AuthorizationError } from "../src/core/rbac.js";

const actor = (role, status = "active") => ({ role, status });

test("every role is known and has a permission set", () => {
  assert.deepEqual(ROLES, ["super_admin", "admin", "support", "viewer"]);
  for (const role of ROLES) assert.ok(permissionsForRole(role).length > 0, role);
  assert.equal(isRole("root"), false);
  assert.deepEqual(permissionsForRole("root"), []);
});

test("permissions grow monotonically from viewer to super_admin", () => {
  const viewer = new Set(permissionsForRole("viewer"));
  const support = new Set(permissionsForRole("support"));
  const admin = new Set(permissionsForRole("admin"));
  const superAdmin = new Set(permissionsForRole("super_admin"));

  for (const permission of viewer) assert.ok(support.has(permission), `support missing ${permission}`);
  for (const permission of support) assert.ok(admin.has(permission), `admin missing ${permission}`);
  for (const permission of admin) assert.ok(superAdmin.has(permission), `super_admin missing ${permission}`);
});

test("viewer is read-only", () => {
  const viewer = actor("viewer");
  assert.equal(can(viewer, PERMISSIONS.CLIENTS_VIEW), true);
  assert.equal(can(viewer, PERMISSIONS.PUBLICATIONS_VIEW), true);
  assert.equal(can(viewer, PERMISSIONS.CLIENTS_CREATE), false);
  assert.equal(can(viewer, PERMISSIONS.PUBLICATIONS_RETRY), false);
  assert.equal(can(viewer, PERMISSIONS.SUBSCRIPTIONS_MANAGE), false);
  assert.equal(can(viewer, PERMISSIONS.USERS_PHONE_VIEW), false);
});

test("support gets limited customer-support actions but no client management", () => {
  const support = actor("support");
  assert.equal(can(support, PERMISSIONS.PUBLICATIONS_RETRY), true);
  assert.equal(can(support, PERMISSIONS.USERS_SESSIONS_REVOKE), true);
  assert.equal(can(support, PERMISSIONS.PLATFORMS_TEST), true);
  assert.equal(can(support, PERMISSIONS.CLIENTS_UPDATE), false);
  assert.equal(can(support, PERMISSIONS.CLIENTS_ROTATE_SECRET), false);
  assert.equal(can(support, PERMISSIONS.USERS_PHONE_VIEW), false);
  assert.equal(can(support, PERMISSIONS.AUDIT_VIEW), false);
});

test("admin manages the business but not administrators", () => {
  const admin = actor("admin");
  assert.equal(can(admin, PERMISSIONS.CLIENTS_CREATE), true);
  assert.equal(can(admin, PERMISSIONS.CLIENTS_ROTATE_SECRET), true);
  assert.equal(can(admin, PERMISSIONS.SUBSCRIPTIONS_MANAGE), true);
  assert.equal(can(admin, PERMISSIONS.PLANS_MANAGE), true);
  assert.equal(can(admin, PERMISSIONS.USERS_PHONE_VIEW), true);
  assert.equal(can(admin, PERMISSIONS.ADMINS_MANAGE), false);
  assert.equal(can(admin, PERMISSIONS.SETTINGS_MANAGE), false);
});

test("super_admin holds every declared permission", () => {
  const superAdmin = actor("super_admin");
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(can(superAdmin, permission), true, `super_admin missing ${permission}`);
  }
});

test("inactive accounts lose every permission regardless of role", () => {
  assert.equal(can(actor("super_admin", "disabled"), PERMISSIONS.DASHBOARD_VIEW), false);
  assert.equal(can(actor("admin", "inactive"), PERMISSIONS.CLIENTS_VIEW), false);
  assert.equal(can(null, PERMISSIONS.DASHBOARD_VIEW), false);
  assert.equal(can(undefined, PERMISSIONS.DASHBOARD_VIEW), false);
});

test("unknown permissions are denied, not defaulted", () => {
  assert.equal(can(actor("super_admin"), "clients.delete_everything"), false);
});

test("canAll / canAny / assertCan", () => {
  const support = actor("support");
  assert.equal(canAll(support, [PERMISSIONS.CLIENTS_VIEW, PERMISSIONS.PUBLICATIONS_RETRY]), true);
  assert.equal(canAll(support, [PERMISSIONS.CLIENTS_VIEW, PERMISSIONS.CLIENTS_CREATE]), false);
  assert.equal(canAny(support, [PERMISSIONS.CLIENTS_CREATE, PERMISSIONS.PUBLICATIONS_RETRY]), true);
  assert.throws(() => assertCan(support, PERMISSIONS.CLIENTS_CREATE), AuthorizationError);
  assert.doesNotThrow(() => assertCan(support, PERMISSIONS.CLIENTS_VIEW));
});
