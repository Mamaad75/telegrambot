# Jarchi 1.23.4

- Fixed automatic approval/rejection tickets for JetEngine/custom post types. The ready-made advert presets now target public custom post types by default, legacy preset rules are repaired once, and a secondary `wp_after_insert_post` detector covers late/custom moderation flows without duplicate tickets.
- Fixed support-desk search. Admins can search by ticket ID (including `#14910` and Persian digits), subject, conversation text, customer name, username, email or common phone/mobile meta fields while existing department/status permissions remain enforced.
- Added an explicit canonical ticket-page URL setting. Jarchi never invents `/jarchi-tickets/` anymore. Elementor ticket icons use the exact designer-supplied URL, and `[jarchi_ticket_icon url="..."]` is supported.
- Ticket notification/menu/shortcode links now resolve to the designer-owned page or a preserved legacy page; if neither is configured they safely fall back to the site home rather than a dead route.
