# Validation — Jarchi WordPress Plugin 1.23.0

- PHP syntax: 124/124 PHP files passed `php -l`.
- JavaScript syntax: 10/10 JavaScript files passed `node --check`.
- Ticket front-end flow reviewed for canonical create/reply redirects and one-page state controls.
- Open-thread layout uses a full-width conversation and does not reuse the desktop inbox row inside a narrow sidebar.
- Chat direction is explicit and physical (not logical RTL margins): customer/user left, support/admin right.
- Legacy Ticket Bot settings route is retained only as a redirect; its visible sidebar item is removed and controls are present under Ticket Advanced.

Companion backend: 2.4.15.
