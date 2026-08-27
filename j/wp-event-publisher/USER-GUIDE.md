# User guide

WP Event Publisher watches your advertisements and publishes them
elsewhere — to Telegram through your Node.js publisher, and to Discord,
Slack, e-mail or any webhook you configure.

You do not have to write code for any of it. The plugin discovers what your
site actually stores and lets you decide what to do with it.

---

## Quick start

If you are upgrading, **you do not have to do anything.** The plugin keeps
publishing exactly as it did. Everything below is optional.

If this is a fresh install:

1. **Settings** — set the webhook URL and the shared secret, and tick the
   post type your advertisements use.
2. **Tools → Connection Test** — confirm the service answers.
3. Publish an advertisement.
4. **Diagnostics** — confirm it arrived.

That is a working installation. The five screens below are how you shape it.

---

## The screens

| Screen | What it is for |
| --- | --- |
| **Dashboard** | Recent activity at a glance |
| **Settings** | Endpoint, credentials, post types, timeouts, retries |
| **Field Mapping** | Which fields exist and which of them are published |
| **Profiles** | Reusable publishing configurations, assigned per category |
| **Rules** | "If this, then that" decisions made before publishing |
| **Destinations** | Where advertisements go |
| **Logs** | Every event, with the reason for every outcome |
| **Diagnostics** | Is it working, and if not, which link in the chain broke |

---

## Field Mapping

Select a post type and the plugin lists **every field it actually has** —
native post fields, every custom field in use, every taxonomy, images —
grouped by where each came from, with a sample value from a real
advertisement.

For each field:

- **Tick** it to send it.
- **Rename** it — this is the label the message shows.
- **Drag** it to reorder; the order drives both the message and the payload.
- Choose its **visibility**:

| Visibility | In the message | In the payload | On this screen |
| --- | --- | --- | --- |
| Visible in Telegram | yes | yes | yes |
| Send to backend only | no | yes | yes |
| Visible in admin only | no | **no** | yes |
| Hidden | no | no | greyed |

Whatever you send, **the payload also carries what you called it.** The label
you type here, the order you drag fields into and the field's own type travel
alongside the values, so the receiving service prints your labels instead of
guessing from the key. Rename a field and the next advertisement goes out with
the new name — there is nothing to rebuild.

- For a repeating field, choose a **list format**: separated, bullets,
  numbered, or one per line.
- Click the **star** to pin a field to the top. Favourites are stored per
  profile.

Groups collapse, and each has **Select all** / **Select none** and a count.
The search box filters on label, key, storage key and source at once.

**A field marked `NEW`** appeared since you last opened the screen — a
framework added it. It is badged and left switched off; the plugin never
enables something behind your back.

### JetEngine, ACF, Meta Box, Pods

Used when installed, **never required**. They give you real labels, real
types and real choice lists instead of generated ones. A site with none of
them gets the same fields from the generic scan.

Deactivating one later does not lose a mapped field: the value is still in
post meta, so it keeps resolving.

### Advertisements published before you installed the plugin

Treated as back catalogue: editing one does not announce it. Send one
deliberately with **Tools → Send One Advertisement Now**.

---

## Templates

Leave the template box empty and the message is built from your enabled
fields. Write one to control it exactly:

```
🚗 {{title}}
💰 Price: {{price}}
📍 {{city}}
{{#if year}}📅 Year: {{year}}{{/if}}
{{#if phone}}📞 {{phone}}{{/if}}
🔗 {{permalink}}
```

| Construct | Meaning |
| --- | --- |
| `{{field}}` | Print the field, or nothing when it is empty |
| `{{#if field}}…{{/if}}` | Keep the block only when the field has a value |
| `{{#unless field}}…{{/unless}}` | The inverse |

That is the whole language — no loops, no expressions, no code. A line whose
placeholders all came out empty is removed, so an advertisement without a
price has no blank gap where the price would be.

A placeholder only produces something if its field is set to **Visible in
Telegram**.

Every mapped field is listed beside the editor; click one to insert it. The
preview updates as you type and renders against a real advertisement.

---

## Profiles

A profile is one complete publishing configuration: fields, order, labels,
template, images, destinations.

**Create one, then assign it.** Assignment resolves outwards from an
advertisement's own category through its parents to the post type, so
assigning "Cars" covers every category under it.

```
Cars               → Default Car Profile
Cars → SUV         → SUV Profile
Cars → Pickup      → Pickup Profile
Real Estate        → Real Estate Profile
Jobs               → Jobs Profile
```

A category with no profile inherits from its parent automatically.

### Inheritance

Profiles also inherit from each other:

```
Default Profile
   ↓
Cars Profile
   ↓
SUV Profile
   ↓
Luxury SUV Profile
```

**Only what a profile changes is stored.** "Luxury SUV" can say one thing
about badges and inherit forty field decisions from "Cars". Widening a
decision at the top is one edit, not twenty.

A chain that would loop back on itself is refused with an explanation.

### Managing profiles

Create, rename, duplicate, delete, export, import, assign. Deleting a
profile re-parents its children onto its own parent and clears any
assignment that pointed at it — nothing is ever left dangling.

**Export** produces JSON carrying the whole ancestry, so importing on
another site lands complete. A profile whose identifier is already taken is
imported under a new one unless you tick overwrite.

---

## Rules

Rules run in order before every publication and decide what happens. A rule
that matches applies its actions; unless it says to stop, the next rule still
runs and can add to the decision.

**With no rules, everything is published with the assigned profile** — which
is exactly how the plugin behaved before rules existed.

### Conditions

Category, subcategory, parent category, any taxonomy, tags, post type,
status, ID, title, author, author role, any custom field (as text, number or
yes/no), price, image count, gallery count, word count, date, time, weekday.

Operators: is, is not, contains, does not contain, starts with, ends with,
is one of, is none of, greater than, at least, less than, at most, between,
matches a `*` pattern, is empty, is not empty.

Group them with **AND** or **OR**, and nest groups inside groups.

A select field compares against the label you see — `Diesel`, not `diesel`.
A price written `۲٬۵۰۰٬۰۰۰٬۰۰۰ تومان` compares as a number.

### Actions

Use profile · use template · send only to · also send to · add text before ·
add text after · replace text · show field · hide field · limit images ·
send no images · delay publishing · do not publish · stop processing ·
continue processing.

### Examples

```
IF Category is Cars                        → Use profile "Cars"
IF Category is Cars AND Price > 1000000000 → Use the premium template
IF Seller type is VIP                      → Add "⭐" before the message
IF Phone is empty                          → Do not publish
IF Gallery count > 10                      → Send at most 5 images
IF Category is Real Estate                 → Send only to Channel A
```

Drag rules to reorder them. Higher runs first.

### Rule Tester

Enter an advertisement ID and press **Test Rules**. You get:

- every rule, matched or not, **and why**
- the profile that won, and its inheritance chain
- the fields that would be sent
- the destinations it would reach, with any delay
- the final message
- the final payload
- the reason, if publication would be skipped

Nothing is sent.

---

## Destinations

A destination is one place an advertisement is published. Several
destinations can share a provider — five Telegram channels are five
destinations.

| Provider | Needs |
| --- | --- |
| **Telegram Publisher** | Nothing; uses Settings. Optionally its own URL, channel and bot name |
| **Generic webhook** | An HTTPS URL; optionally a shared secret and one extra header |
| **Discord** | A channel webhook URL |
| **Slack** | An incoming webhook URL |
| **E-mail** | Recipient addresses |

Each destination can override the **template**, the **image limit** and add
a **delay**.

Create, edit, enable, disable, duplicate, delete, and **send a test** that
delivers a real advertisement so you can look at the result in the channel.

> **Never put a Telegram bot token in WordPress.** The bot field takes a
> short name for the Node.js service to route on; a token typed there is
> refused.

### Scheduling

Publish immediately, after 5 or 30 minutes, after an hour, tomorrow, or a
custom number of seconds. A delayed advertisement is **rebuilt when it is
finally sent** — an edit during the wait goes out corrected, and a deletion
cancels it.

### Adding a service that is not listed

One adapter class, registered with the `wpep_delivery_providers` filter. The
settings form builds itself from the adapter's schema; no admin code is
needed and the core plugin is not modified. See `ARCHITECTURE.md`.

---

## When something looks wrong

**Diagnostics** checks the chain in the order a publication travels it —
configuration, URL, authentication, post types, hooks, delivery record,
queue, scheduling, DNS, TLS, service health, a real authenticated request.
The first failing row is the thing to fix.

**Logs** records every event with the reason for its outcome, including why
an advertisement was skipped and which rules matched.

**Rule Tester** answers "why did this one go there".

The webhook secret is never displayed, logged, exported or put in the page
source anywhere in the plugin.

---

## Common questions

**Will upgrading change what my site publishes?**
No. Until you save a profile, a rule or a destination, every post type keeps
sending exactly what it sent before.

**Do I need JetEngine / ACF / Meta Box / Pods?**
No. They are read when present and ignored when not.

**What happens if I deactivate one of them?**
Mapped fields keep working — the values are in post meta. You lose the
framework's labels, not your data.

**Can two Telegram channels get different messages?**
Yes. Two destinations, each with its own template, image limit and delay.

**What if a rule and a profile disagree?**
The rule wins. Rules run after the profile is resolved and can replace it.

**Can I copy my setup to another site?**
Export the profiles and the rules as JSON on one site and import them on the
other. Destinations are not exported — they carry credentials.
