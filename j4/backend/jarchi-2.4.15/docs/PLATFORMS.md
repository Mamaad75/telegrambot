# Platform configuration

Bot credentials are **backend-only**. Clients configure targets (which channel
to publish to), never tokens.

## Telegram

```env
TELEGRAM_BOT_TOKEN=…
TELEGRAM_WEBHOOK_URL=https://jarchi.example.com/telegram-webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=…      # optional but recommended
TELEGRAM_STARS_ENABLED=true
```

- Add the bot to the customer's channel as an administrator with permission to
  post, edit and delete messages.
- Targets accept `@username`, a `t.me` link (normalized to `@username`) or a
  numeric chat id such as `-1001234567890`.
- Posts with images are sent as photos: captions are capped at 1024 characters,
  plain messages at 4096. The formatter enforces the right limit per case.
- `updated` events edit the existing message; if the edit fails (message too
  old, deleted upstream), the ad is re-published and the outcome recorded as
  `republished_after_edit_failure`.
- `deleted` / `deleted_from_trash` delete the stored message ids.
- The contact button is an inline callback that reveals the advertiser number
  only to the person who presses it, and only when field policy allows it.

## Bale

```env
BALE_BOT_TOKEN=…
BALE_API_BASE=https://tapi.bale.ai
```

Bale speaks a Telegram-shaped API on its own host. Targets accept `@username` or
a numeric chat id. Messages are plain text (no HTML parse mode) with inline
buttons; deletion is supported.

## WhatsApp (Cloud API)

```env
WHATSAPP_ENABLED=true
WHATSAPP_GRAPH_VERSION=v23.0
```

- Credentials are **per client**: the customer stores `accessToken` and
  `phoneNumberId` from the Mini App, and they are encrypted at rest.
- Delivery is a plain text message; WhatsApp has no inline buttons, so an
  enabled view button becomes a trailing link rather than being dropped.
- The recipient comes from `publication_targets.whatsapp.recipient`, or the
  advertiser phone when field policy allows it.
- Deletion is **not supported** by the Cloud API; deletion events report
  `unsupported` and the attempt is recorded.
- Connection tests read the phone number node — credentials are validated, never
  echoed back.

## Failure classes

`src/platforms/errors.js` maps every platform failure into a class that decides
retry behaviour: `timeout`, `network`, `rate_limited` and `server_error` are
retried with exponential backoff and jitter (honouring `retry_after`); `auth`,
`config`, `not_found`, `invalid_request` and `unsupported` are not — they need a
person. Every platform call has a timeout, so a hung platform cannot hold a
webhook request open.
