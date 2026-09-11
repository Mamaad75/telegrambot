# Release 1.26.4

- Fixes the wp-admin Critical Error caused by the registered but missing `upgrade_standard_pack_1262_comments()` callback.
- Restores the comment automation migration in an idempotent form.
- Keeps the 1.26.3 ladder activation and two-days-before-expiry reminder logic.
- Package root folder is now `jarchi` instead of `wp-event-publisher`.
- Keeps all 1.26.2 comment/reply, email dedupe and RTL back-arrow fixes.
