# Providers and integrations

Every integration is optional. This page says what each one adds, what it costs, and how to
turn it on. Nothing here is required for the platform to run — the end-to-end test suite
runs the complete journey with all of them switched off.

Configure credentials in `.env` on the server and restart the API. They are never entered
in the browser and never returned by any endpoint. Settings → Integrations shows each
provider's state (**Configured / Not configured / Disabled / Error**), which settings are
missing, and a "Test connection" button.

---

## Lead sources — finding businesses

### OpenStreetMap (Overpass) — FREE, no key, **on by default**

The default discovery provider, and the reason the platform needs no Google contract.
Business listings contributed to OpenStreetMap: name, category, address, coordinates, and
often phone, website and social links.

```bash
OVERPASS_ENABLED=true
OVERPASS_ENDPOINT=https://overpass-api.de/api/interpreter
```

City names are geocoded once through Nominatim and cached for 30 days; both services are
rate-limited conservatively. **Attribution is required**: data is ODbL licensed, the UI
displays "© OpenStreetMap contributors", and every lead keeps a link to the source object.

Coverage varies by city and category — dense in Tehran, thinner in smaller towns. It has no
review data, so review count stays "unknown" rather than zero.

### Google Places API — PAID, optional

Official Places API (New). Adds review counts and ratings, opening hours, verified
addresses and a Google Maps link.

```bash
GOOGLE_MAPS_API_KEY=your-key
GOOGLE_PLACES_LANGUAGE=fa
GOOGLE_PLACES_REGION=ir
```

Get a key at <https://console.cloud.google.com/> (enable "Places API (New)", attach
billing). Billed per request — set a budget alert and use the per-day rate limit in
Settings → Integrations. Without the key the adapter reports itself not configured and
discovery continues with the others.

### Web search discovery — depends on a search provider

Finds businesses that have a website but no map listing. Yields a name and a URL only; the
crawler fills in the rest. Enabled automatically when a search provider is configured.

### Manual / CSV — FREE, always available

Leads entered by hand or imported from a spreadsheet, through the same normalization and
deduplication as everything else.

---

## Search — discovering a business's website

Both are used only for website discovery. Without either, the platform falls back to domain
probing, which works for Latin-script business names and is marked **NOT_VERIFIED** until a
human confirms it.

### Brave Search API — FREEMIUM (recommended)

```bash
BRAVE_SEARCH_API_KEY=your-key
```

<https://brave.com/search/api/> — free tier available, straightforward signup.

### Google Programmable Search — FREEMIUM

```bash
GOOGLE_CSE_API_KEY=your-key
GOOGLE_CSE_ID=your-engine-id
```

<https://programmablesearchengine.google.com/> then enable the Custom Search JSON API.
100 queries/day free, billed above that. Configure the engine to search the entire web.

---

## AI — analysis and sales-brief wording

**Entirely optional.** With no AI provider, the rules engine still produces scores,
opportunities and a complete sales brief, labelled `RULES`. AI replaces individual fields
and the result is labelled `HYBRID`.

```bash
AI_PROVIDER=anthropic          # anthropic | openai | compatible | local | none
AI_MIN_LEAD_SCORE=65           # leads below this are never sent to a model
AI_MONTHLY_BUDGET_USD=25       # hard ceiling; 0 disables it
```

| Provider | Variables | Cost |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Paid |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Paid |
| OpenAI-compatible gateway | `COMPATIBLE_AI_BASE_URL`, `COMPATIBLE_AI_MODEL`, `COMPATIBLE_AI_API_KEY` | Varies |
| Local model (Ollama, LM Studio) | `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL` | Free to run |

A local model costs nothing per call and keeps data on your own server:

```bash
ollama serve && ollama pull qwen2.5:7b
LOCAL_AI_BASE_URL=http://localhost:11434/v1
LOCAL_AI_MODEL=qwen2.5:7b
AI_PROVIDER=local
```

**Cost control is built in, four ways:** the score threshold filters before any call;
identical inputs are served from the previous analysis instead of being re-billed; the
monthly ceiling stops the queue rather than overspending; and every call is metered in
Settings → Integrations → Usage. Prices come from an editable table — a model with no
configured price reports `Unknown` cost rather than being silently counted as free.

The model is given a structured snapshot of what was observed and is instructed to return
`نامشخص` for anything the snapshot does not contain. Its output is stored as
`AI_INSIGHT`, never as fact, and off-catalogue service recommendations are discarded in
favour of the deterministic one.

---

## Market intelligence

### Google Ads — FREE (reads your own account)

Reads the search terms that triggered **Baimar's own ads**, with clicks, impressions,
conversions and cost, plus Keyword Planner volume data.

```bash
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=123-456-7890
GOOGLE_ADS_LOGIN_CUSTOMER_ID=      # only when using a manager account
```

Setup: apply for a developer token in your Ads account (API Center), create OAuth
credentials in Google Cloud, and generate a refresh token — see
<https://developers.google.com/google-ads/api/docs/oauth/overview>.

This is aggregate advertising performance. It cannot and does not identify who searched.

### Google Search Console — FREE (reads your own properties)

Queries that bring visitors to **Baimar's own website**, aggregated by Google.

```bash
GSC_CLIENT_ID=...
GSC_CLIENT_SECRET=...
GSC_REFRESH_TOKEN=...
GSC_SITE_URL=https://baimar.ir/       # or sc-domain:baimar.ir
```

Labelled `FIRST_PARTY_BAIMAR` in the UI so nobody confuses it with a signal about a lead's
own market.

### CSV import — FREE, always available

Keyword research exports, Keyword Planner downloads, or a spreadsheet the marketing team
maintains. Column names are detected in Persian and English. This is the fastest way to
make the market dashboard useful without connecting anything.

---

## Notifications

### Telegram — FREE

```bash
TELEGRAM_BOT_TOKEN=...            # from @BotFather
TELEGRAM_DEFAULT_CHAT_ID=...      # optional team channel
```

Individual users add their own chat id in Account. Sends hot-lead alerts, follow-up
reminders, campaign completions and the daily summary.

### E-mail (SMTP) — optional

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=Baimar <no-reply@baimar.ir>
```

### In-app — always on

The notification bell. Written first and always, so a Telegram outage never loses an alert.

---

## The website crawler

Built in, no configuration required, but its budget is tunable in Settings → Crawler:

```bash
CRAWLER_USER_AGENT=BaimarLeadIntelligenceBot/1.0 (+https://baimar.ir/bot)
CRAWLER_RESPECT_ROBOTS=true     # leave true in production
CRAWLER_MAX_PAGES=8
CRAWLER_DELAY_MS=1500           # minimum gap between requests to one host
CRAWLER_TIMEOUT_MS=15000
CRAWLER_MAX_BYTES=2500000
CRAWLER_CONCURRENCY=3
```

The crawler identifies itself with a contactable URL, honours `robots.txt` and
`Crawl-delay`, throttles per host, caps bytes and time, and makes **no attempt** to bypass
bot protection, CAPTCHAs or authentication. A site that declines to be read is recorded as
"blocked by robots.txt" and left alone.

---

## Adding your own provider

1. Implement the interface from `apps/api/src/providers/types.ts`.
2. Add the instance to `buildInstances()` in `apps/api/src/providers/registry.ts`, or call
   `registerProvider()` at runtime.
3. Declare `requiredConfig` in the descriptor — the admin UI derives the
   "Not configured" panel from it automatically.
4. Implement `healthCheck()` so the "Test connection" button works.

Rate limiting, usage accounting, cost tracking, error containment and the admin toggle all
come from the registry. There is nothing else to wire up.
