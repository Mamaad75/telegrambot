/**
 * Bahoosh Analytics Pro v2 — marketing attribution.
 *
 * Attribution is stored against the identity, not the session, so first-touch
 * survives session rollover. Every touch is also appended to a bounded
 * touchpoint list, which is what a backend needs to compute linear /
 * position-based / time-decay models later. The tracker itself computes no
 * model beyond first/last touch — those belong in the warehouse.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var KEY = "bap_attribution";
  var MAX_TOUCHPOINTS = 25;

  var UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];

  var CLICK_ID_KEYS = ["gclid", "fbclid", "msclkid", "ttclid", "yclid"];

  function readParams(search) {
    var out = {};
    try {
      var params = new URLSearchParams(search || "");
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var v = params.get(UTM_KEYS[i]);
        if (v) out[UTM_KEYS[i]] = util.truncate(v, 255);
      }
      for (var j = 0; j < CLICK_ID_KEYS.length; j++) {
        var c = params.get(CLICK_ID_KEYS[j]);
        if (c) {
          out.click_id_type = CLICK_ID_KEYS[j];
          out.click_id = util.truncate(c, 255);
          break;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  function hostOf(url) {
    if (!url) return "";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  /** Classifies a referrer when no UTM tags are present. */
  function inferChannel(referrer, currentHost) {
    var host = hostOf(referrer);
    if (!host) return { source: "direct", medium: "none" };
    if (host === currentHost) return { source: "internal", medium: "internal" };
    if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./.test("." + host)) {
      return { source: host, medium: "organic" };
    }
    if (/(^|\.)(facebook|instagram|twitter|x|linkedin|t|telegram|pinterest|reddit|tiktok|youtube)\./.test("." + host)) {
      return { source: host, medium: "social" };
    }
    return { source: host, medium: "referral" };
  }

  function AttributionManager(options) {
    options = options || {};
    this.storage = options.storage || util.Storage;
    this.now = options.now || util.nowMs;
    this.state = null;
  }

  AttributionManager.prototype.init = function (win) {
    win = win || global;
    var loc = win.location || {};
    var doc = win.document || {};
    var now = this.now();

    var stored = this.storage.getJSON(KEY, null);
    if (!stored || typeof stored !== "object") {
      stored = { touchpoints: [] };
    }
    if (!Array.isArray(stored.touchpoints)) stored.touchpoints = [];

    var utm = readParams(loc.search);
    var referrer = NS.context.stripSensitiveParams(doc.referrer || "");
    var currentHost = hostOf(loc.href || "");
    var hasUtm = false;
    for (var k in utm) {
      if (Object.prototype.hasOwnProperty.call(utm, k)) {
        hasUtm = true;
        break;
      }
    }

    var externalReferrer = referrer && hostOf(referrer) !== currentHost;
    var isNewTouch = hasUtm || externalReferrer || !stored.first_touch;

    if (isNewTouch) {
      var channel = hasUtm
        ? {
            source: utm.utm_source || "unknown",
            medium: utm.utm_medium || "unknown",
          }
        : inferChannel(referrer, currentHost);

      var touch = {
        timestamp: new Date(now).toISOString(),
        source: channel.source,
        medium: channel.medium,
        campaign: utm.utm_campaign || null,
        term: utm.utm_term || null,
        content: utm.utm_content || null,
        click_id: utm.click_id || null,
        click_id_type: utm.click_id_type || null,
        landing_page: NS.context.stripSensitiveParams(loc.href || ""),
        referrer: referrer || null,
      };

      if (!stored.first_touch) {
        stored.first_touch = touch;
        stored.first_referrer = referrer || null;
        stored.landing_page = touch.landing_page;
      }
      stored.last_touch = touch;
      stored.last_referrer = referrer || null;
      stored.touchpoints.push(touch);
      if (stored.touchpoints.length > MAX_TOUCHPOINTS) {
        // Keep the first touch (index 0 semantics matter for first-touch models)
        // and the most recent window of touches.
        stored.touchpoints = [stored.touchpoints[0]].concat(
          stored.touchpoints.slice(stored.touchpoints.length - (MAX_TOUCHPOINTS - 1))
        );
      }
      this.storage.setJSON(KEY, stored);
    }

    this.state = stored;
    return this;
  };

  /** Compact block attached to every event. */
  AttributionManager.prototype.toPayload = function () {
    if (!this.state) return {};
    var first = this.state.first_touch || {};
    var last = this.state.last_touch || {};
    return {
      utm_source: last.source || null,
      utm_medium: last.medium || null,
      utm_campaign: last.campaign || null,
      utm_term: last.term || null,
      utm_content: last.content || null,
      click_id: last.click_id || null,
      click_id_type: last.click_id_type || null,
      landing_page: this.state.landing_page || null,
      first_referrer: this.state.first_referrer || null,
      last_referrer: this.state.last_referrer || null,
      first_touch_at: first.timestamp || null,
      last_touch_at: last.timestamp || null,
      touchpoint_count: (this.state.touchpoints || []).length,
    };
  };

  AttributionManager.prototype.getTouchpoints = function () {
    return this.state ? this.state.touchpoints || [] : [];
  };

  AttributionManager.prototype.reset = function () {
    this.storage.remove(KEY);
    this.state = null;
  };

  NS.AttributionManager = AttributionManager;
  NS.attributionKeys = { STORAGE: KEY, UTM_KEYS: UTM_KEYS };
})(typeof window !== "undefined" ? window : globalThis);
