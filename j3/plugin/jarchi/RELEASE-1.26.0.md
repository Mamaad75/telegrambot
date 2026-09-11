# Jarchi 1.26.0

- Customer ticket inbox inside the real Elementor widget becomes a compact one-line table from 700px container width upward; mobile/narrow columns keep the card layout.
- Ticket subjects default to dark gray and Elementor now exposes dedicated controls for subject/meta/header/row/hover colors, row spacing and table radius.
- Elementor typography selectors now target the actual ticket-centre heading, ticket subjects and row metadata.
- Admin ticket pagination uses direct `Admin::app_url('support')` links for every page, preserving filters and preventing page-number clicks from opening the Jarchi dashboard.
- Legacy automated tickets are repaired on upgrade: their department is recovered from the automation rule/preset, the ticket taxonomy is updated, and sender becomes `جارچی — <department>` in both ticket meta and the first message.
- Legacy automated-ticket detection now also recognizes automation id/comment metadata/sender markers.
