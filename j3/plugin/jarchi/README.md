# WP Event Publisher

Sends WordPress advertisement events to the Node.js Telegram Publisher.

```
Publish an advertisement — by any route
  → Hook Router      every publishing hook, funnelled into one decision
  → Event Detector   is this an advertisement? is it being published?
  → Idempotency      one publication = one event, whichever hook won
  → Queue (database) survives reloads, cache flushes and fatals
  → Dispatcher       inline now, cron as backstop, sweeper for stragglers
  → Retry Policy     retry what can succeed, stop on what cannot
  → Webhook          authenticated POST, JSON, UTF-8
  → https://bot.iran-exim.ir/webhook
  → Node.js          → Telegram → @iranexim2365
```

**Diagnostics → Run Full Diagnostics** checks every link in that chain in
order and tells you which one is broken.

Every step writes to **WP Event Publisher → Logs**, so a publish that produced
nothing always has a recorded reason.

---

## 1. Configure the webhook

**WP Event Publisher → Settings → Connection**

| Field | Value |
| --- | --- |
| Webhook URL | `https://bot.iran-exim.ir/webhook` (pre-filled) |
| Site ID | e.g. `site_001` — optional, derived from the site address when empty |

Only HTTPS URLs are accepted (plain HTTP is allowed for `localhost` during
development only). The Connection Test and real advertisement events post to
**this same URL** — there is no separate test endpoint.

### Persian admin UI

The plugin's own screens are Persian and right-to-left by default. Change this
under **Settings → Diagnostics → Admin Language** (Persian / English / follow
the WordPress language). It affects only this plugin's pages — the rest of the
WordPress admin keeps the site language.

Technical values stay in Latin script on purpose: hook names, HTTP header
names, JSON keys and event types (`created`, `updated`, `deleted`) are values
you match against the Node.js service, not prose.

## 2. Configure authentication

**Settings → Connection → Webhook Secret**

Enter the shared secret your Node.js service expects (the value of
`WEBHOOK_SECRET` or equivalent in its `.env`). Leave the field blank on later
saves to keep the stored value — it is never displayed, never written to the
logs and never rendered into any page.

**Authentication Style** decides which credential headers travel with each
request. The default, *All*, sends every supported scheme so the backend can
verify whichever one it implements:

| Header | Meaning |
| --- | --- |
| `X-Webhook-Secret` | the shared secret — **always sent**, whatever style is selected, because this is what the Node.js publisher checks |
| `X-Signature` | `HMAC_SHA256( timestamp + "." + raw_body, secret )`, hex |
| `X-Hub-Signature-256` | `sha256=` + `HMAC_SHA256( raw_body, secret )`, hex |
| `X-API-Key` | the shared secret |
| `Authorization` | `Bearer <secret>` |
| `X-Timestamp` | UTC ISO 8601, e.g. `2026-07-27T10:30:00Z` |
| `X-Site-ID`, `X-Event-ID`, `X-Idempotency-Key`, `X-Event-Type`, `X-Attempt` | context |

Narrow the style down once you know which scheme the backend uses. Verifying in
Node.js:

```js
const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(req.header('X-Timestamp') + '.' + rawBody)   // raw bytes, not re-serialized JSON
  .digest('hex');

crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.header('X-Signature')));
```

Deduplicate on `event_id`: every retry of an event reuses it unchanged.

## 3. Select the advertisement post type

**Settings → What triggers an event → Post Type Detection**

- **Automatic** watches every public post type, whichever plugin registered
  it — JetEngine, ACF, CPT UI, WooCommerce, a theme or core — so a post type
  added later is picked up without touching this screen.
- **Manual** watches only what you tick below.

**Allowed Post Types**

The list shows every post type with an editing screen — including custom post
types that are not publicly queryable — with the number of published items next
to each, which usually makes the advertisement type obvious. Tick it and save.

Also check:

- **Allowed Post Status** — `publish` by default. An event fires when an
  advertisement *enters* one of these statuses, from draft, pending, scheduled
  (`future`) or a front-end submission form that inserts it as published.
- **Event Types** — `created`, `updated`, `deleted`.
- **Enable Plugin** — with this off, the Connection Test still succeeds but no
  advertisement is ever detected.

Internal WordPress post types — attachments, revisions, menu items, navigation
posts, reusable blocks, templates, global styles, fonts and the Action
Scheduler types — are never watched, in either mode. Editing a menu or saving
a template therefore cannot produce an advertisement event.

### Advertisements published before the plugin was installed

The plugin records the moment it is installed. An advertisement published
before that is treated as back catalogue: editing it, alone or through Bulk
Edit, does not announce it. Send an older advertisement deliberately with
**Tools → Send One Advertisement Now**, or move the line with the
`wpep_backfill_cutoff` filter. Everything published from the installation
onwards is announced normally.

## 4. Test the connection

**Tools → Connection Test.** It posts a `test` event to the configured URL with
the production credentials and reports:

- the HTTP status code and the response body,
- and any configuration problem that would still stop a real advertisement
  (plugin disabled, no post type selected, missing secret).

A green result with warnings means the endpoint is reachable but publishing is
still blocked — fix what it lists.

## 5. Test a real advertisement publish

Two ways:

**The real thing.** Publish an advertisement of the selected post type, then
open **Logs**. You should see, in order:
`hook.transition` → `detect.matched` → `event.queued` → `dispatch.inline` or
`cron.scheduled` → `webhook.sending` → `webhook.response` with HTTP 200. The
Telegram channel receives the post.

**Without publishing.** **Tools → Send One Advertisement Now**: enter an
existing post ID. It builds exactly the payload a publish would produce and
sends it synchronously, so you see the HTTP status immediately.

The payload that goes out:

```json
{
  "event_type": "created",
  "event_id": "evt_9f1c0f2a…",
  "timestamp": "2026-07-27T10:30:00Z",
  "contract_version": "1.2",
  "post_id": 123,
  "post_type": "advertisement",
  "title": "فروش دستگاه بسته‌بندی",
  "description": "توضیحات آگهی به صورت متن ساده…",
  "price": "۲۵٬۰۰۰٬۰۰۰ تومان",
  "location": "تهران",
  "phone": "۰۹۱۲۳۴۵۶۷۸۹",
  "url": "https://example.ir/ads/123",
  "images": ["https://example.ir/wp-content/uploads/a.jpg"],
  "site_id": "site_001",
  "fields":     { "company_or_institution_name1": "شرکت نمونه" },
  "field_meta": { "company_or_institution_name1": { "label": "نام شرکت", "order": 3, "type": "text" } },
  "site":   { "…": "…" },
  "post":   { "…": "…" },
  "author": { "id": 7, "name": "…", "email": "…", "phone": "" },
  "media":  { "featured_image": {}, "gallery": [] }
}
```

The flat fields are what the Node.js publisher reads; the structured blocks are
the 1.1.0 contract, kept for compatibility. Persian text is transmitted
unescaped (`JSON_UNESCAPED_UNICODE`) with `Content-Type: application/json;
charset=utf-8`.

### `field_meta` — what each field actually is

`fields` carries an internal key and a value, which is enough to store but not
enough to present: a consumer reading `company_or_institution_name1` alone has
no way to know it means "نام شرکت", and its only recourse is a generic label or
a hardcoded table of guesses. `field_meta` removes the need for either. It is
keyed identically to `fields` and describes every entry:

| Key | What it is |
| --- | --- |
| `label` | The label you typed on the Field Mapping screen, or the framework's own label when you left it alone. Never derived from the key. |
| `order` | The position you dragged the field into. `fields` is already in this order. |
| `visibility` | `telegram` or `backend` — the only two that are transmitted. |
| `format`, `separator` | How a repeating field should be joined: `inline`, `bullets`, `numbered`, `lines`. |
| `type` | `text`, `number`, `select`, `repeater`, `gallery`, `taxonomy`, … as the framework declared it. |
| `source` | The provider that discovered it: `wordpress`, `meta`, `jetengine`, `acf`, `metabox`, `pods`. |
| `storage_key` | The meta key, taxonomy name or post property the value came from. |
| `repeatable`, `required` | As the framework declared them. |
| `choices` | The stored-value → label map of a select or checkbox field. |
| `meta` | Whatever extra the provider attached, reduced to JSON-safe values. |

**A field appears in `field_meta` only if it appears in `fields`.** Anything
disabled, admin-only or hidden reaches neither, and the two are built in one
pass so they cannot drift apart.

### `author.phone`

Read from the **post author's user meta**, over the conventional key list
`billing_phone`, `phone`, `user_phone`, `mobile`, `user_mobile`,
`mobile_number`, `phone_number`, `telephone`, `tel`, `contact_phone`,
`whatsapp` — first plausible value wins. Add your own with the
`wpep_author_phone_meta_keys` filter.

Nothing is guessed. No number is taken from the message, the content or the
title; key names are not fuzzy-matched; and a user ID, order number or any
other numeric metadata is never read as a telephone number. A candidate has to
be 7–15 digits written with only `+`, spaces and phone punctuation. When no
key holds one, `author.phone` is `""` — which is the correct answer, not a
failure.

This is the *author's* number and is separate from the top-level `phone`,
which is the contact number stored on the advertisement itself.

### Advertisement fields

Price, location and images are auto-detected, and can be mapped explicitly when
the theme stores them somewhere unusual — **Settings → Advertisement fields**:

| Setting | Resolution order |
| --- | --- |
| Price Meta Keys | mapped keys (protected keys like `_price` allowed) → WooCommerce price → any field whose name looks like a price |
| Phone Meta Keys | mapped keys → field names containing phone/mobile/tel/whatsapp |
| Location Meta Keys | mapped keys → field names containing city/location/region/… → geographic taxonomies |
| Image Meta Keys | featured image → gallery blocks → `[gallery]` → mapped keys → WooCommerce gallery → attached images → `<img>` tags in the content |
| Description Source | excerpt when present, otherwise the content (configurable) |

Images are always absolute, publicly fetchable URLs — never attachment IDs,
filesystem paths or admin URLs — upgraded to HTTPS when the site runs on HTTPS.

### Publishing many advertisements at once

One request delivers at most three advertisements itself. Publishing more —
through Bulk Edit, an importer or a front-end feed — leaves the rest in the
queue, where the scheduled job or the queue sweeper picks them up within a few
minutes. Nothing is dropped and nothing is sent twice; it keeps a bulk action
from performing dozens of serial HTTP round trips in one PHP process. Raise or
remove the cap with the `wpep_inline_batch_limit` filter.

## Field Mapping

**WP Event Publisher → Field Mapping** is where you decide what an
advertisement is on *this* site.

Select a post type and the plugin lists every field it actually has — native
post fields, every meta key in use, every taxonomy, images — grouped by where
each came from. Tick what should be sent, rename it, reorder it by dragging,
and choose whether it appears in the Telegram message, is sent to the backend
only, is visible on this screen only, or is hidden.

Categories inherit. Set the common fields on the post type, then override
only what differs for "Cars → SUV" or "Real Estate → Apartments". Editing the
parent reaches every category under it.

Templates are optional. Leave the box empty and the message is generated from
the enabled fields; write one to control it exactly:

```
🚗 {{title}}
💰 Price: {{price}}
{{#if year}}📅 Year: {{year}}{{/if}}
🔗 {{permalink}}
```

JetEngine, ACF, Meta Box and Pods are used when installed and are never
required. **[Full documentation: FIELD-MAPPING.md](FIELD-MAPPING.md)**

## 6. Enable debug logs

**Settings → Diagnostics → Debug Mode.** Records the complete lifecycle: every
hook that fired, every reason a save was skipped, every scheduling decision and
every request. With `WP_DEBUG_LOG` enabled the same lines are mirrored into
`wp-content/debug.log` prefixed `[WPEP]`.

Secrets are never logged: the payload is stored, the headers are not, and
context values whose key looks like a credential are redacted.

Turn it off again once the problem is found — failures are always logged
regardless, even with logging switched off entirely.

## 7. Troubleshoot failed events

Open **Logs** and read the `stage` column.

| What you see | What it means |
| --- | --- |
| No entries at all for the publish | The hook did not fire for that post type, or logging is off. Enable Debug Mode and publish again — `hook.transition` should appear for every save. |
| `detect.skipped` | The message names the exact reason: post type not enabled, plugin disabled, status not in the publish list, revision/autosave. |
| `detect.duplicate` | A second hook fired for the same publish; the duplicate was dropped on purpose. |
| `event.queued` but nothing after it | Delivery has not run yet. Use **Tools → Process Queue Now**; check the Pipeline Status panel for cron health. |
| `cron.schedule_failed` | WP-Cron refused the job; the event is delivered inline instead. |
| `webhook.response` with HTTP 401/403 | Authentication mismatch — check the secret and the Authentication Style against the backend. |
| `webhook.response` with HTTP 4xx | The backend rejected the payload; the response body is stored with the entry. |
| `webhook.response` with code 0 | The request never completed (DNS, TLS, firewall). The message carries the transport error, the duration and the timeout actually used. |
| `delivery.permanent` | The failure cannot succeed by repeating (401, 403, 404, 422). The message says what to fix; no retries are wasted on it. |
| `cURL error 28: Operation timed out` | The request ran out of time. The log names the cause: a timeout another plugin shortened, or a Webhook Timeout set too low. Never set it below 10 seconds — a remote TLS handshake does not fit into 3. |
| `delivery.retry` | The attempt failed and was rescheduled with exponential backoff (1, 2, 4, 8 … minutes), reusing the same `event_id`. |
| `delivery.exhausted` | All retries failed. The event is dropped and the post is marked `failed`. |
| `queue.swept` | An event that missed its scheduled run was rescued and delivered. |

Useful filters on the Logs screen: by `stage`, by `status`
(`success`, `failed`, `pending`, `retry`, `skipped`, `info`), by event ID or by
post ID. Everything is exportable as CSV.

### What is retried, and what is not

| Outcome | Retried? |
| --- | --- |
| 401, 403 — authentication rejected | No. Fix the secret. |
| 404, 405, 410 — route missing | No. Fix the URL. |
| 400, 409, 413, 422 — payload rejected | No. The response body is in the log. |
| 408, 425, 429, 5xx | Yes, with backoff and jitter; `Retry-After` is honoured. |
| Timeout, DNS, TLS, connection refused | Yes. |

Every retry reuses the same `event_id`, so the backend can deduplicate.

### Delivery modes

**Settings → Delivery → Dispatch Mode**

- **Automatic** (default) — the event is queued, delivered at the end of the
  publish request (after the response is flushed, so the editor never waits),
  and the scheduled cron job stays as a backstop. A late cron tick cannot
  re-send it: completion markers and per-attempt locks prevent duplicates.
- **Immediate** — inline only.
- **WP-Cron only** — for hosts with a real system cron hitting `wp-cron.php`.

In every mode a sweeper re-runs anything still waiting more than two minutes
after its scheduled time, so a missed tick delays an advertisement instead of
losing it.

## Extending

Filters worth knowing (the About screen lists them all):

| Filter | Purpose |
| --- | --- |
| `wpep_contract_advertisement` | rename or add flat fields the backend expects |
| `wpep_event_payload` | change the complete payload before signing |
| `wpep_allowed_post_types` | force the advertisement post type from code |
| `wpep_price`, `wpep_location`, `wpep_description`, `wpep_image_urls` | override a resolved field |
| `wpep_detect_event_type`, `wpep_should_dispatch` | reclassify or suppress an event |
| `wpep_auth_headers` | add a credential header the backend requires |
| `wpep_retry_delay`, `wpep_duplicate_window`, `wpep_sweep_grace` | tune timing |
| `wpep_excluded_post_types` | change which internal post types can never be watched |
| `wpep_backfill_cutoff` | move or remove the line between back catalogue and new content |
| `wpep_inline_batch_limit` | change how many advertisements one request delivers itself |
| `wpep_field_providers` | register a provider for a field framework the plugin does not know |
| `wpep_discovered_fields` | add, remove or rewrite discovered fields |
| `wpep_default_field_mapping`, `wpep_field_mapping` | change the default or effective mapping |
| `wpep_mapping_taxonomy` | choose which taxonomy drives per-category mappings |
| `wpep_mapped_fields`, `wpep_contract_fields`, `wpep_message` | change what is sent |
| `wpep_mapped_field_meta`, `wpep_contract_field_meta` | change how the sent fields are described |
| `wpep_author_phone_meta_keys`, `wpep_author_phone` | teach it where the author's phone number lives |

### When the connection test fails

The test reports the HTTP status, the response body and the request duration.
If the POST itself failed, it additionally probes `/health` on the same origin
and tells you which side the problem is on:

- **health probe answers** → the host is reachable; the webhook request itself
  was rejected or timed out. Check the secret and the response body.
- **health probe also unreachable** → a network or firewall problem on the
  WordPress side, not a plugin setting.

`{"success":true,"ignored":true,"event_type":"test"}` with HTTP 200 is a
**successful** test: the backend authenticated the request and deliberately
ignored a non-advertisement event.

## Requirements

WordPress 6.5+, PHP 8.1+ (tested on 8.1 through 8.4). WooCommerce is optional; when active, product prices
and product image galleries are picked up automatically.

## Credits

Written and maintained by **ممد از تیم بایمر**. GPL-2.0-or-later.
