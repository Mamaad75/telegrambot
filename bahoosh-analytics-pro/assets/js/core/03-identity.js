/**
 * Bahoosh Analytics Pro v3 — IdentityManager.
 *
 * Two identifiers, two jobs:
 *
 *   anonymous_id  identifies the *browser*. Created before the first event and
 *                 never rotated — not on login, not on logout, not on refresh.
 *   wp_user_id    identifies the *person*. Injected by PHP from
 *                 `wp_get_current_user()` on every page render, so the browser
 *                 can never assert who it is.
 *
 * The anonymous id does not rotate because every event already delivered is
 * bound to the device through it. Minting a new one on logout would orphan that
 * history for no gain: the person is identified by `wp_user_id`, which is the
 * same integer on every device they log in on, and that is what makes
 * cross-device matching possible downstream.
 *
 * The trade-off is deliberate and worth stating: on a shared device the next
 * visitor's events carry the previous visitor's anonymous id until they log in.
 * Analysis must treat `anonymous_id` as "this browser", never as "this person".
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var KEYS = {
    ANONYMOUS_ID: "bap_anonymous_id",
    LINK_STATE: "bap_identity_link",
    LEGACY_USER_ID: "aat_uid", // v1 storage key — migrated, never re-used.
  };

  var ANON_COOKIE = "bap_anon_id";
  var ANON_TTL_SECONDS = 60 * 60 * 24 * 400; // ~13 months.

  function IdentityManager(options) {
    options = options || {};
    this.storage = options.storage || util.Storage;
    this.cookies = options.cookies || util.Cookies;
    this.logger = options.logger || util.createLogger(false);
    this.cookieEnabled = options.cookieEnabled !== false;

    // Server-resolved identity. `0`/null means "not authenticated".
    this.wpUserId = normalizeId(options.wpUserId);
    this.wooCustomerId = normalizeId(options.wooCustomerId);

    this.anonymousId = null;
    this.migratedFromV1 = false;
  }

  function normalizeId(value) {
    var n = parseInt(value, 10);
    return isFinite(n) && n > 0 ? n : null;
  }

  IdentityManager.prototype.init = function () {
    var stored = this.storage.get(KEYS.ANONYMOUS_ID);
    var cookie = this.cookieEnabled ? this.cookies.get(ANON_COOKIE) : null;
    var legacy = this.storage.get(KEYS.LEGACY_USER_ID);

    if (isValidAnonymousId(stored)) {
      this.anonymousId = stored;
    } else if (isValidAnonymousId(cookie)) {
      // localStorage was cleared but the cookie survived (or PHP seeded it).
      this.anonymousId = cookie;
    } else if (legacy) {
      // v1 stored `user_<random>` in `aat_uid`. It was a device id in practice,
      // so carrying it forward preserves continuity for existing installs.
      this.anonymousId = "anon_" + String(legacy).replace(/^user_/, "");
      this.migratedFromV1 = true;
    } else {
      this.anonymousId = util.prefixedId("anon");
    }

    this._persistAnonymousId();
    this._reconcileAuthState();
    return this;
  };

  function isValidAnonymousId(value) {
    return typeof value === "string" && /^anon_[A-Za-z0-9_-]{8,128}$/.test(value);
  }

  IdentityManager.prototype._persistAnonymousId = function () {
    this.storage.set(KEYS.ANONYMOUS_ID, this.anonymousId);
    if (this.cookieEnabled) {
      this.cookies.set(ANON_COOKIE, this.anonymousId, ANON_TTL_SECONDS);
    }
  };

  /**
   * Notes whether this device still needs to tell the server which account it
   * belongs to.
   *
   * Logging out deliberately does nothing here. The anonymous id identifies the
   * browser, and the browser has not changed; rotating it would sever the
   * device from every event it has already produced.
   */
  IdentityManager.prototype._reconcileAuthState = function () {
    var link = this.storage.getJSON(KEYS.LINK_STATE, null) || {};
    var previousUserId = normalizeId(link.wp_user_id);

    this.pendingLink = false;

    if (this.wpUserId) {
      var sameUser = previousUserId === this.wpUserId;
      var sameAnon = link.anonymous_id === this.anonymousId;
      if (!sameUser || !sameAnon) {
        this.pendingLink = true;
      }
    }
  };

  IdentityManager.prototype.needsLink = function () {
    return !!(this.wpUserId && this.pendingLink);
  };

  /** Called after the backend confirms the link so it is not re-sent forever. */
  IdentityManager.prototype.markLinked = function () {
    this.pendingLink = false;
    this.storage.setJSON(KEYS.LINK_STATE, {
      anonymous_id: this.anonymousId,
      wp_user_id: this.wpUserId,
      woocommerce_customer_id: this.wooCustomerId,
      linked_at: util.isoNow(),
    });
  };

  IdentityManager.prototype.getAnonymousId = function () {
    return this.anonymousId;
  };

  IdentityManager.prototype.isAuthenticated = function () {
    return !!this.wpUserId;
  };

  /** The `identity` block embedded in every event. */
  IdentityManager.prototype.toPayload = function () {
    var payload = { anonymous_id: this.anonymousId };
    if (this.wpUserId) payload.wp_user_id = this.wpUserId;
    if (this.wooCustomerId) payload.woocommerce_customer_id = this.wooCustomerId;
    return payload;
  };

  IdentityManager.prototype.reset = function () {
    this.storage.remove(KEYS.ANONYMOUS_ID);
    this.storage.remove(KEYS.LINK_STATE);
    this.storage.remove(KEYS.LEGACY_USER_ID);
    this.anonymousId = util.prefixedId("anon");
    this._persistAnonymousId();
    this.pendingLink = !!this.wpUserId;
  };

  NS.IdentityManager = IdentityManager;
  NS.identityKeys = KEYS;
  NS.ANON_COOKIE = ANON_COOKIE;
})(typeof window !== "undefined" ? window : globalThis);
