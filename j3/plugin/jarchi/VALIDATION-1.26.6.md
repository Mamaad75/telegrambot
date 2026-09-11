# Validation 1.26.6

Static validation performed for the installable package:

- PHP lint over every PHP file.
- Registered `$this` action/filter callbacks checked against declared methods.
- Main automation screen contains a per-rule `ویرایش` button and a single copy-only modal.
- The old Designer permission section is absent.
- No built-in `post_expiring_soon` trigger/preset remains; the 1.26.6 migration deletes legacy rules and clears its scheduled hook.
- Profile registration is marked `initializing` and baseline state is finalized at shutdown without dispatching `profile_completed`.
- Bump meta writes are deferred and reconciled once per post at shutdown; internal `_wpep_*` meta is excluded from recursion.
- `post_bump_expiring` remains enabled and hourly reconciliation reschedules the 48-hour reminder from real detected expiry meta.
