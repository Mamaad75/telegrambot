/**
 * Bahoosh Analytics Pro v4 — tracker namespace.
 *
 * Every tracker module attaches itself to `window.BahooshAnalytics`. Modules are
 * loaded as ordinary classic scripts in dependency order (the numeric filename
 * prefix is the load order), so no bundler is required for development. A
 * concatenated bundle is produced by tools/build-bundle.js for production.
 */
(function (global) {
  "use strict";

  var NS = (global.BahooshAnalytics = global.BahooshAnalytics || {});

  NS.SCHEMA_VERSION = 3;
  NS.VERSION = "4.0.0";

  NS.EVENT_TYPES = {
    // v1 events — preserved.
    PAGE_VIEW: "page_view",
    CLICK: "click",
    SEARCH: "search",
    TIME_SPENT: "time_spent",
    // v2 additions. The two session lifecycle types were removed in v3: the
    // tracker no longer models sessions at all. They are derived analytically
    // from stored events, where the window can change without a redeploy.
    SCROLL: "scroll",
    OUTBOUND_CLICK: "outbound_click",
    FILE_DOWNLOAD: "file_download",
    FORM_VIEW: "form_view",
    FORM_START: "form_start",
    FORM_SUBMIT: "form_submit",
    LOGIN: "login",
    SIGNUP: "signup",
    IDENTIFY: "identify",
    // WooCommerce.
    VIEW_ITEM: "view_item",
    VIEW_ITEM_LIST: "view_item_list",
    ADD_TO_CART: "add_to_cart",
    REMOVE_FROM_CART: "remove_from_cart",
    VIEW_CART: "view_cart",
    BEGIN_CHECKOUT: "begin_checkout",
    ADD_PAYMENT_INFO: "add_payment_info",
    PURCHASE: "purchase",
    REFUND: "refund",
    // v4 experience intelligence.
    RAGE_CLICK: "rage_click",
    DEAD_CLICK: "dead_click",
    JS_ERROR: "js_error",
    WEB_VITAL: "web_vital",
    MEDIA_ENGAGEMENT: "media_engagement",
    COPY: "copy",
  };

  NS.QUEUE_STATE = {
    PENDING: "pending",
    SENDING: "sending",
    FAILED: "failed",
  };

  NS.CONSENT = {
    ANALYTICS: "analytics",
    MARKETING: "marketing",
    PERSONALIZATION: "personalization",
  };

  NS.modules = NS.modules || {};
})(typeof window !== "undefined" ? window : globalThis);
