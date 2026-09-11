# Jarchi 2.4.6

Bale-specific Mini App compatibility hotfix.

## Fixes

- Bale bot buttons now open `/app/bale.html?platform=bale&session=...` instead of placing the launch session in the URL fragment. Some Bale Mini App clients use/reserve the fragment while creating the WebView URL, which can result in a native broken-page screen before Jarchi HTML executes.
- The dedicated Bale entry page loads the Bale Mini App SDK synchronously before Jarchi scripts, as required by Bale Mini App integration guidance.
- Telegram launch URLs remain fragment-based.
- No database migration is required.

## Validation

Run `npm test`, `npm run db:status`, then verify `/health` and `/health/ready`.
