# Validation 1.21.1

- PHP syntax: 124/124 files passed `php -l`.
- JavaScript syntax: 10/10 files passed `node --check`.
- Ticket creation regression checks:
  - URL `?jarchi_view=new` has priority over the Elementor widget's persisted list view.
  - FAQ CTA has a real fallback URL using `jarchi_form=1#jarchi-ticket-form`.
  - The ticket form becomes server-visible when `jarchi_form=1` is present.
  - Core FAQ/form click handling no longer aborts when `window.wpepTickets` is absent.
  - New-ticket CTA uses normal browser navigation rather than a JavaScript redirect.

No database migration is required.
