# Release 1.26.7

Five changes requested from the admin screens, plus the defects found while making them work.

## Contact button: a fixed support account

The contact button had one shape — reveal the advertiser's own number — so it
was gated on the advert carrying one and could not appear on the adverts that
have none.

`دکمه تماس` now offers two modes. **شمارهٔ خود آگهی‌دهنده** is the original
behaviour. **یک آیدی ثابت پشتیبانی** points every advert at one account and
shows on all of them. Write the ID with or without the `@`; it resolves to
`t.me` on Telegram and `ble.ir` on Bale. A full `https://` link is accepted for
anything else — a `wa.me` address, a form, a support page.

This is the first contact button Bale can show at all: the author button needs
a callback handler the bot webhook does not have, and a link needs none.

Three things had to change together, and the last is the one that would have
made the setting look broken:

- The plugin resolves the ID into a per-platform URL and marks the mode.
- The formatters render a URL button instead of a callback button.
- `resolvePublication` re-applied the phone test to every contact button. That
  gate is now `resolveContactButton()`, a pure rule in `src/core/contactButton.js`
  with its own tests, rather than three lines inline beside the database.

A support mode with no destination renders nothing. A button that looks like a
way to reach somebody and is not is worse than no button.

## Showing the number in the message text is now its own switch

Printing the number in the body and offering a contact button were one
decision, so a site that wanted the button had to publish the number too.
Backwards, once a support desk sits in between.

`نمایش شماره در متن` controls the body only. It defaults to on, so a site that
upgrades behaves exactly as it did. Whether a number may be published at all
still depends on the phone field's own mapping.

## Publish fields: grouped by what they are for

The screen grouped by which plugin supplies a field — "JetEngine", "ACF",
"Core". That answers "where did this come from", which is not the question
anybody opens the screen with, and it put price and phone screens apart.

Fields are now grouped into عنوان و معرفی · قیمت و مبلغ · مکان · راه‌های تماس ·
مشخصات · تاریخ و زمان · تصویر و فایل. Classification is by name first — the
name is what the site's author chose, and a storage type of `text` covers a
price, a city and a licence number alike. Persian and English names both, and
Arabic letter forms fold onto Persian ones, so a field named `قيمت` from an
Arabic keyboard is not filed under "other".

**✨ پیشنهاد جارچی** applies a sensible starting selection in one press: what it
is, what it costs, where it is, how to reach them. Capped per section, because
one price is informative and twelve is a spreadsheet. It does not save, and it
does not touch a message template you built yourself.

## WooCommerce orders: where they go, and whether they went

"Where does this send orders? Nothing shows up even though it is on."

Two separate causes.

The screen named the platform and stopped there. It now prints the actual
channel for each live platform, and says so plainly when a platform is switched
on with no channel behind it — the exact case that looks like "it is on but
nothing arrives". Below that, the last orders that were queued and the last
ones that were skipped with the reason, so an empty history is an answer rather
than a silence.

And a real gap: only `woocommerce_checkout_order_created` was hooked. That does
not fire for an order created in wp-admin, over the REST API, by a subscription
renewal, or by a gateway that builds the order itself — so on those shops "new
order" was switched on and never fired once. `woocommerce_new_order` is hooked
too. Both fire for a checkout order, which is what the existing per-order
idempotency marker is for.

## Advert approval and rejection tickets, with the real reason

The plugin read the rejection reason from `_jarchi_reject_reason` — a key
nothing writes. The site's moderation screen writes `_iex_rejection_reason` and
`_iex_rejection_note`. So `{reject_reason}` was always empty and the rejection
ticket asked the advertiser to review a reason it then did not state.

- Both real keys are read, plus the old one, and the list is filterable via
  `jarchi_rejection_meta_keys` for a site whose moderation code differs.
- The reason and the moderator's note are composed into one sentence, and
  `jarchi_reject_reason` can replace it wholesale. A new `{reject_note}` token
  carries the note alone.
- `iex_ad_approved` and `iex_ad_rejected` are listened to directly. Those are
  better signals than a status transition — one says a human pressed reject —
  and the rejection action carries the reason as an argument. Rejecting an
  advert already sitting in `draft` changes no status at all, so the action is
  then the only signal there is. The ledger keys both paths identically, so the
  pair produces one ticket.
- A moderator rejection is no longer misreported as an expiry. Rejecting an
  advert whose expiry date had already passed sent "your advert expired" —
  wrong, and unanswerable, with the real reason sitting in post meta.
- The two preset bodies are rewritten so the rejection puts the reason on its
  own line and the sentence before it does not promise one.

## Tests

Four new plugin suites (moderation, buttons, orders, fields) and a new backend
suite; 167 backend tests pass including the existing ones. Every fix was
mutation-tested — each guard removed one at a time to confirm a test actually
fails. Two tests survived the first pass and were tightened: one was asserting
`phone_published` was false for a fixture that had no phone at all, so the new
switch was not what it was measuring.

Not claimed: these run against a test double, not WordPress and MySQL. The
admin screens were not rendered in a browser.
