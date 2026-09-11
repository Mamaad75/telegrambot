# Validation — Jarchi WordPress Plugin 1.23.3

- Version header/constant/stable tag: 1.23.3.
- PHP syntax lint: all PHP files must pass `php -l`.
- JavaScript syntax: ticket assets must pass `node --check`.
- No automatic call to `maybe_create_page()` remains in ticket content-type registration.
- Elementor ticket centre sets `embedded=true` and its `base_url` to the current host request.
- Embedded submit/reply/rating forms include a same-origin validated `jarchi_return_url`.
- Ticket list/filter/detail/back/new-ticket links use the render-specific base URL.
- Container-query rules are present for narrow Elementor/JetEngine widget slots.

A full browser integration test still requires WordPress + Elementor/JetEngine because routing and container widths are supplied by the host page builder.
