=== Bahoosh Analytics Pro ===
Contributors: bahooshdevelopers
Tags: analytics, woocommerce, tracking, gdpr, ecommerce, funnels, ai, heatmap
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 4.19.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

First-party analytics, experience intelligence, funnels, journeys and safe AI orchestration for WordPress and WooCommerce, with durable duplicate-safe event delivery.

== Description ==

Bahoosh Analytics Pro is the WordPress edge for the Bahoosh analytics and
intelligence platform. It collects behavioural events in the browser and on the
server, provides a WordPress-native analytics workspace, and connects to a
collector/AI backend through a controlled, auditable contract.

**Duplicate-safe, idempotent delivery.** Every event carries a globally unique
id that is generated where the event happens and remains stable across retries.
It is used by the browser queue, WordPress outbox and collector deduplication.
When the collector enforces uniqueness on `(site_id,event_id)`, a timed-out
request, retried delivery, reloaded thank-you page or `sendBeacon` replay
converges on one logical analytics record instead of being double-counted.

**Durable delivery across ordinary network failures.** Events are persisted
before delivery where supported and retried with stable ids. Browser storage
can still be evicted by the user/browser and configured queue capacity or
retention can expire old events, so the plugin intentionally makes no absolute
"zero data loss" claim.

**Two identifiers, two jobs.** One anonymous identifier per browser, which never
rotates, and the WordPress user id for the person. Sessions are not modelled by
the tracker at all — they are derived from the stored events afterwards, so the
window can be changed retroactively instead of being fixed when the data was
collected. Every event carries the id of the page view it belongs to.

**WooCommerce orders are recorded server-side.** Browser-side purchase tracking
loses orders whenever a shopper closes the tab on the way back from a payment
gateway, and duplicates them whenever a thank-you page is reloaded. Purchases
and refunds are emitted from order hooks with ids derived from the order, and
three independent mechanisms collapse WooCommerce's repeated hooks into one
event.

= Privacy =

* Three consent categories: analytics, marketing, personalization.
* Works with your existing consent banner — no second banner.
* Do Not Track and Global Privacy Control are respected by default.
* IP addresses are truncated before storage.
* Password, login, password-reset and checkout-payment forms are never
  instrumented, and credential-like URL parameters are redacted.
* WordPress personal-data export and erasure tools are supported.
* No passwords, tokens, card details, raw email addresses, form values or
  browser fingerprinting signals are ever collected.

= What it tracks =

Page views, clicks, searches, time on page, scroll depth, outbound clicks, file
downloads, form views/starts/submissions, logins and signups. Version 4 can also
collect opt-in experience signals for rage clicks, dead clicks, JavaScript
errors, Web Vitals, HTML5 media engagement and privacy-safe copy behaviour.

With WooCommerce: product views, list views, cart add/remove, cart views,
checkout start, payment info, purchases and refunds.

= Intelligence workspace =

Version 4 adds WordPress-native Experience, Funnels, Journeys and AI Center
screens, a no-code funnel definition builder, dashboard layout customization,
module toggles, interface density/accent controls and a signed AI recommendation
callback. Heavy aggregation and AI model calls belong in the collector/ASP.NET
backend rather than the WordPress database.

AI output is treated as untrusted. Core WordPress execution is restricted to a
small action registry, confidence/autonomy policies and an audit trail; arbitrary
model-generated PHP, SQL, URLs or WordPress option changes are not executable.

= For developers =

    bahoosh('track', 'custom.newsletter_signup', { placement: 'footer' });
    bahoosh('consent', { analytics: true, marketing: true });
    bahoosh('getState');
    bahoosh('reset');

The tracker is available before the script loads — calls are queued and
replayed. PHP-side filters cover settings, tracking decisions, event types,
event payloads, identity, consent, dashboard cards and panels, and reporting
capabilities.

== Installation ==

1. Upload the plugin to `/wp-content/plugins/` and activate it.
2. Go to **Bahoosh Analytics → Settings**.
3. Enter your collector URL, site ID and API key.
4. Check **Bahoosh Analytics → Diagnostics** to confirm everything is working.

Upgrading from version 1? Your existing `AAT_API_URL`, `AAT_SITE_ID` and
`AAT_API_KEY` constants are read automatically on first activation, and
returning visitors keep their identity. See the migration guide in the
plugin documentation.

== Frequently Asked Questions ==

= Does it slow down my site? =

The tracker is deferred to the footer and ships as a single file. Scroll
measurement is throttled to one animation frame, click tracking is limited to
interactive elements by default, and the number of concurrent requests is
capped. Settings are autoloaded so tracking adds no database query to a page
load.

= Is my API key safe? =

Yes. In the default transport mode the key never leaves your server: the
browser posts to WordPress, and WordPress adds the credential before forwarding.
Your key does not appear in page source, in URLs, or in browser history.

= What happens if my collector goes down? =

Pending events remain in the durable queue where supported and delivery retries
with exponential backoff, re-sending the identical event id so the repeat is
recognised rather than stored twice. Authentication failures pause delivery
instead of treating the event as accepted. Browser storage eviction and
configured queue retention/capacity remain real limits, so recovery is durable
rather than an absolute no-loss guarantee.

= Does it work with caching plugins? =

Yes. No visitor-specific markup is added to anonymous pages. Logged-in visitors
receive a per-user token, so exclude authenticated responses from full-page
caching — as most caching plugins already do.

= Does it work with a consent banner? =

Yes. Set `window.bapConsent` before the tracker loads, or dispatch a
`bap:consent` event, or call `bahoosh('consent', {...})`. With "require
consent" enabled, nothing is collected until analytics consent is granted.

== Changelog ==

= 4.19.0 =
* New: A click-and-scroll heatmap on the dashboard, drawn over the real page. Pick a page and a device width; the page is loaded in a frame and the click density is painted on top of it, with a scroll mode showing the share of visitors who reached each quarter of the page.
* Fixed: Click coordinates were being collected and thrown away. The tracker has sent `page_x`, `page_y` and the viewport width since the first version, and the event table has no column for any of them, so every one of those numbers was discarded at the moment it arrived. Nothing was wrong with the tracker; there was nowhere for the data to go. Because of that there is no history to draw: the heatmap starts filling from this version onward.
* New: The heatmap is stored as a count grid — the page divided into 40 columns and 40-pixel bands, one counter per cell — not as individual clicks. It stays small on a busy shop, it is one write with no read, and no visitor's click path can be reconstructed from it. There is no visitor id and no per-click timestamp in the table.
* New: The x coordinate is stored as a fraction of the viewport width rather than as a pixel. 300px is the gutter of a desktop and the middle of a phone; storing the raw pixel would put the same tap in two different places on the same grid.
* New: Scroll depth is reported as the share of page views that reached each quarter. Where a page has milestones recorded but no page views to divide by, the count is shown and the percentage is withheld rather than computed against zero.
* Improved: Viewing a heatmap does not add to it. The framed page loads without the tracker and without the admin bar — the bar would otherwise push the whole page down by 32 pixels that the recorded coordinates do not contain, and offset the entire overlay.
* Note: The default click-capture setting records only clicks that land on a link, button or field, which is the right default for an event log and the wrong one for a heatmap. The screen says so and points at the setting. The heatmap itself can be switched off; it costs one database write per click on a busy shop.

= 4.18.0 =
* Fixed: Search Rescue could never see a search that found nothing — the one thing it exists to find. The tracker wrote `count || null`, and in JavaScript `0 || null` is `null`, which the event store records as "not reported". Every zero-result search was filed as unmeasured and excluded from the screen, which is why the counters read zero.
* New: Search Rescue now says why its list is empty instead of showing four zeros under a footnote. A term that found nothing but has only been searched once is reported as such, with the reason — one search can be a typo, two is a pattern.
* New: A chart on the Customer Segments screen, showing each group's share of customers beside its share of revenue. Either bar alone hides the comparison that changes a decision: a group that is 12% of the shop and 48% of the money is not treated like one that is 40% of the shop and 9% of the money.
* Fixed: The "AI suggestions" link on each segment card jumped to an actions table that was always empty, because the notebook sends segments and no actions. There is now a control that proposes one action per segment, derived from the segment's own profile by rules — no model, no API key, no network.
* New: Those proposals encode an opinion worth stating: a discount is not the answer to every segment. Customers already buying at full price are offered recognition rather than money off, customers who only ever buy on a coupon are not offered another one, and a group with no clear pattern gets no proposal at all. Every proposal still passes through the same policy gate as a remote one.
* Fixed: A run that puts nearly everybody in one segment is no longer reported as "good separation". It scores well on silhouette precisely because there is almost nothing to separate from, and saying so plainly is more useful than the number.
* Improved: The notebook scales its minimum segment size to the shop. A fixed floor of ten left a 54-customer shop with a single segment holding 93% of it, because the second cluster had four people and was dropped.

= 4.17.0 =
* New: A "run quality" panel on the Customer Segments screen. It names the algorithm that produced the segmentation, its silhouette score, the share of customers in the largest segment, and how many were left unsegmented — so a shop owner can tell a real pattern from noise an algorithm found in too little data.
* New: A weak silhouette is reported as "we do not know yet", not as "the segments are wrong". The usual cause is too few customers, not a fault in the method, and the wording says so.
* Fixed: Run metrics are stored under their own `quality` key rather than inside `insights`. `insights` is a list of cards the screen renders one by one, so a map of metrics placed there came out as a row of empty cards.
* Improved: The companion Colab notebook now compares K-Means, hierarchical clustering and DBSCAN over a parameter sweep, scores all of them on silhouette, Calinski-Harabasz and Davies-Bouldin, and picks the winner. It also penalises two things no statistic catches: a segment holding more than half the shop, and two clusters that resolve to the same business name.
* Improved: Customer features go beyond RFM, using the discount share, category variety, basket size, tenure and purchase regularity the export already carries. The discount share is what separates a customer who is loyal from one who only ever buys on a coupon, and the two want opposite treatment.

= 4.16.0 =
* New: Light and dark appearance, with a third "follow the system" setting, chosen per user rather than per site and stored in user meta so it follows them to another browser. The resolved theme is applied on `<html>` from the document head, before the first paint, because a class added on DOMContentLoaded means anyone who prefers light sees a full dark page flash white on every single load.
* Fixed: The gap between the WordPress admin menu and the panel. Three separate `.bap-wrap` rules each set a different margin with `!important`, and WordPress's own `#wpcontent` gutter was added on top of whichever one won. There is now one shell rule and no second gutter.
* Fixed: Roughly 24,000px of empty page below the content on every screen. The navigation rail spans `grid-row: 1 / span 999` so it can stay sticky, and a 24px row-gap applies between every pair of rows in the implicit grid — including the 990-odd empty ones that span creates.
* Fixed: The primary button has never been violet. `.bap-wrap button.button` is specificity (0,2,1) and `.bap-wrap .button-primary` is (0,2,0); both carry `!important`, so the generic rule won and every call-to-action rendered identically to the secondary button beside it.
* Fixed: The Events and Pages screen was registered with a slug string in `add_submenu_page()`'s callback position, which pushed the real callback into `$position` and left the screen without anything to render.
* Improved: 142 distinct colour literals across the screen styles are now about fifteen named tokens. This was the precondition for a light theme rather than a tidy-up: a value with no name cannot be re-themed. Tests now fail the build if a colour literal, an undefined token or a self-referential token reappears.
* Improved: Nothing is set below 10.5px any more. 53 declarations were at 10px or smaller and 20 of them at 9px or smaller, where Persian dots, descenders and zero-width non-joiners stop resolving.
* Improved: The dashboard chart takes its colours from CSS instead of hardcoded hex, so its grid lines and series stay visible when the page is light.
* New: Features that depend on a backend which does not exist yet — the subscription/licence screen and the collector queue inspector — are hidden behind one flag instead of loading and doing nothing. The sidebar no longer reports "no licence" and the header no longer reads "Inactive" on a plugin that is working. Settings lists what is hidden and why; `BAP_Roadmap::WAITING` is the one line to change when the services arrive.

= 4.15.0 =
* New: The analysis packet carries facts about price for the first time. `commerce.price_blocked` is a product with page views and no purchases; `commerce.price_position` is a product priced above the median of its own category and selling less than its neighbours; `commerce.coupon_reliance` is how much of the shop's revenue only closes with a discount. Every product fact also carries its list price now.
* Fixed: No recommendation was ever directly about price, and the cause was structural rather than a wording choice — the packet contained no prices, and a recommendation citing a fact that does not exist is discarded before it is shown. The rule engine now produces three price recommendations of its own, so they appear with no model configured at all.
* Fixed: The agent built its action from the first fact it recognised, which meant the order facts happened to arrive in decided what the shop did. Candidates are now scored by evidence strength and the best one wins; reversing the order of the same facts produces the same action.
* New: The proposed discount comes from the fact rather than always from the cap — 10% for a price test, the measured gap down to the category median for a mispriced product, the cap only for clearing a product that never sold. The screen states the exact percentage and duration before anything is clicked.
* New: Every applied change records how the affected products were selling over the previous 28 days, and a daily job compares that against what happened afterwards once a week of data exists. The comparison is difference-in-differences against the rest of the catalogue, so a quiet week is not read as the discount failing and a seasonal rise is not read as it working.
* New: A verdict of "not enough data" is reported as "we do not know" rather than "it did not work". Fewer than five units across both windows gets no verdict at all: one sale before and two after is a 100% rise and means nothing.
* Security: A discount that would take a product below a recorded cost of goods is refused. The cost is read from the meta a cost-of-goods plugin writes, and when none exists no margin is assumed or displayed.
* Improved: The "your list prices are not real" recommendation deliberately carries no executable action. Every other price recommendation is one click to apply and one to revert; repricing the whole shop is not a decision an automatic mechanism should make.

= 4.14.0 =
* New: A "Search Rescue" screen. Searches that returned zero results are matched against the catalogue, so each one becomes an answer the shop can act on: there is a product that is probably what the shopper meant and the shop is missing the word, or there is not and the shop is missing the product. Those two need opposite fixes and were previously indistinguishable.
* Fixed: The tracker has always sent the result count of each search — WordPress reads it from `$wp_query->found_posts` — and the event store dropped it, leaving the reports to guess from "searched and clicked nothing". That proxy conflated a catalogue gap with a presentation problem. The count is now stored, and the "searches that find nothing" task has split into two tasks with opposite advice.
* New: A search whose result count was never reported — a site whose search bypasses `$wp_query`, or rows recorded before this version — is reported as unmeasured rather than counted as a failure, and the screen says how many are in that state.
* New: Matching works with whichever model provider is configured, through a new plain `BAP_AI_Provider::complete()` entry point; with none configured, a built-in text matcher normalises Persian letter, zero-width-non-joiner and digit variants and compares character bigrams. The screen always states which of the two answered, because they differ in quality.
* Security: A product id the model returns that was not in the list sent to it is discarded rather than shown, and a match below 55% confidence is reported as no match — with a small catalogue there is always a nearest product, and presenting it regardless would send shoppers to the wrong item. Only product ids and names are sent to the model; no prices, stock or descriptions.
* Improved: Model results are cached against a fingerprint of the terms, catalogue, provider and model, so opening the screen costs no quota. Forcing a fresh run requires the settings capability.

= 4.13.1 =
* Fixed: A Gemini error now carries Google's own sentence instead of discarding it. Three unrelated problems arrive as HTTP 403 — the API not enabled on the project, a key restricted to a domain or IP, and the server's country not being served — and reporting one guess for all three sent people to check settings that were never wrong.
* New: A location refusal is recognised and says so, including that the call is made by the web server rather than the browser, so no key change can fix it, and names the two options that do work: the automation webhook or a Llama server.
* Security: Google's message is scrubbed of anything key-shaped before it is shown or logged, because this text reaches a screen and a diagnostic log that gets pasted into support threads.
* Improved: The debug log records Google's machine-readable status alongside the HTTP code; the code alone was not enough to diagnose a 403.

= 4.13.0 =
* New: Customer Segments can import a results file. A shop whose server does not accept traffic from outside — which is the normal case for Iranian hosting with a notebook running on Colab — had no way to get an analysis back: the dataset could be exported, but nothing could be delivered. Now the analysis is carried as a file and uploaded.
* Security: An imported file is held to exactly the rules the signed route applies, because both now run the same code. A run built on synthetic data is refused on upload just as it is over HTTP, and proposed actions still pass through the shop's policy. In place of a signature, the upload requires a logged-in administrator with the settings capability, a nonce, a genuine `is_uploaded_file()` upload and a size bound.
* Improved: Each refusal says which file to pick instead of echoing a code — invalid JSON, a synthetic run, and a missing `run_id` (usually the input dataset chosen by mistake) each get their own sentence.

= 4.12.0 =
* New: Google Gemini as an AI provider, through a free Google AI Studio key. The address and model name fill themselves in; only the key has to be entered.
* New: The connection test lists the models that key may actually use, and asks Google's listing endpoint rather than spending one of the day's free analyses.
* Security: The Gemini key is sent in the `x-goog-api-key` header, never in the query string, so it cannot be copied into web-server, proxy or error logs. It is stored outside the settings array without autoload, is never sent to the browser, and never appears in the diagnostic report.
* Improved: Gemini failures are told apart instead of being reported as a status code — a spent free quota says to wait, a rejected key says where to make a new one, an unknown model names the model, and a content filter is distinguished from a reply cut off at the token limit.
* Improved: A Gemini reply split across several response parts is reassembled; taking only the first part would have left half a JSON document and no recommendations.
* Fixed: The AI Center printed the raw provider id for the automation webhook because that provider had no display label.

= 4.11.0 =
* New: A "Tasks" screen listing the real problems the data found — the page each one happens on, what to change, and a button that opens whichever editor actually owns that page (Elementor, block, classic or the WooCommerce product screen).
* New: Tasks can be ticked off or dismissed, and an id survives the next rebuild so a decision is not lost when the numbers change.
* New: The screen is optional — "صفحه کارها" in Settings turns it on or off like the other modules.
* Note: This screen changes nothing on the site by design, and says so on the screen. Layout and content are never edited automatically; only prices and coupons can be, through the commerce agent.
* Fixed: The page resolver cached its answers for the life of the process, so a long-running rebuild kept calling a page unknown after it had been published.

= 4.10.0 =
* New: Daily summary tables, so a long range is read from one row per day instead of re-scanning every event.
* Improved: Sessions and visitors stay exact across a range — a session that crosses midnight is counted once, not twice.
* Improved: A missing day falls back to the raw events rather than reporting a smaller number.
* Fixed: Per-request memoisation of the event read and the customer lookup, invalidated on write so a cron or WP-CLI process cannot serve a stale result.

= 4.9.0 =
* New: Commerce OS admin shell with a SaaS-style sidebar, command center, metric hierarchy, responsive customer intelligence cards and a unified RTL design system.
* New: Commercial license manager with encrypted-at-rest key storage, explicit license states, cached validation, offline grace handling and site binding metadata.
* New: Central entitlement and feature-flag abstractions so plans, capabilities and remote rollouts remain separate concepts.
* New: Native WordPress premium updater integration with release channels, API/backend compatibility metadata and just-in-time refresh of short-lived signed package URLs.
* New: Customer-level behavioral features join WooCommerce RFM/order features without exporting raw email, search text, click labels or page URLs to the ML service.
* New: Behavior-aware segmentation/prediction feature version cf-2 and multi-tenant daily behavior aggregation.
* New: Bounded concurrent multi-store pipeline runner with optional automatic retraining of missing/stale active models.
* Improved: Customer/order/action/traffic synchronization is more incremental and suitable for long-running SaaS installations.
* Improved: Customer Intelligence screen prioritizes operational segment cards, repeat-purchase/churn indicators and one-click campaign/coupon workflows.
* Improved: Commercial outages do not catastrophically disable existing analytics; WordPress receives clear account/compatibility diagnostics instead.
* Fixed: Campaign links now attribute clicks to the actual send/schedule action measured by the feedback loop.
* Fixed: Version metadata is release-gated so plugin header, BAP_VERSION, readme Stable tag and generated tracker cannot silently drift.
* Security: Premium actions remain schema/policy/capability checked; commercial secrets are never put in URLs, frontend JavaScript or routine logs.


= 4.2.1 =
* Unified: Dashboard, Experience, Funnels, Journeys, AI Center, Settings, Event Inspector and Diagnostics now use the same dark Persian design system, shared hero and primary navigation.
* Improved: Settings, inspector tabs, queue cards, diagnostics tables, notices and pagination no longer fall back to the native light wp-admin visual language.
* Improved: AI Center now explains the full WordPress -> ASP.NET -> fact builder -> AI -> policy -> WordPress flow, shows recommendation counters, action capabilities and recent audit activity.
* Improved: AI recommendation cards now show rationale, impact, evidence ids and a human-readable action preview before approval.
* Fixed: Insights-only AI autonomy can no longer execute an action through a manual approval request.
* Fixed: locally approved/applied/rejected AI recommendations are not reset to pending when the backend repeats the same recommendation.
* Fixed: dashboard accessibility delta labels and browser-queue Persian translations used mismatched JavaScript i18n keys.
* Improved: browser queue timestamps are displayed with the Persian calendar.

= 4.1.0 =
* بازطراحی کامل رابط مدیریت به‌صورت تیره، RTL و فارسی.
* تقویم شمسی داخلی برای تمام فیلترهای تاریخ افزونه بدون وابستگی خارجی.
* نمایش تاریخ‌های نمودار و جدول با تقویم شمسی و اعداد فارسی.
* فارسی‌سازی منوها، داشبورد، Experience، Funnels، Journeys، AI Center، Settings، Inspector و Diagnostics.
* بهبود کارت‌ها، پنل‌ها، جداول، فرم‌ها، دکمه‌ها، وضعیت‌ها و رابط موبایل.
* استفاده از پالت تیره باهوش و Accent قابل شخصی‌سازی.


= 4.0.0 =
* Added: Experience Intelligence collection for rage clicks, conservative dead
  clicks, JavaScript/resource errors, Web Vitals, HTML5 media engagement and
  privacy-safe copy-count signals. Every capability is independently optional.
* Added: Experience workspace with UX issue summaries and normalized
  interaction-density visualization backed by collector reports.
* Added: no-code Funnel workspace. Definitions stay lightweight in WordPress;
  heavy funnel computation is delegated to the collector.
* Added: Journey explorer contract for server-derived paths and conversion
  journeys.
* Added: AI Center with analysis focus controls, recommendation workflow,
  approval/rejection and audit-aware allowlisted actions.
* Added: signed ASP.NET-to-WordPress AI callback using HMAC-SHA256 with a
  five-minute replay window.
* Added: AI autonomy modes (insights, approval, safe-auto) and configurable
  minimum confidence. Safe-auto is limited to explicitly registered low-risk
  actions.
* Added: core AI actions for creating Bahoosh funnels/alerts/annotations and
  updating the analytics dashboard only. Arbitrary PHP/SQL/URL/site mutation is
  deliberately unsupported.
* Added: customizable dashboard cards/panels, module visibility, admin accent
  and comfortable/compact UI density.
* Added: generic authenticated collector GET transport and v4 report/AI REST
  contracts.
* Added: backend implementation specification, JSON schemas and ASP.NET DTO/HMAC
  reference under `docs/`.
* Fixed: upgrade flow now passes the installed DB version into the v3 migration
  instead of referencing an undefined variable.
* Changed: product documentation now describes delivery as durable and
  duplicate-safe rather than claiming mathematically strict exactly-once or
  absolute zero-loss semantics.

= 3.0.0 =
* Changed: the anonymous identifier now identifies the browser and never
  rotates — not on login, not on logout, not on refresh. Rotating it previously
  severed the device from its own history.
* Changed: sessions are no longer modelled by the tracker. Every event carries a
  page view id instead, and sessions are derived from stored events afterwards.
  The session timeout setting is removed.
* Changed: events are sent one per request as they happen. Batch size and flush
  interval settings are removed; the durable offline queue is unchanged.
* Changed: an event's client timestamp is reported as the browser recorded it
  rather than being rewritten when it differs from server time — an event
  queued offline legitimately arrives long after it happened.
* Added: a concurrent request cap, since each event is now its own request.
* Fixed: the queue could evict an event while a request was still open against
  it, turning a slow network into silent data loss.
* Note: while your collector is still on the previous API version, WordPress
  translates on the way out. Use the default "Through WordPress" transport mode;
  direct browser delivery requires an updated collector.

= 2.2.0 =
* Added: an Event Inspector showing the server outbox, your own browser's queue,
  and the debug log, with filters and safe payload inspection.
* Added: a Queue Inspector with flush, retry-failed, clear-failed and clear-all
  actions. Pending events are never removed during normal operation.
* Added: debug mode, off by default, with a bounded rotating log that redacts
  secrets by key name so it is safe to share with support.
* Added: multi-tab coordination. One tab holds a lease and runs the scheduled
  flush; the others collect normally. Correctness never depends on it — event
  ids and the collector's unique index remain the final duplicate protection.
* Added: a dashboard time-series chart with a previous-period comparison. When
  the collector returns no time series the panel says so rather than drawing
  invented data.
* Added: per-feature tracking toggles for page views, clicks, scroll, time,
  forms and SPA navigation.
* Added: lifecycle hooks — bap_before_enqueue, bap_event_queued,
  bap_events_delivered, bap_events_delivery_failed.
* Added: delivered events are retained for a week so the Inspector can show real
  deliveries and the unique index keeps guarding against re-fired order hooks.
* Fixed: the IndexedDB queue driver used an upsert where the localStorage driver
  did not, which could reset an in-flight event's retry state.
* Fixed: uninstall now cleans multisite networks and removes WooCommerce order
  meta from both classic postmeta and HPOS storage.
* Fixed: queued payloads are no longer readable by any script on the page.
* Changed: the plugin passes PHPCS with the WordPress Coding Standards.

= 2.1.0 =
* Fixed: the browser now writes its consent decision where PHP can read it, so
  server-side events and the ingest proxy honour a visitor's choice.
* Fixed: WooCommerce purchase and refund events check consent, captured at
  checkout rather than read from whatever request the order hook runs in.
* Fixed: the ingest endpoint refuses to forward events when consent has been
  withdrawn, and tells the client so its queue clears.
* Fixed: settings are autoloaded again, removing a database query from every
  page load.
* Fixed: scroll tracking no longer reads layout on every scroll event.
* Fixed: `time_spent` reports elapsed time as a delta, so repeated reports no
  longer multiply-count the same seconds.
* Fixed: `session_end` carries the ended session's own start time and page
  count instead of the new session's.
* Fixed: class names of SVG elements are read correctly.
* Added: single-page-app navigation is tracked via the History API.
* Added: click tracking defaults to interactive elements, with the previous
  record-everything behaviour available as a setting.
* Added: a per-page-view event cap.
* Added: a Diagnostics screen, a connection test, failed-event requeueing, and
  WordPress Site Health integration.
* Added: `bahoosh('reset')`, `optOut`, `optIn`, and an inline stub so calls made
  before the tracker loads are replayed.
* Added: forms added to the page after load are now tracked.
* Added: filterable capabilities for viewing reports and changing settings.
* Added: translation template and a Persian translation; interface strings are
  now translatable rather than hardcoded.
* Changed: the outbox purges undeliverable events older than 30 days.

= 2.0.0 =
* Rebuilt around unique event ids, a persistent offline queue and
  acknowledgement-based delivery.
* Added an identity layer that separates identity from session and merges
  anonymous history into WordPress accounts on login.
* Added WooCommerce ecommerce tracking with server-side purchase and refund
  events.
* Added consent management, Do Not Track support, IP anonymization and GDPR
  export/erasure.
* Moved configuration from constants in the plugin file to a settings screen.
* Security: the collector API key is no longer sent to browsers; the admin
  dashboard no longer renders untrusted page URLs as HTML.

== Upgrade Notice ==

= 2.1.0 =
Fixes a privacy defect: consent decisions made in the browser were not reaching
the server, so server-side WooCommerce events could be recorded for visitors who
had declined. Upgrade promptly if you rely on consent gating.
