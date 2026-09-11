/**
 * Bahoosh Analytics Pro v3 — QueueManager.
 *
 * Owns the durable outbox and the delivery loop. Four invariants, in the order
 * they matter:
 *
 *   1. An event is written to durable storage before any network attempt.
 *   2. An event is deleted only on a *settled* answer — `stored`, `duplicate`,
 *      or a non-retryable `rejected`. Never because a request was merely
 *      issued, and never because a response was ambiguous.
 *   3. A retry re-sends the stored record untouched. `event_id` and
 *      `timestamp_client` are byte-identical to the originals, which is what
 *      lets the server recognise the repeat.
 *   4. The server is the authority on duplicates. A `duplicate` is a success.
 *
 * v3 sends one event per request as it happens. The batch is gone; the queue
 * remains, because a connection failure must not lose data. What used to be a
 * "flush a batch" cycle is now "drain the pending records, one request each,
 * bounded by the transport's concurrency cap".
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;
  var STATE = NS.QUEUE_STATE;
  var SETTLEMENT = NS.SETTLEMENT;

  var DEFAULTS = {
    DRAIN_INTERVAL_MS: 15000,
    LEASE_MS: 60000,
    BEACON_LEASE_MS: 5 * 60 * 1000,
    MAX_QUEUE_SIZE: 1000,
    MAX_EVENT_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    PAUSE_MS: 10 * 60 * 1000,
    // How many records one drain pass will claim. Not a batch — each is still
    // its own request — just a bound so a huge backlog is worked through in
    // slices rather than all at once.
    DRAIN_LIMIT: 20,
  };

  /** In-memory shim so the tracker still queues when all storage is blocked. */
  function memoryStorage() {
    var data = {};
    return {
      available: function () {
        return true;
      },
      get: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      set: function (k, v) {
        data[k] = v;
        return true;
      },
      remove: function (k) {
        delete data[k];
      },
      getJSON: function (k, fallback) {
        var raw = this.get(k);
        return raw === null ? fallback : util.safeJsonParse(raw, fallback);
      },
      setJSON: function (k, v) {
        return this.set(k, JSON.stringify(v));
      },
    };
  }

  function QueueManager(options) {
    options = options || {};
    this.transport = options.transport;
    this.retry = options.retry || new NS.RetryPolicy();
    this.logger = options.logger || util.createLogger(false);
    this.window = options.window || global;
    this.now = options.now || util.nowMs;

    this.drainIntervalMs = util.positiveNumberOr(
      options.drainIntervalMs,
      DEFAULTS.DRAIN_INTERVAL_MS
    );
    this.drainLimit = util.positiveNumberOr(options.drainLimit, DEFAULTS.DRAIN_LIMIT);
    this.leaseMs = util.positiveNumberOr(options.leaseMs, DEFAULTS.LEASE_MS);
    this.beaconLeaseMs = util.positiveNumberOr(options.beaconLeaseMs, DEFAULTS.BEACON_LEASE_MS);
    this.maxQueueSize = util.positiveNumberOr(options.maxQueueSize, DEFAULTS.MAX_QUEUE_SIZE);
    this.maxEventAgeMs = util.positiveNumberOr(options.maxEventAgeMs, DEFAULTS.MAX_EVENT_AGE_MS);
    this.pauseMs = util.positiveNumberOr(options.pauseMs, DEFAULTS.PAUSE_MS);

    this.store = options.store || null;
    this.coordinator = options.coordinator || null;
    this.draining = false;
    this.pausedUntil = 0;
    this.timerId = null;
    // Unsettled events for this page view, kept in memory so the exit path can
    // beacon them without an async read. Capped so a long-lived tab on a busy
    // site cannot grow it without bound.
    this.pending = {};
    this.maxPending = util.positiveNumberOr(options.maxPending, 50);

    this.stats = {
      enqueued: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      dropped: 0,
      migrated: 0,
      attempts: 0,
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      last_drain_reason: null,
    };
  }

  QueueManager.prototype.init = function () {
    var self = this;

    if (this.store) {
      // A store supplied by the caller (tests, or a second init) is used as-is.
      return this._finishInit(Promise.resolve(this.store));
    }

    // A usable store exists from the first synchronous moment. Opening real
    // storage is asynchronous and, on Safari, sometimes never finishes at all;
    // until it does, events land here instead of being refused with "enqueue
    // before init". They are moved across when the real store arrives, so
    // nothing is lost and nothing waits.
    var buffer = new NS.queueStore.LocalQueueStore({ storage: memoryStorage() });
    this.store = buffer;
    this.usingBuffer = true;

    var opening = NS.queueStore
      .createQueueStore({ indexedDB: this.window.indexedDB, window: this.window })
      .then(function (store) {
        if (!store) return buffer;
        return self._adoptStore(store, buffer);
      });

    return this._finishInit(opening);
  };

  /**
   * Moves anything buffered during start-up into the durable store.
   *
   * @param {Object} store Durable store.
   * @param {Object} buffer Temporary in-memory store.
   * @returns {Promise<Object>} The durable store.
   */
  QueueManager.prototype._adoptStore = function (store, buffer) {
    var self = this;

    return buffer
      .all()
      .then(function (records) {
        if (!records.length) return null;
        self.logger.debug("moving", records.length, "buffered events to", store.driver);
        return store.put(records);
      })
      .catch(function (error) {
        // A failed handover must not lose the buffer: better to keep serving
        // from memory for this page view than to drop what it holds.
        self.logger.error("buffer handover failed", error && error.message);
        return null;
      })
      .then(function () {
        self.store = store;
        self.usingBuffer = false;
        return store;
      });
  };

  /**
   * Shared tail of `init()`: migrate, trim, bind listeners, start the timer.
   *
   * @param {Promise<Object>} ready Resolves with the store to use.
   * @returns {Promise<QueueManager>}
   */
  QueueManager.prototype._finishInit = function (ready) {
    var self = this;

    return ready
      .then(function (store) {
        self.store = store || new NS.queueStore.LocalQueueStore({ storage: memoryStorage() });
        self.logger.debug("queue driver:", self.store.driver);
        return self._migrateQueued();
      })
      .then(function () {
        return self.store.trim(self.now(), self.maxQueueSize, self.maxEventAgeMs);
      })
      .then(function (dropped) {
        if (dropped && dropped.length) {
          self.stats.dropped += dropped.length;
          self.logger.warn("dropped", dropped.length, "expired queued events");
        }
        self._bindNetworkListeners();
        self._startTimer();
        return self;
      })
      .catch(function (error) {
        self.logger.error("queue init failed", error && error.message);
        self.store = new NS.queueStore.LocalQueueStore({ storage: memoryStorage() });
        self._bindNetworkListeners();
        self._startTimer();
        return self;
      });
  };

  /**
   * Upgrades events left in the outbox by the v2 tracker.
   *
   * They are upgraded rather than discarded because they are real events the
   * visitor produced and we failed to deliver — exactly what the outbox exists
   * to protect. The count is logged so an upgrade is never silent.
   */
  QueueManager.prototype._migrateQueued = function () {
    var self = this;
    return this.store.all().then(function (records) {
      var changed = [];
      for (var i = 0; i < records.length; i++) {
        if (NS.queueStore.upgradeRecord(records[i])) changed.push(records[i]);
      }
      if (!changed.length) return 0;

      self.stats.migrated += changed.length;
      self.logger.warn("upgraded", changed.length, "queued events from schema 2 to 3");

      // One update per record rather than a bulk write: each carries its own
      // rewritten payload, and a migration runs once per browser in the
      // plugin's lifetime, so the extra calls cost nothing worth optimising.
      var writes = changed.map(function (record) {
        return self.store.update([record.event_id], { payload: record.payload });
      });
      return Promise.all(writes).then(function () {
        return changed.length;
      });
    });
  };

  QueueManager.prototype.isOnline = function () {
    var nav = this.window.navigator;
    return !nav || typeof nav.onLine !== "boolean" ? true : nav.onLine;
  };

  QueueManager.prototype._bindNetworkListeners = function () {
    var self = this;
    if (!this.window.addEventListener) return;
    this.window.addEventListener("online", function () {
      self.logger.debug("connection restored, draining queue");
      self.pausedUntil = 0;
      self.drain({ reason: "online" });
    });
    this.window.addEventListener("offline", function () {
      self.logger.debug("connection lost, buffering locally");
    });
  };

  /**
   * The safety net, not the main path.
   *
   * Events are sent as they happen, so in normal operation this timer finds an
   * empty queue. It exists for what is left behind: a failed send waiting out
   * its backoff, a beacon that never got an answer, a record leased by a tab
   * that was closed mid-flight.
   */
  QueueManager.prototype._startTimer = function () {
    var self = this;
    if (this.timerId || !this.window.setInterval) return;
    this.timerId = this.window.setInterval(function () {
      if (self.coordinator && !self.coordinator.shouldDrain()) return;
      self.drain({ reason: "interval" });
    }, this.drainIntervalMs);
  };

  QueueManager.prototype.stop = function () {
    if (this.timerId && this.window.clearInterval) {
      this.window.clearInterval(this.timerId);
      this.timerId = null;
    }
  };

  /**
   * Beacons everything held in memory, synchronously.
   *
   * @returns {number} How many the browser accepted.
   */
  QueueManager.prototype._beaconPending = function () {
    var ids = Object.keys(this.pending);
    var sent = 0;

    for (var i = 0; i < ids.length; i++) {
      if (this.transport.sendBeacon(this.pending[ids[i]])) sent++;
    }

    // Deliberately not cleared. A beacon yields no answer, so these stay queued
    // in durable storage and the next page load re-sends them; the server
    // answers `duplicate` and the record is settled then. Losing data to avoid
    // a duplicate the server already handles would be the wrong trade.
    return sent;
  };

  /**
   * Remembers an event until it is settled, so the exit path has something to
   * send without waiting for storage.
   *
   * Bounded: this is a delivery buffer for the current page view, not a second
   * queue. The durable store remains the record.
   *
   * @param {Object} event
   */
  QueueManager.prototype._hold = function (event) {
    var ids = Object.keys(this.pending);

    if (ids.length >= this.maxPending) {
      delete this.pending[ids[0]];
    }

    this.pending[event.event_id] = event;
  };

  /**
   * Forgets an event the server has settled.
   *
   * @param {string} eventId
   */
  QueueManager.prototype._release = function (eventId) {
    delete this.pending[eventId];
  };

  QueueManager.prototype._toRecord = function (event) {
    var now = this.now();
    return {
      event_id: event.event_id,
      payload: event,
      state: STATE.PENDING,
      attempts: 0,
      created_at: now,
      next_attempt_at: 0,
      lease_expires_at: 0,
      last_error: null,
    };
  };

  /**
   * Persists an event, then sends it.
   *
   * The order is the point: persistence first means a crash between the two
   * loses nothing, and the send is an optimisation over waiting for the timer.
   *
   * @param {Object} event
   * @param {Object} [options] `send: false` to queue without sending.
   */
  QueueManager.prototype.enqueue = function (event, options) {
    var self = this;
    options = options || {};
    if (!this.store) {
      this.logger.warn("enqueue before init");
      return Promise.resolve(false);
    }
    this.stats.enqueued++;
    this._hold(event);

    return this.store
      .put([this._toRecord(event)])
      .then(function () {
        if (options.send === false) return null;
        return self.drain({ reason: "enqueue" });
      })
      .catch(function (error) {
        self.logger.error("enqueue failed", error && error.message);
        return false;
      });
  };

  QueueManager.prototype._paused = function () {
    return this.pausedUntil > this.now();
  };

  /**
   * One delivery pass: claim what is due, send each as its own request.
   *
   * Never throws, never blocks the page, and never removes a record it did not
   * hear a settled answer about.
   */
  QueueManager.prototype.drain = function (options) {
    var self = this;
    options = options || {};
    this.stats.last_drain_reason = options.reason || "unknown";

    if (this.draining) return Promise.resolve({ skipped: "in-progress" });
    if (!this.store) return Promise.resolve({ skipped: "not-ready" });

    // `navigator.onLine` is a hint, and on iOS it is a bad one: in-app browsers
    // (Telegram, Instagram) report `false` on a working connection, and this
    // check used to veto every send for the whole page view. It is now trusted
    // only for the background timer, where being wrong costs one skipped pass;
    // an event the visitor just produced is always attempted.
    if (!this.isOnline() && "interval" === options.reason) {
      return Promise.resolve({ skipped: "offline" });
    }
    if (this._paused() && options.reason !== "manual") {
      return Promise.resolve({ skipped: "paused" });
    }

    this.draining = true;
    var now = this.now();

    return this.store
      .claimBatch(this.drainLimit, now, this.leaseMs)
      .then(function (claimed) {
        if (!claimed.length) return { skipped: "empty" };
        return self._deliverAll(claimed);
      })
      .catch(function (error) {
        self.logger.error("drain failed", error && error.message);
        return { error: error && error.message };
      })
      .then(function (result) {
        self.draining = false;
        return result;
      });
  };

  /**
   * Sends claimed records one request each, never more than the transport's
   * concurrency cap at a time.
   *
   * A page that fires twenty events in a burst would otherwise open twenty
   * sockets; browsers queue them anyway, but the tab's own connection budget is
   * shared with the page's real work, so the cap is politeness with teeth.
   */
  QueueManager.prototype._deliverAll = function (records) {
    var self = this;
    var queue = records.slice();
    var summary = { sent: 0, removed: 0, kept: 0 };
    var lanes = Math.max(1, Math.min(this.transport.maxConcurrent || 1, queue.length));
    var workers = [];

    function next() {
      var record = queue.shift();
      if (!record) return Promise.resolve();
      return self._deliverOne(record, summary).then(next);
    }

    for (var i = 0; i < lanes; i++) workers.push(next());
    return Promise.all(workers).then(function () {
      return summary;
    });
  };

  QueueManager.prototype._deliverOne = function (record, summary) {
    var self = this;
    this.stats.attempts++;
    summary.sent++;

    // The stored payload is sent as-is. Nothing here rewrites event_id or
    // timestamp_client — invariant 3, and the tests assert it.
    return this.transport.send(record.payload).then(function (result) {
      if (NS.isSettled(result.settlement)) {
        self.stats.last_success_at = self.now();
        self.stats.last_error = null;
        return self._settle(record, result).then(function () {
          summary.removed++;
        });
      }

      self.stats.last_failure_at = self.now();
      self.stats.last_error = String(result.error || result.status || "unknown");
      return self._reschedule(record, result).then(function () {
        summary.kept++;
      });
    });
  };

  /** Removes a record the server has answered for, whatever the answer was. */
  QueueManager.prototype._settle = function (record, result) {
    if (result.settlement === SETTLEMENT.STORED) {
      this.stats.stored++;
    } else if (result.settlement === SETTLEMENT.DUPLICATE) {
      this.stats.duplicates++;
    } else {
      this.stats.rejected++;
      // A rejection is the one settled outcome worth surfacing: the event is
      // gone and the payload was wrong, which is a bug somewhere upstream.
      this.logger.warn(
        "event rejected and discarded",
        record.event_id,
        "status",
        result.status,
        result.raw || ""
      );
    }

    // The server has answered about this one, so the exit path must stop
    // beaconing it. Without this, every page view would re-send everything it
    // had already delivered.
    this._release(record.event_id);

    return this.store.remove([record.event_id]);
  };

  QueueManager.prototype._reschedule = function (record, result) {
    var now = this.now();

    if (result.settlement === SETTLEMENT.PAUSE) {
      // Auth or configuration problem: the events are fine, the setup is not.
      // Hold them and stop retrying tightly so we do not hammer a misconfigured
      // endpoint with a request per event.
      this.pausedUntil = now + this.pauseMs;
      this.logger.warn("transport paused for", this.pauseMs, "ms — status", result.status);
    }

    var attempts = (record.attempts || 0) + 1;
    var exhausted = this.retry.exhausted(attempts);
    var delay =
      result.settlement === SETTLEMENT.PAUSE
        ? this.pauseMs
        : this.retry.delayFor(attempts, result.retryAfterMs || 0);

    return this.store.update([record.event_id], {
      attempts: attempts,
      // Exhausted events are parked as `failed` rather than deleted: they stay
      // inspectable, and an operator who fixes the cause can requeue them.
      state: exhausted ? STATE.FAILED : STATE.PENDING,
      next_attempt_at: now + delay,
      lease_expires_at: 0,
      last_error: String(result.error || result.status || "unknown"),
    });
  };

  /**
   * Page-exit delivery.
   *
   * Records are leased rather than deleted because a beacon yields no answer at
   * all. The lease lapses, the next page load re-sends them, and the server
   * answers `duplicate`. An event that both arrived and stayed queued is the
   * designed outcome of a blind send — layer 3 of the duplicate model makes it
   * harmless, and the alternative (deleting on a request we never saw
   * acknowledged) would lose data whenever the beacon failed.
   */
  QueueManager.prototype.flushWithBeacon = function () {
    var self = this;

    // Synchronous first, always.
    //
    // This runs inside `pagehide` and `visibilitychange`, and on iOS the page
    // is frozen the moment that handler returns — a promise callback scheduled
    // inside it never runs. The version below awaited an IndexedDB read before
    // sending anything, so on iPhone the read was scheduled, the page froze,
    // and the beacon was never issued. A search on a results page followed by a
    // tap on a product was lost every single time, which is exactly the
    // reported symptom.
    //
    // `sendBeacon` is synchronous and survives unload by design, so the events
    // held in memory go out now, before any storage is touched.
    var sentNow = this._beaconPending();

    if (!this.store) return Promise.resolve({ skipped: "not-ready", beaconed: sentNow });

    var now = this.now();
    return this.store
      .claimBatch(this.drainLimit, now, this.beaconLeaseMs)
      .then(function (claimed) {
        if (!claimed.length) return { skipped: "empty" };

        var sent = 0;
        var released = [];
        for (var i = 0; i < claimed.length; i++) {
          if (self.transport.sendBeacon(claimed[i].payload)) {
            sent++;
          } else {
            released.push(claimed[i].event_id);
          }
        }

        if (!released.length) return { beacon: true, leased: sent };

        // The browser refused those beacons: release immediately so the next
        // page load retries without waiting for the lease to lapse.
        return self.store
          .update(released, { state: STATE.PENDING, lease_expires_at: 0, next_attempt_at: 0 })
          .then(function () {
            return { beacon: sent > 0, leased: sent, released: released.length };
          });
      })
      .catch(function (error) {
        self.logger.error("beacon flush failed", error && error.message);
        return { error: error && error.message };
      });
  };

  QueueManager.prototype.size = function () {
    return this.store ? this.store.count() : Promise.resolve(0);
  };

  QueueManager.prototype.inspect = function () {
    return this.store ? this.store.all() : Promise.resolve([]);
  };

  /**
   * A summary of queue health. Counts come from the store itself, never from a
   * running tally that could drift away from what is actually stored.
   */
  QueueManager.prototype.snapshot = function () {
    var self = this;
    if (!this.store) {
      return Promise.resolve({ available: false });
    }

    return this.store.all().then(function (records) {
      var counts = { pending: 0, sending: 0, failed: 0 };
      var oldest = null;
      var attempts = 0;

      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (counts[record.state] === undefined) counts[record.state] = 0;
        counts[record.state]++;
        attempts += record.attempts || 0;
        if (oldest === null || (record.created_at || 0) < oldest) oldest = record.created_at || 0;
      }

      return {
        available: true,
        driver: self.store.driver,
        total: records.length,
        counts: counts,
        total_attempts: attempts,
        oldest_created_at: oldest,
        online: self.isOnline(),
        paused_until: self.pausedUntil,
        is_drain_leader: self.coordinator ? !!self.coordinator.isLeader : true,
        stats: self.stats,
      };
    });
  };

  /** Removes only the events that have exhausted their retries. */
  QueueManager.prototype.clearFailed = function () {
    var self = this;
    if (!this.store) return Promise.resolve(0);

    return this.store.all().then(function (records) {
      var ids = [];
      for (var i = 0; i < records.length; i++) {
        if (records[i].state === STATE.FAILED) ids.push(records[i].event_id);
      }
      if (!ids.length) return 0;
      return self.store.remove(ids).then(function () {
        return ids.length;
      });
    });
  };

  /** Returns failed events to the queue with a fresh backoff. */
  QueueManager.prototype.retryFailed = function () {
    var self = this;
    if (!this.store) return Promise.resolve(0);

    return this.store.all().then(function (records) {
      var ids = [];
      for (var i = 0; i < records.length; i++) {
        if (records[i].state === STATE.FAILED) ids.push(records[i].event_id);
      }
      if (!ids.length) return 0;
      return self.store
        .update(ids, {
          state: STATE.PENDING,
          attempts: 0,
          next_attempt_at: 0,
          lease_expires_at: 0,
          last_error: null,
        })
        .then(function () {
          self.pausedUntil = 0;
          return ids.length;
        });
    });
  };

  /** Discards everything. Destructive, and only ever called explicitly. */
  QueueManager.prototype.clearAll = function () {
    if (!this.store) return Promise.resolve(false);
    return this.store.clear();
  };

  NS.QueueManager = QueueManager;
  NS.queueDefaults = DEFAULTS;
  NS.memoryStorage = memoryStorage;
})(typeof window !== "undefined" ? window : globalThis);
