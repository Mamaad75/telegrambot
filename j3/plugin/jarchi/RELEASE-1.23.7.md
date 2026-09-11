# Jarchi 1.23.7 — Real unread badge semantics

## Fixed

- Ticket launcher/menu badges now represent only genuinely unread tickets.
- Notification polling no longer overwrites ticket badges with unrelated notification counts.
- Opening a ticket clears its unread dot immediately and persists the read state through AJAX.
- Cached Elementor/JetEngine/WP Rocket markup self-corrects on load.
- Ticket-related notification records are marked read together with the ticket and old stale records self-heal.
- Customer Hub ticket counters are live and share the same unread source.
- The announcement bell uses a separate combined-count hook and can no longer corrupt pure ticket badges.

## Semantics

Status counters remain status counters. A red dot / ticket icon badge means only: the customer has a ticket with an unread support-side update.
