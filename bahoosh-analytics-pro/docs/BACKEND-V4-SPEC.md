# Bahoosh Analytics Pro 4.2 — ASP.NET Backend & AI Contract

This document is the implementation contract for the Bahoosh collector/API used by the WordPress plugin. The backend is intentionally retained: it is the authoritative data, security and AI orchestration plane. WordPress is the collection/UI/action edge.

## 1. Architecture decision

Do **not** connect WordPress directly to an LLM for production analytics decisions. Keep ASP.NET between WordPress and the AI provider.

Recommended data flow:

1. WordPress/browser emits validated analytics events.
2. ASP.NET authenticates the site, validates schema, enforces `(site_id,event_id)` idempotency and stores accepted events.
3. A background pipeline removes/normalizes sensitive fields, sessionizes events and builds aggregates/features.
4. `POST /ai/analyze` creates an analysis job. The AI receives a compact `AnalysisPacket`, never the raw event lake.
5. The model must return structured JSON matching `docs/schemas/ai-recommendation.schema.json`.
6. ASP.NET validates schema, evidence, confidence and the action allowlist before persisting recommendations.
7. WordPress fetches recommendations or ASP.NET pushes them to the signed WordPress callback.
8. WordPress executes only registered allowlisted actions, subject to autonomy/confidence rules, and records an audit trail.
9. WordPress reports the decision/execution result to ASP.NET.

This keeps model/provider changes independent from WordPress and provides privacy filtering, cost controls, retries, auditability, cross-session computation and rollback governance.

## 2. Recommended backend stack

- ASP.NET Core targeting the current supported .NET LTS line.
- PostgreSQL for tenants/sites/configuration, AI jobs, recommendation state and low-to-medium-volume analytics if starting small.
- For high-volume event analytics, add ClickHouse as the append-heavy analytical store. Do not store raw analytics in `wp_posts`/`wp_options`.
- Redis is optional for caching, distributed rate limits, short-lived locks and job status.
- Start with an ASP.NET `BackgroundService`/durable job table. Introduce RabbitMQ/Kafka only when ingestion/AI throughput justifies the operational cost.
- OpenTelemetry for API/worker traces and metrics.

## 3. Ingestion rules

### Authentication headers from WordPress

The plugin sends:

- `X-BAP-Site-Id`
- `X-BAP-Schema-Version`
- `X-BAP-Plugin-Version`
- `X-Api-Key` and `X-BAP-Key` during the compatibility period

The backend MUST bind the API key to the site and MUST NOT trust a body `site_id` that conflicts with authenticated credentials.

### Idempotency

Create a unique database constraint on:

`(site_id, event_id)`

A retry of an already accepted event returns a successful duplicate settlement instead of inserting a second logical event.

### Native v3 event endpoint

The existing WordPress transport contains a temporary v2 batch adapter. Upgrade the collector so `POST /events` accepts one schema-v3 event directly. Once deployed, the adapter in `BAP_Transport::send_event()` can be removed.

Recommended acknowledgement:

```json
{
  "status": "stored",
  "event_id": "evt_...",
  "server_timestamp": "2026-09-08T10:30:00Z"
}
```

Duplicate:

```json
{
  "status": "duplicate",
  "event_id": "evt_..."
}
```

Permanent validation rejection should be a 4xx. Temporary failures/rate limits should be retryable 429/5xx responses and may include `Retry-After`.

## 4. Privacy normalization before AI

The AI input builder MUST operate on normalized facts, not raw request payloads.

Never send to an AI provider:

- raw email, phone, name or postal address;
- IP address;
- passwords/tokens/auth headers;
- form field values;
- payment/card data;
- raw cookies;
- full URL query strings containing identifiers/secrets;
- JavaScript stack traces that may contain secrets;
- arbitrary DOM/page text captured from visitors.

Prefer:

- route/path instead of full URL;
- pseudonymous analytics identity only when genuinely needed;
- aggregate counts, rates, percentiles and deltas;
- coarse country/device/channel;
- evidence IDs that map back to server-side facts.

Maintain an explicit PII classification table and reject new fields from AI packets until classified.

## 5. Server-side derived facts

Compute these in ASP.NET, not in the browser:

- sessions from event timestamps and anonymous/user identity;
- first/last touch and multi-touch journey chains;
- funnel step populations and drop-offs;
- page/path transitions;
- ecommerce metrics, LTV, repeat purchase and cart/checkout abandonment;
- UX issue aggregation: rage/dead clicks, JS errors, poor Web Vitals;
- heatmap buckets normalized by viewport/document dimensions;
- anomalies against comparable prior periods;
- statistically meaningful deltas with sample-size guards.

Keep raw accepted events immutable where practical. Derived models should be rebuildable when session or attribution definitions change.

## 6. Backend API required by WordPress 4.2

All paths are relative to the configured collector API root.

### Existing / compatibility

- `POST events`
- `POST identity/link`
- `GET dashboard`
- existing privacy export/erase endpoints used by the deployed collector

### Experience

`GET reports/experience?site_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD&url=/path&device=mobile`

Response:

```json
{
  "experience": {
    "summary": {
      "rage_clicks": 31,
      "dead_clicks": 18,
      "js_errors": 7,
      "poor_vitals": 11
    },
    "heatmap": {
      "points": [
        { "x_ratio": 0.42, "y_ratio": 0.31, "count": 12, "event_type": "rage_click" }
      ]
    },
    "top_issues": [
      {
        "type": "rage_click",
        "label": "Repeated clicks on checkout CTA",
        "url": "/checkout/",
        "count": 23,
        "severity": "high"
      }
    ]
  }
}
```

`x_ratio` and `y_ratio` MUST be normalized to `0..1`. Do not return raw screen snapshots to this endpoint.

### Journeys

`GET reports/journeys?site_id=...&from=...&to=...&entry=/landing&conversion=purchase`

Response:

```json
{
  "paths": [
    {
      "users": 421,
      "conversion_rate": 7.2,
      "nodes": ["/", "/product/example", "begin_checkout", "purchase"]
    }
  ]
}
```

Bound path length and result count. Collapse very low-frequency paths into `Other` for privacy and usability.

### Funnel report

`POST reports/funnel`

Request:

```json
{
  "site_id": "site_123",
  "from": "2026-09-01",
  "to": "2026-09-08",
  "funnel": {
    "id": "fn_checkout",
    "name": "Checkout",
    "steps": [
      { "label": "Product", "event_type": "view_item", "path": "" },
      { "label": "Cart", "event_type": "add_to_cart", "path": "" },
      { "label": "Checkout", "event_type": "begin_checkout", "path": "" },
      { "label": "Purchase", "event_type": "purchase", "path": "" }
    ]
  }
}
```

Response:

```json
{
  "report": {
    "users": 1000,
    "steps": [
      { "label": "Product", "users": 1000, "conversion_rate": 100.0, "dropoff_rate": 0.0 },
      { "label": "Cart", "users": 420, "conversion_rate": 42.0, "dropoff_rate": 58.0 },
      { "label": "Checkout", "users": 260, "conversion_rate": 26.0, "dropoff_rate": 38.1 },
      { "label": "Purchase", "users": 180, "conversion_rate": 18.0, "dropoff_rate": 30.8 }
    ]
  }
}
```

Define whether funnel membership is user-scoped or session-scoped and expose that mode once supported. Do not silently mix definitions.

## 7. AI analysis API

### Request an analysis

`POST ai/analyze`

Request sent by WordPress:

```json
{
  "site_id": "site_123",
  "from": "2026-09-01",
  "to": "2026-09-08",
  "focus": "conversion",
  "origin": "wordpress"
}
```

Allowed focus values currently are:

- `growth`
- `conversion`
- `ux`
- `retention`
- `revenue`
- `performance`

Prefer an asynchronous job:

```json
{
  "job_id": "airun_01...",
  "status": "queued"
}
```

The WordPress UI can subsequently fetch recommendations. A signed webhook may also push completed recommendations.

### Fetch recommendations

`GET ai/recommendations?site_id=...&status=pending`

Response:

```json
{
  "recommendations": [
    {
      "id": "rec_01...",
      "title": "Create a checkout-friction funnel",
      "summary": "Users with rage clicks on checkout convert materially less often.",
      "rationale": "The issue repeated across a sufficient sample and coincides with a conversion drop.",
      "priority": "high",
      "confidence": 91,
      "impact": "Improve diagnosis of checkout drop-off",
      "evidence": ["fact_ux_103", "fact_funnel_44"],
      "action": {
        "type": "bahoosh.create_funnel",
        "payload": {
          "name": "Checkout friction",
          "steps": [
            { "label": "Checkout", "event_type": "begin_checkout", "path": "" },
            { "label": "Rage click", "event_type": "rage_click", "path": "/checkout/" },
            { "label": "Purchase", "event_type": "purchase", "path": "" }
          ]
        }
      },
      "created_at": "2026-09-08T10:40:00Z",
      "model_run_id": "airun_01..."
    }
  ]
}
```

### Decision callback to backend

`POST ai/recommendations/{id}/decision`

```json
{
  "decision": "approve",
  "wordpress_status": "applied"
}
```

Store both the human decision and execution result. Never infer that approval means execution succeeded.

## 8. AI AnalysisPacket

The model should receive a compact packet similar to `docs/schemas/analysis-packet.schema.json`.

Rules:

- include current and previous comparable periods;
- include denominators, not only percentages;
- include sample sizes;
- include known instrumentation/data-quality warnings;
- include stable evidence IDs for every important fact;
- cap top-N lists;
- exclude raw event streams unless an explicitly approved specialized model needs them;
- include site/business goals only when provided by the site owner, not guessed by the model.

## 9. Structured AI output and evidence validation

Model output MUST be JSON/schema constrained. Do not accept prose and regex it into actions.

Before persisting a recommendation:

1. JSON schema validation.
2. Ensure `confidence` is `0..100`.
3. Validate every evidence ID exists in the run's fact snapshot.
4. Reject claims whose metric/delta contradicts the referenced fact.
5. Validate the action type against the backend allowlist.
6. Validate action payload against that action's versioned schema.
7. Apply business guardrails (minimum sample size, revenue bounds, experiment constraints).
8. Store the exact model/provider/version, prompt/template version, input snapshot hash, output hash, token usage/cost and latency.

Do not let a model invent a URL to call, SQL to execute, PHP to run, a WordPress option name, a user id or a price mutation.

## 10. WordPress action policy

Bahoosh 4 core registers only low-risk internal actions:

- `bahoosh.create_funnel`
- `bahoosh.create_alert`
- `bahoosh.add_annotation`
- `bahoosh.update_dashboard`

These may be eligible for `safe_auto` after confidence checks.

For future site-changing actions use versioned adapters, for example:

- `wordpress.post.update_meta.v1`
- `woocommerce.coupon.create_draft.v1`
- `bahoosh.experiment.create_draft.v1`

Every mutating adapter should define:

- target allowlist;
- input JSON schema;
- preview/dry-run result;
- whether human approval is mandatory;
- reversible state / rollback token when possible;
- idempotency key;
- maximum scope and rate;
- audit record.

Content, pricing, checkout, users, roles, permissions, SEO/indexation and payment settings should **not** be `safe_auto` by default.

## 11. Signed ASP.NET -> WordPress callback

WordPress endpoint:

`POST /wp-json/bahoosh/v2/ai/callback`

Headers:

```text
X-BAP-Timestamp: 1788864000
X-BAP-Signature: <lowercase hex hmac-sha256>
Content-Type: application/json
```

Signature input:

```text
{timestamp}.{raw_request_body}
```

Signature:

```text
HMAC-SHA256(secret, signature_input)
```

The secret is generated in WordPress under Bahoosh AI settings. ASP.NET stores it encrypted at rest per site. WordPress rejects callbacks outside a 5-minute clock window.

Payload:

```json
{
  "recommendations": [ /* recommendation objects */ ]
}
```

ASP.NET should also attach a unique delivery id internally and retry network failures using the identical body. The WordPress recommendation `id` makes storage idempotent.

## 12. AI autonomy modes

WordPress currently exposes:

- `insights`: recommendations only; no execution.
- `approval`: a human approves an executable recommendation.
- `safe_auto`: only actions registered as `safe_auto` may execute automatically, and only above the configured minimum confidence.

Backend policy MUST be at least as strict as WordPress policy. A site with `approval` must never receive a backend instruction assuming automatic execution.

## 13. Recommended AI job tables

Suggested entities:

### `ai_runs`
- `id`
- `site_id`
- `from_utc`, `to_utc`
- `focus`
- `status`
- `model_provider`, `model_name`, `model_version`
- `prompt_version`
- `input_snapshot_hash`
- `input_token_count`, `output_token_count`, `estimated_cost`
- `latency_ms`
- `started_at`, `completed_at`
- `error_code`

### `ai_recommendations`
- `id`
- `run_id`
- `site_id`
- structured recommendation fields
- `action_type`, `action_payload_json`
- `status`
- `created_at`, `decided_at`, `applied_at`

### `ai_decisions`
- `recommendation_id`
- actor/source (`wordpress_user`, `safe_auto`, `backend_policy`)
- decision
- execution status/result/rollback token
- timestamp

## 14. Data quality must gate AI

AI should not make confident optimization recommendations when tracking is incomplete. Generate machine-readable health facts such as:

- event acceptance/rejection rate;
- late/offline event rate;
- duplicate rate;
- purchase vs order reconciliation gap;
- consented traffic share;
- JS tracker coverage;
- collector lag;
- Web Vital sample size.

If quality is below a threshold, recommendations should first say how to repair measurement rather than optimize the business from unreliable data.

## 15. Heatmap implementation

The WordPress tracker already collects interaction coordinates/signals. Aggregate server-side:

- normalize coordinates against document/viewport dimensions;
- bucket by canonical route, device family and viewport band;
- exclude samples below privacy minimums;
- separate click/dead/rage layers;
- optionally maintain selector/element aggregates;
- expire very fine-grained raw coordinates earlier than aggregate heatmaps.

The current WordPress Experience UI consumes normalized points and renders an interaction-density view. Full DOM-snapshot/session-replay rendering is intentionally a separate subsystem.

## 16. Session replay — separate security project

If Bahoosh later implements Clarity-style replay, do not extend the current click tracker into unrestricted DOM capture. Build it as a separate opt-in subsystem with:

- deny-by-default text/input capture;
- masking before data leaves the browser;
- selector-based block/mask/allow policies;
- strict payload and retention caps;
- checkout/account/payment hard blocks;
- sampling;
- tenant-configurable retention;
- privacy review and load testing.

Replay is not required for AI analytics and should not block the v4 backend work.

## 17. Rollout order for backend developer

1. Native schema-v3 single-event ingest + idempotency.
2. Sessionization and aggregate fact tables.
3. Experience report endpoint.
4. Funnel computation endpoint.
5. Journey/path endpoint.
6. AI run persistence + AnalysisPacket builder.
7. Schema-constrained model call + evidence validator.
8. Recommendation APIs + signed WordPress callback.
9. Data-quality gates and cost/rate controls.
10. Later: experiments, advanced attribution, cohorts/LTV, replay.

## 18. Definition of done

Backend v4 is production-ready when:

- event retries never double-count a logical event;
- unsupported event types return deterministic validation errors;
- reports are reproducible from stored facts;
- AI provider receives no prohibited PII;
- every AI claim can be traced to evidence in a stored run snapshot;
- arbitrary AI output cannot execute arbitrary WordPress operations;
- callback signature/replay protections are tested;
- all mutating actions are audited and idempotent;
- failed AI jobs do not affect event ingestion;
- WordPress remains usable if the AI provider is unavailable.
