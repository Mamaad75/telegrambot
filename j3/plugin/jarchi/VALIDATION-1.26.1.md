# Validation 1.26.1

Validated on the packaged source before release:

- PHP syntax: **124/124 PHP files passed** `php -l`.
- Front-end JS syntax: **3/3 asset JavaScript files passed** `node --check` (including `assets/js/tickets.js`).
- Static regression suite: **67/67 checks passed** for versioning, automation triggers/presets/tokens, PublishPress Future integration, automated email, backend `post_id`, safe nonce redirect, attachment preview, independent ticket badge selectors, WP Rocket no-cache handling, and embedded Ticket Center return URLs.
- Profile completion is event-driven (`updated_user_meta` / `added_user_meta` / `profile_update`) and is **not** included in the legacy-user hourly scan.
- PublishPress Future: official schedule/expired hooks plus `_expiration-date` reminder fallback are present.
- Customer stale nonce: create/reply/rating paths return to the same Ticket Center and render an inline retry message rather than WordPress `wp_nonce_ays()` / expired-link UI.
- Backend event contract: ticket events include top-level `post_id`, alias `id`, and structured `post.id`.
- Cache regression guard: configured ticket URL plus pages embedding `[jarchi_tickets]` or Elementor `jarchi_ticket_center` are rejected from WP Rocket cache; `render_center()` always applies private/no-store semantics and the 1.26.1 migration purges already-cached direct Ticket Center surfaces once.
