/**
 * Bahoosh Analytics Pro v3 — persistent queue storage drivers.
 *
 * Two drivers implement one async interface: IndexedDB (preferred) and
 * localStorage (fallback). Both are keyed by `event_id`, which makes writing
 * the same event twice a no-op — the client-side half of end-to-end idempotency.
 *
 * v3 removed batching, not the queue. A batch was a throughput optimisation; the
 * queue is what makes a lost connection survivable, and only one of those was
 * worth keeping. Records are now claimed and settled individually.
 *
 * Record shape:
 *   {
 *     event_id, payload, state, attempts, created_at,
 *     next_attempt_at, lease_expires_at, last_error
 *   }
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;
  var util = NS.util;
  var QUEUE_STATE = NS.QUEUE_STATE;

  var DB_NAME = "bahoosh_analytics";
  var DB_VERSION = 1;
  var STORE_NAME = "events";
  // The `_v2` suffix is historical and stays deliberately: renaming the key on
  // upgrade would orphan every event the v2 tracker had queued but not yet
  // delivered. The records inside are migrated in place instead.
  var LS_KEY = "bap_queue_v2";

  /**
   * Selection shared by both drivers. Returns records eligible for sending:
   * pending records whose backoff has elapsed, plus records stuck in `sending`
   * whose lease expired (the tab was closed mid-flight, or a sendBeacon left
   * us without an acknowledgement).
   */
  function selectClaimable(records, now, limit) {
    var eligible = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.state === QUEUE_STATE.PENDING && (r.next_attempt_at || 0) <= now) {
        eligible.push(r);
      } else if (
        r.state === QUEUE_STATE.SENDING &&
        (r.lease_expires_at || 0) <= now
      ) {
        eligible.push(r);
      }
    }
    eligible.sort(function (a, b) {
      return (a.created_at || 0) - (b.created_at || 0);
    });
    return limit > 0 ? eligible.slice(0, limit) : eligible;
  }

  function applyClaim(record, now, leaseMs) {
    record.state = QUEUE_STATE.SENDING;
    record.lease_expires_at = now + leaseMs;
    return record;
  }

  /**
   * Eviction policy, stated explicitly because a queue that silently loses data
   * is worse than one that refuses it.
   *
   *   1. Age first. A record older than `maxAgeMs` is dropped whatever the
   *      queue depth: a week-old page view has no analytical value left, and
   *      keeping it crowds out events that do.
   *   2. Then oldest-first, and only once the queue is over `maxSize`. The
   *      newest events are the ones a struggling site most needs to keep.
   *   3. Never a record that is mid-flight. A `sending` record with a live
   *      lease has a request open against it; evicting it would delete an event
   *      the server may be about to acknowledge, turning a slow network into
   *      silent data loss. Its lease expires soon enough, and it becomes
   *      evictable then.
   */
  function selectDroppable(records, now, maxSize, maxAgeMs) {
    var doomed = [];
    var survivors = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var inFlight = r.state === QUEUE_STATE.SENDING && (r.lease_expires_at || 0) > now;
      if (inFlight) continue; // rule 3: untouchable while a request is open
      if (maxAgeMs > 0 && now - (r.created_at || 0) > maxAgeMs) {
        doomed.push(r.event_id);
      } else {
        survivors.push(r);
      }
    }
    if (maxSize > 0 && survivors.length > maxSize) {
      survivors.sort(function (a, b) {
        return (a.created_at || 0) - (b.created_at || 0);
      });
      var overflow = survivors.length - maxSize;
      for (var j = 0; j < overflow; j++) {
        doomed.push(survivors[j].event_id);
      }
    }
    return doomed;
  }

  /**
   * Brings a record written by the v2 tracker up to the v3 envelope.
   *
   * A v2 event carries `session`/`batch_id`/`sequence` and no `page_view_id`,
   * which the v3 endpoint rejects. Upgrading rather than dropping matters: this
   * is a durable outbox, and the events sitting in it are ones the visitor
   * genuinely produced but we never managed to deliver. Losing them at upgrade
   * time would be the one failure the whole queue exists to prevent.
   *
   * The synthetic page view id is marked as such so nobody later mistakes it
   * for a real grouping.
   *
   * @returns {boolean} Whether the record was changed.
   */
  function upgradeRecord(record) {
    var payload = record && record.payload;
    if (!payload || typeof payload !== "object") return false;
    if (payload.page_view_id && payload.schema_version === NS.SCHEMA_VERSION) return false;

    if (!payload.page_view_id) {
      var legacy = payload.session && payload.session.session_id;
      // Reuse the old session id when there is one: every event from that
      // session then lands in one page view, which is the closest honest
      // approximation available after the fact.
      payload.page_view_id = legacy
        ? "pv_migrated_" + String(legacy).replace(/^sess_/, "")
        : util.prefixedId("pv");
    }

    delete payload.session;
    delete payload.batch_id;
    delete payload.sequence;
    payload.schema_version = NS.SCHEMA_VERSION;
    if (!payload.origin) payload.origin = "browser";
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* localStorage driver                                                 */
  /* ------------------------------------------------------------------ */

  function LocalQueueStore(options) {
    options = options || {};
    this.key = options.key || LS_KEY;
    this.storage = options.storage || NS.util.Storage;
    this.driver = "localStorage";
  }

  LocalQueueStore.prototype._read = function () {
    var map = this.storage.getJSON(this.key, {});
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  };

  LocalQueueStore.prototype._write = function (map) {
    return this.storage.setJSON(this.key, map);
  };

  LocalQueueStore.prototype._values = function () {
    var map = this._read();
    var out = [];
    for (var id in map) {
      if (Object.prototype.hasOwnProperty.call(map, id)) out.push(map[id]);
    }
    return out;
  };

  LocalQueueStore.prototype.init = function () {
    return Promise.resolve(this.storage.available());
  };

  LocalQueueStore.prototype.put = function (records) {
    var map = this._read();
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      // Upsert keyed by event_id: re-enqueuing an event never duplicates it.
      if (!map[r.event_id]) map[r.event_id] = r;
    }
    var ok = this._write(map);
    return ok
      ? Promise.resolve(records.length)
      : Promise.reject(new Error("bap_queue_write_failed"));
  };

  LocalQueueStore.prototype.claimBatch = function (limit, now, leaseMs) {
    var map = this._read();
    var claimed = selectClaimable(this._values(), now, limit);
    for (var i = 0; i < claimed.length; i++) {
      map[claimed[i].event_id] = applyClaim(claimed[i], now, leaseMs);
    }
    this._write(map);
    return Promise.resolve(claimed);
  };

  LocalQueueStore.prototype.remove = function (eventIds) {
    var map = this._read();
    for (var i = 0; i < eventIds.length; i++) {
      delete map[eventIds[i]];
    }
    this._write(map);
    return Promise.resolve(eventIds.length);
  };

  LocalQueueStore.prototype.update = function (eventIds, patch) {
    var map = this._read();
    for (var i = 0; i < eventIds.length; i++) {
      var rec = map[eventIds[i]];
      if (!rec) continue;
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) rec[k] = patch[k];
      }
    }
    this._write(map);
    return Promise.resolve(eventIds.length);
  };

  LocalQueueStore.prototype.all = function () {
    return Promise.resolve(this._values());
  };

  LocalQueueStore.prototype.count = function () {
    return Promise.resolve(this._values().length);
  };

  LocalQueueStore.prototype.trim = function (now, maxSize, maxAgeMs) {
    var doomed = selectDroppable(this._values(), now, maxSize, maxAgeMs);
    return doomed.length ? this.remove(doomed).then(function () { return doomed; })
                         : Promise.resolve([]);
  };

  LocalQueueStore.prototype.clear = function () {
    this.storage.remove(this.key);
    return Promise.resolve(true);
  };

  /* ------------------------------------------------------------------ */
  /* IndexedDB driver                                                    */
  /* ------------------------------------------------------------------ */

  function IdbQueueStore(options) {
    options = options || {};
    this.dbName = options.dbName || DB_NAME;
    this.storeName = options.storeName || STORE_NAME;
    this.idb = options.indexedDB || global.indexedDB;
    this.db = null;
    this.driver = "indexedDB";
  }

  IdbQueueStore.prototype.init = function () {
    var self = this;
    if (this.db) return Promise.resolve(true);
    if (!this.idb) return Promise.reject(new Error("bap_idb_unavailable"));
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = self.idb.open(self.dbName, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(self.storeName)) {
          var store = db.createObjectStore(self.storeName, {
            keyPath: "event_id",
          });
          store.createIndex("state", "state", { unique: false });
          store.createIndex("created_at", "created_at", { unique: false });
        }
      };
      req.onsuccess = function (event) {
        self.db = event.target.result;
        resolve(true);
      };
      req.onerror = function () {
        reject(req.error || new Error("bap_idb_open_failed"));
      };
      req.onblocked = function () {
        reject(new Error("bap_idb_blocked"));
      };
    });
  };

  IdbQueueStore.prototype._tx = function (mode, work) {
    var self = this;
    return this.init().then(function () {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = self.db.transaction(self.storeName, mode);
        } catch (e) {
          reject(e);
          return;
        }
        var store = tx.objectStore(self.storeName);
        var result;
        try {
          result = work(store);
        } catch (e) {
          reject(e);
          return;
        }
        tx.oncomplete = function () {
          resolve(result && result.value !== undefined ? result.value : result);
        };
        tx.onerror = function () {
          reject(tx.error || new Error("bap_idb_tx_failed"));
        };
        tx.onabort = function () {
          reject(tx.error || new Error("bap_idb_tx_aborted"));
        };
      });
    });
  };

  IdbQueueStore.prototype._readAll = function () {
    var self = this;
    return this.init().then(function () {
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction(self.storeName, "readonly");
        var req = tx.objectStore(self.storeName).getAll();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          reject(req.error || new Error("bap_idb_read_failed"));
        };
      });
    });
  };

  IdbQueueStore.prototype.put = function (records) {
    return this._tx("readwrite", function (store) {
      for (var i = 0; i < records.length; i++) {
        // `add`, not `put`: re-enqueuing an event_id that is already queued must
        // not reset its attempt count or clear a live lease. The ConstraintError
        // is the expected outcome for a duplicate and is swallowed so it does
        // not abort the transaction — matching the localStorage driver exactly.
        var request = store.add(records[i]);
        request.onerror = function (event) {
          event.preventDefault();
          event.stopPropagation();
        };
      }
      return { value: records.length };
    });
  };

  IdbQueueStore.prototype.claimBatch = function (limit, now, leaseMs) {
    var self = this;
    return this._readAll().then(function (records) {
      var claimed = selectClaimable(records, now, limit);
      if (!claimed.length) return [];
      return self
        ._tx("readwrite", function (store) {
          for (var i = 0; i < claimed.length; i++) {
            store.put(applyClaim(claimed[i], now, leaseMs));
          }
          return { value: claimed };
        })
        .then(function () {
          return claimed;
        });
    });
  };

  IdbQueueStore.prototype.remove = function (eventIds) {
    return this._tx("readwrite", function (store) {
      for (var i = 0; i < eventIds.length; i++) {
        store.delete(eventIds[i]);
      }
      return { value: eventIds.length };
    });
  };

  IdbQueueStore.prototype.update = function (eventIds, patch) {
    var self = this;
    return this._readAll().then(function (records) {
      var byId = {};
      for (var i = 0; i < records.length; i++) byId[records[i].event_id] = records[i];
      var touched = [];
      for (var j = 0; j < eventIds.length; j++) {
        var rec = byId[eventIds[j]];
        if (!rec) continue;
        for (var k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) rec[k] = patch[k];
        }
        touched.push(rec);
      }
      if (!touched.length) return 0;
      return self._tx("readwrite", function (store) {
        for (var m = 0; m < touched.length; m++) store.put(touched[m]);
        return { value: touched.length };
      });
    });
  };

  IdbQueueStore.prototype.all = function () {
    return this._readAll();
  };

  IdbQueueStore.prototype.count = function () {
    return this._readAll().then(function (r) {
      return r.length;
    });
  };

  IdbQueueStore.prototype.trim = function (now, maxSize, maxAgeMs) {
    var self = this;
    return this._readAll().then(function (records) {
      var doomed = selectDroppable(records, now, maxSize, maxAgeMs);
      if (!doomed.length) return [];
      return self.remove(doomed).then(function () {
        return doomed;
      });
    });
  };

  IdbQueueStore.prototype.clear = function () {
    return this._tx("readwrite", function (store) {
      store.clear();
      return { value: true };
    });
  };

  /**
   * Picks IndexedDB when it actually works, otherwise localStorage. Resolves to
   * null when neither is usable, in which case the tracker degrades to an
   * in-memory queue rather than throwing.
   */
  function createQueueStore(options) {
    options = options || {};
    if (options.driver === "localStorage") {
      var forced = new LocalQueueStore(options);
      return forced.init().then(function (ok) {
        return ok ? forced : null;
      });
    }
    var idb = new IdbQueueStore(options);
    return idb
      .init()
      .then(function () {
        return idb;
      })
      .catch(function () {
        var local = new LocalQueueStore(options);
        return local.init().then(function (ok) {
          return ok ? local : null;
        });
      });
  }

  NS.queueStore = {
    LocalQueueStore: LocalQueueStore,
    IdbQueueStore: IdbQueueStore,
    createQueueStore: createQueueStore,
    selectClaimable: selectClaimable,
    selectDroppable: selectDroppable,
    upgradeRecord: upgradeRecord,
  };
})(typeof window !== "undefined" ? window : globalThis);
