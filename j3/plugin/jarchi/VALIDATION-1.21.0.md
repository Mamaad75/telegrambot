# Validation — Jarchi WordPress Plugin 1.21.0

- PHP syntax scan: **124/124** PHP files passed `php -l`.
- JavaScript syntax scan: **10/10** JS files passed `node --check`.
- Elementor migration is intentionally narrow: only Elementor Shortcode widgets whose complete value is `[jarchi_tickets]`, `[jarchi_tickets view="list"]`, or `[jarchi_tickets view="new"]` are converted; surrounding Elementor layout/settings are preserved.
- Runtime field discovery is primed from real posts in the active mapping scope and merged into the request registry before mapping validation/save.
- Contact privacy: the account-owner phone is carried independently as Contract 1.4 `contact_phone`; the ordinary listing `phone` field retains its own mapping/visibility policy.
