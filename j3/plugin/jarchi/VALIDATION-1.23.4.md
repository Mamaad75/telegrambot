# Validation — Jarchi 1.23.4

- PHP syntax lint for all plugin PHP files.
- Automatic-ticket preset migration is limited to rules carrying `from_preset=post-approved|post-rejected`; manually authored `post` rules are not changed.
- Publication detection is idempotent through the existing AutomationLedger even though both `transition_post_status` and `wp_after_insert_post` may observe the same approval.
- Admin search resolves IDs before WP_Query and then keeps the existing status/taxonomy scope filters, so support-agent department restrictions remain effective.
- Ticket URL configuration is same-origin validated. The removed `/jarchi-tickets/` path is no longer generated.
