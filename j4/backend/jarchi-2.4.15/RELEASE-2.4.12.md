# Jarchi 2.4.12

Bale Web reliability hotfix.

## Fixes

- The official Bale SDK remains the first script in `bale.html`, but it is now `async` so its network request cannot block parsing or prevent Jarchi `app.js` from executing.
- Bot-issued `/panel` sessions are the primary authentication credential in Bale Web/Desktop. SDK `initData` remains supported for direct Mini App launches.
- Jarchi keeps probing briefly for `Bale.WebApp` and signals `ready()`/`expand()` when it becomes available.
- No database migration is required.

## Expected behavior

A slow or unavailable Bale SDK may temporarily limit Bale-native APIs, but the Jarchi control panel itself still authenticates and renders from the bot-issued session.
