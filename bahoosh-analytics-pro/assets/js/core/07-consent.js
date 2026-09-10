/**
 * Bahoosh Analytics Pro v2 — ConsentManager.
 *
 * Three independent categories (analytics / marketing / personalization).
 * `analytics` gates all event collection; `marketing` gates attribution
 * capture; `personalization` is reserved for downstream features and is
 * carried on the event so the backend can honour it.
 *
 * State is written to localStorage *and* mirrored to a first-party cookie.
 * The cookie is not redundant: it is the only way PHP can see the visitor's
 * choice, and PHP is what decides whether a server-side WooCommerce event may
 * be recorded and whether the ingest proxy forwards a batch at all.
 *
 * Integrates with an existing CMP through `window.bapConsent` or the
 * `bap:consent` DOM event, so sites already running a consent banner do not
 * need a second one.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var KEY = "bap_consent";
  var COOKIE = "bap_consent";
  var COOKIE_TTL_SECONDS = 60 * 60 * 24 * 180; // 6 months, a common CMP default.

  var CATEGORIES = ["analytics", "marketing", "personalization"];

  function ConsentManager(options) {
    options = options || {};
    this.storage = options.storage || util.Storage;
    this.cookies = options.cookies || util.Cookies;
    this.requireConsent = !!options.requireConsent;
    this.respectDnt = options.respectDnt !== false;
    this.cookieEnabled = options.cookieEnabled !== false;
    this.defaults = options.defaults || {
      analytics: !options.requireConsent,
      marketing: !options.requireConsent,
      personalization: false,
    };
    this.listeners = [];
    this.state = null;
  }

  /** Do Not Track / Global Privacy Control. */
  ConsentManager.prototype.signalsOptOut = function (win) {
    win = win || global;
    var nav = win.navigator || {};
    if (nav.globalPrivacyControl === true) return true;
    var dnt = nav.doNotTrack || win.doNotTrack || nav.msDoNotTrack;
    return dnt === "1" || dnt === 1 || dnt === "yes";
  };

  ConsentManager.prototype.init = function (win) {
    win = win || global;
    var stored = this.storage.getJSON(KEY, null);
    var external = win.bapConsent && typeof win.bapConsent === "object" ? win.bapConsent : null;

    this.state = {
      analytics: pick(external, stored, this.defaults, "analytics"),
      marketing: pick(external, stored, this.defaults, "marketing"),
      personalization: pick(external, stored, this.defaults, "personalization"),
      updated_at: (stored && stored.updated_at) || null,
      source: external ? "cmp" : stored ? "stored" : "default",
    };

    if (this.respectDnt && this.signalsOptOut(win)) {
      this.state.analytics = false;
      this.state.marketing = false;
      this.state.personalization = false;
      this.state.source = "dnt";
    }

    // Keep the cookie in step on every load, not only on change: a visitor
    // whose cookie expired (or who arrived with DNT set) must not leave PHP
    // reading a stale grant.
    this._syncCookie();

    var self = this;
    if (win.addEventListener) {
      win.addEventListener("bap:consent", function (event) {
        if (event && event.detail) self.update(event.detail);
      });
    }
    return this;
  };

  function pick(external, stored, defaults, key) {
    if (external && typeof external[key] === "boolean") return external[key];
    if (stored && typeof stored[key] === "boolean") return stored[key];
    return !!defaults[key];
  }

  /**
   * Mirrors the decision into a first-party cookie for PHP.
   *
   * Deliberately minimal — three booleans, no identifiers — so it stays well
   * inside header size budgets and carries nothing that could identify anyone
   * on its own.
   */
  ConsentManager.prototype._syncCookie = function () {
    if (!this.cookieEnabled || !this.state) return false;
    var compact = {
      analytics: !!this.state.analytics,
      marketing: !!this.state.marketing,
      personalization: !!this.state.personalization,
    };
    return this.cookies.set(COOKIE, JSON.stringify(compact), COOKIE_TTL_SECONDS);
  };

  ConsentManager.prototype.update = function (patch) {
    if (!this.state) this.init();
    var changed = false;
    for (var i = 0; i < CATEGORIES.length; i++) {
      var k = CATEGORIES[i];
      if (typeof patch[k] === "boolean" && this.state[k] !== patch[k]) {
        this.state[k] = patch[k];
        changed = true;
      }
    }
    if (!changed) return this.state;

    this.state.updated_at = util.isoNow();
    this.state.source = "explicit";
    this.storage.setJSON(KEY, this.state);
    this._syncCookie();

    for (var j = 0; j < this.listeners.length; j++) {
      try {
        this.listeners[j](this.state);
      } catch (e) {
        /* a broken listener must not break tracking */
      }
    }
    return this.state;
  };

  /**
   * Withdraws every category and clears the mirror.
   *
   * Used by `bahoosh('reset')`. Withdrawal is prospective: events already
   * delivered are not retracted here — that is what the privacy erasure tools
   * are for.
   */
  ConsentManager.prototype.withdrawAll = function () {
    return this.update({ analytics: false, marketing: false, personalization: false });
  };

  ConsentManager.prototype.onChange = function (fn) {
    if (typeof fn === "function") this.listeners.push(fn);
    return this;
  };

  ConsentManager.prototype.has = function (category) {
    if (!this.state) this.init();
    return !!this.state[category];
  };

  ConsentManager.prototype.canTrack = function () {
    return this.has(NS.CONSENT.ANALYTICS);
  };

  ConsentManager.prototype.toPayload = function () {
    if (!this.state) this.init();
    return {
      analytics: !!this.state.analytics,
      marketing: !!this.state.marketing,
      personalization: !!this.state.personalization,
    };
  };

  NS.ConsentManager = ConsentManager;
  NS.consentStorageKey = KEY;
  NS.consentCookie = COOKIE;
})(typeof window !== "undefined" ? window : globalThis);
