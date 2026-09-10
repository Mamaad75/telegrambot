=== Bahoosh Analytics Pro ===
Contributors: bahooshdevelopers
Tags: analytics, woocommerce, tracking, gdpr, ecommerce, funnels, ai, heatmap
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 4.2.1
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
