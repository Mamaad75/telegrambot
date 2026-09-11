# Validation — 1.23.7

- PHP syntax lint across all plugin PHP files.
- `node --check` on `assets/js/tickets.js` and `assets/js/ticket-notifications.js`.
- Static verification that notification polling reads `data.unread` only for notification badges and `data.ticket_unread` for ticket badges.
- Static verification that ticket opening has both PHP and AJAX read paths.
- Static verification that Customer Hub live counters and announcement combined badge use separate data hooks.
