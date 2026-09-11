# Jarchi 2.4.10

## Fixes

- Reconciles legacy production schemas that were marked migrated but lacked `site_field_catalog.created_at` and `subscriptions.updated_at`.
- Prevents the Super Admin **Fields** screen from returning HTTP 500 when an older catalog table is missing optional timestamp columns.
- Restores Bale Mini App launches to the main `/app/` entry that is already proven on this deployment, instead of maintaining a second Bale-only application document.
- Allows the main Mini App entry to be framed only for `platform=bale` and only by official Bale origins; Telegram/normal web framing remains denied.
- Keeps older Bale chat buttons functional by redirecting `/app/bale.html` to the main entry.

## Database

Migration `0017_legacy_schema_reconciliation.sql` is additive and idempotent. It adds missing timestamp columns only if absent.
