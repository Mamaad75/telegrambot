/**
 * Bahoosh Analytics Pro v3 — EventFactory.
 *
 * Produces the v3 event envelope. One rule governs this file:
 *
 *   **An event is born complete.**
 *
 * `event_id` and `timestamp_client` are assigned here, once, at the moment the
 * event is created — never at send time, never on a retry, never anywhere
 * downstream. Everything the delivery guarantee rests on follows from that:
 *
 *   - A retry re-sends a byte-identical id, so the server can recognise it.
 *   - An event queued offline for three days still reports when it *happened*,
 *     not when it finally got out.
 *   - No component below this one has to reason about identity or ordering.
 *
 * Nothing downstream may add or rewrite either field. The tests assert it.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  function EventFactory(options) {
    options = options || {};
    this.siteId = options.siteId;
    this.identity = options.identity;
    this.pageView = options.pageView;
    this.attribution = options.attribution;
    this.consent = options.consent;
    this.window = options.window || global;
    this.contextCache = null;
  }

  /**
   * Drops cached environment data.
   *
   * Called on a SPA route change: the device has not changed, but the viewport
   * may have, and re-measuring once per route is cheaper than re-measuring per
   * event.
   */
  EventFactory.prototype.refreshPage = function () {
    this.contextCache = null;
    return this;
  };

  EventFactory.prototype.getContext = function () {
    // Screen metrics are cheap but not free; the viewport is the only part that
    // realistically changes within a page, so only that is refreshed.
    if (!this.contextCache) {
      this.contextCache = NS.context.collect(this.window);
    } else {
      var win = this.window;
      var doc = win.document || {};
      this.contextCache.viewport_width =
        win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth) || 0;
      this.contextCache.viewport_height =
        win.innerHeight || (doc.documentElement && doc.documentElement.clientHeight) || 0;
      this.contextCache.viewport_size =
        this.contextCache.viewport_width + "x" + this.contextCache.viewport_height;
    }
    return this.contextCache;
  };

  /**
   * @param {string} type      Event type, e.g. "page_view".
   * @param {Object} data      Type-specific payload.
   * @param {Object} [overrides] `event_id` (for deterministic server-side ids),
   *                             `timestamp_client`, `page`, `page_view_id`.
   */
  EventFactory.prototype.build = function (type, data, overrides) {
    overrides = overrides || {};

    var event = {
      schema_version: NS.SCHEMA_VERSION,
      event_id: overrides.event_id || util.prefixedId("evt"),
      site_id: this.siteId,

      // Stamped on *every* event, not only on page_view. Stamping only the
      // page_view would leave the clicks, scrolls and time_spent that belong to
      // that view with nothing to group them by, which is the entire point.
      page_view_id: overrides.page_view_id || (this.pageView ? this.pageView.getId() : null),

      identity: this.identity.toPayload(),

      event_type: type,
      timestamp_client: overrides.timestamp_client || util.isoNow(),
      origin: overrides.origin || "browser",

      page: overrides.page || NS.context.page(this.window),
      context: this.getContext(),
      consent: this.consent ? this.consent.toPayload() : undefined,

      data: data || {},
    };

    // Attribution rides along only when the visitor allowed marketing storage.
    if (this.attribution && (!this.consent || this.consent.has(NS.CONSENT.MARKETING))) {
      event.attribution = this.attribution.toPayload();
    }

    return event;
  };

  NS.EventFactory = EventFactory;
})(typeof window !== "undefined" ? window : globalThis);
