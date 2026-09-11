# Jarchi WordPress Plugin 1.22.0

## Single-page ticket flow

The customer ticket experience now uses one Elementor widget and one WordPress page for the three creation states:

1. Ticket inbox
2. FAQ gate
3. Ticket form

State changes are handled by native radio/label controls and CSS, so the primary flow does not depend on the localized `tickets.js` file or on routing to a second WordPress page. This directly avoids the Elementor/cache navigation failures seen in 1.21.x.

The legacy `jarchi-new-ticket` page is no longer created or required. Existing copies are left untouched so upgrades never delete site-owner content. Legacy deep links resolve to the main ticket page with `jarchi_view=new`.

Elementor exposes FAQ title, FAQ description and the continue-button text in addition to the existing ticket UI controls.
