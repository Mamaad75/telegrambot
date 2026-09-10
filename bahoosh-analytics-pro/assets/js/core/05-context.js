/**
 * Bahoosh Analytics Pro v2 — device & environment context.
 *
 * Deliberately coarse: user-agent parsing yields a browser family and major
 * version rather than the raw UA string, and no fingerprinting signals
 * (canvas, fonts, audio) are collected.
 */
(function (global) {
  "use strict";

  var NS = global.BahooshAnalytics;

  var BROWSER_RULES = [
    { name: "Edge", re: /Edg(?:e|A|iOS)?\/(\d+)/ },
    { name: "Opera", re: /(?:OPR|Opera)\/(\d+)/ },
    { name: "Samsung Internet", re: /SamsungBrowser\/(\d+)/ },
    { name: "Firefox", re: /(?:Firefox|FxiOS)\/(\d+)/ },
    { name: "Chrome", re: /(?:Chrome|CriOS)\/(\d+)/ },
    { name: "Safari", re: /Version\/(\d+).*Safari/ },
  ];

  var OS_RULES = [
    { name: "Windows", re: /Windows NT/ },
    { name: "Android", re: /Android/ },
    { name: "iOS", re: /(?:iPhone|iPad|iPod)/ },
    { name: "macOS", re: /Mac OS X/ },
    { name: "Linux", re: /Linux/ },
  ];

  function detectBrowser(ua) {
    for (var i = 0; i < BROWSER_RULES.length; i++) {
      var m = ua.match(BROWSER_RULES[i].re);
      if (m) return { browser: BROWSER_RULES[i].name, browser_version: m[1] };
    }
    return { browser: "unknown", browser_version: null };
  }

  function detectOs(ua) {
    for (var i = 0; i < OS_RULES.length; i++) {
      if (OS_RULES[i].re.test(ua)) return OS_RULES[i].name;
    }
    return "unknown";
  }

  function detectDeviceType(ua, width) {
    if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) {
      return "tablet";
    }
    if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/.test(ua)) return "mobile";
    if (width > 0 && width < 768) return "mobile";
    if (width > 0 && width < 1024) return "tablet";
    return "desktop";
  }

  function timezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (e) {
      return null;
    }
  }

  function collect(win) {
    win = win || global;
    var nav = win.navigator || {};
    var screen = win.screen || {};
    var doc = win.document || {};
    var ua = String(nav.userAgent || "");
    var viewportWidth =
      win.innerWidth ||
      (doc.documentElement && doc.documentElement.clientWidth) ||
      0;
    var viewportHeight =
      win.innerHeight ||
      (doc.documentElement && doc.documentElement.clientHeight) ||
      0;

    var browser = detectBrowser(ua);

    return {
      library: "bahoosh-analytics-pro",
      library_version: NS.VERSION,
      device_type: detectDeviceType(ua, viewportWidth),
      browser: browser.browser,
      browser_version: browser.browser_version,
      operating_system: detectOs(ua),
      language: nav.language || null,
      timezone: timezone(),
      timezone_offset_minutes: new Date().getTimezoneOffset(),
      screen_width: screen.width || 0,
      screen_height: screen.height || 0,
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
      screen_resolution: (screen.width || 0) + "x" + (screen.height || 0),
      viewport_size: viewportWidth + "x" + viewportHeight,
    };
  }

  function page(win) {
    win = win || global;
    var loc = win.location || {};
    var doc = win.document || {};
    return {
      url: stripSensitiveParams(loc.href || ""),
      path: loc.pathname || "",
      title: NS.util.truncate(doc.title, 300),
      referrer: stripSensitiveParams(doc.referrer || ""),
    };
  }

  var SENSITIVE_PARAMS = [
    "password",
    "pwd",
    "token",
    "access_token",
    "id_token",
    "auth",
    "api_key",
    "apikey",
    "key",
    "secret",
    "session",
    "sessionid",
    "otp",
    "code",
  ];

  /**
   * Removes credential-ish query parameters before a URL is recorded. Analytics
   * URLs routinely leak password-reset and magic-link tokens; this is cheap
   * insurance against storing them.
   */
  function stripSensitiveParams(rawUrl) {
    if (!rawUrl || rawUrl.indexOf("?") === -1) return rawUrl;
    try {
      var url = new URL(rawUrl, global.location ? global.location.href : undefined);
      var removed = false;
      for (var i = 0; i < SENSITIVE_PARAMS.length; i++) {
        if (url.searchParams.has(SENSITIVE_PARAMS[i])) {
          url.searchParams.set(SENSITIVE_PARAMS[i], "[redacted]");
          removed = true;
        }
      }
      return removed ? url.toString() : rawUrl;
    } catch (e) {
      return rawUrl;
    }
  }

  NS.context = {
    collect: collect,
    page: page,
    stripSensitiveParams: stripSensitiveParams,
    detectBrowser: detectBrowser,
    detectOs: detectOs,
    detectDeviceType: detectDeviceType,
  };
})(typeof window !== "undefined" ? window : globalThis);
