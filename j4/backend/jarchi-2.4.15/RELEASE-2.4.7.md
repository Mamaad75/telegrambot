# Jarchi 2.4.7

Bale Web/Desktop framing compatibility hotfix.

## Fixed

- The global `X-Frame-Options: DENY` header prevented Bale Web/Desktop from rendering the dedicated Mini App document when Bale hosted it in a cross-origin frame.
- `/app/bale.html` is now frameable only from official Bale origins using `Content-Security-Policy: frame-ancestors`.
- All other Jarchi routes remain protected with `X-Frame-Options: DENY` and `frame-ancestors 'none'`.

No database migration is required.
