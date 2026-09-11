# AI product creation

A customer gives Jarchi the little they have — a name, a photo, maybe a price —
and the backend writes the listing, matches it to their store's taxonomy, and
publishes it to WooCommerce once a person approves.

The feature is **off** until `AI_ENABLED=true`. With it off, the endpoints
answer `503 AI_DISABLED` and nothing else in the backend behaves differently.

## Flow

```
customer panel / WordPress plugin
   │  POST /api/ai/products or /api/sites/:siteId/ai/products            (returns in milliseconds)
   ▼
product draft  ──────────────────────────────┐
   │  ai_jobs: generate                      │ version 1..n kept forever
   ▼                                         │
worker ──▶ image analysis (vision, optional) │
       ──▶ content + SEO generation          │
       ──▶ schema validation ────────────────┘
   ▼
awaiting_review  ──▶ customer edits / regenerates a section
   │  approve
   ▼
approved ──▶ ai_jobs: publish ──▶ media upload ──▶ taxonomy matching
   │                                                     │
   ▼                                                     ▼
published  ◀────────────── WooCommerce product ◀── create or update
```

Two modes, decided per site:

| Mode | Settings |
| --- | --- |
| **Assisted** (default) | `require_manual_approval = true`, `auto_publish = false` — nothing reaches the store until the customer approves |
| **Automatic** | `require_manual_approval = false` **and** `auto_publish = true` — generation queues its own publish job |

Automatic mode is never a side effect of anything: both flags must be set
deliberately, and enabling `auto_publish` writes a warning to the log.

## Draft lifecycle

```
draft → analyzing → generated → awaiting_review → approved → publishing → published
```

Failure states: `generation_failed`, `validation_failed`, `approval_rejected`,
`publishing_failed`. Terminal: `published`, `cancelled`.

Transitions are enforced in `services/productDrafts.js`; an illegal one is
refused with `CONFLICT` rather than quietly applied.

## Modules

```
src/ai/
  index.js              provider selection (openai | mock), injectable for tests
  errors.js             AI error taxonomy + safe customer messages
  sanitize.js           prompt-injection defence, HTML/text/slug sanitizing
  providers/base.js     the interface all business logic depends on
  providers/openai.js   OpenAI-compatible: structured JSON, vision, images
  providers/mock.js     deterministic provider for tests
  prompts/              versioned prompt templates (product-content@v1, …)
  schemas/              strict validation of model output
  seo/rules.js          length and keyword guidelines
  product/generator.js  orchestration: analyse → write → validate
  product/taxonomy.js   matching suggestions against the store's terms
  image/validation.js   magic-byte sniffing, dimensions, size

src/services/
  productDrafts.js         drafts, versions, state machine
  productJobs.js           job queue
  productImages.js         image storage on disk, WordPress media ids
  productPublisher.js      draft → WooCommerce, idempotent
  siteProductSettings.js   per-site automation rules
  aiUsage.js               quota reserve/commit/release
  woocommerce.js           encrypted connections + REST client

src/workers/productWorker.js   generation, regeneration, image, publish handlers
src/routes/aiProducts.js       customer API
src/routes/admin/ai.js         admin visibility
```

## Never inventing facts

The rule that shapes the prompts, the schema and the publisher alike: marketing
language is generated, facts are not.

- Every attribute carries a `source`: `user_provided`, `image_analysis` or
  `inferred`. Anything `inferred` is marked `requires_review`.
- **Inferred attributes are not written to WooCommerce.** They appear in the
  review screen as suggestions; a person can accept them by editing the draft.
- Image observations carry `certain` / `likely` / `uncertain`.
- The model is instructed to omit rather than guess, and to list uncertainties
  in `warnings`, which are stored on the draft and shown to the customer.

## Validation

`ai/schemas/generatedProduct.js` is the only door model output passes through.

- Structurally unusable output (not an object, no title, no derivable slug)
  throws `AI_VALIDATION_ERROR`; the job retries with a firmer instruction, and
  after `AI_MAX_RETRIES` the draft lands in `validation_failed`. **Unvalidated
  output is never stored.**
- Usable-but-imperfect output is accepted with warnings: over-long meta
  description, missing keyword, thin description, duplicate tags.
- Text is sanitized: descriptions keep a small structural HTML subset (no
  script, style, iframe, links, images or event handlers); titles, meta
  descriptions and alt text are plain text; slugs are normalized; tags are
  deduplicated and bounded.

## Regeneration

`POST /api/ai/products/:id/regenerate` with a `section`:
`content`, `title`, `description`, `seo`, `tags`, `categories`.

Only that section's fields are written. Any field the customer edited by hand is
in `locked_fields` and survives every later regeneration — editing the title and
regenerating the description keeps the title exactly as written.

## Versioning

Every generation, regeneration and customer edit appends a row to
`ai_product_versions`. Nothing is overwritten. The draft records
`current_version`, `approved_version` and `published_version`, so it is always
answerable which text a customer approved and which text reached the store.

## Idempotency

| Operation | Guard |
| --- | --- |
| Create draft | `Idempotency-Key` header → unique index on (user, key); a repeat returns the original draft |
| Start generation | partial unique index on (draft, type) for open jobs → a second click joins the running job |
| Publish | the same index, **plus** `wc_product_id` on the draft, **plus** a lookup for a product carrying `_jarchi_draft_id` in the store |
| Media upload | `wp_media_id` recorded per image; an uploaded image is never sent twice |

The third publish guard matters: if a previous attempt created the product but
died before recording the id, the next attempt finds it by meta key and updates
it instead of creating a duplicate.

## Quota

Quotas come from the customer's existing subscription plan
(`plans.ai_products_per_month`, `plans.ai_images_per_month`; `-1` = unlimited,
`0` = not included).

```
check → reserve → execute → commit
                          └─ release (job failed permanently)
```

The check and the reservation are one SQL statement, so two requests cannot both
spend the last credit. Every generation *and* regeneration costs one product
credit, because each is a real provider call. Image analysis rides along with a
generation and is recorded but not charged.

Seeded defaults: trial 3, monthly 20, quarterly 60, semiannual 120, annual 300.

## WooCommerce connection

Per site, entered by the customer, encrypted with `PLATFORM_CREDENTIAL_KEY`:

- WooCommerce consumer key/secret — products, categories, tags, attributes
- WordPress username + application password — media uploads (`wp/v2/media`),
  which WooCommerce keys cannot do

The base URL is **pinned to the hostname already registered for the site**, and
every request re-checks that the address does not resolve into a private
network. `getConnectionView` is the only projection routes may return: status,
last test result, and a masked key hint.

## Categories, tags and attributes

The store's existing terms are fetched and given to the model, which is told to
reuse them. Suggestions are then matched in `ai/product/taxonomy.js`:

| Result | Action |
| --- | --- |
| exact (after normalizing Persian/Arabic letter variants) | reuse the term |
| possible (≥ 0.6 token overlap) | reuse, and record it as a "possible" match |
| no match | create **only** if the site allows it, otherwise skip and report |

`allow_category_creation` is off by default — automated category creation is how
a catalogue turns to noise. `allow_tag_creation` is on, capped at five new tags
per product.

Attributes are mapped to global WooCommerce attributes where the name matches;
otherwise they become product-level custom attributes.

## Images

Uploaded via raw body (`Content-Type: image/png|jpeg|webp`) or base64 JSON — no
multipart dependency. Validation reads the file's own magic bytes and container
header: a PHP script named `.png` is rejected on content, not on extension.
Bytes live under `AI_MEDIA_DIR`; PostgreSQL stores only metadata and references.
Uploads never attached to a product are swept after `AI_MEDIA_TTL_HOURS`.

Generated images are additive: they never replace the customer's own photo
unless the site sets `replace_original_image`.

## Language

The prompt receives a language code (site setting → request → `AI_DEFAULT_LANGUAGE`).
Persian is the default and the tested path; nothing in the business logic is
Persian-specific, so `en`, `ar`, `tr` and others work by changing the setting.

## Admin visibility

`/api/admin/ai/*` — overview, jobs (retry/cancel/run), drafts, usage per user,
and failing WooCommerce connections. Reads need `ai.view` (every role);
acting needs `ai.manage` (admin and super admin), and every action is audited.
Admins see draft *status*, never the customer's generated copy.


## WordPress plugin integration

The first-party plugin can now enter the same pipeline without impersonating a customer session.
It authenticates with the site webhook secret and sends a deterministic source key (`post:<id>` or
`product:<id>`). The backend resolves the site owner, applies the existing subscription quota, queues
the same durable AI jobs, and exposes the same review/publish lifecycle.

This is intentionally an integration boundary, not a second product engine: prompts, validation,
versions, quotas, image storage, taxonomy matching and WooCommerce publishing remain shared.
