# Jarchi 2.4.8

Bale embedded-session compatibility hotfix.

## Fixed

Bale Web/Desktop renders `/app/bale.html` inside a cross-site frame. The 2.4.7 frontend exchanged the bot launch token into a `SameSite=Lax` HttpOnly cookie and then discarded the Bearer token. In an embedded cross-site context that cookie is not reliably available to the next API request, leaving bootstrap unable to authenticate.

2.4.8 keeps the already-validated Bale launch token as an in-tab Bearer credential after the exchange. The token is removed from the visible URL immediately and remains scoped to the WebView/tab. Telegram retains the cookie-only flow.

No database migration is required.
