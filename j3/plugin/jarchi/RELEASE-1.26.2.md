# Release 1.26.2

- Fixed duplicate advert-owner e-mails on new comments by suppressing the overlapping WordPress core post-author notification for public advert post types that Jarchi already handles.
- Fixed comment reply automations so they only fire after approval and also fire when a moderated reply is later approved.
- Comment replies now notify the relevant registered participants without regressing the existing top-level "new comment" automation.
- Upgrader refreshes the built-in `comment-reply` preset text to include sender name and advert link when the site still uses the stock template.
- Reversed the ticket-center back arrow icon to match the requested RTL direction.
