# Validation — Jarchi WordPress Plugin 1.23.1

## Regression target

Customer accounts with a Subscriber-like role were redirected to the site's account page when submitting a ticket, and no ticket was created.

## Root cause

The customer-facing create/reply/rating forms posted to `wp-admin/admin-post.php`. Sites that intentionally block non-admin users from `wp-admin` can redirect that request during `admin_init` before the Jarchi `admin_post_*` handler runs.

## Fix validation

- Customer create form posts to the public Jarchi ticket page.
- Customer reply form posts to the public Jarchi ticket page.
- Customer rating form posts to the public Jarchi ticket page.
- `template_redirect` dispatches `submit`, `reply`, and `rating` after normal WordPress authentication is available.
- Existing nonce validation remains in the original handlers.
- Successful ticket creation still redirects to the inbox with `jarchi_ticket_created=<id>` only after both the ticket and first message have been stored.
- A priority-0 `admin_init` compatibility bridge handles cached <=1.23.0 admin-post forms for ordinary customers before common wp-admin blockers.
- Staff/admin requests are not intercepted by the compatibility bridge.

## Static validation

- PHP syntax: 124 / 124 files passed `php -l`.
- JavaScript syntax: 10 / 10 files passed `node --check`.
- Source invariants confirm no customer create/reply/rating form uses `admin-post.php`.
- Frontend and legacy compatibility dispatch hooks are registered.

