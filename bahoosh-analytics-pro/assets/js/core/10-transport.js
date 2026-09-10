/**
 * Bahoosh Analytics Pro v3 — Transport.
 *
 * One HTTP request per event, sent as it happens. Batching is gone; the queue
 * is not. Those are separate concerns that v2 had welded together: batching was
 * a throughput optimisation, the queue is what makes a lost connection
 * survivable, and only one of the two was worth keeping.
 *
 * Two mechanisms:
 *
 *   fetch      — the normal path. Returns a settlement the queue uses to decide
 *                whether the event may be deleted.
 *   sendBeacon — the page-exit path. Fire-and-forget: it cannot read a
 *                response, so nothing is deleted on the strength of a beacon.
 *                Those events stay leased and go out again on the next load,
 *                where the server answers `duplicate` and they settle. A blind
 *                send that arrives twice is the designed behaviour, not a bug.
 *
 * Because one event is now one request, a busy page could open dozens of
 * sockets at once. `maxConcurrent` caps that; the queue supplies the backoff.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var DEFAULT_TIMEOUT_MS = 15000;
  var DEFAULT_MAX_CONCURRENT = 4;

  // The settlement table lives in RetryPolicy — one place decides what an
  // answer means, and this file only speaks HTTP.
  var SETTLEMENT = NS.SETTLEMENT;

  function Transport(options) {
    options = options || {};
    this.endpoint = options.endpoint;
    this.beaconEndpoint = options.beaconEndpoint || options.endpoint;
    this.siteId = options.siteId;
    // Only ever a *public* ingest key. The secret API key stays on the server.
    this.ingestKey = options.ingestKey || "";
    // Server-signed proof of the visitor's WordPress identity. Opaque to the
    // browser: it cannot be forged, only replayed by the same anonymous id.
    this.identityToken = options.identityToken || "";
    this.credentials = options.credentials || "omit";
    this.timeoutMs = util.positiveNumberOr(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxConcurrent = util.positiveNumberOr(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this.fetchImpl = options.fetch || (global.fetch ? global.fetch.bind(global) : null);
    this.navigatorImpl = options.navigator || global.navigator;
    this.logger = options.logger || util.createLogger(false);
    this.extraHeaders = options.headers || {};
    this.retry = options.retry || new NS.RetryPolicy();
    this.inFlight = 0;
  }

  Transport.prototype._headers = function () {
    var headers = {
      "Content-Type": "application/json",
      "X-BAP-Site-Id": String(this.siteId || ""),
      "X-BAP-Schema-Version": String(NS.SCHEMA_VERSION),
    };
    if (this.ingestKey) headers["X-BAP-Ingest-Key"] = this.ingestKey;
    if (this.identityToken) headers["X-BAP-Identity"] = this.identityToken;
    for (var k in this.extraHeaders) {
      if (Object.prototype.hasOwnProperty.call(this.extraHeaders, k)) {
        headers[k] = this.extraHeaders[k];
      }
    }
    return headers;
  };

  /**
   * Attaches the identity token to the event without mutating the stored copy.
   *
   * The stored copy must stay byte-identical across retries, so the token — the
   * one field that can legitimately change between attempts, because it expires
   * — is added on the way out rather than baked in at creation.
   */
  Transport.prototype._stamp = function (event) {
    if (!this.identityToken) return event;
    var stamped = {};
    for (var k in event) {
      if (Object.prototype.hasOwnProperty.call(event, k)) stamped[k] = event[k];
    }
    var identity = {};
    for (var i in event.identity || {}) {
      if (Object.prototype.hasOwnProperty.call(event.identity, i)) identity[i] = event.identity[i];
    }
    identity.identity_token = this.identityToken;
    stamped.identity = identity;
    return stamped;
  };

  /** Whether another request may be opened right now. */
  Transport.prototype.hasCapacity = function () {
    return this.inFlight < this.maxConcurrent;
  };

  /**
   * Sends one event.
   *
   * @returns {Promise<Object>} `{ settlement, status, retryAfterMs, error }`
   */
  Transport.prototype.send = function (event) {
    var self = this;
    var payload = this._stamp(event);

    if (!this.fetchImpl) {
      return Promise.resolve({ settlement: SETTLEMENT.RETRY, status: 0, networkError: true });
    }

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timedOut = false;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
    }

    var init = {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(payload),
      credentials: this.credentials,
      keepalive: true,
    };
    if (controller) init.signal = controller.signal;

    this.inFlight++;

    return this.fetchImpl(this.endpoint, init)
      .then(function (response) {
        if (timer) clearTimeout(timer);
        var retryAfterMs = NS.parseRetryAfter(
          response.headers && response.headers.get ? response.headers.get("Retry-After") : null
        );
        return response
          .text()
          .catch(function () {
            return "";
          })
          .then(function (text) {
            return {
              settlement: self.retry.classify(response.status, text),
              status: response.status,
              retryAfterMs: retryAfterMs,
              raw: text,
            };
          });
      })
      .catch(function (error) {
        if (timer) clearTimeout(timer);
        var aborted = error && (error.name === "AbortError" || error.name === "TimeoutError");
        self.logger.debug("transport failure", error && error.message);
        return {
          settlement: SETTLEMENT.RETRY,
          status: 0,
          networkError: !aborted,
          timeout: timedOut,
          aborted: aborted,
          error: error && error.message,
        };
      })
      .then(function (result) {
        self.inFlight--;
        return result;
      });
  };

  /**
   * Best-effort delivery during page unload. Returns whether the browser
   * queued the request — never whether the server accepted it.
   */
  Transport.prototype.sendBeacon = function (event) {
    var nav = this.navigatorImpl;
    if (!nav || typeof nav.sendBeacon !== "function") return false;
    try {
      var payload = JSON.stringify(this._stamp(event));
      // `text/plain` keeps the beacon a CORS-simple request; anything else
      // needs a preflight that sendBeacon cannot perform during unload.
      var blob =
        typeof Blob !== "undefined"
          ? new Blob([payload], { type: "text/plain;charset=UTF-8" })
          : payload;
      return !!nav.sendBeacon(this.beaconEndpoint, blob);
    } catch (e) {
      this.logger.debug("beacon failed", e && e.message);
      return false;
    }
  };

  NS.Transport = Transport;
})(typeof window !== "undefined" ? window : globalThis);
