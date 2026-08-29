# Field Mapping

WP Event Publisher does not know what an advertisement is. Your site does.

This document explains the system that closes that gap: how the plugin finds
out which fields a post type actually has, how you decide which of them are
published, and how the message and the payload are built from your decisions.

Nothing here requires JetEngine, ACF, Meta Box or Pods. If one of them is
installed the plugin reads its field definitions to get better labels and
types; if none of them is, the same data is found anyway.

---

## The screen

**WP Event Publisher → Field Mapping.**

1. **Select a post type** — `car`, `estate`, `job`, `product`, whatever your
   site calls its listings.
2. **Select a category** (optional) and a **subcategory** (optional).
3. The table below shows every field that post type has, grouped by where it
   came from.

A `•` next to a category name means that category has its own mapping rather
than inheriting one.

### Per field you can set

| Control | Effect |
| --- | --- |
| **Checkbox** | Off means the field is not sent anywhere, whatever its visibility says. |
| **Label** | What the field is called in the generated message. Leave it blank to use the name the source plugin gave it. |
| **Visibility** | See the table below. |
| **List format** | For repeatable fields only: separator, bullets, numbers, or one per line. |
| **Separator** | The string joining an inline list. Defaults to `، `. |
| **Drag handle** | Order. It controls both the generated message and the order of `fields` in the payload. |

### Visibility

| Setting | In the Telegram message | In the webhook payload | On this screen |
| --- | --- | --- | --- |
| **Visible in Telegram** | yes | yes | yes |
| **Send to backend only** | no | yes | yes |
| **Visible in admin only** | no | **no** | yes |
| **Hidden** | no | no | greyed |

"Visible in admin only" is for fields you want to see while mapping — a
sample value tells you whether you picked the right meta key — without them
leaving the site. It is not a security boundary; it is an editorial one.

### Search and bulk actions

The search box filters on label, key, storage key and source at once.
**Enable all shown** / **Disable all shown** and the bulk visibility selector
act on whatever the filter is currently showing, so you can type `price`,
set those four fields to Telegram, then clear the filter.

---

## Where fields come from

Each group in the table is one provider.

| Group | What it contributes | Requires |
| --- | --- | --- |
| **WordPress** | title, description, content, excerpt, permalink, slug, status, post type, author, dates, menu order | — |
| **Custom fields (post meta)** | every meta key this post type actually uses, discovered from the database | — |
| **Taxonomies** | every taxonomy registered for the post type, plus derived top level / deepest term / full path fields for hierarchical ones | — |
| **Images** | featured image, gallery, and the two combined | — |
| **JetEngine** | meta box definitions: labels, types, options, repeaters | JetEngine |
| **Advanced Custom Fields** | field groups: labels, types, choices, sub-fields | ACF |
| **Meta Box** | registered boxes, including cloneable fields | Meta Box |
| **Pods** | pod fields | Pods |

**A framework's description wins over the raw scan.** If ACF says the meta
key `fuel_type` is a select called "Fuel" with three options, that is what
the screen shows — instead of a guessed "Fuel Type" text field. The key is
listed once, not twice.

**Deactivating a framework does not lose data.** The value still lives in
post meta, so the field keeps resolving; it just reverts to a generated
label. Your mapping is untouched.

### Field keys

The key in the left column (also shown under the label) is the field's
identity: it is the mapping key, the payload key under `fields`, and the
template placeholder. It is derived from the storage key, so it survives a
cache rebuild, a framework being deactivated, and the plugin being
deactivated and reactivated.

Taxonomy fields are prefixed `tax_`:

```
tax_product_cat          every assigned term
tax_product_cat_top      the top-level ancestor
tax_product_cat_leaf     the deepest assigned term
tax_product_cat_path     the whole path, "Cars › SUV › Compact SUV"
```

---

## Categories and inheritance

A mapping belongs to a **scope**. A scope is either a post type on its own:

```
car
```

or a post type and a term:

```
car:product_cat:42
```

When the plugin needs a mapping for a post it walks outwards from the most
specific scope — the post's deepest term, then each ancestor term, then the
post type — and the first scope with an opinion about a given field wins.

```
car                       price, mileage, fuel, year
└── car:product_cat:10    (Cars — inherits everything)
    ├── …:11              (SUV — adds drivetrain, overrides label of "fuel")
    │   └── …:12          (Compact SUV — inherits Cars + SUV)
    └── …:13              (Sedan — inherits Cars only)
```

Editing "Cars" reaches every category under it. Editing "SUV" reaches SUV and
Compact SUV, and leaves Sedan alone.

**Nothing is copied.** A subcategory stores only what it changes, so widening
a decision at the top is one edit rather than twenty.

Use **Discard this scope's mapping and inherit again** to remove an override.

Which taxonomy drives this is the post type's first hierarchical taxonomy.
Change it with:

```php
add_filter( 'wpep_mapping_taxonomy', function ( string $taxonomy, string $post_type ): string {
    return 'car' === $post_type ? 'vehicle_class' : $taxonomy;
}, 10, 2 );
```

---

## Message templates

Leave the template box empty and the message is generated: every
Telegram-visible field in mapping order, printed as `Label: value`, with
title, description and permalink printed bare. Fields with no value are
skipped.

Write a template and you control it exactly.

```
🚗 {{title}}
💰 Price: {{price}}
📍 City: {{city}}
{{#if year}}📅 Year: {{year}}{{/if}}
{{#if phone}}📞 {{phone}}{{/if}}
🔗 {{permalink}}
```

### Syntax

| Construct | Meaning |
| --- | --- |
| `{{field}}` | Print the field. Empty if it has no value. |
| `{{#if field}}…{{/if}}` | Keep the block only when the field has a value. |
| `{{#unless field}}…{{/unless}}` | The inverse. |

That is the whole language. There is no loop, no expression, no function
call — a template is content, and content stored in an option and rendered in
a background request must never be able to run anything. A `<?php` or a
`[shortcode]` inside a template stays literal text, and a field *value* that
happens to contain `{{price}}` is printed, not expanded.

Nesting works. Conditionals are resolved before placeholders, so a
placeholder inside a removed block is never evaluated.

**Empty lines are cleaned up.** A line whose placeholders all resolved to
nothing is removed, along with any punctuation left stranded on it, so an
advertisement without a price has no blank gap where the price would be.

**A placeholder only works if its field is set to "Visible in Telegram".** A
backend-only field resolves to empty in a template — it is sent, but not
something you asked to publish.

### Per-category templates

Templates inherit exactly like fields do. Give "Cars" one template and "Real
Estate" another; give "SUV" a third and it overrides "Cars" for SUVs only.

Click **Preview with a real advertisement** to render the template you are
looking at — saved or not — against an actual post of the selected category.

---

## The payload

Every advertisement now carries a `fields` object alongside everything the
plugin already sent:

```json
{
  "event_id": "evt_9f2c…",
  "event_type": "created",
  "post_id": 501,
  "title": "…",
  "price": "…",
  "message": "🚗 …\n💰 Price: …",
  "fields": {
    "price": "2500000000",
    "fuel_type": "Diesel",
    "mileage": 120000,
    "extras": [ "Air conditioning", "Navigation" ],
    "service_history": [
      { "garage": "…", "kind": "Full service" }
    ],
    "images": [ "https://…/1.jpg", "https://…/2.jpg" ],
    "tax_product_cat": [
      {
        "id": 12, "name": "Compact SUV", "slug": "compact-suv",
        "parent": { "id": 11, "name": "SUV", "slug": "suv" },
        "ancestors": [ … ], "children": [], "path": [ "Cars", "SUV", "Compact SUV" ]
      }
    ]
  },
  "taxonomy": {
    "source": "product_cat",
    "category":    { "id": 10, "name": "Cars",        "slug": "cars" },
    "subcategory": { "id": 11, "name": "SUV",         "slug": "suv" },
    "term":        { "id": 12, "name": "Compact SUV", "slug": "compact-suv" },
    "path": [ "Cars", "SUV", "Compact SUV" ],
    "categories": [ … ], "tags": [ … ], "all": { … }
  }
}
```

Rules:

- `fields` contains **only enabled fields whose visibility transmits them** —
  Telegram-visible and backend-only. Admin-only and hidden fields are absent.
- A field with no value is absent rather than `null`, so `fields` is never
  padded with empties.
- Values keep their shape: a scalar is a scalar, a repeater is a list of
  rows with named columns, a gallery is a list of URLs, a taxonomy keeps its
  hierarchy.
- **Select and checkbox fields are sent as their labels**, not their stored
  values: `"Diesel"`, not `"diesel"`.
- `message` is what the template produced. An empty string means no template
  applied and the consumer should build its own message, exactly as before.

### `field_meta` — the same keys, described

`fields` tells a consumer what the values are. It does not tell it what they
*mean*: a key like `company_or_institution_name1` gives a formatter nothing to
print but a generic label, unless it keeps a hardcoded table of guesses. Since
1.5.1 it does not have to. Every payload carries `field_meta`, keyed
identically to `fields`:

```json
"field_meta": {
  "price": {
    "label": "قیمت", "order": 0, "visibility": "telegram",
    "format": "inline", "separator": "، ",
    "type": "number", "source": "jetengine", "storage_key": "price",
    "repeatable": false, "required": true,
    "choices": {}, "meta": {}
  },
  "fuel_type": {
    "label": "نوع سوخت", "order": 1, "visibility": "telegram",
    "format": "inline", "separator": "، ",
    "type": "select", "source": "jetengine", "storage_key": "fuel_type",
    "repeatable": false, "required": false,
    "choices": { "diesel": "Diesel", "petrol": "Petrol", "ev": "Electric" },
    "meta": {}
  },
  "service_history": {
    "label": "سوابق سرویس", "order": 2, "visibility": "backend",
    "format": "bullets", "separator": "، ",
    "type": "repeater", "source": "jetengine", "storage_key": "service_history",
    "repeatable": true, "required": false,
    "choices": {}, "meta": {}
  }
}
```

| Key | Where it comes from |
| --- | --- |
| `label` | The **Label** box on this screen — including a per-category override. Empty falls back to the framework's own label. **Never derived from the key.** |
| `order` | The drag order. `fields` is already in it; nothing is sorted alphabetically. |
| `visibility` | `telegram` or `backend`. Those are the only two values that can appear, because nothing else is transmitted. |
| `format`, `separator` | The **List format** choice, for joining a repeating field. |
| `type` | What the framework declared: `text`, `number`, `select`, `repeater`, `gallery`, `taxonomy`, … |
| `source` | The provider that discovered it: `wordpress`, `meta`, `jetengine`, `acf`, `metabox`, `pods`, or your own. |
| `storage_key` | The meta key, taxonomy name or post property behind the value. |
| `repeatable`, `required` | As the framework declared them. |
| `choices` | The stored-value → label map, so a consumer can resolve `diesel` → `Diesel` itself. |
| `meta` | Provider extras, reduced to JSON-safe values. |

Two rules make it safe to rely on:

- **`field_meta` describes exactly the keys in `fields`, and no others.** A
  field that is disabled, admin-only, hidden or empty is missing from both.
  Renaming a field on this screen changes what the consumer prints on the
  next publication — there is nothing to rebuild and no cache to clear.
- Both maps are produced in **one pass** over the effective mapping, and are
  reconciled after filtering, so they cannot drift apart.

### Nothing was removed

Every field and block the plugin sent before 1.4.0 is still sent, unchanged:
the flat `post_id` / `title` / `description` / `price` / `location` / `phone`
/ `url` / `images`, and the `site`, `post`, `author`, `listing`, `media` and
`taxonomy` blocks. `taxonomy` gained keys; it lost none. An existing Node.js
consumer needs no change.

---

## Performance

Discovery reads field group definitions and runs one grouped query against
the meta table. That is far too expensive to do on every publish, so it is
cached.

The cache key includes a **signature from every provider**. Activating ACF,
editing a JetEngine meta box, updating a plugin or deactivating Meta Box
changes a signature, which changes the key, which rebuilds the list. You do
not have to remember to clear anything.

It is also flushed explicitly on plugin activation, on settings save, on
`activated_plugin` / `deactivated_plugin` / `upgrader_process_complete`, and
on ACF's field group hooks. **Rescan fields** does it on demand.

Delivering an advertisement reads meta; it never scans. Each field is read at
most once per delivery even though the payload builder and the message
renderer both use it.

---

## Extending

Add a provider for a framework the plugin does not know:

```php
add_filter( 'wpep_field_providers', function ( array $providers ): array {
    $providers[] = new My_Framework_Provider(); // implements WPEventPublisher\FieldProvider
    return $providers;
} );
```

The interface is five methods: `id()`, `label()`, `is_available()`,
`discover( $post_type )`, `resolve( $field, $post )`, plus `signature()` for
cache invalidation. Extending `WPEventPublisher\BaseProvider` gives you meta
reading, label generation and type guessing for free.

Providers later in the list win when two describe the same storage key. A
provider that throws is skipped — it costs its own fields, never the screen
and never a publication.

### Filters

| Filter | Purpose |
| --- | --- |
| `wpep_field_providers` | register or reorder providers |
| `wpep_discovered_fields` | add, remove or rewrite discovered fields |
| `wpep_is_internal_meta_key` | hide a meta key from discovery |
| `wpep_field_cache_ttl` | change the discovery cache lifetime |
| `wpep_default_field_mapping` | change the automatic default mapping |
| `wpep_field_mapping` | change an effective mapping at runtime |
| `wpep_mapping_taxonomy` | choose which taxonomy drives per-category mappings |
| `wpep_mapped_fields` | change the `fields` object before it is sent |
| `wpep_contract_fields` | change the `fields` block of the payload |
| `wpep_mapped_field_meta` | change the descriptions before they are sent |
| `wpep_contract_field_meta` | change the `field_meta` block of the payload |
| `wpep_message` | change the rendered message |

A description added through either filter for a key that `fields` does not
carry is discarded: the block describes what was sent, never more.

---

## Security

- Every screen render and every AJAX endpoint checks
  `current_user_can( 'manage_options' )` **and** a nonce.
- A submitted field key that is not a discovered field of that post type is
  discarded, so a crafted request cannot store a mapping for something that
  does not exist.
- Visibility and format values are checked against their allow-lists; an
  unknown visibility falls back to hidden, never to visible.
- Labels are `sanitize_text_field()`, separators are length-bounded,
  templates are stripped of tags and capped.
- Everything the server returns is inserted into the page as text, never as
  HTML — a field label coming from a third-party plugin cannot become markup.
- No credential is ever localized onto this screen, logged, or included in a
  sample value.
