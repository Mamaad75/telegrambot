/**
 * Bahoosh Analytics Pro v2 — shared utilities.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;

  var HEX = [];
  for (var i = 0; i < 256; i++) {
    HEX[i] = (i + 0x100).toString(16).slice(1);
  }

  /**
   * RFC 4122 v4 UUID. Uses crypto.randomUUID / crypto.getRandomValues when the
   * browser exposes them and only falls back to Math.random on ancient engines.
   * Event identity correctness depends on this never colliding, so the strong
   * source is always preferred.
   */
  function uuid() {
    var c = global.crypto || global.msCrypto;
    if (c && typeof c.randomUUID === "function") {
      try {
        return c.randomUUID();
      } catch (e) {
        /* fall through */
      }
    }
    var bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") {
      c.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return (
      HEX[bytes[0]] + HEX[bytes[1]] + HEX[bytes[2]] + HEX[bytes[3]] + "-" +
      HEX[bytes[4]] + HEX[bytes[5]] + "-" +
      HEX[bytes[6]] + HEX[bytes[7]] + "-" +
      HEX[bytes[8]] + HEX[bytes[9]] + "-" +
      HEX[bytes[10]] + HEX[bytes[11]] + HEX[bytes[12]] +
      HEX[bytes[13]] + HEX[bytes[14]] + HEX[bytes[15]]
    );
  }

  function prefixedId(prefix) {
    return prefix + "_" + uuid().replace(/-/g, "");
  }

  function nowMs() {
    return Date.now();
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function positiveNumberOr(value, fallback) {
    var num = Number(value);
    return isFinite(num) && num > 0 ? num : fallback;
  }

  function truncate(text, maxLength) {
    if (text === null || text === undefined) return "";
    var trimmed = String(text).replace(/\s+/g, " ").trim();
    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }

  function safeJsonParse(raw, fallback) {
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  /** localStorage wrapper that never throws (private mode, quota, disabled). */
  var Storage = {
    available: function () {
      try {
        var k = "__bap_probe__";
        global.localStorage.setItem(k, "1");
        global.localStorage.removeItem(k);
        return true;
      } catch (e) {
        return false;
      }
    },
    get: function (key) {
      try {
        return global.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set: function (key, value) {
      try {
        global.localStorage.setItem(key, value);
        return true;
      } catch (e) {
        return false;
      }
    },
    remove: function (key) {
      try {
        global.localStorage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    },
    getJSON: function (key, fallback) {
      var raw = this.get(key);
      if (raw === null) return fallback;
      var parsed = safeJsonParse(raw, undefined);
      if (parsed === undefined) {
        this.remove(key);
        return fallback;
      }
      return parsed;
    },
    setJSON: function (key, value) {
      try {
        return this.set(key, JSON.stringify(value));
      } catch (e) {
        return false;
      }
    },
  };

  /** First-party cookie helpers — the bridge that lets PHP read the anonymous id. */
  var Cookies = {
    get: function (name) {
      var doc = global.document;
      if (!doc || typeof doc.cookie !== "string") return null;
      var parts = doc.cookie.split(";");
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part.indexOf(name + "=") === 0) {
          try {
            return decodeURIComponent(part.slice(name.length + 1));
          } catch (e) {
            return null;
          }
        }
      }
      return null;
    },
    set: function (name, value, maxAgeSeconds) {
      var doc = global.document;
      if (!doc) return false;
      var secure =
        global.location && global.location.protocol === "https:"
          ? "; Secure"
          : "";
      try {
        doc.cookie =
          name +
          "=" +
          encodeURIComponent(value) +
          "; Path=/; Max-Age=" +
          Math.floor(maxAgeSeconds) +
          "; SameSite=Lax" +
          secure;
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  function once(fn) {
    var called = false;
    var result;
    return function () {
      if (!called) {
        called = true;
        result = fn.apply(this, arguments);
      }
      return result;
    };
  }

  function createLogger(enabled, prefix) {
    var noop = function () {};
    if (!enabled || !global.console) {
      return { debug: noop, warn: noop, error: noop };
    }
    var tag = "[" + (prefix || "Bahoosh") + "]";
    return {
      debug: function () {
        var args = [tag].concat(Array.prototype.slice.call(arguments));
        (console.debug || console.log).apply(console, args);
      },
      warn: function () {
        var args = [tag].concat(Array.prototype.slice.call(arguments));
        (console.warn || console.log).apply(console, args);
      },
      error: function () {
        var args = [tag].concat(Array.prototype.slice.call(arguments));
        (console.error || console.log).apply(console, args);
      },
    };
  }

  NS.util = {
    uuid: uuid,
    prefixedId: prefixedId,
    nowMs: nowMs,
    isoNow: isoNow,
    positiveNumberOr: positiveNumberOr,
    truncate: truncate,
    safeJsonParse: safeJsonParse,
    once: once,
    createLogger: createLogger,
    Storage: Storage,
    Cookies: Cookies,
  };
})(typeof window !== "undefined" ? window : globalThis);
