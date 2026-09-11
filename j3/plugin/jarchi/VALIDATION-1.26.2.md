# Validation 1.26.2

- PHP syntax check passed for modified files: `includes/class-ticket-automations.php`, `includes/class-tickets.php`, and `wp-event-publisher.php`.
- `comment_on_post` remains deduplicated by comment id through the automation ledger.
- `comment_reply` is now gated by approval both on insert and on later status transition.
- WordPress core post-author comment notification recipients are filtered only for public, non-built-in advert-like post types, so ticket/comment records owned by the plugin are unaffected.
- Back icon path now points to the opposite direction from 1.26.1.
