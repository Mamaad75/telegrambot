# Validation — Jarchi 1.23.8

- PHP syntax: all plugin PHP files linted with `php -l`.
- JavaScript syntax: ticket JavaScript checked with `node --check`.
- ZIP integrity: tested after packaging.
- Security properties reviewed: ticket pages marked private/no-store; AJAX nonce refresh requires logged-in WordPress session; announcement seen-state AJAX verifies nonce and active announcement IDs.
- Backward compatibility: old admin-post handlers remain, existing Elementor/JetEngine host-page routing is preserved, and ticket backend events only add fields.
