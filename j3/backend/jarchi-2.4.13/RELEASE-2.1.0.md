# Jarchi Backend 2.1.0

- Paid Mini App entitlements are now site-aware. Active site members inherit the site owner\'s active paid plan automatically.
- Trial accounts never receive remote features.
- `/api/sites` returns per-site entitlement snapshots.
- `/api/entitlements/:siteId` exposes lock state so the Mini App can show paywalls without granting access.
- Remote tickets/products/site-control routes enforce site-scoped entitlement.
- Remote announcements endpoint is gated by `remote_announcements`.
- Mini App refreshes subscription/site entitlements automatically after checkout and on tab resume.
- Paid access is activated immediately by the payment verification flow; no manual admin toggle is required.
