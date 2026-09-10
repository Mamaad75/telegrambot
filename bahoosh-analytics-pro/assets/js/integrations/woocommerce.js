/**
 * Bahoosh Analytics Pro v2 — WooCommerce browser integration.
 *
 * Covers the browsing funnel only. `purchase` and `refund` are emitted
 * server-side from order hooks, because a browser-side purchase event is lost
 * whenever the shopper closes the tab on the redirect back from a payment
 * gateway — and duplicated whenever they reload the thank-you page.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var TYPES = NS.EVENT_TYPES;

  function WooIntegration(tracker, config) {
    this.tracker = tracker;
    this.config = config || {};
    this.window = tracker.window || global;
    this.document = this.window.document;
    this.currency = this.config.currency || null;
  }

  WooIntegration.prototype.init = function () {
    var pageType = this.config.page_type;

    if (pageType === "product" && this.config.product) {
      this.tracker.track(TYPES.VIEW_ITEM, {
        currency: this.currency,
        value: numeric(this.config.product.price),
        items: [this.config.product],
      });
    }

    if ((pageType === "shop" || pageType === "product_category" || pageType === "search") &&
        Array.isArray(this.config.item_list) && this.config.item_list.length) {
      this.tracker.track(TYPES.VIEW_ITEM_LIST, {
        list_name: this.config.list_name || pageType,
        currency: this.currency,
        items: this.config.item_list,
      });
    }

    if (pageType === "cart") {
      this.tracker.track(TYPES.VIEW_CART, {
        currency: this.currency,
        value: numeric(this.config.cart_total),
        items: this.config.cart_items || [],
      });
    }

    if (pageType === "checkout") {
      this.tracker.track(TYPES.BEGIN_CHECKOUT, {
        currency: this.currency,
        value: numeric(this.config.cart_total),
        coupons: this.config.coupons || [],
        items: this.config.cart_items || [],
      });
      this._bindCheckout();
    }

    this._bindCartEvents();
    return this;
  };

  /** WooCommerce broadcasts cart changes over jQuery when it is present. */
  WooIntegration.prototype._bindCartEvents = function () {
    var self = this;
    var $ = this.window.jQuery;

    if ($ && typeof $ === "function") {
      $(this.document.body).on("added_to_cart", function (_event, _fragments, _hash, $button) {
        self._trackAddToCart($button);
      });
      $(this.document.body).on("removed_from_cart", function () {
        // The removal target is resolved from the click handler below; this
        // hook only confirms WooCommerce processed it.
      });
    }

    // Non-AJAX add-to-cart (single product form) and cart-row removal links
    // work without jQuery.
    var doc = this.document;
    if (!doc || !doc.addEventListener) return;

    doc.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;
      if (!form.classList || !form.classList.contains("cart")) return;
      if (form.querySelector && form.querySelector(".ajax_add_to_cart")) return; // handled by jQuery hook
      self._trackAddToCartFromForm(form);
    }, true);

    doc.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== "function") return;

      var ajaxButton = target.closest(".ajax_add_to_cart");
      if (ajaxButton && !self.window.jQuery) {
        self._trackAddToCart(ajaxButton);
        return;
      }

      var removeLink = target.closest("a.remove");
      if (removeLink) self._trackRemoveFromCart(removeLink);
    }, true);
  };

  WooIntegration.prototype._trackAddToCart = function (button) {
    var el = unwrap(button);
    var productId = el ? attr(el, "data-product_id") || attr(el, "data-product-id") : null;
    var quantity = el ? numeric(attr(el, "data-quantity")) || 1 : 1;
    var item = this._resolveItem(productId);

    this.tracker.track(TYPES.ADD_TO_CART, {
      currency: this.currency,
      value: item && item.price ? numeric(item.price) * quantity : null,
      items: [
        assign({ item_id: productId ? String(productId) : null, quantity: quantity }, item || {}),
      ],
    });
  };

  WooIntegration.prototype._trackAddToCartFromForm = function (form) {
    var productField =
      form.querySelector('[name="add-to-cart"]') ||
      form.querySelector('[name="product_id"]') ||
      form.querySelector('[name="variation_id"]');
    var quantityField = form.querySelector('[name="quantity"]');
    var productId = productField ? productField.value : (this.config.product || {}).item_id;
    var quantity = quantityField ? numeric(quantityField.value) || 1 : 1;
    var item = this._resolveItem(productId);

    this.tracker.track(TYPES.ADD_TO_CART, {
      currency: this.currency,
      value: item && item.price ? numeric(item.price) * quantity : null,
      items: [
        assign({ item_id: productId ? String(productId) : null, quantity: quantity }, item || {}),
      ],
    });
  };

  WooIntegration.prototype._trackRemoveFromCart = function (link) {
    var productId = attr(link, "data-product_id") || attr(link, "data-product-id");
    var item = this._resolveItem(productId);
    this.tracker.track(TYPES.REMOVE_FROM_CART, {
      currency: this.currency,
      items: [assign({ item_id: productId ? String(productId) : null }, item || {})],
    });
  };

  WooIntegration.prototype._bindCheckout = function () {
    var self = this;
    var doc = this.document;
    if (!doc || !doc.addEventListener) return;
    var reported = false;

    function report(method) {
      if (reported) return;
      reported = true;
      self.tracker.track(TYPES.ADD_PAYMENT_INFO, {
        currency: self.currency,
        value: numeric(self.config.cart_total),
        payment_type: method || null,
        items: self.config.cart_items || [],
      });
    }

    doc.addEventListener("change", function (e) {
      var target = e.target;
      if (!target || target.name !== "payment_method") return;
      report(target.value);
    }, true);

    doc.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== "function") return;
      if (!target.closest("#place_order")) return;
      var selected = doc.querySelector('input[name="payment_method"]:checked');
      report(selected ? selected.value : null);
      // The gateway redirect is imminent.
      self.tracker.queue.flushWithBeacon();
    }, true);
  };

  WooIntegration.prototype._resolveItem = function (productId) {
    if (!productId) return null;
    var catalog = this.config.catalog || {};
    return catalog[String(productId)] || null;
  };

  /* helpers */

  function unwrap(el) {
    // jQuery objects arrive from the `added_to_cart` hook.
    if (!el) return null;
    if (el.jquery && el.length) return el[0];
    return el.nodeType === 1 ? el : null;
  }

  function attr(el, name) {
    return el && el.getAttribute ? el.getAttribute(name) : null;
  }

  function numeric(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : null;
  }

  function assign(target, source) {
    for (var k in source) {
      if (Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined) {
        if (target[k] === null || target[k] === undefined) target[k] = source[k];
      }
    }
    return target;
  }

  NS.WooIntegration = WooIntegration;

  // Boot once the tracker announces itself.
  if (global.document && global.BAP_WC) {
    global.document.addEventListener("bahoosh:ready", function () {
      var tracker = NS.instance;
      if (!tracker || !tracker.consent || !tracker.consent.canTrack()) return;
      new WooIntegration(tracker, global.BAP_WC).init();
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
