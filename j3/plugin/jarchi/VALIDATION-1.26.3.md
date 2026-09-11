# Validation 1.26.3

- Plugin version and stable tag are 1.26.3.
- Standard pack provisions/enables both `post-bumped` and `post-bump-expiring`.
- Built-in `post-bump-ended` preset-derived rules are disabled by the 1.26.3 upgrader and are not re-enabled by the standard pack.
- Future ladder expiry meta changes invoke `post_bumped`; Jarchi schedules one `jarchi_bump_expiry_reminder` at expiry minus two days.
- Stale reminder cycles are replaced when the same advert is bumped again with a new expiry.
- Ladder event ledger object IDs include `post_id:expiry_timestamp`, preventing duplicates within a cycle while allowing later cycles.
- Internal `_wpep_bump_reminder_expiry` meta is excluded from bump detection to prevent recursion.
