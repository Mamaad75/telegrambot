# Jarchi WordPress Plugin 1.21.1

Hotfix for the customer ticket creation flow.

## Fixed

- Elementor ticket-list CTA now reaches the new-ticket view correctly.
- FAQ gate CTA reveals the form with JavaScript and has a server-rendered fallback URL when JavaScript is unavailable.
- Ticket UI event handling no longer depends on the localized unread-polling configuration.
- New-ticket navigation uses a normal anchor instead of a JavaScript redirect.

No database migration is required. Backend/Mini App 2.4.14 does not need another deployment for this hotfix.
