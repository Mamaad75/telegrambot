# Jarchi 2.4.11

Bale Web compatibility hotfix based on the official Bale Mini App integration contract.

## Fixes

- Dedicated `/app/bale.html` is again a real Mini App entry.
- `https://tapi.bale.ai/miniapp.js?3` is the first script in `<head>` and is loaded synchronously as required by Bale.
- `Bale.WebApp.ready()` and `expand()` are signalled as soon as the SDK exists.
- Bale prefers signed `initData` authentication; the bot-issued session is only a fallback.
- Bale no longer changes browser history/sessionStorage during bootstrap.
- Bale iframe CSP now contains both the restrictive `frame-ancestors` allow-list and the documented `frame-src` allowance.
- Telegram code path is unchanged from 2.4.10.

No new database migration is required.
