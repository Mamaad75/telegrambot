import type { Role } from './enums';

/**
 * Permission matrix. The API enforces these; the web app uses the same table to hide
 * controls the user cannot use, so the two never disagree.
 */
export const PERMISSIONS = [
  'lead:read:all',
  'lead:read:assigned',
  'lead:create',
  'lead:update',
  'lead:delete',
  'lead:assign',
  'lead:import',
  'lead:export',
  'lead:run_audit',
  'lead:run_ai',
  'campaign:read',
  'campaign:create',
  'campaign:run',
  'campaign:delete',
  'crm:write',
  'market:read',
  'market:import',
  'report:read',
  'user:read',
  'user:manage',
  'settings:read',
  'settings:write',
  'provider:read',
  'provider:write',
  'audit_log:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SALESPERSON: Permission[] = [
  'lead:read:assigned',
  'lead:update',
  'lead:export',
  'crm:write',
  'market:read',
  'report:read',
];

const SALES_MANAGER: Permission[] = [
  ...SALESPERSON,
  'lead:read:all',
  'lead:create',
  'lead:assign',
  'lead:import',
  'lead:run_audit',
  'lead:run_ai',
  'campaign:read',
  'campaign:create',
  'campaign:run',
  'market:import',
  'user:read',
  'settings:read',
  'provider:read',
];

const ADMIN: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SALESPERSON: SALESPERSON,
  SALES_MANAGER: SALES_MANAGER,
  ADMIN: ADMIN,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** True when the role may only see leads assigned to them. */
export function isRestrictedToAssigned(role: Role): boolean {
  return can(role, 'lead:read:assigned') && !can(role, 'lead:read:all');
}

export const ROLE_LABELS: Record<Role, { fa: string; en: string }> = {
  ADMIN: { fa: 'مدیر سیستم', en: 'Administrator' },
  SALES_MANAGER: { fa: 'مدیر فروش', en: 'Sales manager' },
  SALESPERSON: { fa: 'کارشناس فروش', en: 'Salesperson' },
};
