# Jarchi 1.25.0

Merged production release combining the two divergent 1.23.8/1.24.0 lines.

## Ticket reliability
- Keeps the account-private no-cache/WP Rocket exclusion, fresh nonce before writes, safe PRG refresh and attachment previews.
- Keeps independent announcement and ticket unread badges.
- Keeps strict ticket webhook payloads with top-level `post_id`.
- Keeps the repaired custom-event/bump automations and the safe standard automation pack.

## Support inbox
- Restores semantic sender/receiver direction for customer, admin and automatic tickets.
- Automatic tickets identify their support department as the visible sender.
- Ready-made automation presets create/resolve their intended department automatically; existing preset rules without a department are repaired once.
- Customer ticket lists use a compact table-like desktop layout while mobile/narrow Elementor slots remain card-based.
- WordPress admin pagination is styled as a proper horizontal pager rather than a raw vertical list.

## Designer and settings UX
- Keeps the 1.24.0 nested ticket navigation groups.
- Ticket category remains hidden by default and can be enabled globally or overridden per Elementor widget/shortcode.
- FAQ has one source of truth again: the dedicated FAQ screen. Saving Advanced cannot erase FAQ entries.

## Zero-config defaults
- On 1.25.0 upgrade, missing safe event-driven rules (welcome, ad approved, ad rejected, comment reply) are provisioned once. Existing rules are not forcibly re-enabled or overwritten.
- Scheduled profile scans are still not auto-enabled, preventing bulk messages to historical users.
