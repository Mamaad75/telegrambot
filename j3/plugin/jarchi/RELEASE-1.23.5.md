# Jarchi 1.23.5

## Fix: ticket agent assignment

The single-ticket admin view previously rendered the assignment form without an explicit `admin-post.php` action. As a result the hidden `action=wpep_ticket_assign_agent` field was posted back to the current admin screen and WordPress never dispatched the registered `admin_post_wpep_ticket_assign_agent` hook.

1.23.5 posts the form to `admin-post.php`, preserves the current ticket as the return destination, validates the selected agent server-side, and shows clear success/error feedback. When no support agents exist, the UI explains that state and links to the support-agent management screen instead of presenting a non-functional assignment control.
