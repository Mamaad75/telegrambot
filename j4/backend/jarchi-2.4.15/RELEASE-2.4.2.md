# Jarchi 2.4.2

## Fixes
- Fix admin manual subscription grant failing on installations whose `subscriptions` table has no `updated_at` column.
- Expand Super Admin user management: inspect identities, subscriptions, owned sites, site memberships, suspend/activate users, revoke sessions, grant plans, and grant site access.
- Keep all user-management operations audited.
