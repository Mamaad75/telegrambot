/**
 * Bahoosh Analytics Pro v3 — TabCoordinator.
 *
 * Ten open tabs should not mean ten drain loops working over one shared queue.
 * One tab holds a lease and runs the periodic drain; the others collect and
 * persist normally and let the leader deliver the backlog.
 *
 * What this class is *not*: duplicate protection. That is `event_id` and the
 * server's answer, both of which hold whether or not any of this runs. Two tabs
 * racing produces one redundant request that the server settles as
 * `duplicate` — a wasted round trip, not a wrong number. Every guarantee still
 * holds with `multi_tab_coordination` switched off, and the tests assert it.
 *
 * Leadership is a *lease*, not a lock, which is what makes it safe when a tab
 * is closed, crashes, or is frozen by the browser: the lease expires and
 * another tab takes over. There is no handshake to get stuck in.
 *
 * v3 shrank this file considerably. It used to carry a BroadcastChannel
 * messaging layer for announcing flushes between tabs; with events sent
 * individually as they happen there is nothing left to announce, and an unused
 * abstraction is worse than no abstraction. The localStorage lease is the whole
 * mechanism now.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;

  var LEASE_KEY = "bap_leader";
  var DEFAULT_LEASE_MS = 8000;
  var DEFAULT_RENEW_MS = 3000;

  function TabCoordinator(options) {
    options = options || {};
    this.storage = options.storage || util.Storage;
    this.window = options.window || global;
    this.now = options.now || util.nowMs;
    this.logger = options.logger || util.createLogger(false);

    this.leaseMs = util.positiveNumberOr(options.leaseMs, DEFAULT_LEASE_MS);
    this.renewMs = util.positiveNumberOr(options.renewMs, DEFAULT_RENEW_MS);

    this.tabId = options.tabId || util.prefixedId("tab");
    this.timerId = null;
    this.isLeader = false;
    this.enabled = options.enabled !== false;
  }

  TabCoordinator.prototype.start = function () {
    if (!this.enabled) return this;

    this._claimOrYield();

    var self = this;
    if (this.window.setInterval) {
      this.timerId = this.window.setInterval(function () {
        self._claimOrYield();
      }, this.renewMs);
    }

    // Releasing on unload lets the next tab take over immediately rather than
    // waiting out the lease. Best effort: a crash skips this, which is exactly
    // what the lease expiry is for.
    if (this.window.addEventListener) {
      this.window.addEventListener("pagehide", function () {
        self.release();
      });
    }

    return this;
  };

  /**
   * Takes the lease if it is free or stale, renews it if we already hold it.
   *
   * Read-modify-write over localStorage is not atomic, so two tabs can briefly
   * both believe they lead. Deliberately not fixed: the cost is one redundant
   * request that settles as a duplicate, and the locking needed to close that
   * window would be more failure surface than the problem is worth.
   */
  TabCoordinator.prototype._claimOrYield = function () {
    if (!this.enabled) return true;

    var now = this.now();
    var lease = this.storage.getJSON(LEASE_KEY, null);
    var wasLeader = this.isLeader;

    var held = lease && typeof lease.tab_id === "string" && (lease.expires_at || 0) > now;

    if (!held || lease.tab_id === this.tabId) {
      this.storage.setJSON(LEASE_KEY, {
        tab_id: this.tabId,
        expires_at: now + this.leaseMs,
      });
      this.isLeader = true;
    } else {
      this.isLeader = false;
    }

    if (this.isLeader !== wasLeader) {
      this.logger.debug(this.isLeader ? "became drain leader" : "yielded drain leadership");
    }

    return this.isLeader;
  };

  /**
   * Whether this tab should run the periodic drain.
   *
   * Only the scheduled sweep asks. Sending an event as it happens, delivering
   * on page exit, and a manual drain are all unconditional — those are moments
   * where delivery matters more than tidiness.
   */
  TabCoordinator.prototype.shouldDrain = function () {
    if (!this.enabled) return true;
    return this._claimOrYield();
  };

  /** Gives up leadership so another tab can take over without waiting. */
  TabCoordinator.prototype.release = function () {
    if (!this.enabled || !this.isLeader) return;

    var lease = this.storage.getJSON(LEASE_KEY, null);
    if (lease && lease.tab_id === this.tabId) {
      this.storage.remove(LEASE_KEY);
    }
    this.isLeader = false;
  };

  TabCoordinator.prototype.stop = function () {
    if (this.timerId && this.window.clearInterval) {
      this.window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.release();
  };

  NS.TabCoordinator = TabCoordinator;
  NS.tabLeaseKey = LEASE_KEY;
})(typeof window !== "undefined" ? window : globalThis);
