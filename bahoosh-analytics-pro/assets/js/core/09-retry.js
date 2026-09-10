/**
 * Bahoosh Analytics Pro v3 — RetryPolicy.
 *
 * Owns two questions and nothing else: *what does this answer mean*, and *when
 * should we try again*. Both live here rather than in the transport so there is
 * exactly one place to read when the delivery rules are in doubt.
 *
 * The rule that matters for data integrity: a timeout or network failure is
 * always retried, because the server may or may not have processed the event
 * and only `event_id` idempotency can tell the difference. A retry re-sends the
 * stored event *unchanged* — same id, same `timestamp_client` — which is what
 * lets the server answer `duplicate` instead of storing it twice.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var DEFAULT_SCHEDULE_MS = [2000, 5000, 15000, 60000];
  var DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;
  var DEFAULT_MAX_ATTEMPTS = 10;

  /**
   * The v3 settlement table. `stored`, `duplicate` and `rejected` all mean the
   * event leaves the queue — the server has spoken and repeating the request
   * cannot change the answer. Only `retry` and `pause` keep it.
   */
  var SETTLEMENT = {
    STORED: "stored",
    DUPLICATE: "duplicate",
    REJECTED: "rejected",
    RETRY: "retry",
    PAUSE: "pause",
  };

  /** Whether a settlement means the local copy may be deleted. */
  function isSettled(settlement) {
    return (
      settlement === SETTLEMENT.STORED ||
      settlement === SETTLEMENT.DUPLICATE ||
      settlement === SETTLEMENT.REJECTED
    );
  }

  function RetryPolicy(options) {
    options = options || {};
    this.schedule = options.schedule || DEFAULT_SCHEDULE_MS;
    this.maxDelayMs = util.positiveNumberOr(options.maxDelayMs, DEFAULT_MAX_DELAY_MS);
    this.maxAttempts = util.positiveNumberOr(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.jitterRatio = typeof options.jitterRatio === "number" ? options.jitterRatio : 0.2;
    this.random = options.random || Math.random;
  }

  /** @param {number} attempts Number of attempts already made (>= 1). */
  RetryPolicy.prototype.delayFor = function (attempts, retryAfterMs) {
    if (retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.maxDelayMs);
    }
    var index = Math.max(0, attempts - 1);
    var base =
      index < this.schedule.length
        ? this.schedule[index]
        : this.schedule[this.schedule.length - 1] * Math.pow(2, index - this.schedule.length + 1);
    base = Math.min(base, this.maxDelayMs);
    // Full-spread jitter avoids a thundering herd when a site's visitors all
    // reconnect at the same moment after an outage.
    var jitter = base * this.jitterRatio;
    var delta = (this.random() * 2 - 1) * jitter;
    return Math.max(0, Math.round(base + delta));
  };

  RetryPolicy.prototype.exhausted = function (attempts) {
    return attempts >= this.maxAttempts;
  };

  /**
   * Maps an HTTP answer onto a settlement.
   *
   * The server is the authority on duplicates: a repeat is a *success*, not an
   * error, because the client cannot know whether an earlier blind send landed.
   * Treating it as an error would leave the event queued forever.
   *
   * A 2xx with no parseable body is read as `stored`, so a collector that
   * simply answers `200 OK` still works.
   *
   * @param {number} status HTTP status, or 0 for a network-level failure.
   * @param {string} text   Raw response body.
   */
  RetryPolicy.prototype.classify = function (status, text) {
    var body = util.safeJsonParse(text, null);
    var reported = body && typeof body === "object" ? body.status : null;

    if (status >= 200 && status < 300) {
      if (reported === SETTLEMENT.DUPLICATE) return SETTLEMENT.DUPLICATE;
      if (reported === SETTLEMENT.REJECTED) return SETTLEMENT.REJECTED;
      return SETTLEMENT.STORED;
    }

    // An explicitly retryable rejection stays queued whatever the status code:
    // the server is saying the event is fine and the failure is transient.
    if (body && typeof body === "object" && body.retryable === true) {
      return SETTLEMENT.RETRY;
    }

    if (status === 401 || status === 403 || status === 404) return SETTLEMENT.PAUSE;
    if (status === 408 || status === 425 || status === 429) return SETTLEMENT.RETRY;
    if (status === 422) return SETTLEMENT.REJECTED;
    if (status === 413) return SETTLEMENT.REJECTED; // one event too large only ever gets larger
    if (status >= 400 && status < 500) return SETTLEMENT.REJECTED;
    return SETTLEMENT.RETRY; // 5xx, 0, and anything unrecognised
  };

  /** Parses `Retry-After` in both seconds and HTTP-date forms. */
  function parseRetryAfter(headerValue, now) {
    if (!headerValue) return 0;
    var seconds = parseInt(headerValue, 10);
    if (isFinite(seconds) && String(seconds) === String(headerValue).trim()) {
      return Math.max(0, seconds * 1000);
    }
    var when = Date.parse(headerValue);
    if (isFinite(when)) return Math.max(0, when - (now || Date.now()));
    return 0;
  }

  NS.RetryPolicy = RetryPolicy;
  NS.SETTLEMENT = SETTLEMENT;
  NS.isSettled = isSettled;
  NS.parseRetryAfter = parseRetryAfter;
})(typeof window !== "undefined" ? window : globalThis);
