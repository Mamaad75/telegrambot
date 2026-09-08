# BAIMAR LEAD INTELLIGENCE

Internal platform for Baimar (بایمر) that answers three questions for the sales team:

1. **Who should we contact?**
2. **What does that business most likely need from us?**
3. **What should the salesperson say?**

A salesperson opens a lead and understands the business in 30–60 seconds.

---

## The principle this is built on

> A list of 10,000 phone numbers is nearly useless. A list of 100 businesses with verified
> information, a real website audit, identified digital weaknesses, a lead score, a
> recommended service, a sales angle, an opening line and objection handling is extremely
> valuable.

Everything below follows from that. In particular, the platform **never invents data**.
Each value on screen is labelled as one of:

| Badge | Meaning |
| --- | --- |
| **واقعیت** (Fact) | Directly observed from a public source |
| **محاسبه‌شده** (Calculated) | Derived from observed data |
| **تخمینی** (Estimated) | Inferred from indirect signals — needs verification |
| **تحلیل هوش مصنوعی** (AI insight) | Written by a language model — check before quoting |
| **نامشخص** (Unknown) | We do not know, and we say so |

There is no code path that fabricates a phone number, a review count, a search volume, a
revenue figure, or a person. When the platform cannot measure something, it says
"not measured" — including in the website audit, which reports *which* checks it could not
perform rather than scoring them zero.

---

## Quick start

### Option A — Docker (recommended)

```bash
git clone <this-repo> baimar && cd baimar

cp .env.example .env
# Generate real secrets — never ship the placeholders:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

docker compose up -d --build
```

Then open <http://localhost:3000> and sign in with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` from your `.env` (defaults: `admin@baimar.local` / `ChangeMe123!`).
**Change that password immediately** in Settings → Users.

Migrations and the service-catalogue seed run automatically on container start.

### Option B — local development

Requires Node 20+, PostgreSQL 14+ and Redis 6+.

```bash
npm install
cp .env.example .env          # point DATABASE_URL and REDIS_URL at your instances

npm run db:migrate            # create the schema
npm run db:seed               # service catalogue + first administrator
npm run db:demo               # optional: 20 clearly-labelled demo businesses

npm run dev                   # API :4000, worker, and dashboard :3000 together
```

### Verify the install

```bash
curl localhost:4000/health
# {"status":"ok","database":"up","redis":"up",...}

npm test                      # 103 unit tests, no database needed
npm run test:e2e              # 33 end-to-end tests (needs Postgres + Redis)
```

---

## What works with nothing configured

The platform is fully usable **without a single API key**. The end-to-end test suite proves
it: it runs the entire journey with no Google key, no AI key and no search key.

| Capability | With zero configuration |
| --- | --- |
| Lead discovery | OpenStreetMap (free, no key) + CSV import + manual entry |
| Website discovery | Domain probing; a search API improves it substantially |
| Website audit | Full — the crawler is built in |
| Lead scoring, business value, opportunity matching | Full — deterministic engines |
| Sales brief | Full — generated from rules, labelled `RULES` |
| CRM, pipeline, follow-ups, exports | Full |
| Market intelligence | Reports "insufficient data" until you import keywords or connect Google Ads / Search Console |
| AI analysis | Off. The brief is still produced by the rules engine |

Adding a provider **enhances** a capability. Removing one **degrades** that capability and
nothing else — a failing vendor never breaks a request. See
[docs/PROVIDERS.md](docs/PROVIDERS.md) for what each integration adds, what it costs, and
how to configure it.

---

## How a lead becomes a call

```
CAMPAIGN
   ↓ DISCOVERY          every enabled lead source, in parallel; a failing one is logged, not fatal
   ↓ NORMALIZATION      Persian text folded, Iranian phones → E.164, URLs → domains
   ↓ DEDUPLICATION      provider identity → phone → domain → city-scoped name/address similarity
   ↓ WEBSITE DISCOVERY  search provider, then domain probing; unconfirmed results are NOT_VERIFIED
   ↓ CRAWL + AUDIT      robots.txt honoured, per-host throttle, byte and time caps
   ↓ SIGNALS            observations become named signals, each with its evidence
   ↓ SCORING            configurable weights, per-group caps, 0–100 with a full breakdown
   ↓ BUSINESS VALUE     separate coarse tier from public signals only — never revenue
   ↓ OPPORTUNITY        database-driven service rules + market demand boost
   ↓ AI (optional)      only above the score threshold, cached, budget-capped
   ↓ SALES BRIEF        why to call, what to sell, what to say, what they'll object to
   READY TO CALL
```

Nothing in that chain runs inside an HTTP request. Endpoints enqueue and return; the
worker does the work and the UI shows live progress.

---

## Repository layout

```
apps/
  api/                  Fastify API + BullMQ workers (the modular monolith)
    prisma/schema.prisma    data model, 30+ models
    src/core/               scoring, business value, dedupe, opportunity, sales brief, market
    src/audit/              website audit engine
    src/crawler/            polite crawler, robots.txt, HTML analysis, tech detection
    src/providers/          provider interfaces + every adapter
    src/services/           orchestration shared by the API and the queue
    src/modules/            HTTP routes
  web/                  Next.js dashboard — Persian, RTL, dark/light
packages/
  shared/               types, enums, RBAC matrix, Persian text and phone utilities
docs/                   architecture, deployment, providers, data policy
docker/                 container entrypoint
nginx/                  reverse proxy configuration
```

Further reading: [Architecture](docs/ARCHITECTURE.md) ·
[Deployment](docs/DEPLOYMENT.md) · [Providers](docs/PROVIDERS.md) ·
[Data & privacy policy](docs/DATA-POLICY.md)

---

## Demo data

```bash
npm run db:demo            # 20 example businesses
npx tsx apps/api/prisma/demo.ts --clean   # remove them
```

Demo rows are safe by construction: every one is flagged `isDemo`, prefixed `[نمونه]`,
uses `*.example.com` (reserved by RFC 2606) for websites, carries a pinned note telling the
salesperson not to dial the placeholder number, and is **hidden from every production list
by default**. Demo market signals are flagged too, so they can never contaminate the real
demand picture.

---

## Operating notes

**Cost control.** AI is the only component that can cost money per lead, and it is gated
four ways: leads below a configurable score are never sent; identical inputs are served
from cache; a monthly USD ceiling stops the queue rather than overspending; and every call
is metered in Settings → Integrations → Usage. A model with no configured price reports
`Unknown` cost rather than being counted as free.

**Crawling.** The crawler identifies itself, honours `robots.txt` and `Crawl-delay`,
throttles per host, caps bytes and time, and makes **no attempt** to bypass bot protection.
A site that declines to be read is recorded as "blocked by robots.txt" and left alone.

**Scaling.** One VPS with 2 CPU / 4 GB runs the whole stack. Under load, run the worker in
its own container (`docker-compose.prod.yml` does this) so a slow crawl never competes with
an HTTP request.

**Backups.** The database is the only stateful component that matters; Redis holds queues
and cache and can be lost without data loss. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API, worker and dashboard together |
| `npm run build` | Build shared package, API and dashboard |
| `npm test` | Unit tests (no infrastructure needed) |
| `npm run test:e2e` | End-to-end tests (needs Postgres + Redis) |
| `npm run typecheck` | Typecheck every package |
| `npm run db:migrate` | Create/apply migrations (development) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Service catalogue + first administrator |
| `npm run db:demo` | Seed demo data |
| `npm run db:reset` | Drop and rebuild the database |

---

## Licensing and attribution

- **OpenStreetMap** data is ODbL licensed. The UI displays the required attribution and
  every lead sourced from it keeps a link to the original object.
- **Vazirmatn** (the Persian UI font) is SIL Open Font License 1.1.
- Google Places, Google Ads and Search Console data are used only through their official
  APIs, under the terms of the account you connect.
