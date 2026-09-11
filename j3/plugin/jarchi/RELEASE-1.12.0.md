# Jarchi 1.12.0

## Customer Hub
- Auto-created `مرکز کاربری جارچی` page at `/jarchi-account/`.
- Logged-in customer hub combines announcements, unread ticket counters, account overview and full ticket center.
- New Elementor widget: `مرکز کاربری جارچی` with text, color, layout, shadow and typography controls.
- Existing `[jarchi_customer_hub]` shortcode retained for backwards compatibility.

## Ticket security and scale
- Mini App customer ticket API is now scoped by customer identity instead of exposing site-wide tickets.
- Customer replies use user semantics and correctly mark support unread state.
- Customer mark-read updates the customer unread flag.
- Backend ticket reads use a short TTL cache with in-flight request coalescing.
- Customer ticket API rate limiting is keyed by authenticated customer instead of shared IP.
- Default PostgreSQL pool increased to 20 and remains configurable.
- Polling interval on front-end ticket badge reduced to lower WordPress load while refreshing immediately on tab visibility.

## Load testing
- Added `tools/load-test-500.mjs` for a 500-user HTTP smoke/load run.
- The full production load test requires a deployed backend with PostgreSQL and real secrets; this artifact is the repeatable harness for that environment.
