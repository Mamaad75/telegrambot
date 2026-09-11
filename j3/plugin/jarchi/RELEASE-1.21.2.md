# Jarchi WordPress Plugin 1.21.2

## Ticket navigation hotfix

- Repairs new-ticket routing when `_wpep_ticket_new_page_id` accidentally points at the inbox page.
- Recovers the canonical `jarchi-new-ticket` page when available.
- Always appends `jarchi_view=new` so Elementor widget state cannot override navigation.
- Protects the CTA from theme/AJAX-link interception while keeping a native href fallback.
- FAQ continuation no longer cancels its fallback URL when the inline form is missing.
