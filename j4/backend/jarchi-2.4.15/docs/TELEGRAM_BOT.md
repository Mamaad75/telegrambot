# Telegram bots

One bot token serves three audiences: channel publishing, the customer Mini App
entry point, and the admin interface. What a Telegram user sees depends on
whether their id maps to an active `admin_users` row.

## Customer commands

| Command | Behaviour |
| --- | --- |
| `/start` | Creates the account, starts the 7-day trial once, links any client provisioned for that Telegram id, opens the Mini App |
| `/panel` | Fresh Mini App link (24h session) |

Inline `plans` / `buy:<plan>` callbacks drive Telegram Stars checkout;
`pre_checkout_query` validates the plan and `successful_payment` activates the
subscription idempotently (duplicate charge ids are ignored).

The **contact button** on a published ad decrypts the advertiser number for that
one publication and sends it to the person who pressed it. The number is never
logged.

## Admin interface — `/admin`

```
🛠 مدیریت جارچی
📊 داشبورد        👥 کاربران      🌐 کلاینت‌ها
📡 پلتفرم‌ها       📢 انتشارها     💳 اشتراک‌ها
🧾 پرداخت‌ها       🧩 فیلدها       📋 گزارش‌ها
🧰 ابزارها         ⚙️ تنظیمات
```

The menu is filtered by the pressing admin's permissions — a viewer is not shown
buttons that would be refused.

| Section | Actions |
| --- | --- |
| 📊 داشبورد | Client, user, subscription and publication figures per platform, plus the retry queue |
| 🌐 کلاینت‌ها | List, search, create (6-step flow), open, edit name/URL/owner, enable/disable, rotate secret, per-platform targets and tests, publications, fields, webhook diagnostics |
| 📢 انتشارها | Browse all or failures only, open a publication, queue a retry |
| 👥 کاربران | List, search, detail, suspend/activate, revoke sessions |
| 💳 اشتراک‌ها | Active / expiring / expired views, extend by N days |
| 🧾 پرداخت‌ها | Recent invoices |
| 🧩 فیلدها | Pick a client, see label, key, order, per-platform visibility, first/last seen |
| 📡 پلتفرم‌ها | Shared bot status (reachability, masked token fingerprint) |
| 📋 گزارش‌ها | Audit log |
| 🧰 ابزارها | Retry queue state, run the queue now |
| ⚙️ تنظیمات | Version, contract, timezone, webhook URL, retry configuration, your role |

## Authorization

`ADMIN_TELEGRAM_ID` is **not** the security model — it only seeds the first
super admin. Every command and callback:

1. resolves the Telegram user id against `admin_users` (active accounts only);
2. applies a per-admin rate limit (`RATE_LIMIT_BOT_*`);
3. checks the specific permission for that action;
4. audits denials and every state change with `channel = "telegram"`.

Callback data names an action and its target — never identity, never
entitlement. A crafted callback grants nothing: the check runs server-side on
every press.

## Flows and state

Multi-step flows (create client, search, edit a field, change a platform target,
extend a subscription) store their state in `admin_bot_states`:

- one row per (admin Telegram id, chat) — a flow cannot fork;
- an expiry of `ADMIN_BOT_STATE_TTL_MINUTES` — an abandoned flow stops capturing
  the admin's messages;
- durable — a restart mid-flow resumes at the same step;
- validated per step with the same validators the HTTP API uses; an invalid
  value keeps the flow alive at that step instead of aborting;
- cancellable with the «✖️ لغو» button, the word «لغو», or `/cancel`;
- revoked automatically if the admin loses the permission mid-flow.

Destructive or customer-visible actions — disabling a client, rotating a secret,
sending a test message into a customer channel, suspending a user — always ask
for confirmation first.
