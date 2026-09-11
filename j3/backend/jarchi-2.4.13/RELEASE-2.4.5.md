# Jarchi 2.4.6

Hotfix release for Mini App startup.

## Fixed
- Telegram Mini App no longer waits on the Bale CDN before running Jarchi.
- Bale Mini App no longer waits on the Telegram CDN.
- Platform SDKs are optional/non-blocking when a valid bot session token exists.
- Direct launches without a session wait briefly for platform `initData`.
- Telegram customer launch links explicitly include `platform=telegram`.

No database migration is required from 2.4.4.
