/**
 * Bahoosh Analytics Pro — on-screen diagnostic.
 *
 * A desktop browser has a console. A phone does not, and an iPhone needs a Mac
 * and a cable before it will show you one — which is exactly the device where
 * tracking problems actually happen. Without something like this, diagnosing
 * "it does not work on my iPhone" is guesswork on both sides.
 *
 * Append `?bap_debug=1` to any front-end URL and a small panel appears with the
 * tracker's real state: which storage driver it got, how many events it has
 * queued, whether the last send succeeded, and every error. Screenshot it and
 * the problem is usually obvious.
 *
 * Off unless asked for, never shown to an ordinary visitor, and it reports only
 * the tracker's own state — no page content and nothing about the person using
 * it.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;

  var MAX_LINES = 14;

  function enabled(win) {
    try {
      return (win.location.search || "").indexOf("bap_debug=1") !== -1;
    } catch (e) {
      return false;
    }
  }

  function OnScreenDebug(tracker) {
    this.tracker = tracker;
    this.window = tracker.window;
    this.document = tracker.document;
    this.lines = [];
    this.panel = null;
    this.body = null;
  }

  OnScreenDebug.prototype.mount = function () {
    var doc = this.document;
    if (!doc || !doc.body) return this;

    var panel = doc.createElement("div");
    panel.setAttribute("dir", "ltr");
    panel.style.cssText = [
      "position:fixed",
      "inset-inline-start:8px",
      "inset-block-end:8px",
      "z-index:2147483647",
      "max-width:min(92vw,420px)",
      "max-height:52vh",
      "overflow:auto",
      "background:rgba(12,12,20,.94)",
      "color:#e8e8f0",
      "font:11px/1.6 ui-monospace,Menlo,monospace",
      "padding:9px 11px",
      "border-radius:11px",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 8px 28px rgba(0,0,0,.45)",
      "-webkit-user-select:text",
      "user-select:text",
    ].join(";");

    var head = doc.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-weight:700";
    head.appendChild(doc.createTextNode("Bahoosh tracker"));

    var close = doc.createElement("span");
    close.textContent = "×";
    close.style.cssText = "cursor:pointer;padding:0 5px";
    close.addEventListener("click", function () {
      panel.parentNode && panel.parentNode.removeChild(panel);
    });
    head.appendChild(close);

    var body = doc.createElement("div");

    panel.appendChild(head);
    panel.appendChild(body);
    doc.body.appendChild(panel);

    this.panel = panel;
    this.body = body;

    return this;
  };

  OnScreenDebug.prototype.log = function (text) {
    this.lines.push(text);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.render();
  };

  OnScreenDebug.prototype.render = function () {
    if (!this.body) return;

    var tracker = this.tracker;
    var queue = tracker.queue || {};
    var stats = queue.stats || {};
    var store = queue.store || {};

    var summary = [
      "ready: " + (tracker.ready ? "yes" : "NO") + "   started: " + (tracker.started ? "yes" : "NO"),
      "storage: " + (store.driver || "none") + (queue.usingBuffer ? " (buffer)" : ""),
      "online flag: " + (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : "n/a"),
      "beacon: " + (typeof navigator !== "undefined" && navigator.sendBeacon ? "yes" : "NO"),
      "queued: " + (stats.enqueued || 0) + "   sent: " + (stats.stored || 0) + "   dup: " + (stats.duplicates || 0),
      "rejected: " + (stats.rejected || 0) + "   held: " + Object.keys(queue.pending || {}).length,
      "last error: " + (stats.last_error || "none"),
    ];

    this.body.textContent = summary.concat(this.lines).join("\n");
  };

  /**
   * Attaches the panel when the URL asks for it.
   *
   * @param {Object} tracker
   * @returns {Object|null}
   */
  function attach(tracker) {
    if (!tracker || !enabled(tracker.window)) return null;

    var view = new OnScreenDebug(tracker).mount();
    var start = NS.util.nowMs();

    view.render();

    // Refreshed on a timer rather than hooked into every code path: the panel
    // must never be able to change the behaviour it is reporting on.
    if (tracker.window.setInterval) {
      tracker.window.setInterval(function () {
        view.log("t+" + Math.round((NS.util.nowMs() - start) / 1000) + "s");
        view.lines = view.lines.slice(-1);
        view.render();
      }, 2000);
    }

    return view;
  }

  NS.OnScreenDebug = OnScreenDebug;
  NS.attachOnScreenDebug = attach;
})(typeof window !== "undefined" ? window : globalThis);
