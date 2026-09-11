# Jarchi WordPress Plugin 1.22.1

## Ticket creation UX

The single-page ticket flow now completes back in the inbox. After a ticket is successfully created, the POST handler redirects to the canonical ticket page with a validated one-time success flag. The inbox shows **«تیکت شما ثبت شد»**, lists the newly created ticket with the rest of the user's tickets, and does not automatically open the thread.

The confirmation progressively clears itself from the URL and fades after a few seconds when JavaScript is available. The server-rendered behavior remains correct without JavaScript.
