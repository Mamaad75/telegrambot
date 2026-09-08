# Architecture

## Shape: a modular monolith

One API process, one worker process, one database. Modules are separated by directory and
by interface, not by network hop. A 2 CPU / 4 GB VPS runs the whole thing, and a developer
can follow a lead from discovery to sales brief without leaving the repository.

Microservices were rejected deliberately: the coupling here is *data* coupling (a lead's
audit feeds its score which feeds its brief), and splitting that across services would add
failure modes without removing any.

```
┌───────────────┐     ┌──────────────────────────────────────────┐
│  Next.js web  │────▶│  Fastify API                              │
│  (RTL, fa-IR) │     │   auth · leads · campaigns · market ·      │
└───────────────┘     │   settings · providers · CRM · dashboard   │
                      └───────────┬──────────────┬───────────────┘
                                  │              │
                          ┌───────▼──────┐  ┌────▼─────┐
                          │  PostgreSQL  │  │  Redis   │
                          │  (Prisma)    │  │ queue +  │
                          └───────▲──────┘  │ cache +  │
                                  │         │ ratelimit│
                      ┌───────────┴──────┐  └────▲─────┘
                      │  BullMQ workers  │───────┘
                      │  campaign · lead · ai · notification · market
                      └───────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Provider registry  │  ← every external system enters here
                    └────────────────────┘
```

## The provider registry is the load-bearing idea

No capability may depend on one vendor. Each capability is an interface
(`src/providers/types.ts`); adapters implement it; the registry decides which are usable.

```
LeadSourceProvider   ← OpenStreetMap · Google Places · web search · manual/CSV
SearchProvider       ← Brave · Google Programmable Search
WebsiteProvider      ← built-in polite crawler
AIProvider           ← Anthropic · OpenAI · any OpenAI-compatible endpoint · local model
KeywordInsightProvider ← Google Ads · Search Console · CSV import
NotificationProvider ← Telegram · SMTP · in-app
```

The registry:

1. instantiates every adapter, configured or not, so the admin UI can list them all;
2. merges the code-level descriptor with the database row (enabled flag, rate limits,
   priority) so an administrator can turn one off without a deploy;
3. hands out **only** adapters that are both enabled and configured;
4. wraps every call in `callProvider`, which applies the rate limit, records usage, and
   converts any failure into a `ProviderError`.

`firstSuccessful()` walks a list of interchangeable adapters and returns the first that
works, collecting the failures. That is why a Google outage degrades discovery to
OpenStreetMap instead of failing the campaign.

**Google Maps is never required.** The default discovery provider is OpenStreetMap, which
needs no key. If `GOOGLE_MAPS_API_KEY` is absent the adapter reports itself as
not configured and is skipped.

## Data model, and why it looks like this

`apps/api/prisma/schema.prisma`. Three decisions drive the shape:

**Every fact keeps its source.** `LeadSourceReference` records which provider supplied
which fields, with the URL of the original record. The lead detail screen can therefore
show "phone: from OpenStreetMap node/12345" and link to it. Deduplication merges leads,
never source references.

**Every derived number keeps its reasons.** `LeadScore.breakdown` stores each contributing
signal with its points, its evidence and its confidence. `BusinessSignal` stores the
individual observations. A score is never a bare number a salesperson has to trust.

**Nullable means unknown.** `reviewCount` is null when no source reported reviews — not
zero. `WebsiteAudit.seoScore` is null when SEO could not be evaluated, and
`WebsiteAudit.unavailable` lists which checks were skipped and why. The UI renders those as
"unknown" and "not measured".

## Request path vs. work path

HTTP endpoints validate, authorize, read or enqueue, and return. Nothing that touches the
network or iterates over hundreds of rows happens inside a request.

Five queues, each with a concurrency chosen for what it does:

| Queue | Jobs | Concurrency | Why |
| --- | --- | --- | --- |
| `campaign` | `discover_businesses`, | 1 | one long run at a time |
| `lead` | `normalize_lead`, `deduplicate_lead`, `discover_website`, `crawl_website`, `audit_website`, `calculate_score` | `CRAWLER_CONCURRENCY` | bounded by politeness, not CPU |
| `ai` | `analyze_lead`, `generate_sales_brief` | 1 | keeps spend predictable |
| `notification` | `send_notification` | 2 | |
| `market` | `market_analysis` | 1 | |

Every job is recorded in `JobLog` with its payload, result, duration and error, and every
job has a retry policy. Failures are visible in Settings → Logs rather than being lost.

## The engines

All of these are pure functions over data. They have no I/O, which is why they are
straightforward to test and why the same code runs from the API and from the worker.

**Deduplication** (`core/dedupe.ts`) — ordered from "cannot be coincidence" to "probably
the same place": provider identity → normalized phone → website domain → identical name key
within a city → fuzzy name similarity within a city → name plus address similarity. Below
the threshold it creates a separate lead: a duplicate a human can merge is far less
damaging than two different businesses silently welded together. Merging fills gaps only
and never overwrites a conflicting value.

**Scoring** (`core/scoring.ts`) — signals are grouped (presence, website quality, missing
capability, potential) and each group is capped. Without caps, a single audited website
stacks a dozen small findings and pins every audited lead at 100/100, which destroys the
ranking the sales team actually needs. Counter-signals (a genuinely modern site) are
uncapped and pull the score down. Weights, thresholds and caps are all editable in
Settings → Scoring, and changing them offers to re-score every lead.

**Business value** (`core/business-value.ts`) — deliberately separate from the lead score.
Lead score = how likely we have an opportunity. Business value = how commercially
attractive the business looks, from public signals only, expressed as one of four coarse
tiers with its reasons. It is never presented as revenue, because we have no legitimate
source for revenue.

**Opportunity matching** (`core/opportunity.ts`) — reads service rules from the database.
Adding a service and describing when it applies is an admin action, not a deploy. Rules
support `requiresAll` / `requiresAny` / `excludes`, so "redesign" never fires for a business
with no website. Capability gaps are gated by business type: "no online store" is a signal
for a shop, not for an accountant.

**Sales brief** (`core/sales-brief.ts`) — deterministic first, always. AI output overlays
individual fields and the result is marked `HYBRID`, so it is always clear which sentences
a model wrote. Openings are built only from observations we can defend if the business
owner pushes back.

## Website audit

`audit/engine.ts` crawls a small, polite sample and turns markup into six normalized scores.
The primitive is a *check* with three outcomes — pass, fail, or **unavailable**.
Unavailable checks are excluded from the denominator and reported to the UI. This is what
lets the platform be honest: it does not run Lighthouse, so it reports Core Web Vitals as
not measured rather than inventing numbers.

Politeness is not configurable away in production: identified user agent, `robots.txt` and
`Crawl-delay` honoured, one request per host at a time, byte and time caps, and no
bot-protection evasion of any kind.

## Market intelligence

Aggregates only what Baimar is entitled to hold: its own Google Ads search terms, its own
Search Console queries, and imported keyword research. Signals are scored on log scales so
one large campaign cannot dominate, and a service with fewer observations than
`minSampleSize` reports `INSUFFICIENT_DATA` with the reason — never a fabricated volume.

There is no code path anywhere in this repository that stores or requests an individual
person's search activity. See [DATA-POLICY.md](DATA-POLICY.md).

## Security

- Passwords: scrypt (Node standard library — no native addon, so the image builds
  anywhere), 16-byte salt, timing-safe comparison, enforced policy.
- Sessions: short-lived JWT access tokens; refresh tokens are opaque, stored only as
  SHA-256 hashes, rotated on use and revoked on password change.
- Provider credentials: AES-256-GCM at rest, never returned by any endpoint. The provider
  API returns *which* settings are missing, never their values.
- RBAC: one matrix in `packages/shared/src/permissions.ts`, enforced by the API and used by
  the web app to hide controls — so the UI and the server can never disagree.
- Row-level visibility: a salesperson's queries are scoped to their assigned leads at the
  query level, not by filtering in the client.
- Helmet headers, strict CORS allow-list, global and per-route rate limits, Zod validation
  on every input, Prisma parameterised queries throughout.
- Audit log: every action that changes data records who, what, before, after and from where.
