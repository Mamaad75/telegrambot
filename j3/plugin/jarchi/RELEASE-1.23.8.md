# Jarchi 1.23.8

Production hardening release for the customer ticket surface.

## Fixed
- Private/no-store ticket pages and WP Rocket exclusion/purge.
- Just-in-time front-form nonce refresh to prevent stale cached nonce failures.
- Attachment limits now respect the PHP/WordPress server ceiling and selected files have visual previews.
- Ticket create/reply redirects stay on the designer-owned host page and force one fresh render.
- Announcement unread state is independent from ticket unread and is persisted per user.
- Ticket backend events include top-level `post_id` and contract version.
- Legacy ladder custom-event presets are repaired.
- Added one-click safe standard automation pack.

## Intentionally not automatic
Profile scan rules are not enabled on upgrade because doing so on an existing production site can create a large number of historic tickets. Ad-expiry / 7-day reminders still require a reliable expiry source (for example the site's PublishPress Future workflow or an explicit Jarchi custom event).
