# Jarchi 2.4.10

Bale Web/Desktop bootstrap hotfix.

## Fixed

The dedicated Bale Mini App page was still loading `https://tapi.bale.ai/miniapp.js?3` synchronously in `<head>`. If that third-party request stalled, was filtered, or failed inside Bale Web, the browser never reached Jarchi's local `app.js`, so the page stayed forever on the static skeleton and even the 20-second watchdog could not run.

2.4.10 changes the Bale entry to load the local `sdk-loader.js`, which injects the Bale SDK asynchronously. Jarchi can therefore start immediately and authenticate from the bot-issued session token without waiting for the platform SDK.

No database migration is required.
