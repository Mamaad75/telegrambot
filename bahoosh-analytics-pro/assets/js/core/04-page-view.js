/**
 * Bahoosh Analytics Pro v3 — PageView.
 *
 * Replaces the session as the unit that groups events. A page view is exactly
 * what its name says: one load of one page, from the moment the tracker boots
 * until the visitor navigates away.
 *
 * The id lives in memory and nowhere else. That is the whole design:
 *
 *   - Nothing to expire, so there is no timeout to tune and no clock to trust.
 *   - Nothing to share, so two tabs cannot disagree and no cross-tab
 *     coordination is needed to keep them consistent.
 *   - Nothing to resolve server-side, so an event carries its grouping with it.
 *   - A refresh mints a new one, which is correct: a refresh *is* a new view.
 *
 * Sessions have not disappeared as a concept — they are derived analytically
 * from the stored events, where the window can be changed retroactively without
 * redeploying a tracker. The tracker's job is to report what happened, not to
 * decide where one visit ends and the next begins.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  function PageView(options) {
    options = options || {};
    this.now = options.now || util.nowMs;
    this.id = null;
    this.startedAt = 0;
    this.viewCount = 0;
  }

  /**
   * Opens a page view. Called once on load and again on every SPA route change;
   * both are genuinely new views and each gets its own id.
   *
   * @returns {string} The new page view id.
   */
  PageView.prototype.start = function () {
    this.id = util.prefixedId("pv");
    this.startedAt = this.now();
    this.viewCount++;
    return this.id;
  };

  /**
   * The current id, opening a view if one is somehow not yet open.
   *
   * The fallback is not defensive padding: it guarantees that no event can ever
   * be built without a page view id, which is the invariant the whole grouping
   * model rests on.
   */
  PageView.prototype.getId = function () {
    if (!this.id) this.start();
    return this.id;
  };

  /** Milliseconds since this page view opened. */
  PageView.prototype.elapsedMs = function () {
    return this.startedAt ? Math.max(0, this.now() - this.startedAt) : 0;
  };

  NS.PageView = PageView;
})(typeof window !== "undefined" ? window : globalThis);
