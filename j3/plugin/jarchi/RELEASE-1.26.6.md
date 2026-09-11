# Release 1.26.6

This release focuses on automatic-ticket editing, profile-completion correctness, and reliable ladder lifecycle notifications.

- Per-rule popup copy editor on the main automation screen.
- No separate role-permission panel.
- Profile-completed is transition-based and suppressed during initial registration writes.
- Seven-day advert-expiry warning removed.
- Ladder start detection reconciles real post meta after all JetEngine/plugin writes finish.
- Ladder expiry reminder uses the actual detected expiry and is scheduled 48 hours before it, with hourly reconciliation.
- Obsolete ladder-ended preset removed.
