# Validation — Jarchi WordPress Plugin 1.20.0

Validation performed before packaging:

- PHP syntax lint: all 124 PHP files passed `php -l`.
- JavaScript syntax: all 10 JS files under `assets/` and `admin/` passed `node --check`.
- Version consistency: plugin header and `WPEP_VERSION` are `1.20.0`.
- Field Mapping route: assets explicitly load for the centralized `page=wp-event-publisher&jarchi_view=fields` route.
- Runtime field path: publication resolves the effective mapping against `discover_for_post()` so actual post meta can survive global discovery misses.
- Ticket badge SQL: counts distinct ticket IDs to avoid duplicate postmeta inflating the badge.
- User ticket flow: main list and new-ticket view are separate; FAQ gate and dedicated new-ticket URL are present.
- Customer hub: auto-create hook removed; page creation is opt-in from ticket UI settings.

A full browser/WordPress integration test still requires installing the ZIP on a staging copy of the target WordPress site because plugin behavior depends on the site theme, Elementor, JetEngine and existing field definitions.
