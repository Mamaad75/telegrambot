# Jarchi 2.4.13

## Bale WebView compatibility

Bale now loads `app-bale-legacy.js`, a prebuilt ES5-compatible version of the same Mini App source used by Telegram. This specifically addresses the observed production failure where the inline HTML watchdog executed but `app.js` never reached its first statement, which is consistent with a JavaScript parse-compatibility failure in the Bale WebView engine.

Telegram continues to load the modern `app.js` bundle unchanged.

No database migration is required.
