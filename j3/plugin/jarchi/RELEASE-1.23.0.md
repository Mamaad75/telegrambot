# Jarchi WordPress Plugin 1.23.0

## Ticket workspace
- Full-width ticket thread when a conversation is open.
- Customer bubbles are physically left; support/admin bubbles are physically right, independent of RTL.
- Responsive message metadata, attachments and reply composer.
- Client-side status/search filtering without page reload.

## Navigation and redirects
- Ticket creation success returns to the inbox with the existing success notice.
- Ticket/reply errors return to the correct one-page state instead of relying on the HTTP referrer.
- Reply persistence is checked before success redirect.

## Admin
- Removed the visible standalone Ticket Bot Settings navigation item.
- Merged Telegram/Bale remote ticket controls into Ticket Advanced.
- Kept the legacy settings route as a compatibility redirect.
- Made advanced settings grids responsive.

## Mini App compatibility
Pair with Jarchi Backend/Mini App 2.4.15 for staff-side ticket list, thread, reply, status, unread and canned-reply workflows.
