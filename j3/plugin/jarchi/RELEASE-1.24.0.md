# Jarchi 1.24.0

Information-architecture and ticket-form customization release.

## Admin navigation
- Ticket pages are consolidated into three nested groups: Support Management, Ticket Settings, and Automation & Maintenance.
- Existing routes are preserved; this is a navigation-only reorganization and does not break bookmarks.

## Front-end ticket form
- Ticket category is hidden by default.
- Site administrators can enable it globally under Ticket Appearance.
- Elementor designers can inherit, show, or hide it per widget and customize its label.
- The shortcode supports `show_category` and `category_label`.

## Compatibility
All 1.23.8 production hardening remains included.
