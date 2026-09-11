# Architecture

WP Event Publisher turns a WordPress publication into one or more messages
on other services. This document describes how, layer by layer, and why each
boundary is where it is.

The plugin has no Composer dependency, no build step and no framework. It is
plain PHP 8.1+ with a WordPress-style autoloader.

---

## The shape of one publication

```
  WordPress fires a hook
        │
  HookRouter ─────────► EventDetector ──► "is this an advertisement event?"
        │                                  (idempotency, eligibility, back-catalogue bound)
        ▼
      Event  ──────────► Queue (durable table)
        │
        ▼
  Dispatcher ──────────► inline at shutdown, or WP-Cron, or the sweeper
        │                (retry policy, backoff, delivery counters)
        ▼
  Normalizer ──────────► everything WordPress knows about the post
        │
        ▼
  Publisher ┬─► RuleContext ──► RuleEngine ──► RuleOutcome
            │                                  (which profile, which template,
            │                                   which destinations, skip, delay)
            ├─► ProfileRepository ──► Profile  (fields, order, images, template)
            ├─► FieldRegistry + FieldResolver ─► mapped field values
            ├─► MessageTemplate ──────────────► the rendered message
            └─► Contract ─────────────────────► the wire payload
                        │
                        ▼
                  Publication          ← one normalized object
                        │
        ┌───────────────┼───────────────┬──────────────┐
        ▼               ▼               ▼              ▼
   Telegram         Discord          Slack          E-mail        (DeliveryProvider)
   (Node.js webhook)                                Generic webhook
        │
        ▼
     Logger  ← every step, with its outcome
```

Two boundaries carry most of the weight:

- **`Publication` separates message generation from delivery.** Everything
  above it decides *what* to publish; everything below it decides *how to put
  it on a wire*. Every destination receives byte-identical data, so Discord
  and Telegram cannot drift apart.
- **`Publisher::build()` has no side effects.** It produces a publication and
  a plan without sending anything, which is what makes the Rule Tester able
  to show exactly what would happen.

---

## Layers

### 1. Detection

| Class | Responsibility |
| --- | --- |
| `HookRouter` | Subscribes to all 13 publishing hooks and logs which fired |
| `EventDetector` | Decides whether a state change is a `created` / `updated` / `deleted` event; owns idempotency, the publish cooldown, the delete-once guard and the back-catalogue bound |
| `Event` | Immutable identity of one lifecycle event |
| `EventId` | Issues and persists stable `evt_…` identifiers |

Delivery never depends on which hook a given publishing path happens to
fire. The router listens to all of them and the detector collapses them into
one event, keyed on the *logical publication* rather than the derived type.

### 2. Queue and delivery

| Class | Responsibility |
| --- | --- |
| `Queue` | Durable table with an atomic claim; survives object-cache flushes |
| `Dispatcher` | Inline-plus-cron dispatch, the sweeper, the retry budget, delivery counters |
| `RetryPolicy` | Classifies a failure as permanent or transient; backoff with jitter and `Retry-After` |
| `Webhook` | The HTTP transport: signing, timeout guards, `http_request_args` re-assertion |
| `Signer` | HMAC-SHA256 over `timestamp . "." . raw_body` |

An advertisement is delivered inline at the end of the publish request, with
WP-Cron as a backstop and a sweeper behind that. At most three are delivered
inline per request; the rest wait in the queue so a bulk action never chains
dozens of serial HTTP calls onto one page load.

### 3. Field discovery

| Class | Responsibility |
| --- | --- |
| `FieldProvider` (interface) | `id`, `label`, `is_available`, `discover`, `resolve`, `signature` |
| `BaseProvider` | Meta reading, label generation, type guessing |
| `CoreProvider` | Native post fields |
| `MetaProvider` | Every meta key the post type actually uses, from one grouped query |
| `TaxonomyProvider` | Every taxonomy, plus derived `_top` / `_leaf` / `_path` fields |
| `ImageProvider` | Featured image, gallery, and the two combined |
| `JetEngineProvider`, `AcfProvider`, `MetaBoxProvider`, `PodsProvider` | Optional; read a framework's own definitions when it is installed |
| `FieldRegistry` | Merges every available provider and caches the result |
| `Field` | One field descriptor: key, label, storage key, type, choices, children |
| `FieldResolver` | Turns a field plus a post into a structured value and a display string |

**No framework is ever required.** An optional provider reports itself
unavailable and contributes nothing; the generic meta scan finds the same
keys regardless. When a framework *is* present its description wins — real
label, declared type, actual choice list — and the key is listed once.

The discovery cache key includes **every provider's signature**, so
activating ACF, editing a JetEngine meta box or updating a plugin rebuilds
the list without anybody clearing a cache.

### 4. Configuration

| Class | Responsibility |
| --- | --- |
| `FieldMapping` | Per-scope mapping (post type, or post type + term) with inheritance |
| `Profile` | One complete publishing configuration, storing only its overrides |
| `ProfileRepository` | Profile CRUD, inheritance resolution, scope assignment, import/export, validation |
| `MessageTemplate` | `{{field}}`, `{{#if}}`, `{{#unless}}`; nothing else |
| `DynamicPayload` | The `fields` object, the `field_meta` that describes it, and the category summary |
| `Contract` | The wire format — the only class that knows it |

`DynamicPayload::describe()` is the single join point where the effective
mapping, the discovered `Field` objects and the resolved values are all in
hand at once. Both `fields` and `field_meta` are built there, in one pass —
one discovery, one resolution — and reconciled after filtering, so the values
and their descriptions can never disagree about what was sent. Nothing else in
the plugin performs a second discovery pass to describe a field.

Two independent hierarchies meet here, and keeping them apart is deliberate:

- **Profile inheritance** (`Default → Cars → SUV`) merges *configuration*.
- **Scope assignment** maps a post type or term onto *one profile*, resolving
  outwards from the post's deepest term.

Neither has to know about the other.

### 5. Rules

| Class | Responsibility |
| --- | --- |
| `Rule` | A condition group plus a list of actions |
| `RuleContext` | Every fact a condition can ask about one advertisement, computed once |
| `RuleEngine` | Storage, ordering, evaluation, validation |
| `RuleOutcome` | The accumulated decisions **and the trace that produced them** |

Rules never act. They accumulate decisions in a `RuleOutcome`, and the
publisher acts on the result. That is what lets the Rule Tester render a full
prediction with no side effects, and what lets every delivery log record
*why* it went where it went.

### 6. Destinations

| Class | Responsibility |
| --- | --- |
| `DeliveryProvider` (interface) | `id`, `label`, `settings_schema`, `initialize`, `validate`, `send`, and five `supports_*` capability reports |
| `BaseDeliveryProvider` | JSON posting, response classification, retryability, SSRF refusal, message clamping |
| `TelegramDeliveryProvider` | The Node.js Telegram Publisher webhook — the default |
| `WebhookDeliveryProvider` | Any endpoint, optionally HMAC-signed |
| `DiscordDeliveryProvider`, `SlackDeliveryProvider`, `EmailDeliveryProvider` | Rich embeds, Block Kit, `wp_mail()` |
| `DestinationRegistry` | Registered providers and configured destinations |
| `Publisher` | The workflow: build a plan, deliver it, schedule what is delayed |

A **provider** is a kind of service. A **destination** is one configured
instance of it — five Telegram channels are five destinations sharing one
adapter, each with its own template, image limit and delay.

---

## Extending

### A new field framework

```php
add_filter( 'wpep_field_providers', function ( array $providers ): array {
    $providers[] = new My_Framework_Provider(); // implements WPEventPublisher\FieldProvider
    return $providers;
} );
```

Extend `BaseProvider` for meta reading, label generation and type guessing.
Providers later in the list win when two describe the same storage key.

### A new destination service

```php
add_filter( 'wpep_delivery_providers', function ( array $providers ): array {
    $providers[] = new My_Service_Provider(); // implements WPEventPublisher\DeliveryProvider
    return $providers;
} );
```

**The core plugin needs no change.** The Destinations screen builds its
settings form from the provider's own `settings_schema()`, so a new adapter
gets a working admin UI without shipping any admin code. WhatsApp, Teams, a
CRM or an internal queue are each one class.

### A new rule subject

```php
add_filter( 'wpep_rule_subject_value', function ( $value, $subject, $key, $context ) {
    return 'my_subject' === $subject ? my_lookup( $context->post() ) : $value;
}, 10, 4 );
```

---

## Failure containment

The rule is that a publishing plugin must never be why an administrator
cannot reach their dashboard, and never why an advertisement silently
vanishes.

| Failure | Contained how |
| --- | --- |
| Anything during boot | Caught in `Plugin::boot()`; becomes an admin notice naming the file and line |
| A field provider throws during discovery | That provider contributes nothing; the rest of the list is built |
| A delivery adapter throws | Becomes a failed, retryable delivery result |
| A message template throws | Falls back to title + permalink and logs why |
| A condition cannot be evaluated | The rule is traced as "not matched" and publication continues |
| A framework is deactivated after mapping | The value is still in post meta, so the field keeps resolving |
| A field disappears from a post type | The mapping entry is dropped, not sent empty |
| A mapped destination is removed | Skipped with a log line |
| A delivery kills the process | The claim already counted the attempt, so it retires instead of looping |

---

## Storage

| Option | Contents | Autoloaded |
| --- | --- | --- |
| `wpep_settings` | Endpoint, credentials, post types, timeouts | yes |
| `wpep_field_mappings` | Per-scope field mappings (1.4.0) | no |
| `wpep_profiles` | Every profile | no |
| `wpep_profile_assignments` | Scope → profile | no |
| `wpep_rules` | Every rule | no |
| `wpep_destinations` | Every configured destination | no |
| `wpep_delivery_stats` | Lifetime counters | no |
| `wpep_fields_generation` | Discovery cache generation | no |
| `wpep_seen_fields` | Which keys a post type has shown, for the NEW badge | no |
| `wpep_installed_at` | Back-catalogue cutoff | no |
| `wpep_queue_has_work` | Whether the sweeper needs to run at all | yes |

| Table | Contents |
| --- | --- |
| `{prefix}wpep_queue` | Events awaiting delivery, with an atomic claim |
| `{prefix}wpep_logs` | Structured delivery log |

Discovered fields live in transients keyed by a hash of every provider's
signature.

---

## Security posture

- Every admin screen and every AJAX endpoint checks
  `current_user_can( 'manage_options' )` **and** a nonce before reading input.
- Submitted keys are checked against what actually exists: a field key that
  is not discovered, a scope the site does not have, a provider that is not
  registered, and an unknown visibility or operator are all discarded.
- An unknown visibility falls back to **hidden**, never to visible.
- Destination URLs are refused unless absolute HTTPS to a non-private
  address — plain HTTP, `localhost`, RFC 1918 space and the cloud metadata
  address are all rejected, because a destination URL is administrator input
  that the server then fetches.
- A Telegram bot token typed into the destination's bot field is refused
  outright: bot tokens belong in the Node.js service.
- Password-typed settings are never rendered back to the browser; the screen
  shows a marker and an unchanged marker keeps the stored value.
- No credential is ever passed to `wp_localize_script()`, written to the log,
  or included in a sample value or export.
- Templates are stripped of tags, length-bounded and **never evaluated**:
  `<?php` and `[shortcode]` stay literal, and a field value containing
  `{{price}}` is printed rather than expanded.
- Everything the server returns is inserted into the DOM as text.
