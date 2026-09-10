/**
 * Bahoosh Analytics Pro v4 — Experience intelligence.
 *
 * Lightweight behavioral signals inspired by product/UX analytics tools. This
 * module deliberately does NOT record DOM snapshots, typed text or copied
 * content. It emits small structured events that the Bahoosh backend can
 * aggregate into heatmaps, frustration reports and performance insights.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;
  var TYPES = NS.EVENT_TYPES;

  var RAGE_WINDOW_MS = 900;
  var RAGE_RADIUS_PX = 48;
  var RAGE_MIN_CLICKS = 3;
  var DEAD_CLICK_DELAY_MS = 1100;
  var MAX_LABEL = 120;

  function ExperienceMonitor(tracker) {
    this.tracker = tracker;
    this.window = tracker.window;
    this.document = tracker.document;
    this.features = tracker.features || {};
    this.bound = false;
    this.recentClicks = [];
    this.lastRageAt = 0;
    this.domVersion = 0;
    this.mediaProgress = typeof WeakMap === "function" ? new WeakMap() : null;
    this.vitals = {};
    this.vitalsSentForPage = false;
    this.observers = [];
  }

  ExperienceMonitor.prototype.bind = function () {
    if (this.bound) return this;
    this.bound = true;

    var self = this;
    var doc = this.document;
    var win = this.window;

    if ((this.features.rageClicks || this.features.deadClicks) && doc && doc.addEventListener) {
      doc.addEventListener("click", function (e) {
        self._observeClick(e);
      }, true);
    }

    if (this.features.deadClicks && doc && doc.body && typeof win.MutationObserver === "function") {
      var mutationObserver = new win.MutationObserver(function () {
        self.domVersion++;
      });
      mutationObserver.observe(doc.body, { childList: true, subtree: true, attributes: true });
      this.observers.push(mutationObserver);
    }

    if (this.features.jsErrors && win && win.addEventListener) {
      win.addEventListener("error", function (e) { self._trackJsError(e); });
      win.addEventListener("unhandledrejection", function (e) { self._trackRejection(e); });
    }

    if (this.features.webVitals) this._bindWebVitals();
    if (this.features.media && doc && doc.addEventListener) this._bindMedia();
    if (this.features.copy && doc && doc.addEventListener) this._bindCopy();

    return this;
  };

  ExperienceMonitor.prototype.routeChanged = function () {
    this.recentClicks = [];
    this.vitalsSentForPage = false;
    // Browser navigation timing is document-scoped. We keep the raw vitals for
    // the document but do not attribute them to a later SPA route.
  };

  ExperienceMonitor.prototype._observeClick = function (e) {
    if (!e || !e.target) return;
    if (this.features.rageClicks) this._detectRageClick(e);
    if (this.features.deadClicks) this._detectDeadClick(e);
  };

  ExperienceMonitor.prototype._detectRageClick = function (e) {
    var now = util.nowMs();
    var x = Number(e.clientX) || 0;
    var y = Number(e.clientY) || 0;
    var target = closestTrackTarget(e.target);

    this.recentClicks = this.recentClicks.filter(function (point) {
      return now - point.at <= RAGE_WINDOW_MS;
    });
    this.recentClicks.push({ at: now, x: x, y: y, target: target });

    var cluster = this.recentClicks.filter(function (point) {
      var dx = point.x - x;
      var dy = point.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= RAGE_RADIUS_PX;
    });

    if (cluster.length < RAGE_MIN_CLICKS || now - this.lastRageAt < RAGE_WINDOW_MS) return;
    this.lastRageAt = now;

    this.tracker.track(TYPES.RAGE_CLICK, elementPayload(target, e, {
      click_count: cluster.length,
      window_ms: RAGE_WINDOW_MS,
      radius_px: RAGE_RADIUS_PX,
    }));
  };

  ExperienceMonitor.prototype._detectDeadClick = function (e) {
    var target = closestTrackTarget(e.target);
    if (!target || !looksActionable(target)) return;
    if (target.disabled || hasNavigationIntent(target)) return;

    var self = this;
    var beforeUrl = safeLocation(this.window);
    var beforeDom = this.domVersion;
    var beforeActive = this.document ? this.document.activeElement : null;
    var snapshot = elementPayload(target, e, {});

    this.window.setTimeout(function () {
      if (!self.tracker.started) return;
      if (safeLocation(self.window) !== beforeUrl) return;
      if (self.domVersion !== beforeDom) return;
      if (self.document && self.document.activeElement !== beforeActive && isFormControl(target)) return;

      snapshot.delay_ms = DEAD_CLICK_DELAY_MS;
      self.tracker.track(TYPES.DEAD_CLICK, snapshot);
    }, DEAD_CLICK_DELAY_MS);
  };

  ExperienceMonitor.prototype._trackJsError = function (e) {
    if (!e) return;
    // Resource load failures do not expose a useful message; classify them
    // without copying HTML or resource response content.
    var target = e.target || null;
    var isResource = target && target !== this.window && target.tagName;
    var data = {
      kind: isResource ? "resource_error" : "javascript_error",
      message: util.truncate(isResource ? "Resource failed to load" : sanitizeErrorText(e.message), 300),
      filename: e.filename ? NS.context.stripSensitiveParams(String(e.filename)) : null,
      line: Number(e.lineno) || null,
      column: Number(e.colno) || null,
      resource_tag: isResource ? String(target.tagName).toLowerCase() : null,
    };
    this.tracker.track(TYPES.JS_ERROR, data);
  };

  ExperienceMonitor.prototype._trackRejection = function (e) {
    var reason = e && e.reason;
    var message = "Unhandled promise rejection";
    if (reason && typeof reason.message === "string") message = reason.message;
    else if (typeof reason === "string") message = reason;

    this.tracker.track(TYPES.JS_ERROR, {
      kind: "unhandled_rejection",
      message: util.truncate(sanitizeErrorText(message), 300),
    });
  };

  ExperienceMonitor.prototype._bindWebVitals = function () {
    var self = this;
    var win = this.window;
    if (!win || typeof win.PerformanceObserver !== "function") return;

    function observe(type, callback, options) {
      try {
        var observer = new win.PerformanceObserver(function (list) {
          callback(list.getEntries());
        });
        observer.observe(options || { type: type, buffered: true });
        self.observers.push(observer);
      } catch (e) {
        /* Browser does not support this entry type. */
      }
    }

    observe("largest-contentful-paint", function (entries) {
      var last = entries[entries.length - 1];
      if (last) self.vitals.lcp = roundMetric(last.startTime);
    });

    var cls = 0;
    observe("layout-shift", function (entries) {
      entries.forEach(function (entry) {
        if (!entry.hadRecentInput) cls += entry.value || 0;
      });
      self.vitals.cls = Math.round(cls * 10000) / 10000;
    });

    // INP: approximate the Web Vital as the worst observed interaction latency.
    observe("event", function (entries) {
      entries.forEach(function (entry) {
        if (entry.interactionId && entry.duration) {
          self.vitals.inp = Math.max(self.vitals.inp || 0, roundMetric(entry.duration));
        }
      });
    }, { type: "event", buffered: true, durationThreshold: 40 });

    observe("paint", function (entries) {
      entries.forEach(function (entry) {
        if (entry.name === "first-contentful-paint") self.vitals.fcp = roundMetric(entry.startTime);
      });
    });

    try {
      var nav = win.performance && win.performance.getEntriesByType ? win.performance.getEntriesByType("navigation")[0] : null;
      if (nav) {
        self.vitals.ttfb = roundMetric(nav.responseStart);
        self.vitals.dom_content_loaded = roundMetric(nav.domContentLoadedEventEnd);
      }
    } catch (e) {
      /* ignore */
    }

    if (win.addEventListener) {
      win.addEventListener("pagehide", function () { self.flushVitals(); });
    }
  };

  ExperienceMonitor.prototype.flushVitals = function () {
    if (!this.features.webVitals || this.vitalsSentForPage) return;
    var keys = Object.keys(this.vitals || {});
    if (!keys.length) return;
    this.vitalsSentForPage = true;

    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      this.tracker.track(TYPES.WEB_VITAL, {
        metric: name,
        value: this.vitals[name],
        rating: vitalRating(name, this.vitals[name]),
      }, { send: false });
    }
  };

  ExperienceMonitor.prototype._bindMedia = function () {
    var self = this;
    var doc = this.document;
    ["play", "pause", "ended"].forEach(function (eventName) {
      doc.addEventListener(eventName, function (e) {
        var media = e.target;
        if (!isMedia(media)) return;
        self.tracker.track(TYPES.MEDIA_ENGAGEMENT, mediaPayload(media, eventName));
      }, true);
    });

    doc.addEventListener("timeupdate", function (e) {
      var media = e.target;
      if (!isMedia(media) || !isFinite(media.duration) || media.duration <= 0) return;
      var pct = Math.floor((media.currentTime / media.duration) * 100);
      var milestones = [25, 50, 75, 100];
      var state = self.mediaProgress ? (self.mediaProgress.get(media) || {}) : (media.__bapMediaProgress || {});
      milestones.forEach(function (milestone) {
        if (pct >= milestone && !state[milestone]) {
          state[milestone] = true;
          self.tracker.track(TYPES.MEDIA_ENGAGEMENT, mediaPayload(media, "progress", milestone));
        }
      });
      if (self.mediaProgress) self.mediaProgress.set(media, state);
      else media.__bapMediaProgress = state;
    }, true);
  };

  ExperienceMonitor.prototype._bindCopy = function () {
    var self = this;
    this.document.addEventListener("copy", function (e) {
      var selection = self.window.getSelection ? String(self.window.getSelection() || "") : "";
      var target = closestTrackTarget(e.target);
      // Never transmit copied text. Length and element context are sufficient
      // for identifying content users repeatedly need to take elsewhere.
      self.tracker.track(TYPES.COPY, {
        copied_length: Math.min(100000, selection.length),
        element: target && target.tagName ? String(target.tagName).toLowerCase() : null,
        element_id: target && target.id ? util.truncate(target.id, 120) : null,
      });
    }, true);
  };

  function closestTrackTarget(target) {
    if (!target) return null;
    if (target.nodeType === 3) target = target.parentElement;
    if (!target || typeof target.closest !== "function") return target || null;
    try {
      return target.closest('a,button,input,select,textarea,summary,[role="button"],[role="link"],[data-bap-track]') || target;
    } catch (e) {
      return target;
    }
  }

  function elementPayload(target, e, extra) {
    var payload = extra || {};
    payload.element = target && target.tagName ? String(target.tagName).toLowerCase() : null;
    payload.element_id = target && target.id ? util.truncate(target.id, 120) : null;
    payload.element_classes = target && target.getAttribute ? util.truncate(target.getAttribute("class") || "", 200) || null : null;
    payload.element_role = target && target.getAttribute ? target.getAttribute("role") : null;
    payload.text = target && target.textContent ? util.truncate(String(target.textContent).replace(/\s+/g, " ").trim(), MAX_LABEL) : null;
    payload.mouse_x = Number(e && e.clientX) || 0;
    payload.mouse_y = Number(e && e.clientY) || 0;
    payload.page_x = Number(e && e.pageX) || 0;
    payload.page_y = Number(e && e.pageY) || 0;
    payload.scroll_y = Number((global && global.scrollY) || 0);
    var root = global && global.document ? global.document.documentElement : null;
    var body = global && global.document ? global.document.body : null;
    payload.document_width = Math.max(root ? root.scrollWidth : 0, body ? body.scrollWidth : 0);
    payload.document_height = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0);
    return payload;
  }

  function looksActionable(el) {
    if (!el || !el.matches) return false;
    try {
      return el.matches('button,a,summary,[role="button"],[role="link"],[data-bap-track],input[type="button"],input[type="submit"]');
    } catch (e) {
      return false;
    }
  }

  function hasNavigationIntent(el) {
    if (!el || !el.tagName) return false;
    var tag = String(el.tagName).toLowerCase();
    if (tag === "a") {
      var href = el.getAttribute && el.getAttribute("href");
      return !!href && href !== "#" && !/^javascript:/i.test(href);
    }
    if (tag === "button") {
      var type = (el.getAttribute && el.getAttribute("type")) || "submit";
      if (String(type).toLowerCase() === "submit") return true;
    }
    return false;
  }

  function isFormControl(el) {
    if (!el || !el.tagName) return false;
    return /^(input|select|textarea)$/i.test(el.tagName);
  }

  function isMedia(el) {
    return !!(el && el.tagName && /^(video|audio)$/i.test(el.tagName));
  }

  function mediaPayload(media, action, progress) {
    var src = media.currentSrc || media.src || "";
    return {
      action: action,
      progress_percent: progress || null,
      media_type: String(media.tagName || "").toLowerCase(),
      source: src ? NS.context.stripSensitiveParams(src) : null,
      current_time: isFinite(media.currentTime) ? Math.round(media.currentTime * 1000) / 1000 : null,
      duration: isFinite(media.duration) ? Math.round(media.duration * 1000) / 1000 : null,
    };
  }

  function safeLocation(win) {
    try { return String(win.location && win.location.href || ""); } catch (e) { return ""; }
  }

  function sanitizeErrorText(value) {
    var text = String(value || "");
    // Strip query strings and email-like substrings from exception messages.
    text = text.replace(/https?:\/\/[^\s?#]+\?[^\s]+/gi, function (url) {
      return url.split("?")[0] + "?[redacted]";
    });
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
    return text;
  }

  function roundMetric(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function vitalRating(name, value) {
    value = Number(value) || 0;
    if (name === "lcp") return value <= 2500 ? "good" : value <= 4000 ? "needs_improvement" : "poor";
    if (name === "cls") return value <= 0.1 ? "good" : value <= 0.25 ? "needs_improvement" : "poor";
    if (name === "inp") return value <= 200 ? "good" : value <= 500 ? "needs_improvement" : "poor";
    if (name === "fcp") return value <= 1800 ? "good" : value <= 3000 ? "needs_improvement" : "poor";
    if (name === "ttfb") return value <= 800 ? "good" : value <= 1800 ? "needs_improvement" : "poor";
    return "unknown";
  }

  NS.ExperienceMonitor = ExperienceMonitor;
})(typeof window !== "undefined" ? window : globalThis);
