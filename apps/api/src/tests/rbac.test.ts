import { describe, expect, it } from 'vitest';
import { ROLES, ROLE_PERMISSIONS, can, isRestrictedToAssigned } from '@baimar/shared';

/**
 * The API and the web app share this matrix. If they ever diverge, the UI would offer
 * controls the server rejects — so the contract is asserted here directly.
 */
describe('role-based access control', () => {
  it('gives the administrator every permission', () => {
    for (const permission of ROLE_PERMISSIONS.ADMIN) {
      expect(can('ADMIN', permission)).toBe(true);
    }
  });

  it('restricts a salesperson to their own leads', () => {
    expect(can('SALESPERSON', 'lead:read:assigned')).toBe(true);
    expect(can('SALESPERSON', 'lead:read:all')).toBe(false);
    expect(isRestrictedToAssigned('SALESPERSON')).toBe(true);
    expect(isRestrictedToAssigned('SALES_MANAGER')).toBe(false);
    expect(isRestrictedToAssigned('ADMIN')).toBe(false);
  });

  it('keeps destructive and configuration powers away from non-administrators', () => {
    for (const role of ['SALESPERSON', 'SALES_MANAGER'] as const) {
      expect(can(role, 'settings:write')).toBe(false);
      expect(can(role, 'user:manage')).toBe(false);
      expect(can(role, 'lead:delete')).toBe(false);
      expect(can(role, 'audit_log:read')).toBe(false);
      expect(can(role, 'provider:write')).toBe(false);
    }
  });

  it('lets a sales manager run the pipeline but not reconfigure the platform', () => {
    expect(can('SALES_MANAGER', 'campaign:run')).toBe(true);
    expect(can('SALES_MANAGER', 'lead:assign')).toBe(true);
    expect(can('SALES_MANAGER', 'lead:run_ai')).toBe(true);
    expect(can('SALES_MANAGER', 'settings:read')).toBe(true);
    expect(can('SALES_MANAGER', 'settings:write')).toBe(false);
  });

  it('grants every role the ability to do their own CRM work', () => {
    for (const role of ROLES) {
      expect(can(role, 'crm:write')).toBe(true);
      expect(can(role, 'market:read')).toBe(true);
    }
  });

  it('never grants a permission that does not exist in the catalogue', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(ROLE_PERMISSIONS.ADMIN).toContain(permission);
      }
    }
  });
});
