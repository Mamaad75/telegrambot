# Validation 1.22.0

- PHP syntax: 124/124 files passed `php -l`.
- JavaScript syntax: 10/10 files passed `node --check`.
- Single-page flow source checks passed for list, FAQ and form radio states.
- The main new-ticket CTA no longer uses page navigation.
- `new_ticket_page_url()` now deep-links to the main ticket page only.
- Jarchi no longer provisions a separate `jarchi-new-ticket` page.
- Primary state switching works without the localized front-end JS bundle (native radio/label + CSS).
