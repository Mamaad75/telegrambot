# Jarchi 1.17.2

This build merges the 1.17.x feature set onto the Jarchi 1.9.7 dynamic-field branch.

Preserved from 1.9.7:
- Dynamic Field Mapping UI and API
- Dynamic rendering metadata (`rendering`)
- Field `icon`, `prefix`, `suffix`
- Field ordering and dynamic formatting

Carried from 1.17.1:
- FAQ before ticket submission
- Canned Replies and FAQ promotion
- Admin-created tickets
- Ticket status filter chips with icons/counts
- Ticket notifications and Web Push
- Automated tickets
- Ticket operations / SLA / performance
- Customer Hub and Elementor widget
- Light/Dark theme only
- Sidebar/icon/UI improvements
- Elementor isolation improvements
- Support agent/admin pages and ticket operations

Bootstrap hardening:
- Duplicate bootstrap guard (`WPEP_BOOTSTRAPPED`)
- Guarded global `wpep()` declaration

Architecture:
- Local WordPress Ticket Center remains independent from Backend/Mini App.
- Mini App remote control remains protected by Backend Plan Entitlement.
