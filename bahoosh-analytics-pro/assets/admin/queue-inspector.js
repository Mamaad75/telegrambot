/**
 * Bahoosh Analytics Pro — browser queue inspector.
 *
 * The tracking queue is in IndexedDB, which PHP cannot read. wp-admin is the
 * same origin as the front end, though, so this script opens the very same
 * database the tracker uses and reports what is genuinely there. Nothing on
 * this screen is estimated or assumed.
 *
 * It boots the tracker's own modules with `manual_boot`, so the queue logic
 * exercised here is the tested production code rather than a second
 * implementation that could drift.
 */
(function () {
  "use strict";

  var config = window.BAP_QUEUE_INSPECTOR;
  var root = document.querySelector("[data-bap-queue-inspector]");
  if (!config || !root) return;

  var NS = window.BahooshAnalytics;
  var els = {
    loading: root.querySelector("[data-queue-loading]"),
    summary: root.querySelector("[data-queue-summary]"),
    details: root.querySelector("[data-queue-details]"),
    rows: root.querySelector("[data-queue-rows]"),
    status: root.querySelector("[data-queue-status]"),
  };

  var manager = null;

  function setStatus(message, isError) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.className = "bap-status" + (isError ? " is-error" : "");
  }

  function text(node, selector, value) {
    var target = node.querySelector(selector);
    if (target) target.textContent = value;
  }

  function formatTime(ms) {
    if (!ms) return config.i18n.never;
    try {
      return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
      }).format(new Date(ms));
    } catch (e) {
      return String(ms);
    }
  }

  /** Builds the queue stack against the same endpoint the tracker uses. */
  function build() {
    if (manager) return Promise.resolve(manager);
    if (!NS || !NS.QueueManager) {
      return Promise.reject(new Error(config.i18n.trackerMissing));
    }

    var transport = new NS.Transport({
      endpoint: config.endpoint,
      siteId: config.siteId,
      credentials: "same-origin",
      headers: config.nonce ? { "X-WP-Nonce": config.nonce } : {},
    });

    var identity = new NS.IdentityManager({}).init();
    var pageView = new NS.PageView();
    pageView.start();

    manager = new NS.QueueManager({
      transport: transport,
      // No interval: this screen delivers only when an administrator asks.
      drainIntervalMs: 24 * 60 * 60 * 1000,
    });

    manager.identity = identity;
    manager.pageView = pageView;

    return manager.init().then(function () {
      // The inspector must never start delivering on its own.
      manager.stop();
      return manager;
    });
  }

  function readConsentCookie() {
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf("bap_consent=") === 0) {
        try {
          return JSON.parse(decodeURIComponent(part.slice("bap_consent=".length)));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  function describeStorage() {
    var available = [];
    if (window.indexedDB) available.push("IndexedDB");
    try {
      window.localStorage.setItem("__bap_probe__", "1");
      window.localStorage.removeItem("__bap_probe__");
      available.push("localStorage");
    } catch (e) {
      /* blocked */
    }
    if (typeof window.BroadcastChannel === "function") available.push("BroadcastChannel");
    return available.length ? available.join(", ") : config.i18n.noStorage;
  }

  function render(snapshot, records) {
    if (els.loading) els.loading.hidden = true;
    if (els.summary) els.summary.hidden = false;
    if (els.details) els.details.hidden = false;

    var counts = snapshot.counts || {};
    text(root, '[data-count="pending"]', String(counts.pending || 0));
    text(root, '[data-count="sending"]', String(counts.sending || 0));
    text(root, '[data-count="failed"]', String(counts.failed || 0));
    text(root, '[data-count="total"]', String(snapshot.total || 0));

    var stats = snapshot.stats || {};
    text(root, '[data-field="driver"]', snapshot.driver || "—");
    text(root, '[data-field="oldest"]', snapshot.oldest_created_at ? formatTime(snapshot.oldest_created_at) : "—");
    text(root, '[data-field="last_success"]', formatTime(stats.last_success_at));
    text(root, '[data-field="last_failure"]', formatTime(stats.last_failure_at));
    text(root, '[data-field="last_error"]', stats.last_error || "—");
    text(root, '[data-field="online"]', snapshot.online ? config.i18n.online : config.i18n.offline);

    var identity = manager && manager.identity ? manager.identity.getAnonymousId() : null;
    var pageView = manager && manager.pageView ? manager.pageView.getId() : null;
    text(root, '[data-field="anonymous_id"]', identity || "—");
    text(root, '[data-field="page_view_id"]', pageView || "—");

    var consent = readConsentCookie();
    text(
      root,
      '[data-field="consent"]',
      consent
        ? config.i18n.analytics + ": " + (consent.analytics ? config.i18n.granted : config.i18n.denied)
        : config.i18n.noConsentCookie
    );
    text(root, '[data-field="storage"]', describeStorage());

    renderRows(records);
  }

  /**
   * Renders queued events.
   *
   * Built with DOM APIs, never innerHTML: an event payload carries page URLs
   * and product names, which are attacker-influenced strings.
   */
  function renderRows(records) {
    if (!els.rows) return;
    els.rows.textContent = "";

    if (!records.length) {
      var empty = document.createElement("tr");
      var cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "bap-muted";
      cell.textContent = config.i18n.nothingQueued;
      empty.appendChild(cell);
      els.rows.appendChild(empty);
      return;
    }

    records
      .slice()
      .sort(function (a, b) {
        return (b.created_at || 0) - (a.created_at || 0);
      })
      .slice(0, 100)
      .forEach(function (record) {
        var payload = record.payload || {};
        var tr = document.createElement("tr");

        var type = document.createElement("td");
        var strong = document.createElement("strong");
        strong.textContent = payload.event_type || "—";
        var code = document.createElement("code");
        code.className = "bap-id";
        code.textContent = record.event_id;
        type.appendChild(strong);
        type.appendChild(document.createElement("br"));
        type.appendChild(code);

        var state = document.createElement("td");
        var badge = document.createElement("span");
        badge.className = "bap-badge " + stateClass(record.state);
        badge.textContent = stateLabel(record.state);
        state.appendChild(badge);

        var attempts = document.createElement("td");
        attempts.textContent = String(record.attempts || 0);

        var queued = document.createElement("td");
        queued.textContent = formatTime(record.created_at);

        var error = document.createElement("td");
        error.className = "bap-error";
        error.textContent = record.last_error || "";

        tr.appendChild(type);
        tr.appendChild(state);
        tr.appendChild(attempts);
        tr.appendChild(queued);
        tr.appendChild(error);
        els.rows.appendChild(tr);
      });
  }

  function stateLabel(state) {
    return config.i18n.states[state] || state;
  }

  function stateClass(state) {
    if (state === "failed") return "is-critical";
    if (state === "sending") return "is-recommended";
    return "";
  }

  function refresh() {
    return build()
      .then(function (queue) {
        return Promise.all([queue.snapshot(), queue.inspect()]);
      })
      .then(function (results) {
        render(results[0], results[1]);
      })
      .catch(function (error) {
        if (els.loading) {
          els.loading.textContent = error && error.message ? error.message : config.i18n.error;
        }
        setStatus(error && error.message, true);
      });
  }

  var ACTIONS = {
    refresh: function () {
      return refresh().then(function () {
        setStatus(config.i18n.refreshed, false);
      });
    },

    flush: function () {
      return build()
        .then(function (queue) {
          return queue.drain({ reason: "manual" });
        })
        .then(function (result) {
          setStatus(
            result && result.skipped
              ? config.i18n.flushSkipped + " (" + result.skipped + ")"
              : config.i18n.flushed,
            false
          );
          return refresh();
        });
    },

    retry: function () {
      return build()
        .then(function (queue) {
          return queue.retryFailed();
        })
        .then(function (count) {
          setStatus(config.i18n.requeued.replace("%d", String(count)), false);
          return refresh();
        });
    },

    "clear-failed": function () {
      if (!window.confirm(config.i18n.confirmClearFailed)) return Promise.resolve();
      return build()
        .then(function (queue) {
          return queue.clearFailed();
        })
        .then(function (count) {
          setStatus(config.i18n.cleared.replace("%d", String(count)), false);
          return refresh();
        });
    },

    "clear-all": function () {
      // Two confirmations: this discards pending events that would otherwise
      // still be delivered.
      if (!window.confirm(config.i18n.confirmClearAll)) return Promise.resolve();
      if (!window.confirm(config.i18n.confirmClearAllAgain)) return Promise.resolve();

      return build()
        .then(function (queue) {
          return queue.clearAll();
        })
        .then(function () {
          try {
            ["bap_anonymous_id", "bap_identity_link", "bap_attribution", "bap_consent", "bap_leader"].forEach(
              function (key) {
                window.localStorage.removeItem(key);
              }
            );
          } catch (e) {
            /* storage blocked; the queue is cleared regardless */
          }
          setStatus(config.i18n.clearedAll, false);
          return refresh();
        });
    },
  };

  root.addEventListener("click", function (event) {
    var button = event.target.closest("[data-queue-action]");
    if (!button) return;
    event.preventDefault();

    var action = ACTIONS[button.getAttribute("data-queue-action")];
    if (!action) return;

    button.disabled = true;
    setStatus(config.i18n.working, false);
    Promise.resolve()
      .then(action)
      .catch(function (error) {
        setStatus(error && error.message ? error.message : config.i18n.error, true);
      })
      .then(function () {
        button.disabled = false;
      });
  });

  refresh();
})();
