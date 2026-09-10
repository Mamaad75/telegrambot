/**
 * Bahoosh Analytics Pro v4 — Tracker.
 *
 * Wires the managers together and owns auto-instrumentation. Everything it
 * collects passes through the consent gate first; nothing is fabricated —
 * each event corresponds to a real user action.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;
  var TYPES = NS.EVENT_TYPES;

  var SCROLL_MILESTONES = [25, 50, 75, 100];
  var DOWNLOAD_EXT =
    /\.(pdf|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|txt|rtf|mp3|mp4|avi|mkv|mov|wav|dmg|exe|apk|iso)(\?|#|$)/i;
  var MAX_TEXT_LENGTH = 120;
  var DEFAULT_MAX_EVENTS_PER_PAGE = 500;

  /**
   * What counts as a click worth recording in the default `interactive` mode.
   * Recording every click on the document produces enormous volumes of
   * unusable data — most clicks land on layout containers.
   */
  var INTERACTIVE_SELECTOR =
    'a, button, input[type="submit"], input[type="button"], input[type="reset"], ' +
    'summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
    "[data-bap-track]";

  function Tracker(config) {
    this.config = config || {};
    this.window = this.config.window || global;
    this.document = this.window.document;
    this.logger = util.createLogger(!!this.config.debug, "Bahoosh");
    this.ready = false;
    this.started = false;

    this.maxEventsPerPage = util.positiveNumberOr(
      this.config.max_events_per_page,
      DEFAULT_MAX_EVENTS_PER_PAGE
    );
    this.clickCapture = this.config.click_capture === "all" ? "all" : "interactive";

    var features = this.config.features || {};
    this.features = {
      pageViews: features.page_views !== false,
      clicks: features.clicks !== false,
      scroll: features.scroll !== false,
      time: features.time !== false,
      forms: features.forms !== false,
      spa: features.spa !== false,
      rageClicks: features.rage_clicks === true,
      deadClicks: features.dead_clicks === true,
      jsErrors: features.js_errors === true,
      webVitals: features.web_vitals === true,
      media: features.media === true,
      copy: features.copy === true,
    };

    this._resetPageState();
    this.finalEventsSent = false;
    this.capReported = false;
    this.scrollScheduled = false;
    this.linkError = null;
  }

  /**
   * Per-page counters. Also called on a SPA route change, where the page
   * conceptually starts again without the document reloading.
   */
  Tracker.prototype._resetPageState = function () {
    var now = util.nowMs();
    this.pageStartedAt = now;
    this.lastTimeReportAt = now;
    this.engagedSince = this._isVisible() ? now : 0;
    this.engagedMs = 0;
    this.maxScrollDepth = 0;
    this.firedMilestones = {};
    this.seenForms = {};
    this.startedForms = {};
    this.eventsThisPage = 0;
    this.finalEventsSent = false;
    this.currentPath = this._currentPath();
  };

  Tracker.prototype._currentPath = function () {
    var loc = this.window.location || {};
    return (loc.pathname || "") + (loc.search || "");
  };

  Tracker.prototype._isVisible = function () {
    var doc = this.document;
    return !doc || !doc.visibilityState || doc.visibilityState === "visible";
  };

  Tracker.prototype.init = function () {
    var self = this;
    var config = this.config;

    if (!config.site_id || !config.endpoint) {
      this.logger.warn("missing site_id or endpoint — tracker disabled");
      return Promise.resolve(this);
    }

    this.consent = new NS.ConsentManager({
      requireConsent: !!config.require_consent,
      respectDnt: config.respect_dnt !== false,
      cookieEnabled: config.cookie_enabled !== false,
      defaults: config.consent_defaults,
    }).init(this.window);

    this.identity = new NS.IdentityManager({
      wpUserId: config.wp_user_id,
      wooCustomerId: config.woocommerce_customer_id,
      cookieEnabled: config.cookie_enabled !== false,
      logger: this.logger,
    }).init();

    // Opened before anything else can produce an event. Every event carries a
    // page view id, so there must never be a moment where one is not available.
    this.pageView = new NS.PageView();
    this.pageView.start();

    this.attribution = new NS.AttributionManager();
    if (this.consent.has(NS.CONSENT.MARKETING)) {
      this.attribution.init(this.window);
    }

    this.eventFactory = new NS.EventFactory({
      siteId: config.site_id,
      identity: this.identity,
      pageView: this.pageView,
      attribution: this.attribution,
      consent: this.consent,
      window: this.window,
    });

    // One policy instance, shared: the transport reads answers through it and
    // the queue schedules retries through it, so there is no way for the two to
    // disagree about what a given response meant.
    this.retryPolicy = new NS.RetryPolicy({
      schedule: config.retry_schedule_ms,
      maxAttempts: config.max_retry_attempts,
    });

    this.transport = new NS.Transport({
      endpoint: config.endpoint,
      beaconEndpoint: config.beacon_endpoint || config.endpoint,
      siteId: config.site_id,
      ingestKey: config.ingest_key || "",
      identityToken: config.identity_token || "",
      credentials: config.credentials || "omit",
      timeoutMs: config.request_timeout_ms,
      maxConcurrent: config.max_concurrent_requests,
      retry: this.retryPolicy,
      logger: this.logger,
    });

    this.coordinator = new NS.TabCoordinator({
      window: this.window,
      logger: this.logger,
      enabled: config.multi_tab_coordination !== false,
    }).start();

    this.queue = new NS.QueueManager({
      transport: this.transport,
      coordinator: this.coordinator,
      retry: this.retryPolicy,
      maxQueueSize: config.max_queue_size,
      logger: this.logger,
      window: this.window,
    });

    this.consent.onChange(function (state) {
      if (state.analytics && !self.started) self._start();
      if (state.marketing && !self.attribution.state) self.attribution.init(self.window);
    });

    return this.queue.init().then(function () {
      self.ready = true;
      self._bindLifecycle();
      self._exposeApi();
      if (self.consent.canTrack()) self._start();
      else self.logger.debug("waiting for analytics consent");
      return self;
    });
  };

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  Tracker.prototype._start = function () {
    if (this.started) return;
    this.started = true;

    this._maybeLinkIdentity();
    if (this.features.pageViews) this._trackPageView();
    this._trackSearch();
    this._trackAuthEvents();
    this._bindInteractions();
    if (NS.ExperienceMonitor && !this.experience) {
      this.experience = new NS.ExperienceMonitor(this).bind();
    }
    if (this.features.spa) this._bindHistory();

    // Anything left from a previous visit (offline, an unanswered beacon, a
    // crash mid-send) goes out now.
    this.queue.drain({ reason: "startup" });
  };

  Tracker.prototype._bindLifecycle = function () {
    var self = this;
    var doc = this.document;
    if (!doc || !doc.addEventListener) return;

    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "hidden") {
        self._accrueEngagement();
        self._handlePageExit("hidden");
      } else {
        self.engagedSince = util.nowMs();
        self.finalEventsSent = false;
      }
    });

    if (this.window.addEventListener) {
      // `pagehide` fires in cases `beforeunload` does not (bfcache, mobile
      // Safari), and unlike `beforeunload` it does not block the bfcache.
      this.window.addEventListener("pagehide", function () {
        self._accrueEngagement();
        self._handlePageExit("pagehide");
      });
    }
  };

  /** Accumulates foreground time, so "engaged" excludes background tabs. */
  Tracker.prototype._accrueEngagement = function () {
    if (this.engagedSince > 0) {
      this.engagedMs += util.nowMs() - this.engagedSince;
      this.engagedSince = 0;
    }
  };

  Tracker.prototype._handlePageExit = function (reason) {
    if (!this.started) return;
    if (!this.finalEventsSent) {
      this.finalEventsSent = true;
      this._trackTimeSpent(reason);
      if (this.experience && typeof this.experience.flushVitals === "function") this.experience.flushVitals();
    }
    this.queue.flushWithBeacon();
  };

  /* ---------------------------------------------------------------- */
  /* SPA navigation                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Treats a History API navigation as a page view.
   *
   * Plenty of WordPress themes and WooCommerce filter plugins swap the whole
   * page over `pushState` without a reload. Without this, everything after the
   * first route is attributed to the landing URL.
   */
  Tracker.prototype._bindHistory = function () {
    var self = this;
    var win = this.window;
    var history = win.history;
    if (!win.addEventListener) return;

    var announce = function () {
      // The URL is updated synchronously but frameworks usually render after;
      // a microtask hop keeps `document.title` in step with the new route.
      if (win.setTimeout) win.setTimeout(function () { self._handleRouteChange(); }, 0);
      else self._handleRouteChange();
    };

    if (history && typeof history.pushState === "function" && !history.__bapPatched) {
      var wrap = function (name) {
        var original = history[name];
        if (typeof original !== "function") return;
        history[name] = function () {
          var result = original.apply(this, arguments);
          try {
            announce();
          } catch (e) {
            /* never break the host application's navigation */
          }
          return result;
        };
      };
      wrap("pushState");
      wrap("replaceState");
      history.__bapPatched = true;
    }

    win.addEventListener("popstate", announce);
    win.addEventListener("hashchange", announce);
  };

  Tracker.prototype._handleRouteChange = function () {
    if (!this.started) return;

    var next = this._currentPath();
    if (next === this.currentPath) return;

    // Close out the page being left *before* the new page view opens, so the
    // final time_spent is stamped with the id of the view it measured rather
    // than the one that replaces it.
    this._accrueEngagement();
    this._trackTimeSpent("spa_navigation");

    this.eventFactory.refreshPage();
    this._resetPageState();

    // A virtual navigation is a genuinely new view of a genuinely new page, so
    // it gets its own id — the same treatment a full reload receives.
    this.pageView.start();
    if (this.experience && typeof this.experience.routeChanged === "function") this.experience.routeChanged();

    if (this.features.pageViews) this._trackPageView();
    this._trackSearch();
    if (this.features.forms) this._observeForms();
  };

  /* ---------------------------------------------------------------- */
  /* Identity linking                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Asks WordPress to link this device's anonymous id to the logged-in user.
   * The browser never states *who* it is: the REST route resolves the user from
   * the WordPress login cookie, server-side. The request is authenticated with
   * a nonce so a third-party page cannot forge links.
   */
  Tracker.prototype._maybeLinkIdentity = function () {
    var self = this;
    if (!this.identity.needsLink() || !this.config.link_endpoint) return;

    var body = {
      anonymous_id: this.identity.getAnonymousId(),
    };

    var headers = { "Content-Type": "application/json" };
    if (this.config.nonce) headers["X-WP-Nonce"] = this.config.nonce;

    var fetchImpl = this.window.fetch ? this.window.fetch.bind(this.window) : null;
    if (!fetchImpl) return;

    fetchImpl(this.config.link_endpoint, {
      method: "POST",
      headers: headers,
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("link failed: " + response.status);
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function () {
        self.identity.markLinked();
        // `identify` records the moment of the merge in the event stream so
        // the history is auditable.
        self.track(TYPES.IDENTIFY, {
          linked_anonymous_id: body.anonymous_id,
          method: "wordpress_login",
        });
      })
      .catch(function (error) {
        // Not fatal: the link is retried on the next page view.
        self.logger.warn("identity link deferred", error && error.message);
        self.linkError = error && error.message;
      });
  };

  /* ---------------------------------------------------------------- */
  /* Auto-instrumentation                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Opens a page view in the event stream.
   *
   * `page_view` still carries the url and title, so it remains the event that
   * describes the view; the grouping itself lives in `page_view_id`, which
   * every event of this view carries.
   */
  Tracker.prototype._trackPageView = function () {
    this.track(TYPES.PAGE_VIEW, {
      page_type: this.config.page_type || null,
      post_id: this.config.post_id || null,
      view_number: this.pageView.viewCount,
    });
  };

  Tracker.prototype._trackSearch = function () {
    var loc = this.window.location || {};
    var param = this.config.search_param || "s";
    try {
      var query = new URLSearchParams(loc.search || "").get(param);
      if (query) {
        this.track(TYPES.SEARCH, {
          query: util.truncate(query, 255),
          results_count: this.config.search_results_count || null,
        });
      }
    } catch (e) {
      /* ignore */
    }
  };

  /** Login/signup are reported by PHP (one-shot flags) — never guessed in JS. */
  Tracker.prototype._trackAuthEvents = function () {
    if (this.config.auth_event === "login") {
      this.track(TYPES.LOGIN, { method: "wordpress" });
    } else if (this.config.auth_event === "signup") {
      this.track(TYPES.SIGNUP, { method: "wordpress" });
    }
  };

  Tracker.prototype._bindInteractions = function () {
    var self = this;
    var doc = this.document;
    if (!doc || !doc.addEventListener) return;

    if (this.features.clicks) {
      doc.addEventListener("click", function (e) {
        self._handleClick(e);
      }, true);
    }

    if (this.features.scroll && this.window.addEventListener) {
      // Scroll handlers read layout (`scrollHeight`), which forces a reflow.
      // Doing that on every scroll event janks the page, so the read is
      // deferred to one animation frame.
      this.window.addEventListener("scroll", function () {
        self._scheduleScrollMeasure();
      }, { passive: true });
    }

    if (this.features.forms) {
      doc.addEventListener("submit", function (e) {
        self._handleFormSubmit(e);
      }, true);

      doc.addEventListener("focusin", function (e) {
        self._handleFormFocus(e);
      }, true);

      this._observeForms();
    }
  };

  Tracker.prototype._handleClick = function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== "function") return;

    var interactive = null;
    if (this.clickCapture === "interactive") {
      try {
        interactive = target.closest(INTERACTIVE_SELECTOR);
      } catch (err) {
        interactive = null;
      }
      if (!interactive) return;
    }

    var subject = interactive || target;
    var anchor = target.closest("a");
    var href = anchor ? anchor.href : null;

    this.track(TYPES.CLICK, {
      element: subject.tagName || null,
      element_id: subject.id || null,
      element_classes: classNameOf(subject),
      element_role: subject.getAttribute ? subject.getAttribute("role") : null,
      text: util.truncate(subject.textContent, MAX_TEXT_LENGTH),
      link_href: href ? NS.context.stripSensitiveParams(href) : null,
      mouse_x: e.clientX,
      mouse_y: e.clientY,
      page_x: e.pageX,
      page_y: e.pageY,
      scroll_y: this.window.scrollY || 0,
    });

    if (!href) return;

    if (DOWNLOAD_EXT.test(href)) {
      this.track(TYPES.FILE_DOWNLOAD, {
        file_url: NS.context.stripSensitiveParams(href),
        file_name: fileNameOf(href),
        link_text: util.truncate(anchor.textContent, MAX_TEXT_LENGTH),
      });
      return;
    }

    if (this._isOutbound(href)) {
      this.track(TYPES.OUTBOUND_CLICK, {
        target_url: NS.context.stripSensitiveParams(href),
        target_host: hostOf(href),
        link_text: util.truncate(anchor.textContent, MAX_TEXT_LENGTH),
      });
      // An outbound click usually means the page is about to go away.
      this.queue.flushWithBeacon();
    }
  };

  /** `className` is an SVGAnimatedString on SVG elements, not a string. */
  function classNameOf(element) {
    if (!element) return null;
    var raw =
      element.getAttribute && element.getAttribute("class") !== null
        ? element.getAttribute("class")
        : typeof element.className === "string"
          ? element.className
          : "";
    return util.truncate(raw, 200) || null;
  }

  function fileNameOf(href) {
    var withoutQuery = String(href).split("?")[0].split("#")[0];
    var parts = withoutQuery.split("/");
    return parts[parts.length - 1] || null;
  }

  Tracker.prototype._isOutbound = function (href) {
    if (!/^https?:/i.test(href)) return false;
    var host = hostOf(href);
    var current = this.window.location ? this.window.location.hostname : "";
    return !!host && host !== current;
  };

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  }

  Tracker.prototype._scheduleScrollMeasure = function () {
    var self = this;
    if (this.scrollScheduled) return;
    this.scrollScheduled = true;

    var raf = this.window.requestAnimationFrame;
    var run = function () {
      self.scrollScheduled = false;
      self._handleScroll();
    };

    if (typeof raf === "function") raf.call(this.window, run);
    else if (this.window.setTimeout) this.window.setTimeout(run, 100);
    else run();
  };

  Tracker.prototype._handleScroll = function () {
    var win = this.window;
    var doc = this.document || {};
    var scrollTop = win.scrollY || 0;
    var viewportHeight = win.innerHeight || 0;
    var fullHeight = Math.max(
      doc.body ? doc.body.scrollHeight : 0,
      doc.documentElement ? doc.documentElement.scrollHeight : 0
    );
    if (fullHeight <= 0) return;

    var depth = Math.min(100, Math.round(((scrollTop + viewportHeight) / fullHeight) * 100));
    if (depth <= this.maxScrollDepth) return;
    this.maxScrollDepth = depth;

    for (var i = 0; i < SCROLL_MILESTONES.length; i++) {
      var milestone = SCROLL_MILESTONES[i];
      if (depth >= milestone && !this.firedMilestones[milestone]) {
        this.firedMilestones[milestone] = true;
        this.track(TYPES.SCROLL, {
          depth_percent: milestone,
          time_to_depth_ms: util.nowMs() - this.pageStartedAt,
        });
      }
    }
  };

  /**
   * Reports time on page as a *delta* since the last report.
   *
   * A visitor who switches tabs three times produces three `time_spent`
   * events. If each carried the total elapsed time, summing them would
   * multiply-count the same seconds; reporting deltas keeps aggregation
   * correct, and `total_duration_ms` is carried alongside for the cases where
   * the running total is what you want.
   */
  Tracker.prototype._trackTimeSpent = function (reason) {
    if (!this.features.time) return;
    var now = util.nowMs();
    var delta = Math.max(0, now - this.lastTimeReportAt);

    this._accrueEngagement();
    var engaged = this.engagedMs;
    this.engagedMs = 0;
    if (this._isVisible()) this.engagedSince = now;

    this.lastTimeReportAt = now;

    this.track(TYPES.TIME_SPENT, {
      duration_ms: delta,
      engaged_ms: engaged,
      total_duration_ms: now - this.pageStartedAt,
      scroll_depth: this.maxScrollDepth,
      reason: reason || "exit",
    });
  };

  /**
   * `form_view` fires when a form actually enters the viewport.
   *
   * Re-runs on route changes and watches for forms injected later, which is
   * how most modern themes render checkout steps and popups.
   */
  Tracker.prototype._observeForms = function () {
    var self = this;
    var doc = this.document;
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    if (typeof this.window.IntersectionObserver !== "function") return;

    if (!this.formObserver) {
      this.formObserver = new this.window.IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isIntersecting) continue;
            var form = entries[i].target;
            var key = formKey(form);
            if (self.seenForms[key]) continue;
            self.seenForms[key] = true;
            self.track(TYPES.FORM_VIEW, { form_id: key, form_action: formAction(form) });
            self.formObserver.unobserve(form);
          }
        },
        { threshold: 0.4 }
      );
    }

    this._observeFormsIn(doc);

    if (!this.formMutationObserver && typeof this.window.MutationObserver === "function" && doc.body) {
      this.formMutationObserver = new this.window.MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (!node || node.nodeType !== 1) continue;
            if (node.tagName === "FORM") self._observeForm(node);
            else if (typeof node.querySelectorAll === "function") self._observeFormsIn(node);
          }
        }
      });
      this.formMutationObserver.observe(doc.body, { childList: true, subtree: true });
    }
  };

  Tracker.prototype._observeFormsIn = function (root) {
    var forms = root.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) this._observeForm(forms[i]);
  };

  Tracker.prototype._observeForm = function (form) {
    if (!this.formObserver || !isTrackableForm(form)) return;
    if (form.__bapObserved) return;
    form.__bapObserved = true;
    this.formObserver.observe(form);
  };

  Tracker.prototype._handleFormFocus = function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== "function") return;
    var form = target.closest("form");
    if (!form || !isTrackableForm(form)) return;
    var key = formKey(form);
    if (this.startedForms[key]) return;
    this.startedForms[key] = true;
    this.track(TYPES.FORM_START, { form_id: key, form_action: formAction(form) });
  };

  Tracker.prototype._handleFormSubmit = function (e) {
    var form = e.target;
    if (!form || form.tagName !== "FORM" || !isTrackableForm(form)) return;
    this.track(TYPES.FORM_SUBMIT, {
      form_id: formKey(form),
      form_action: formAction(form),
      field_count: form.elements ? form.elements.length : 0,
    });
    // A submit navigates away; get what we have out of the door.
    this.queue.flushWithBeacon();
  };

  /**
   * Never instrument credential or payment forms.
   *
   * The verdict is cached on the element: this runs on every focus and submit,
   * and `querySelector` on each one is a measurable cost in long forms.
   */
  function isTrackableForm(form) {
    if (!form) return false;
    if (typeof form.__bapTrackable === "boolean") return form.__bapTrackable;

    var trackable = true;
    if (form.getAttribute && form.getAttribute("data-bap-ignore") !== null) {
      trackable = false;
    } else {
      var action = (form.getAttribute ? form.getAttribute("action") || "" : "").toLowerCase();
      if (/wp-login|lostpassword|resetpass|checkout\/pay/.test(action)) trackable = false;
      else if (form.querySelector && form.querySelector('input[type="password"]')) trackable = false;
    }

    form.__bapTrackable = trackable;
    return trackable;
  }

  function formKey(form) {
    return (
      (form.getAttribute && form.getAttribute("data-bap-form-id")) ||
      form.id ||
      (form.getAttribute && form.getAttribute("name")) ||
      classNameOf(form) ||
      "form"
    );
  }

  function formAction(form) {
    var action = (form.getAttribute && form.getAttribute("action")) || "";
    return action ? NS.context.stripSensitiveParams(action) : null;
  }

  /* ---------------------------------------------------------------- */
  /* Public surface                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * @param {string} type
   * @param {Object} [data]
   * @param {Object} [options] `{ event_id, send }` — `send: false` queues
   *                           without an immediate request.
   */
  Tracker.prototype.track = function (type, data, options) {
    if (!this.ready || !this.consent.canTrack()) return Promise.resolve(false);

    // A runaway loop in host-page code must not be able to fill the visitor's
    // storage quota. The cap is per page view, and is reported once.
    if (this.eventsThisPage >= this.maxEventsPerPage) {
      if (!this.capReported) {
        this.capReported = true;
        this.logger.warn("event cap reached for this page view:", this.maxEventsPerPage);
      }
      return Promise.resolve(false);
    }
    this.eventsThisPage++;

    options = options || {};
    var event = this.eventFactory.build(type, data, { event_id: options.event_id });
    this.logger.debug("track", type, event.event_id);
    return this.queue.enqueue(event, { send: options.send });
  };

  /**
   * Forces a delivery pass.
   *
   * Rarely needed now that events go out as they happen — it exists for the
   * backlog: retries waiting out a backoff, and records a previous page left
   * behind. Kept as `flush()` because that is the name the public API has
   * always used.
   */
  Tracker.prototype.flush = function () {
    return this.queue ? this.queue.drain({ reason: "manual" }) : Promise.resolve(null);
  };

  Tracker.prototype.setConsent = function (patch) {
    return this.consent.update(patch || {});
  };

  /**
   * Forgets this visitor and starts over: a fresh anonymous id, a fresh page
   * view, and no attribution history. Anything already delivered is untouched —
   * retracting that is what the privacy erasure tools are for.
   *
   * This is the *only* path that mints a new anonymous id. Ordinary logout does
   * not, because the browser has not changed; this is an explicit request to
   * forget the device.
   */
  Tracker.prototype.reset = function () {
    if (!this.ready) return Promise.resolve(false);
    var self = this;

    return this.flush()
      .catch(function () {
        return null;
      })
      .then(function () {
        self.identity.reset();
        self.pageView.start();
        self.attribution.reset();
        self._resetPageState();
        self.logger.debug("identity reset");
        return true;
      });
  };

  /** Stops collection and withdraws every consent category. */
  Tracker.prototype.optOut = function () {
    this.consent.withdrawAll();
    this.started = false;
    return this.consent.toPayload();
  };

  Tracker.prototype.optIn = function () {
    return this.consent.update({ analytics: true });
  };

  /**
   * A snapshot for diagnostics. Safe to show an administrator: identifiers
   * only, never queued payloads.
   */
  Tracker.prototype.getState = function () {
    return {
      version: NS.VERSION,
      schema_version: NS.SCHEMA_VERSION,
      ready: this.ready,
      started: this.started,
      site_id: this.config.site_id,
      endpoint: this.config.endpoint,
      transport: this.config.ingest_key ? "direct" : "proxy",
      anonymous_id: this.identity ? this.identity.getAnonymousId() : null,
      wp_user_id: this.identity ? this.identity.wpUserId : null,
      pending_link: this.identity ? this.identity.needsLink() : false,
      link_error: this.linkError || null,
      page_view_id: this.pageView ? this.pageView.getId() : null,
      page_views_this_load: this.pageView ? this.pageView.viewCount : 0,
      consent: this.consent ? this.consent.toPayload() : null,
      online: this.queue ? this.queue.isOnline() : null,
      paused_until: this.queue ? this.queue.pausedUntil : null,
      queue_driver: this.queue && this.queue.store ? this.queue.store.driver : null,
      is_drain_leader: this.coordinator ? !!this.coordinator.isLeader : null,
      tab_id: this.coordinator ? this.coordinator.tabId : null,
      features: this.features,
      events_this_page: this.eventsThisPage,
      storage: {
        local_storage: util.Storage.available(),
        indexed_db: !!(this.window.indexedDB),
        broadcast_channel: typeof this.window.BroadcastChannel === "function",
        cookies: !!(this.document && typeof this.document.cookie === "string"),
      },
      stats: this.queue ? this.queue.stats : null,
    };
  };

  /** Queue health, for the admin Queue Inspector. */
  Tracker.prototype.getQueueSnapshot = function () {
    return this.queue ? this.queue.snapshot() : Promise.resolve({ available: false });
  };

  /** Drains any `bahoosh(...)` calls made before the script finished loading. */
  Tracker.prototype._exposeApi = function () {
    var self = this;
    var win = this.window;
    var pending = win.bahoosh && win.bahoosh.q ? win.bahoosh.q.slice() : [];

    var api = function (method) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (typeof api[method] === "function") return api[method].apply(api, args);
      self.logger.warn("unknown method", method);
      return undefined;
    };

    api.track = function (type, data, options) {
      return self.track(type, data, options);
    };
    api.flush = function () {
      return self.flush();
    };
    api.consent = function (patch) {
      return self.setConsent(patch);
    };
    api.optOut = function () {
      return self.optOut();
    };
    api.optIn = function () {
      return self.optIn();
    };
    api.reset = function () {
      return self.reset();
    };
    api.getState = function () {
      return self.getState();
    };
    api.queue = function () {
      // Queued payloads are only exposed with debugging on: any third-party
      // script on the page can call this.
      if (!self.config.debug) {
        self.logger.warn("queue inspection requires debug mode");
        return Promise.resolve([]);
      }
      return self.queue.inspect();
    };
    api.snapshot = function () {
      return self.getQueueSnapshot();
    };
    api.retryFailed = function () {
      return self.queue.retryFailed();
    };
    api.clearFailed = function () {
      return self.queue.clearFailed();
    };
    api.instance = self;
    api.version = NS.VERSION;

    win.bahoosh = api;

    for (var i = 0; i < pending.length; i++) {
      try {
        api.apply(null, pending[i]);
      } catch (e) {
        self.logger.warn("queued call failed", e && e.message);
      }
    }

    if (win.document && typeof win.CustomEvent === "function") {
      win.document.dispatchEvent(new win.CustomEvent("bahoosh:ready", { detail: self.getState() }));
    }
  };

  NS.Tracker = Tracker;

  // Auto-boot unless the host page opts out (tests construct their own).
  if (global.BAP_CONFIG && !global.BAP_CONFIG.manual_boot) {
    var config = global.BAP_CONFIG;
    config.window = global;
    var tracker = new Tracker(config);
    NS.instance = tracker;
    tracker.init().catch(function (error) {
      if (global.console && console.warn) {
        console.warn("[Bahoosh] init failed", error && error.message);
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
