/* Jarchi Bale legacy compatibility prelude. */
(function(){
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function(search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement);
      return this.split(String(search)).join(String(replacement));
    };
  }
  if (!Object.fromEntries) {
    Object.fromEntries = function(iterable) {
      var obj = {};
      var entries = Array.from(iterable);
      for (var i = 0; i < entries.length; i++) obj[entries[i][0]] = entries[i][1];
      return obj;
    };
  }
  if (window.crypto && !window.crypto.randomUUID) {
    window.crypto.randomUUID = function() {
      var bytes = new Uint8Array(16);
      if (window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = [];
      for (var j = 0; j < bytes.length; j++) hex.push((bytes[j] + 256).toString(16).slice(1));
      return hex.slice(0,4).join('') + '-' + hex.slice(4,6).join('') + '-' + hex.slice(6,8).join('') + '-' + hex.slice(8,10).join('') + '-' + hex.slice(10,16).join('');
    };
  }
})();
/*
 * Jarchi Mini App.
 *
 * One bundle runs in Telegram, in Bale and in a plain browser. The differences
 * between them are confined to two places: how the session is proven (initData
 * header vs. a bearer token from the bot link) and which SDK object exists.
 * Everything below that is the same app.
 *
 * What a viewer can see is decided by the server and read back from two calls:
 * /api/me carries the subscription and its entitlements, and /api/admin-mini/me
 * says whether this person is also a Jarchi operator and what they may do. The
 * UI never grants itself a screen; it only hides what the server would refuse,
 * so a hidden button and a forged request fail the same way.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var _a, _b;
/* ------------------------------- platform -------------------------------- */
window.__JARCHI_APP_STARTED__ = true;
window.__JARCHI_BOOT_STAGE__ = "app_loaded";
var params = new URLSearchParams(location.search);
var hashParams = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
var tg = ((_a = window.Telegram) === null || _a === void 0 ? void 0 : _a.WebApp) || null;
var bale = ((_b = window.Bale) === null || _b === void 0 ? void 0 : _b.WebApp) || null;
var requestedPlatform = params.get("platform") || hashParams.get("platform") || "";
var platform = requestedPlatform || (bale ? "bale" : tg ? "telegram" : "web");
var sessionToken = params.get("session") || hashParams.get("session") || "";
try {
    if (platform === "bale") {
        // Bale Web runs the Mini App inside an iframe. Its own documentation warns
        // against browser-history routing in the web client, so keep the fallback
        // bot session only in memory and do not mutate history/sessionStorage here.
    }
    else if (sessionToken) {
        sessionStorage.setItem("jarchi.session", sessionToken);
        var cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete("session");
        var cleanHash = new URLSearchParams(String(cleanUrl.hash || "").replace(/^#/, ""));
        cleanHash.delete("session");
        cleanUrl.hash = cleanHash.toString() ? "#".concat(cleanHash.toString()) : "";
        history.replaceState({}, document.title, "".concat(cleanUrl.pathname).concat(cleanUrl.search).concat(cleanUrl.hash));
    }
    else {
        sessionToken = sessionStorage.getItem("jarchi.session") || "";
    }
}
catch ( /* private mode / embedded navigation restrictions */_c) { /* private mode / embedded navigation restrictions */ }
var initData = platform === "bale" ? ((bale === null || bale === void 0 ? void 0 : bale.initData) || "") : platform === "telegram" ? ((tg === null || tg === void 0 ? void 0 : tg.initData) || "") : "";
var platformReadySignalled = false;
function signalPlatformReady() {
    var _a, _b;
    if (platformReadySignalled)
        return;
    var sdk = platform === "bale" ? bale : platform === "telegram" ? tg : null;
    if (!sdk)
        return;
    try {
        (_a = sdk.ready) === null || _a === void 0 ? void 0 : _a.call(sdk);
    }
    catch ( /* old client */_c) { /* old client */ }
    try {
        (_b = sdk.expand) === null || _b === void 0 ? void 0 : _b.call(sdk);
    }
    catch ( /* old client */_d) { /* old client */ }
    platformReadySignalled = true;
}
function refreshPlatformSdk() {
    var _a, _b;
    tg = ((_a = window.Telegram) === null || _a === void 0 ? void 0 : _a.WebApp) || tg || null;
    bale = ((_b = window.Bale) === null || _b === void 0 ? void 0 : _b.WebApp) || bale || null;
    initData = platform === "bale" ? ((bale === null || bale === void 0 ? void 0 : bale.initData) || "") : platform === "telegram" ? ((tg === null || tg === void 0 ? void 0 : tg.initData) || "") : "";
    signalPlatformReady();
}
refreshPlatformSdk();
// The Bale SDK is intentionally async so a slow/unreachable CDN can never
// freeze Jarchi before app.js runs. Keep attaching for a short window; when the
// SDK arrives, ready()/expand() are signalled immediately. Authentication of
// /panel links does not depend on this SDK.
if (platform === "bale" && !bale) {
    var baleAttachAttempts_1 = 0;
    var baleAttachTimer_1 = setInterval(function () {
        baleAttachAttempts_1 += 1;
        refreshPlatformSdk();
        if (bale || baleAttachAttempts_1 >= 60)
            clearInterval(baleAttachTimer_1);
    }, 250);
}
function waitForPlatformAuthContext() {
    return __awaiter(this, void 0, void 0, function () {
        var deadline;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    refreshPlatformSdk();
                    // Bot-issued session links do not need a third-party SDK to authenticate.
                    // For direct Mini App launches, wait briefly for the platform SDK/initData
                    // while the local app remains alive (and its watchdog can still fire).
                    if (sessionToken || initData || !["telegram", "bale"].includes(platform))
                        return [2 /*return*/];
                    deadline = Date.now() + 2500;
                    _a.label = 1;
                case 1:
                    if (!(Date.now() < deadline)) return [3 /*break*/, 3];
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 50); })];
                case 2:
                    _a.sent();
                    refreshPlatformSdk();
                    if (initData)
                        return [2 /*return*/];
                    return [3 /*break*/, 1];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Never leave the user on an infinite skeleton when a WebView/runtime throws
// before bootstrap can render an error. This also gives Support a concrete
// client-side failure to report without exposing secrets.
window.addEventListener("error", function (event) {
    var _a;
    try {
        var rawMessage = String(((_a = event === null || event === void 0 ? void 0 : event.error) === null || _a === void 0 ? void 0 : _a.message) || (event === null || event === void 0 ? void 0 : event.message) || "").trim();
        // Browsers report opaque failures from cross-origin SDKs as "Script error."
        // with no usable stack/source. It is not evidence that our bootstrap failed.
        if (!(event === null || event === void 0 ? void 0 : event.error) && /^script error\.?$/i.test(rawMessage))
            return;
        var message = rawMessage || "خطای اجرای برنامه";
        var host = document.querySelector("#content");
        if (host && host.querySelector(".skeleton-page")) {
            host.innerHTML = "<div class=\"state error\"><div class=\"state-icon\">\u26A0\uFE0F</div><h3>\u0627\u062C\u0631\u0627\u06CC \u067E\u0646\u0644 \u0628\u0627 \u062E\u0637\u0627 \u0645\u0648\u0627\u062C\u0647 \u0634\u062F</h3><p>".concat(esc(message), "</p><button class=\"btn\" onclick=\"location.reload()\">\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0645\u062C\u062F\u062F</button></div>");
        }
    }
    catch (_b) { }
});
window.addEventListener("unhandledrejection", function (event) {
    var _a;
    try {
        var message = String(((_a = event === null || event === void 0 ? void 0 : event.reason) === null || _a === void 0 ? void 0 : _a.message) || (event === null || event === void 0 ? void 0 : event.reason) || "").trim();
        // Third-party SDKs occasionally reject bookkeeping promises without a
        // reason. Do not replace a healthy bootstrap skeleton with a generic error.
        if (!message)
            return;
        var host = document.querySelector("#content");
        if (host && host.querySelector(".skeleton-page")) {
            host.innerHTML = "<div class=\"state error\"><div class=\"state-icon\">\u26A0\uFE0F</div><h3>\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u067E\u0646\u0644 \u0628\u0627 \u062E\u0637\u0627 \u0645\u0648\u0627\u062C\u0647 \u0634\u062F</h3><p>".concat(esc(message), "</p><button class=\"btn\" onclick=\"location.reload()\">\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0645\u062C\u062F\u062F</button></div>");
        }
    }
    catch (_b) { }
});
/* --------------------------------- utils --------------------------------- */
var $ = function (selector, scope) {
    if (scope === void 0) { scope = document; }
    return scope.querySelector(selector);
};
var $$ = function (selector, scope) {
    if (scope === void 0) { scope = document; }
    return __spreadArray([], __read(scope.querySelectorAll(selector)), false);
};
function esc(value) {
    if (value === void 0) { value = ""; }
    return String(value !== null && value !== void 0 ? value : "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
/** Persian digits everywhere a number is shown to a reader. */
function n(value) { return Number(value || 0).toLocaleString("fa-IR"); }
function date(value) {
    if (!value)
        return "—";
    try {
        return new Date(value).toLocaleDateString("fa-IR");
    }
    catch (_a) {
        return "—";
    }
}
function ago(value) {
    if (!value)
        return "—";
    var minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1)
        return "همین حالا";
    if (minutes < 60)
        return "".concat(n(minutes), " \u062F\u0642\u06CC\u0642\u0647 \u067E\u06CC\u0634");
    var hours = Math.round(minutes / 60);
    if (hours < 24)
        return "".concat(n(hours), " \u0633\u0627\u0639\u062A \u067E\u06CC\u0634");
    return "".concat(n(Math.round(hours / 24)), " \u0631\u0648\u0632 \u067E\u06CC\u0634");
}
function daysLeft(value) {
    return value ? Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000)) : 0;
}
function initials(name) {
    var text = String(name || "").trim();
    return text ? text.slice(0, 1) : "ج";
}
/* -------------------------------- feedback -------------------------------- */
function toast(message, tone) {
    if (tone === void 0) { tone = "ok"; }
    var element = document.createElement("div");
    element.className = "toast ".concat(tone);
    element.textContent = message;
    $("#toastRoot").appendChild(element);
    setTimeout(function () { return element.remove(); }, 3000);
}
function haptic(kind) {
    var _a, _b, _c;
    if (kind === void 0) { kind = "light"; }
    try {
        (_c = (_b = (_a = (tg || bale)) === null || _a === void 0 ? void 0 : _a.HapticFeedback) === null || _b === void 0 ? void 0 : _b.impactOccurred) === null || _c === void 0 ? void 0 : _c.call(_b, kind);
    }
    catch ( /* unsupported */_d) { /* unsupported */ }
}
/** Skeletons match the shape of what is loading, so nothing jumps on arrival. */
function skeleton(rows, _a) {
    if (rows === void 0) { rows = 3; }
    var _b = _a === void 0 ? {} : _a, _c = _b.title, title = _c === void 0 ? true : _c;
    $("#content").innerHTML = "\n    <div class=\"skeleton-page\" aria-busy=\"true\" aria-label=\"\u062F\u0631 \u062D\u0627\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC\">\n      ".concat(title ? '<div class="skeleton skeleton-title"></div>' : "", "\n      ").concat(Array.from({ length: rows }, function () { return '<div class="skeleton skeleton-card"></div>'; }).join(""), "\n    </div>");
}
function emptyState(icon, title, body, action) {
    if (body === void 0) { body = ""; }
    if (action === void 0) { action = ""; }
    return "<div class=\"state\">\n    <div class=\"state-icon\" aria-hidden=\"true\">".concat(icon, "</div>\n    <h3>").concat(esc(title), "</h3>\n    ").concat(body ? "<p>".concat(esc(body), "</p>") : "", "\n    ").concat(action, "\n  </div>");
}
function errorState(message, _a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.retry, retry = _c === void 0 ? true : _c;
    $("#content").innerHTML = "<div class=\"state error\">\n    <div class=\"state-icon\" aria-hidden=\"true\">\u26A0\uFE0F</div>\n    <h3>\u0645\u0634\u06A9\u0644\u06CC \u067E\u06CC\u0634 \u0622\u0645\u062F</h3>\n    <p>".concat(esc(message), "</p>\n    ").concat(retry ? '<button class="btn" id="retryBtn">تلاش مجدد</button>' : "", "\n  </div>");
    var button = $("#retryBtn");
    if (button)
        button.onclick = function () { return go(state.tab); };
}
/* ---------------------------------- api ----------------------------------- */
/*
 * The single request helper. `admin` picks the admin-authenticated mount, which
 * runs the same RBAC router behind Mini App identity; everything else goes to
 * the customer API. Signature is unchanged from 2.1.x so existing calls work.
 */
function api(path_1) {
    return __awaiter(this, arguments, void 0, function (path, opts, admin) {
        var headers, omitSessionBearer, controller, timeout, requestOpts, response, requestPath, error_1, data, _a, error;
        var _b;
        if (opts === void 0) { opts = {}; }
        if (admin === void 0) { admin = false; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    headers = __assign({ "accept": "application/json", "content-type": "application/json" }, (opts.headers || {}));
                    omitSessionBearer = opts.omitSessionBearer === true;
                    if (sessionToken && !omitSessionBearer)
                        headers.authorization = "Bearer ".concat(sessionToken);
                    if (initData && platform === "telegram")
                        headers["X-Telegram-Init-Data"] = initData;
                    if (initData && platform === "bale")
                        headers["X-Bale-Init-Data"] = initData;
                    controller = new AbortController();
                    timeout = setTimeout(function () { return controller.abort(); }, Number(opts.timeoutMs || 15000));
                    requestOpts = __assign(__assign({}, opts), { headers: headers, credentials: "same-origin", cache: "no-store", signal: controller.signal });
                    delete requestOpts.timeoutMs;
                    delete requestOpts.omitSessionBearer;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, 4, 5]);
                    requestPath = "/api".concat(admin ? "/admin-mini" : "").concat(path);
                    return [4 /*yield*/, fetch(requestPath, requestOpts)];
                case 2:
                    response = _c.sent();
                    return [3 /*break*/, 5];
                case 3:
                    error_1 = _c.sent();
                    if ((error_1 === null || error_1 === void 0 ? void 0 : error_1.name) === "AbortError")
                        throw new Error("زمان پاسخ سرور تمام شد؛ دوباره تلاش کنید.");
                    throw error_1;
                case 4:
                    clearTimeout(timeout);
                    return [7 /*endfinally*/];
                case 5:
                    data = null;
                    _c.label = 6;
                case 6:
                    _c.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, response.json()];
                case 7:
                    data = _c.sent();
                    return [3 /*break*/, 9];
                case 8:
                    _a = _c.sent();
                    data = null;
                    return [3 /*break*/, 9];
                case 9:
                    if (!response.ok || (data === null || data === void 0 ? void 0 : data.success) === false) {
                        error = new Error(friendlyError(data, response.status));
                        error.status = response.status;
                        error.code = (data === null || data === void 0 ? void 0 : data.error_code) || ((_b = data === null || data === void 0 ? void 0 : data.error) === null || _b === void 0 ? void 0 : _b.code) || "";
                        error.data = data;
                        throw error;
                    }
                    return [2 /*return*/, data];
            }
        });
    });
}
var nativeApi = function (path, opts) {
    if (opts === void 0) { opts = {}; }
    return api(path, opts, false);
};
var adminApi = function (path, opts) {
    if (opts === void 0) { opts = {}; }
    return api(path, opts, true);
};
/**
 * A message a person can act on.
 *
 * The server already writes Persian for the cases it expects; this fills in the
 * transport-level failures, which otherwise surface as "Failed to fetch" or a
 * bare status code and tell a customer nothing.
 */
function friendlyError(data, status) {
    var _a;
    var server = typeof (data === null || data === void 0 ? void 0 : data.error) === "string"
        ? data.error
        : typeof ((_a = data === null || data === void 0 ? void 0 : data.error) === null || _a === void 0 ? void 0 : _a.message) === "string" ? data.error.message : "";
    if (server)
        return server;
    if (status === 401)
        return "نشست شما منقضی شده است. لطفاً پنل را از داخل ربات دوباره باز کنید.";
    if (status === 402)
        return "این بخش نیازمند اشتراک فعال است.";
    if (status === 403)
        return "شما به این بخش دسترسی ندارید.";
    if (status === 404)
        return "موردی پیدا نشد.";
    if (status === 409)
        return "این عملیات با وضعیت فعلی سازگار نیست.";
    if (status === 429)
        return "درخواست‌ها زیاد است. کمی صبر کنید.";
    if (status >= 500)
        return "سرور پاسخ نداد. کمی بعد دوباره تلاش کنید.";
    return "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.";
}
/* --------------------------------- state ---------------------------------- */
var state = {
    user: null,
    subscription: null,
    entitlements: null,
    sites: [],
    currentSite: null,
    admin: null,
    tab: "home",
    version: "",
    paymentUrl: "",
    adminSites: [],
    assignments: [],
    ticketFilter: "all",
    account: null,
};
var can = function (permission) { var _a, _b; return Boolean((_b = (_a = state.admin) === null || _a === void 0 ? void 0 : _a.permissions) === null || _b === void 0 ? void 0 : _b.includes(permission)); };
var isSuperAdmin = function () { var _a; return ((_a = state.admin) === null || _a === void 0 ? void 0 : _a.role) === "super_admin"; };
var siteRole = function () { var _a; return String(((_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.site_role) || ""); };
var canManageMembers = function () { return ["owner", "admin"].includes(siteRole()) || can("clients.update"); };
var hasFeature = function (name) {
    var _a, _b, _c, _d, _e, _f;
    return Boolean((_d = (_c = (_b = (_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.entitlements) === null || _b === void 0 ? void 0 : _b.features) === null || _c === void 0 ? void 0 : _c[name]) !== null && _d !== void 0 ? _d : (_f = (_e = state.entitlements) === null || _e === void 0 ? void 0 : _e.features) === null || _f === void 0 ? void 0 : _f[name]);
};
/* --------------------------------- theme ---------------------------------- */
function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("#themeIcon").textContent = theme === "light" ? "☾" : "☀";
    $("#themeToggle").setAttribute("aria-label", theme === "light" ? "پوسته تیره" : "پوسته روشن");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
        meta.setAttribute("content", theme === "light" ? "#f8fafc" : "#0b1220");
    // A viewer in a private window still gets a working toggle; it just forgets.
    try {
        localStorage.setItem("jarchi.theme", theme);
    }
    catch ( /* storage blocked */_a) { /* storage blocked */ }
}
/* ------------------------------- navigation ------------------------------- */
/*
 * One list drives the drawer and the bottom bar. `when` is evaluated after
 * /api/me and /api/admin-mini/me have answered, so a tab appears only for
 * someone the server would actually serve it to.
 */
var TABS = [
    { id: "home", label: "خانه", icon: "🏠", primary: true, when: function () { return true; } },
    { id: "sites", label: "سایت‌ها", icon: "🌐", primary: true, when: function () { return state.sites.length > 0; } },
    { id: "team", label: "اعضا", icon: "👥", primary: true, when: function () { return Boolean(state.currentSite); } },
    { id: "fields", label: "فیلدها", icon: "🧩", when: function () { return Boolean(state.currentSite) && ["owner", "admin"].includes(siteRole()); } },
    { id: "products", label: "محصولات", icon: "🤖", when: function () { return Boolean(state.currentSite) && hasFeature("remote_products"); } },
    { id: "tickets", label: "تیکت‌ها", icon: "🎫", when: function () { return Boolean(state.currentSite) && hasFeature("remote_tickets"); } },
    { id: "billing", label: "اشتراک", icon: "💳", primary: true, when: function () { return true; } },
    { id: "account", label: "حساب‌های متصل", icon: "🔗", when: function () { return Boolean(state.user); } },
    { id: "clients", label: "مدیریت سایت‌ها", icon: "🗂", admin: true, when: function () { return isSuperAdmin(); } },
    { id: "assign", label: "اعطای دسترسی", icon: "🔑", admin: true, when: function () { return isSuperAdmin(); } },
    { id: "users", label: "کاربران", icon: "👤", admin: true, when: function () { return isSuperAdmin(); } },
    { id: "plans", label: "پلن‌ها", icon: "🏷", admin: true, when: function () { return can("plans.view"); } },
    { id: "observability", label: "مانیتورینگ", icon: "📈", admin: true, when: function () { return can("audit.view"); } },
];
var visibleTabs = function () { return TABS.filter(function (tab) { try {
    return tab.when();
}
catch (_a) {
    return false;
} }); };
function renderNav() {
    var tabs = visibleTabs();
    $("#drawerNav").innerHTML = tabs.map(function (tab) { return "\n    <li><button data-tab=\"".concat(tab.id, "\" ").concat(state.tab === tab.id ? 'aria-current="page"' : "", ">\n      <span class=\"nav-icon\" aria-hidden=\"true\">").concat(tab.icon, "</span>\n      <span>").concat(esc(tab.label), "</span>\n      ").concat(tab.admin ? '<span class="chip brand small" style="margin-inline-start:auto">مدیر</span>' : "", "\n    </button></li>"); }).join("");
    // The bottom bar holds the few destinations a thumb needs; the rest live in
    // the drawer, so the bar never becomes a scrolling strip of tiny targets.
    var primary = tabs.filter(function (tab) { return tab.primary; }).slice(0, 4);
    $("#tabbar").innerHTML = __spreadArray(__spreadArray([], __read(primary.map(function (tab) { return "\n      <button data-tab=\"".concat(tab.id, "\" ").concat(state.tab === tab.id ? 'aria-current="page"' : "", ">\n        <span class=\"nav-icon\" aria-hidden=\"true\">").concat(tab.icon, "</span><span>").concat(esc(tab.label), "</span>\n      </button>"); })), false), [
        "<button data-drawer=\"1\" aria-label=\"\u0628\u06CC\u0634\u062A\u0631\">\n       <span class=\"nav-icon\" aria-hidden=\"true\">\u2630</span><span>\u0628\u06CC\u0634\u062A\u0631</span>\n     </button>",
    ], false).join("");
    $$("[data-tab]").forEach(function (button) { button.onclick = function () { return go(button.dataset.tab); }; });
    $$("[data-drawer]").forEach(function (button) { button.onclick = function () { return toggleDrawer(true); }; });
}
function toggleDrawer(open) {
    var drawer = $("#drawer");
    var scrim = $("#scrim");
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    $("#menuButton").setAttribute("aria-expanded", open ? "true" : "false");
    scrim.hidden = !open;
    requestAnimationFrame(function () { return scrim.classList.toggle("open", open); });
}
/* --------------------------------- modal ---------------------------------- */
/*
 * Modals are built from a field list rather than raw HTML so a caller cannot
 * accidentally interpolate an unescaped value into the markup, and so every
 * dialog gets the same labels, sizing and 48px targets.
 */
function modal(_a) {
    var _this = this;
    var title = _a.title, _b = _a.lead, lead = _b === void 0 ? "" : _b, _c = _a.fields, fields = _c === void 0 ? [] : _c, _d = _a.confirm, confirm = _d === void 0 ? "تایید" : _d, _e = _a.tone, tone = _e === void 0 ? "" : _e, _f = _a.body, body = _f === void 0 ? "" : _f, onSubmit = _a.onSubmit;
    var root = $("#modalRoot");
    var renderField = function (field) {
        var _a;
        if (field.type === "checkbox") {
            return "<label class=\"check\">\n        <span>".concat(esc(field.label), "</span>\n        <span class=\"switch\">\n          <input type=\"checkbox\" name=\"").concat(esc(field.name), "\" ").concat(field.value ? "checked" : "", ">\n          <span class=\"track\"></span>\n        </span>\n      </label>");
        }
        if (field.type === "select") {
            return "<label class=\"field\"><span>".concat(esc(field.label), "</span>\n        <select name=\"").concat(esc(field.name), "\" ").concat(field.required ? "required" : "", ">\n          ").concat((field.options || []).map(function (option) { var _a; return "<option value=\"".concat(esc(option.value), "\" ").concat(String(option.value) === String((_a = field.value) !== null && _a !== void 0 ? _a : "") ? "selected" : "", ">").concat(esc(option.label), "</option>"); }).join(""), "\n        </select></label>");
        }
        if (field.type === "textarea") {
            return "<label class=\"field\"><span>".concat(esc(field.label), "</span>\n        <textarea name=\"").concat(esc(field.name), "\" ").concat(field.required ? "required" : "", " placeholder=\"").concat(esc(field.placeholder || ""), "\">").concat(esc(field.value || ""), "</textarea></label>");
        }
        return "<label class=\"field\"><span>".concat(esc(field.label), "</span>\n      <input name=\"").concat(esc(field.name), "\" type=\"").concat(esc(field.inputType || "text"), "\"\n             value=\"").concat(esc((_a = field.value) !== null && _a !== void 0 ? _a : ""), "\" placeholder=\"").concat(esc(field.placeholder || ""), "\"\n             ").concat(field.required ? "required" : "", " ").concat(field.inputMode ? "inputmode=\"".concat(esc(field.inputMode), "\"") : "", "></label>");
    };
    root.innerHTML = "\n    <div class=\"modal-backdrop\">\n      <div class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"".concat(esc(title), "\">\n        <h3>").concat(esc(title), "</h3>\n        ").concat(lead ? "<p class=\"modal-lead\">".concat(esc(lead), "</p>") : "", "\n        <form id=\"modalForm\" novalidate>\n          ").concat(body, "\n          ").concat(fields.map(renderField).join(""), "\n          <div class=\"row-actions\">\n            <button class=\"btn ").concat(tone, "\" type=\"submit\">").concat(esc(confirm), "</button>\n            <button class=\"btn ghost\" type=\"button\" id=\"modalCancel\">\u0627\u0646\u0635\u0631\u0627\u0641</button>\n          </div>\n        </form>\n      </div>\n    </div>");
    var close = function () { root.innerHTML = ""; };
    $("#modalCancel").onclick = close;
    $(".modal-backdrop").onclick = function (event) { if (event.target === event.currentTarget)
        close(); };
    $("#modalForm").onsubmit = function (event) { return __awaiter(_this, void 0, void 0, function () {
        var submit, values, fields_1, fields_1_1, field, keepOpen, error_2;
        var e_1, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    event.preventDefault();
                    submit = event.target.querySelector('button[type="submit"]');
                    submit.disabled = true;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    values = Object.fromEntries(new FormData(event.target).entries());
                    try {
                        for (fields_1 = __values(fields), fields_1_1 = fields_1.next(); !fields_1_1.done; fields_1_1 = fields_1.next()) {
                            field = fields_1_1.value;
                            if (field.type === "checkbox")
                                values[field.name] = values[field.name] === "on";
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (fields_1_1 && !fields_1_1.done && (_a = fields_1.return)) _a.call(fields_1);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    return [4 /*yield*/, onSubmit(values, { close: close })];
                case 2:
                    keepOpen = _b.sent();
                    if (!keepOpen)
                        close();
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _b.sent();
                    toast(error_2.message, "error");
                    submit.disabled = false;
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    }); };
    return { close: close };
}
/** A destructive action always states what it will do before it does it. */
function confirmModal(_a) {
    var title = _a.title, lead = _a.lead, _b = _a.confirm, confirm = _b === void 0 ? "تایید" : _b, _c = _a.tone, tone = _c === void 0 ? "danger" : _c, onConfirm = _a.onConfirm;
    return modal({ title: title, lead: lead, confirm: confirm, tone: tone, fields: [], onSubmit: onConfirm });
}
function copyText(value_1) {
    return __awaiter(this, arguments, void 0, function (value, label) {
        var _a;
        if (label === void 0) { label = "کپی شد"; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, navigator.clipboard.writeText(value)];
                case 1:
                    _b.sent();
                    toast(label);
                    return [3 /*break*/, 3];
                case 2:
                    _a = _b.sent();
                    // Clipboard access is refused in some in-app webviews; selecting the text
                    // is the only thing left that works, so offer that instead of failing.
                    toast("امکان کپی خودکار نبود؛ متن را دستی انتخاب کنید", "warn");
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/* ------------------------------- bootstrap -------------------------------- */
function exchangeLaunchSession() {
    return __awaiter(this, arguments, void 0, function (_a) {
        var error_3;
        var _b = _a === void 0 ? {} : _a, _c = _b.keepBearer, keepBearer = _c === void 0 ? false : _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!sessionToken)
                        return [2 /*return*/, false];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, nativeApi("/session/exchange", {
                            method: "POST",
                            body: JSON.stringify({ session: sessionToken }),
                            timeoutMs: 10000,
                            omitSessionBearer: true,
                        })];
                case 2:
                    _d.sent();
                    if (!keepBearer) {
                        sessionToken = "";
                        try {
                            sessionStorage.removeItem("jarchi.session");
                        }
                        catch ( /* private mode */_e) { /* private mode */ }
                    }
                    return [2 /*return*/, true];
                case 3:
                    error_3 = _d.sent();
                    sessionToken = "";
                    try {
                        sessionStorage.removeItem("jarchi.session");
                    }
                    catch ( /* private mode */_f) { /* private mode */ }
                    if ((error_3 === null || error_3 === void 0 ? void 0 : error_3.status) === 401) {
                        throw new Error(platform === "bale"
                            ? "نشست بله منقضی شده است؛ پنل را دوباره از ربات جارچی باز کنید."
                            : "نشست منقضی شده است؛ پنل را دوباره از ربات جارچی باز کنید.");
                    }
                    throw error_3;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function establishSession() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(platform === "bale" && sessionToken)) return [3 /*break*/, 2];
                    return [4 /*yield*/, exchangeLaunchSession({ keepBearer: true })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
                case 2:
                    if (initData) {
                        sessionToken = "";
                        if (platform !== "bale") {
                            try {
                                sessionStorage.removeItem("jarchi.session");
                            }
                            catch ( /* private mode */_b) { /* private mode */ }
                        }
                        return [2 /*return*/];
                    }
                    if (!sessionToken)
                        return [2 /*return*/];
                    return [4 /*yield*/, exchangeLaunchSession({ keepBearer: false })];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function bootstrap() {
    return __awaiter(this, void 0, void 0, function () {
        var me, _a, _b, sites, health, account, error_4;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 7, , 8]);
                    window.__JARCHI_BOOT_STAGE__ = "platform_context";
                    return [4 /*yield*/, waitForPlatformAuthContext()];
                case 1:
                    _c.sent();
                    window.__JARCHI_BOOT_STAGE__ = "session_exchange";
                    return [4 /*yield*/, establishSession()];
                case 2:
                    _c.sent();
                    window.__JARCHI_BOOT_STAGE__ = "me";
                    return [4 /*yield*/, nativeApi("/me")];
                case 3:
                    me = _c.sent();
                    state.user = me.user;
                    state.subscription = me.subscription;
                    state.entitlements = me.entitlements;
                    // Being an operator is a separate question from being a customer, and not
                    // being one is the normal case — so a refusal here is not an error.
                    window.__JARCHI_BOOT_STAGE__ = "admin_me";
                    _a = state;
                    return [4 /*yield*/, adminApi("/me").then(function (result) { return result.admin; }).catch(function () { return null; })];
                case 4:
                    _a.admin = _c.sent();
                    window.__JARCHI_BOOT_STAGE__ = "initial_data";
                    return [4 /*yield*/, Promise.all([
                            nativeApi("/sites").catch(function () { return ({ sites: [] }); }),
                            nativeApi("/health").catch(function () { return ({}); }),
                            nativeApi("/account/identities").catch(function () { return ({ account: null }); }),
                        ])];
                case 5:
                    _b = __read.apply(void 0, [_c.sent(), 3]), sites = _b[0], health = _b[1], account = _b[2];
                    state.sites = sites.sites || [];
                    state.currentSite = state.sites[0] || null;
                    state.version = health.version || "";
                    state.account = account.account || null;
                    window.__JARCHI_BOOT_STAGE__ = "render";
                    renderIdentity();
                    renderNav();
                    return [4 /*yield*/, go(params.get("tab") || "home")];
                case 6:
                    _c.sent();
                    window.__JARCHI_BOOT_STAGE__ = "ready";
                    clearTimeout(BOOT_WATCHDOG);
                    return [3 /*break*/, 8];
                case 7:
                    error_4 = _c.sent();
                    renderNav();
                    clearTimeout(BOOT_WATCHDOG);
                    errorState(error_4.message, { retry: true });
                    $("#content").insertAdjacentHTML("beforeend", '<p class="muted small" style="text-align:center">اگر این پیام تکرار شد، پنل را از داخل ربات دوباره باز کنید.</p>');
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function renderIdentity() {
    var _a, _b;
    var name = ((_a = state.user) === null || _a === void 0 ? void 0 : _a.display_name) || ((_b = state.user) === null || _b === void 0 ? void 0 : _b.username) || "کاربر جارچی";
    $("#drawerName").textContent = name;
    $("#drawerAvatar").textContent = initials(name);
    $("#drawerMeta").textContent = state.admin
        ? "".concat(roleLabel(state.admin.role), " \u00B7 ").concat(platformLabel())
        : platformLabel();
    $("#versionLabel").textContent = state.version ? "\u0646\u0633\u062E\u0647 ".concat(state.version) : "";
    var badge = $("#roleBadge");
    if (state.admin) {
        badge.hidden = false;
        badge.textContent = roleLabel(state.admin.role);
    }
    else {
        badge.hidden = true;
    }
    var switcher = $("#drawerSite");
    if (state.sites.length > 1) {
        switcher.hidden = false;
        $("#siteSwitcher").innerHTML = state.sites
            .map(function (site) { var _a; return "<option value=\"".concat(esc(site.id), "\" ").concat(((_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.id) === site.id ? "selected" : "", ">").concat(esc(site.name || site.id), "</option>"); })
            .join("");
        $("#siteSwitcher").onchange = function (event) {
            state.currentSite = state.sites.find(function (site) { return site.id === event.target.value; }) || null;
            renderNav();
            go(state.tab);
        };
    }
    else {
        switcher.hidden = true;
    }
}
var ROLE_LABELS = {
    super_admin: "مدیر ارشد", admin: "مدیر", support: "پشتیبان", viewer: "بازدیدکننده", owner: "مالک",
};
var roleLabel = function (role) { return ROLE_LABELS[String(role || "").toLowerCase()] || String(role || "—"); };
var platformLabel = function () { return ({ telegram: "تلگرام", bale: "بله", web: "وب" }[platform] || platform); };
var SCREENS = {};
function go(tab) {
    return __awaiter(this, void 0, void 0, function () {
        var target, error_5;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    target = SCREENS[tab] ? tab : "home";
                    state.tab = target;
                    toggleDrawer(false);
                    renderNav();
                    $("#pageTitle").textContent = ((_a = TABS.find(function (item) { return item.id === target; })) === null || _a === void 0 ? void 0 : _a.label) || "مرکز کنترل";
                    (_c = (_b = $("#content")).scrollTo) === null || _c === void 0 ? void 0 : _c.call(_b, { top: 0 });
                    window.scrollTo({ top: 0, behavior: "instant" });
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, SCREENS[target]()];
                case 2:
                    _d.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_5 = _d.sent();
                    errorState(error_5.message);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/* --------------------------------- home ----------------------------------- */
SCREENS.home = function home() {
    return __awaiter(this, void 0, void 0, function () {
        var site, subscription;
        var _a;
        return __generator(this, function (_b) {
            skeleton(2);
            site = state.currentSite;
            subscription = state.subscription;
            $("#content").innerHTML = "\n    <div class=\"hero\">\n      <div>\n        <span class=\"eyebrow\">\u0645\u0631\u06A9\u0632 \u06A9\u0646\u062A\u0631\u0644</span>\n        <h2>".concat(esc(((_a = state.user) === null || _a === void 0 ? void 0 : _a.display_name) || "خوش آمدید"), "</h2>\n        <p>\u0633\u0627\u06CC\u062A\u060C \u0627\u0639\u0636\u0627\u060C \u0641\u06CC\u0644\u062F\u0647\u0627 \u0648 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0631\u0627 \u0627\u0632 \u0647\u0645\u06CC\u0646\u200C\u062C\u0627 \u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0646\u06CC\u062F.</p>\n      </div>\n      <div class=\"hero-icon\" aria-hidden=\"true\">\u2726</div>\n    </div>\n\n    <div class=\"grid-2\">\n      <div class=\"stat\"><small>\u0633\u0627\u06CC\u062A\u200C\u0647\u0627</small><strong>").concat(n(state.sites.length), "</strong></div>\n      <div class=\"stat\"><small>\u0646\u0642\u0634 \u0634\u0645\u0627</small><strong>").concat(esc(site ? roleLabel(site.site_role) : "—"), "</strong></div>\n      <div class=\"stat\"><small>\u067E\u0644\u0646</small><strong>").concat(esc((subscription === null || subscription === void 0 ? void 0 : subscription.plan_name) || "بدون اشتراک"), "</strong></div>\n      <div class=\"stat\"><small>\u0645\u0627\u0646\u062F\u0647</small><strong>").concat(subscription ? "".concat(n(daysLeft(subscription.expires_at)), " \u0631\u0648\u0632") : "—", "</strong></div>\n    </div>\n\n    ").concat(site ? "<section class=\"card\">\n      <h3>".concat(esc(site.name || site.id), "</h3>\n      <div class=\"chips\" style=\"margin:var(--space-2) 0 var(--space-3)\">\n        <span class=\"chip ").concat(site.enabled ? "ok" : "bad", "\">").concat(site.enabled ? "فعال" : "غیرفعال", "</span>\n        <span class=\"chip\">").concat(site.telegram_channel_id ? "تلگرام ✓" : "تلگرام —", "</span>\n        <span class=\"chip\">").concat(site.bale_chat_id ? "بله ✓" : "بله —", "</span>\n      </div>\n      <dl class=\"kv\">\n        <dt>\u0622\u062F\u0631\u0633</dt><dd class=\"mono\">").concat(esc(site.wordpress_url || "—"), "</dd>\n        <dt>\u0622\u062E\u0631\u06CC\u0646 \u0627\u0646\u062A\u0634\u0627\u0631</dt><dd>").concat(ago(site.last_publication_at), "</dd>\n        <dt>\u0622\u062E\u0631\u06CC\u0646 \u0648\u0628\u0647\u0648\u06A9</dt><dd>").concat(ago(site.last_webhook_at), "</dd>\n      </dl>\n    </section>") : emptyState("🌐", "هنوز سایتی به شما متصل نیست", "پس از اتصال افزونه وردپرس، سایت شما این‌جا ظاهر می‌شود."), "\n\n    ").concat(renderCapabilities());
            return [2 /*return*/];
        });
    });
};
function renderCapabilities() {
    var _a, _b, _c;
    var features = ((_b = (_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.entitlements) === null || _b === void 0 ? void 0 : _b.features) || ((_c = state.entitlements) === null || _c === void 0 ? void 0 : _c.features);
    if (!features)
        return "";
    var labels = {
        site_control: "کنترل سایت", remote_tickets: "تیکت از راه دور",
        remote_announcements: "اطلاعیه", remote_products: "محصولات هوشمند", analytics: "گزارش‌ها",
    };
    return "<section class=\"card\">\n    <h3>\u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0627\u0634\u062A\u0631\u0627\u06A9 \u0634\u0645\u0627</h3>\n    <div class=\"chips\" style=\"margin-top:var(--space-3)\">\n      ".concat(Object.entries(labels).map(function (_a) {
        var _b = __read(_a, 2), key = _b[0], label = _b[1];
        return "<span class=\"chip ".concat(features[key] ? "ok" : "", "\">").concat(esc(label), " ").concat(features[key] ? "✓" : "—", "</span>");
    }).join(""), "\n    </div>\n  </section>");
}
/* -------------------------------- my sites -------------------------------- */
SCREENS.sites = function sites() {
    return __awaiter(this, void 0, void 0, function () {
        var refreshed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/sites")];
                case 1:
                    refreshed = _a.sent();
                    state.sites = refreshed.sites || [];
                    if (state.currentSite) {
                        state.currentSite = state.sites.find(function (site) { return site.id === state.currentSite.id; }) || state.sites[0] || null;
                    }
                    renderIdentity();
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">\u0627\u062A\u0635\u0627\u0644\u200C\u0647\u0627</span><h2>\u0633\u0627\u06CC\u062A\u200C\u0647\u0627\u06CC \u0645\u0646</h2></div>\n    </div>\n    ".concat(state.sites.length ? state.sites.map(siteCard).join("")
                        : emptyState("🌐", "سایتی ثبت نشده", "اتصال سایت از طریق افزونه وردپرس انجام می‌شود."));
                    $$("[data-select-site]").forEach(function (button) {
                        button.onclick = function () {
                            var _a;
                            state.currentSite = state.sites.find(function (site) { return site.id === button.dataset.selectSite; }) || null;
                            renderIdentity();
                            renderNav();
                            toast("\u0633\u0627\u06CC\u062A \u0641\u0639\u0627\u0644: ".concat(((_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.name) || ""));
                            go("team");
                        };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function siteCard(site) {
    var _a;
    var active = ((_a = state.currentSite) === null || _a === void 0 ? void 0 : _a.id) === site.id;
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(site.name || site.id), "</div>\n          <div class=\"record-meta\">\n            <span class=\"mono\">").concat(esc(site.wordpress_url || "—"), "</span>\n          </div>\n        </div>\n        <span class=\"chip ").concat(site.enabled ? "ok" : "bad", "\">").concat(site.enabled ? "فعال" : "غیرفعال", "</span>\n      </div>\n      <div class=\"chips\" style=\"margin-top:var(--space-2)\">\n        <span class=\"chip brand\">").concat(esc(roleLabel(site.site_role)), "</span>\n        <span class=\"chip\">").concat(site.telegram_channel_id ? "تلگرام ✓" : "تلگرام —", "</span>\n        <span class=\"chip\">").concat(site.bale_chat_id ? "بله ✓" : "بله —", "</span>\n        <span class=\"chip\">").concat(site.remote_access ? "کنترل از راه دور ✓" : "کنترل از راه دور —", "</span>\n      </div>\n    </div>\n    <div class=\"record-actions\">\n      <button class=\"btn ").concat(active ? "ghost" : "", " small\" data-select-site=\"").concat(esc(site.id), "\" ").concat(active ? "disabled" : "", ">\n        ").concat(active ? "سایت فعال" : "انتخاب", "\n      </button>\n    </div>\n  </article>");
}
/* ------------------------------ site members ------------------------------ */
SCREENS.team = function team() {
    return __awaiter(this, void 0, void 0, function () {
        var site, data, manage;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    site = state.currentSite;
                    if (!site) {
                        $("#content").innerHTML = emptyState("👥", "ابتدا یک سایت انتخاب کنید");
                        return [2 /*return*/];
                    }
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(site.id), "/members"))];
                case 1:
                    data = _a.sent();
                    manage = data.can_manage;
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow\">".concat(esc(site.name || site.id), "</span>\n        <h2>\u0627\u0639\u0636\u0627\u06CC \u0633\u0627\u06CC\u062A</h2>\n        <p class=\"muted small\">\u0646\u0642\u0634 \u0634\u0645\u0627: ").concat(esc(roleLabel(data.site_role)), "</p>\n      </div>\n      ").concat(manage ? '<button class="btn" id="addMember">+ افزودن عضو</button>' : "", "\n    </div>\n\n    ").concat(manage ? "" : '<div class="notice">شما به‌عنوان پشتیبان فقط می‌توانید اعضا را ببینید. تغییر دسترسی‌ها با مالک یا مدیر سایت است.</div>', "\n\n    ").concat(data.owner ? memberRow(data.owner, { manage: false }) : "", "\n    ").concat(data.members.length
                        ? data.members.map(function (member) { return memberRow(member, { manage: manage }); }).join("")
                        : emptyState("👤", "عضو دیگری ثبت نشده", manage ? "با شناسه تلگرام یا بله می‌توانید همکار اضافه کنید." : ""));
                    if (manage)
                        $("#addMember").onclick = function () { return addMemberModal(site.id); };
                    $$("[data-member-role]").forEach(function (button) {
                        button.onclick = function () { return changeMemberRoleModal(site.id, button.dataset.memberRole, button.dataset.currentRole); };
                    });
                    $$("[data-member-remove]").forEach(function (button) {
                        button.onclick = function () { return removeMemberModal(site.id, button.dataset.memberRemove, button.dataset.memberName); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function memberRow(member, _a) {
    var manage = _a.manage;
    var isOwner = member.role === "owner";
    var ids = (member.identities || [])
        .map(function (identity) { return "".concat(identity.platform === "bale" ? "بله" : "تلگرام", ": ").concat(identity.platform_user_id); })
        .join(" · ");
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(member.display_name || member.username || "\u06A9\u0627\u0631\u0628\u0631 ".concat(member.user_id)), "</div>\n          <div class=\"record-meta\">\n            ").concat(ids ? "<span class=\"mono\">".concat(esc(ids), "</span>") : '<span class="muted">بدون شناسه ثبت‌شده</span>', "\n            ").concat(member.created_at ? "<span>".concat(esc(date(member.created_at)), "</span>") : "", "\n          </div>\n        </div>\n        <span class=\"chip ").concat(isOwner ? "brand" : member.role === "admin" ? "ok" : "", "\">").concat(esc(roleLabel(member.role)), "</span>\n      </div>\n    </div>\n    ").concat(manage && !isOwner ? "<div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-member-role=\"".concat(esc(member.user_id), "\" data-current-role=\"").concat(esc(member.role), "\">\u062A\u063A\u06CC\u06CC\u0631 \u0646\u0642\u0634</button>\n      <button class=\"btn danger small\" data-member-remove=\"").concat(esc(member.user_id), "\" data-member-name=\"").concat(esc(member.display_name || member.username || ""), "\">\u062D\u0630\u0641</button>\n    </div>") : "", "\n  </article>");
}
function addMemberModal(siteId) {
    var _this = this;
    modal({
        title: "افزودن عضو",
        lead: "شناسه عددی تلگرام یا بله همکار را وارد کنید. او باید قبلاً ربات جارچی را استارت کرده باشد.",
        fields: [
            { name: "platform", label: "پلتفرم", type: "select", value: platform === "bale" ? "bale" : "telegram",
                options: [{ value: "telegram", label: "تلگرام" }, { value: "bale", label: "بله" }] },
            { name: "platform_user_id", label: "شناسه عددی کاربر", required: true, inputMode: "numeric", placeholder: "مثلاً ۱۲۳۴۵۶۷۸۹" },
            { name: "role", label: "نقش", type: "select", value: "support",
                options: [{ value: "support", label: "پشتیبان — فقط کار روی سایت" }, { value: "admin", label: "مدیر — می‌تواند اعضا را هم مدیریت کند" }] },
        ],
        confirm: "افزودن",
        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/members"), {
                            method: "POST",
                            body: JSON.stringify({
                                platform: values.platform,
                                platform_user_id: String(values.platform_user_id || "").trim(),
                                role: values.role,
                            }),
                        })];
                    case 1:
                        _a.sent();
                        haptic("medium");
                        toast("عضو اضافه شد");
                        return [4 /*yield*/, go("team")];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); },
    });
}
function changeMemberRoleModal(siteId, userId, currentRole) {
    var _this = this;
    modal({
        title: "تغییر نقش",
        lead: "پشتیبان فقط روی سایت کار می‌کند؛ مدیر می‌تواند اعضا را هم تغییر دهد.",
        fields: [
            { name: "role", label: "نقش جدید", type: "select", value: currentRole,
                options: [{ value: "support", label: "پشتیبان" }, { value: "admin", label: "مدیر" }] },
        ],
        confirm: "ذخیره",
        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/members/").concat(encodeURIComponent(userId)), {
                            method: "PATCH",
                            body: JSON.stringify({ role: values.role }),
                        })];
                    case 1:
                        _a.sent();
                        toast("نقش بروزرسانی شد");
                        return [4 /*yield*/, go("team")];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); },
    });
}
function removeMemberModal(siteId, userId, name) {
    var _this = this;
    confirmModal({
        title: "حذف دسترسی",
        lead: "".concat(name || "این کاربر", " \u067E\u0633 \u0627\u0632 \u062D\u0630\u0641\u060C \u062F\u06CC\u06AF\u0631 \u0628\u0647 \u0627\u06CC\u0646 \u0633\u0627\u06CC\u062A \u062F\u0633\u062A\u0631\u0633\u06CC \u0646\u062E\u0648\u0627\u0647\u062F \u062F\u0627\u0634\u062A. \u0627\u06CC\u0646 \u06A9\u0627\u0631 \u0642\u0627\u0628\u0644 \u0628\u0627\u0632\u06AF\u0634\u062A \u0627\u0633\u062A\u061B \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0648 \u0631\u0627 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F."),
        confirm: "حذف دسترسی",
        onConfirm: function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/members/").concat(encodeURIComponent(userId)), { method: "DELETE" })];
                    case 1:
                        _a.sent();
                        haptic("medium");
                        toast("دسترسی حذف شد");
                        return [4 /*yield*/, go("team")];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); },
    });
}
/* ------------------------------ field control ----------------------------- */
/*
 * The field list belongs to WordPress: the plugin decides what exists and what
 * it is called. What can be changed here is presentation and routing, and every
 * row shows the plugin's own answer next to the override so it is always clear
 * which of the two is in effect.
 */
SCREENS.fields = function fields() {
    return __awaiter(this, void 0, void 0, function () {
        var site, editable, data, _a, list;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    site = state.currentSite;
                    if (!site) {
                        $("#content").innerHTML = emptyState("🧩", "ابتدا یک سایت انتخاب کنید");
                        return [2 /*return*/];
                    }
                    skeleton(4);
                    editable = hasFeature("site_control") && (["owner", "admin"].includes(siteRole()) || can("fields.manage"));
                    if (!editable) return [3 /*break*/, 2];
                    return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(site.id), "/fields"))];
                case 1:
                    _a = _b.sent();
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, nativeApi("/fields/".concat(encodeURIComponent(site.id)))];
                case 3:
                    _a = _b.sent();
                    _b.label = 4;
                case 4:
                    data = _a;
                    list = data.fields || [];
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow\">".concat(esc(site.name || site.id), "</span>\n        <h2>\u0641\u06CC\u0644\u062F\u0647\u0627\u06CC \u0627\u0646\u062A\u0634\u0627\u0631</h2>\n        <p class=\"muted small\">\u0641\u0647\u0631\u0633\u062A \u0641\u06CC\u0644\u062F\u0647\u0627 \u0627\u0632 \u0627\u0641\u0632\u0648\u0646\u0647 \u0648\u0631\u062F\u067E\u0631\u0633 \u0645\u06CC\u200C\u0622\u06CC\u062F\u061B \u0627\u06CC\u0646\u200C\u062C\u0627 \u0641\u0642\u0637 \u0646\u0645\u0627\u06CC\u0634 \u0648 \u0645\u0642\u0635\u062F \u0622\u0646\u200C\u0647\u0627 \u0631\u0627 \u062A\u0646\u0638\u06CC\u0645 \u0645\u06CC\u200C\u06A9\u0646\u06CC\u062F.</p>\n      </div>\n    </div>\n\n    ").concat(list.length
                        ? "<div id=\"fieldList\">".concat(list.map(function (field, index) { return fieldRow(field, index, list.length, editable); }).join(""), "</div>")
                        : emptyState("🧩", "هنوز فیلدی دریافت نشده", "پس از اولین انتشار از وردپرس، فیلدها این‌جا فهرست می‌شوند."));
                    if (!editable)
                        return [2 /*return*/];
                    // Same controls as the operator's per-site tab; one implementation so the two
                    // screens cannot drift in what a toggle actually does.
                    wireFieldControls(site.id, list, function () { return go("fields"); });
                    return [2 /*return*/];
            }
        });
    });
};
/**
 * One field row, shared by the customer field screen and the operator's
 * per-site tab.
 *
 * Both the plugin's own label and the override are shown when they differ, so
 * it is never ambiguous which of the two is in force, and the platform switches
 * are disabled while a field is hidden because hiding already decided them.
 */
function fieldRow(field, index, total, editable) {
    var key = field.field_key;
    var label = field.effective_label || field.label_override || field.label || key;
    var platforms = field.effective_platforms || {};
    var renamed = Boolean(field.label_override) && field.label_override !== field.label;
    var PLATFORM_LABELS = { telegram: "تلگرام", bale: "بله", whatsapp: "واتساپ" };
    var toggle = function (name) { return "\n    <label class=\"check\" style=\"min-height:36px\">\n      <span class=\"small\">".concat(PLATFORM_LABELS[name], "</span>\n      <span class=\"switch\">\n        <input type=\"checkbox\" data-field-platform=\"").concat(name, "\" data-field-key=\"").concat(esc(key), "\"\n               ").concat(platforms[name] ? "checked" : "", " ").concat(field.hidden ? "disabled" : "", "\n               aria-label=\"").concat(PLATFORM_LABELS[name], " \u0628\u0631\u0627\u06CC ").concat(esc(label), "\">\n        <span class=\"track\"></span>\n      </span>\n    </label>"); };
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(label), "</div>\n          <div class=\"record-meta\">\n            <span class=\"mono\">").concat(esc(key), "</span>\n            ").concat(field.field_type ? "<span>".concat(esc(field.field_type), "</span>") : "", "\n            ").concat(renamed ? "<span class=\"muted\">\u0646\u0627\u0645 \u0627\u0641\u0632\u0648\u0646\u0647: ".concat(esc(field.label), "</span>") : "", "\n          </div>\n        </div>\n        ").concat(field.hidden ? '<span class="chip bad">پنهان</span>' : "", "\n      </div>\n\n      ").concat(editable ? "<div class=\"grid\" style=\"margin-top:var(--space-2)\">\n        ".concat(toggle("telegram"), "\n        ").concat(toggle("bale"), "\n        ").concat(toggle("whatsapp"), "\n        <label class=\"check\" style=\"min-height:36px\">\n          <span class=\"small\">\u067E\u0646\u0647\u0627\u0646 \u0627\u0632 \u0647\u0645\u0647 \u067E\u0644\u062A\u0641\u0631\u0645\u200C\u0647\u0627</span>\n          <span class=\"switch\">\n            <input type=\"checkbox\" data-field-hidden=\"").concat(esc(key), "\" ").concat(field.hidden ? "checked" : "", "\n                   aria-label=\"\u067E\u0646\u0647\u0627\u0646 \u06A9\u0631\u062F\u0646 ").concat(esc(label), "\">\n            <span class=\"track\"></span>\n          </span>\n        </label>\n      </div>") : "<div class=\"chips\" style=\"margin-top:var(--space-2)\">\n        ".concat(Object.keys(PLATFORM_LABELS).map(function (name) {
        return "<span class=\"chip ".concat(platforms[name] ? "ok" : "", "\">").concat(PLATFORM_LABELS[name], " ").concat(platforms[name] ? "✓" : "—", "</span>");
    }).join(""), "\n      </div>"), "\n    </div>\n\n    ").concat(editable ? "<div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-field-label=\"".concat(esc(key), "\"\n              data-current-label=\"").concat(esc(field.label_override || ""), "\"\n              data-plugin-label=\"").concat(esc(field.label || key), "\">\u0646\u0627\u0645 \u0646\u0645\u0627\u06CC\u0634\u06CC</button>\n      <button class=\"btn ghost small\" data-field-move=\"").concat(esc(key), "\" data-direction=\"-1\"\n              ").concat(index === 0 ? "disabled" : "", " aria-label=\"\u0627\u0646\u062A\u0642\u0627\u0644 ").concat(esc(label), " \u0628\u0647 \u0628\u0627\u0644\u0627\">\u2191</button>\n      <button class=\"btn ghost small\" data-field-move=\"").concat(esc(key), "\" data-direction=\"1\"\n              ").concat(index === total - 1 ? "disabled" : "", " aria-label=\"\u0627\u0646\u062A\u0642\u0627\u0644 ").concat(esc(label), " \u0628\u0647 \u067E\u0627\u06CC\u06CC\u0646\">\u2193</button>\n    </div>") : "", "\n  </article>");
}
/* -------------------------------- billing --------------------------------- */
SCREENS.billing = function billing() {
    return __awaiter(this, void 0, void 0, function () {
        var data, subscription;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/plans")];
                case 1:
                    data = _a.sent();
                    state.paymentUrl = data.payment_url || state.paymentUrl;
                    subscription = state.subscription;
                    $("#content").innerHTML = "\n    <div class=\"section-head\"><div><span class=\"eyebrow\">\u0627\u0634\u062A\u0631\u0627\u06A9</span><h2>\u067E\u0644\u0646\u200C\u0647\u0627</h2></div></div>\n\n    ".concat(subscription ? "<section class=\"card\">\n      <h3>".concat(esc(subscription.plan_name || subscription.plan_id), "</h3>\n      <dl class=\"kv\" style=\"margin-top:var(--space-2)\">\n        <dt>\u0648\u0636\u0639\u06CC\u062A</dt><dd>").concat(esc(subscription.status === "active" ? "فعال" : subscription.status), "</dd>\n        <dt>\u0627\u0646\u0642\u0636\u0627</dt><dd>").concat(date(subscription.expires_at), " (").concat(n(daysLeft(subscription.expires_at)), " \u0631\u0648\u0632)</dd>\n      </dl>\n    </section>") : '<div class="notice">اشتراک فعالی ندارید.</div>', "\n\n    ").concat((data.plans || []).map(planCard).join(""), "\n\n    <div class=\"notice\">\u067E\u0631\u062F\u0627\u062E\u062A \u062F\u0631 \u0645\u0631\u0648\u0631\u06AF\u0631 \u0627\u0645\u0646 \u0633\u0627\u06CC\u062A \u0634\u0645\u0627 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u0634\u0648\u062F \u0648 \u067E\u0633 \u0627\u0632 \u062A\u06A9\u0645\u06CC\u0644\u060C \u0627\u0634\u062A\u0631\u0627\u06A9 \u062F\u0631 \u0647\u0645\u06CC\u0646 \u067E\u0646\u0644 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0645\u06CC\u200C\u06AF\u0631\u062F\u062F.</div>");
                    $$("[data-buy]").forEach(function (button) { button.onclick = function () { return buyPlan(button.dataset.buy); }; });
                    return [2 /*return*/];
            }
        });
    });
};
function planCard(plan) {
    var features = plan.features || {};
    var labels = {
        site_control: "کنترل سایت", remote_tickets: "تیکت", remote_announcements: "اطلاعیه",
        remote_products: "محصولات هوشمند", analytics: "گزارش",
    };
    var included = Object.entries(labels).filter(function (_a) {
        var _b = __read(_a, 1), key = _b[0];
        return features[key];
    });
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(plan.name), "</div>\n          <div class=\"record-meta\"><span>").concat(n(plan.duration_days), " \u0631\u0648\u0632</span></div>\n        </div>\n        <strong>").concat(n(plan.price_toman), " \u062A\u0648\u0645\u0627\u0646</strong>\n      </div>\n      ").concat(included.length ? "<div class=\"chips\" style=\"margin-top:var(--space-2)\">\n        ".concat(included.map(function (_a) {
        var _b = __read(_a, 2), label = _b[1];
        return "<span class=\"chip ok\">".concat(esc(label), "</span>");
    }).join(""), "\n      </div>") : "", "\n    </div>\n    <div class=\"record-actions\"><button class=\"btn small\" data-buy=\"").concat(esc(plan.id), "\">\u062E\u0631\u06CC\u062F</button></div>\n  </article>");
}
function buyPlan(planId) {
    if (!state.paymentUrl) {
        toast("لینک پرداخت هنوز تنظیم نشده است", "error");
        return;
    }
    var url = new URL(state.paymentUrl);
    url.searchParams.set("plan_id", planId);
    url.searchParams.set("source", platform);
    url.searchParams.set("return_to", location.href);
    url.searchParams.set("jarchi_return", "1");
    // Telegram's in-app webview cannot complete a gateway flow; the SDK hands it
    // to the real browser instead, and a plain browser just follows the link.
    if (tg === null || tg === void 0 ? void 0 : tg.openLink)
        tg.openLink(url.toString());
    else
        window.location.href = url.toString();
}
/* ========================================================================== *
 *                          operator (admin) screens                          *
 * ========================================================================== */
/* ----------------------------- site management ---------------------------- */
SCREENS.clients = function clients() {
    return __awaiter(this, void 0, void 0, function () {
        var data, create;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(4);
                    return [4 /*yield*/, adminApi("/clients?page_size=100")];
                case 1:
                    data = _a.sent();
                    state.adminSites = data.clients || data.items || [];
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">\u0645\u062F\u06CC\u0631\u06CC\u062A</span><h2>\u0633\u0627\u06CC\u062A\u200C\u0647\u0627\u06CC \u0645\u0634\u062A\u0631\u06CC\u0627\u0646</h2></div>\n      ".concat(can("clients.create") ? '<button class="btn" id="newSite">+ سایت جدید</button>' : "", "\n    </div>\n    ").concat(state.adminSites.length
                        ? state.adminSites.map(adminSiteCard).join("")
                        : emptyState("🗂", "هنوز سایتی ثبت نشده", "با دکمه «سایت جدید» اولین مشتری را اضافه کنید."));
                    create = $("#newSite");
                    if (create)
                        create.onclick = createSiteModal;
                    $$("[data-open-site]").forEach(function (button) { button.onclick = function () { return openSite(button.dataset.openSite); }; });
                    return [2 /*return*/];
            }
        });
    });
};
function adminSiteCard(site) {
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(site.name || site.id), "</div>\n          <div class=\"record-meta\">\n            <span class=\"mono\">").concat(esc(site.id), "</span>\n            <span>").concat(esc(site.wordpress_url || "—"), "</span>\n          </div>\n        </div>\n        <span class=\"chip ").concat(site.enabled ? "ok" : "bad", "\">").concat(site.enabled ? "فعال" : "غیرفعال", "</span>\n      </div>\n    </div>\n    <div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-open-site=\"").concat(esc(site.id), "\">\u0645\u062F\u06CC\u0631\u06CC\u062A</button>\n    </div>\n  </article>");
}
/**
 * Creating a site produces credentials that exist in readable form exactly
 * once. The dialog that shows them is opened from the create handler after it
 * closes its own dialog, so the parent's cleanup cannot wipe the child.
 */
function createSiteModal() {
    var _this = this;
    modal({
        title: "سایت جدید",
        lead: "پس از ساخت، اطلاعات اتصال یک‌بار نمایش داده می‌شود. آن‌ها را در همان لحظه در افزونه وردپرس ثبت کنید.",
        fields: [
            { name: "name", label: "نام مشتری", required: true, placeholder: "مثلاً فروشگاه نمونه" },
            { name: "wordpress_url", label: "آدرس سایت وردپرس", required: true, inputType: "url", placeholder: "https://example.com" },
            { name: "owner_telegram_id", label: "شناسه تلگرام مالک", inputMode: "numeric", placeholder: "اختیاری" },
            { name: "telegram_channel_id", label: "کانال تلگرام", placeholder: "@channel یا -100…" },
            { name: "bale_chat_id", label: "چت بله", placeholder: "شناسه عددی چت" },
        ],
        confirm: "ساخت سایت",
        onSubmit: function (values_1, _a) { return __awaiter(_this, [values_1, _a], void 0, function (values, _b) {
            var payload, _c, _d, key, value, result;
            var e_2, _e;
            var close = _b.close;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        payload = { name: values.name, wordpress_url: values.wordpress_url };
                        try {
                            for (_c = __values(["owner_telegram_id", "telegram_channel_id", "bale_chat_id"]), _d = _c.next(); !_d.done; _d = _c.next()) {
                                key = _d.value;
                                value = String(values[key] || "").trim();
                                if (value)
                                    payload[key] = value;
                            }
                        }
                        catch (e_2_1) { e_2 = { error: e_2_1 }; }
                        finally {
                            try {
                                if (_d && !_d.done && (_e = _c.return)) _e.call(_c);
                            }
                            finally { if (e_2) throw e_2.error; }
                        }
                        return [4 /*yield*/, adminApi("/clients", { method: "POST", body: JSON.stringify(payload) })];
                    case 1:
                        result = _f.sent();
                        close();
                        haptic("medium");
                        toast("سایت ساخته شد");
                        // Next frame, so this dialog's removal cannot take the next one with it.
                        setTimeout(function () { return credentialsModal(result.client || result.site); }, 0);
                        return [2 /*return*/, true];
                }
            });
        }); },
    });
}
function credentialsModal(client) {
    var _this = this;
    if (!client)
        return;
    var rows = [
        ["شناسه سایت", client.id],
        ["آدرس وبهوک", client.webhook_url || "".concat(location.origin, "/webhook")],
        ["رمز وبهوک", client.webhook_secret],
    ].filter(function (_a) {
        var _b = __read(_a, 2), value = _b[1];
        return value;
    });
    modal({
        title: "اطلاعات اتصال",
        lead: "این اطلاعات فقط همین یک‌بار نمایش داده می‌شود. رمز وبهوک بعداً قابل بازیابی نیست و در صورت نیاز باید بازتولید شود.",
        body: "<div class=\"grid\">\n      ".concat(rows.map(function (_a, index) {
            var _b = __read(_a, 2), label = _b[0], value = _b[1];
            return "\n        <div>\n          <div class=\"small muted\">".concat(esc(label), "</div>\n          <div class=\"copy-row\">\n            <code id=\"cred").concat(index, "\">").concat(esc(value), "</code>\n            <button class=\"btn ghost small\" type=\"button\" data-copy=\"").concat(index, "\">\u06A9\u067E\u06CC</button>\n          </div>\n        </div>");
        }).join(""), "\n      <div class=\"notice warn\">\u062A\u0627 \u0648\u0642\u062A\u06CC \u0627\u06CC\u0646 \u0645\u0642\u0627\u062F\u06CC\u0631 \u062F\u0631 \u0627\u0641\u0632\u0648\u0646\u0647 \u0648\u0631\u062F\u067E\u0631\u0633 \u062B\u0628\u062A \u0646\u0634\u0648\u0646\u062F\u060C \u0627\u0646\u062A\u0634\u0627\u0631 \u0627\u0632 \u0622\u0646 \u0633\u0627\u06CC\u062A \u06A9\u0627\u0631 \u0646\u062E\u0648\u0627\u0647\u062F \u06A9\u0631\u062F.</div>\n    </div>"),
        confirm: "ثبت کردم، ببند",
        onSubmit: function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, go("clients")];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        }); }); },
    });
    $$("[data-copy]").forEach(function (button) {
        button.onclick = function () { return copyText($("#cred".concat(button.dataset.copy)).textContent, "در حافظه کپی شد"); };
    });
}
/* ---------------------------- one site, in tabs --------------------------- */
var SITE_TABS = [
    { id: "overview", label: "کلی" },
    { id: "platforms", label: "پلتفرم‌ها" },
    { id: "fields", label: "فیلدها" },
    { id: "members", label: "اعضا" },
    { id: "publications", label: "انتشارها" },
    { id: "webhooks", label: "وبهوک‌ها" },
];
function openSite(siteId_1) {
    return __awaiter(this, arguments, void 0, function (siteId, tab) {
        var detail, client, body, error_6;
        if (tab === void 0) { tab = "overview"; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(siteId)))];
                case 1:
                    detail = _a.sent();
                    client = detail.client || detail;
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow mono\">".concat(esc(client.id), "</span>\n        <h2>").concat(esc(client.name || client.id), "</h2>\n      </div>\n      <button class=\"btn ghost small\" id=\"backToClients\">\u0628\u0627\u0632\u06AF\u0634\u062A</button>\n    </div>\n    <div class=\"subtabs\" role=\"tablist\">\n      ").concat(SITE_TABS.map(function (item) { return "<button role=\"tab\" data-site-tab=\"".concat(item.id, "\" aria-selected=\"").concat(item.id === tab, "\">").concat(esc(item.label), "</button>"); }).join(""), "\n    </div>\n    <div id=\"siteTabBody\"><div class=\"skeleton skeleton-card\"></div></div>");
                    $("#backToClients").onclick = function () { return go("clients"); };
                    $$("[data-site-tab]").forEach(function (button) {
                        button.onclick = function () { return openSite(siteId, button.dataset.siteTab); };
                    });
                    body = $("#siteTabBody");
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 15, , 16]);
                    if (!(tab === "overview")) return [3 /*break*/, 4];
                    return [4 /*yield*/, siteOverviewTab(body, client)];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 14];
                case 4:
                    if (!(tab === "platforms")) return [3 /*break*/, 6];
                    return [4 /*yield*/, sitePlatformsTab(body, client)];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 14];
                case 6:
                    if (!(tab === "fields")) return [3 /*break*/, 8];
                    return [4 /*yield*/, siteFieldsTab(body, client)];
                case 7:
                    _a.sent();
                    return [3 /*break*/, 14];
                case 8:
                    if (!(tab === "members")) return [3 /*break*/, 10];
                    return [4 /*yield*/, siteMembersTab(body, client)];
                case 9:
                    _a.sent();
                    return [3 /*break*/, 14];
                case 10:
                    if (!(tab === "publications")) return [3 /*break*/, 12];
                    return [4 /*yield*/, sitePublicationsTab(body, client)];
                case 11:
                    _a.sent();
                    return [3 /*break*/, 14];
                case 12:
                    if (!(tab === "webhooks")) return [3 /*break*/, 14];
                    return [4 /*yield*/, siteWebhooksTab(body, client)];
                case 13:
                    _a.sent();
                    _a.label = 14;
                case 14: return [3 /*break*/, 16];
                case 15:
                    error_6 = _a.sent();
                    body.innerHTML = "<div class=\"state error\"><div class=\"state-icon\">\u26A0\uFE0F</div><p>".concat(esc(error_6.message), "</p></div>");
                    return [3 /*break*/, 16];
                case 16: return [2 /*return*/];
            }
        });
    });
}
function siteOverviewTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var toggle, rotate;
        var _this = this;
        return __generator(this, function (_a) {
            body.innerHTML = "\n    <section class=\"card\">\n      <dl class=\"kv\">\n        <dt>\u0622\u062F\u0631\u0633 \u0648\u0631\u062F\u067E\u0631\u0633</dt><dd class=\"mono\">".concat(esc(client.wordpress_url || "—"), "</dd>\n        <dt>\u0645\u0627\u0644\u06A9</dt><dd>").concat(esc(client.owner_display_name || client.owner_username || (client.owner_user_id ? "#".concat(client.owner_user_id) : "تعیین نشده")), "</dd>\n        <dt>\u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647</dt><dd>").concat(date(client.created_at), "</dd>\n        <dt>\u0622\u062E\u0631\u06CC\u0646 \u0627\u0646\u062A\u0634\u0627\u0631</dt><dd>").concat(ago(client.last_publication_at), "</dd>\n        <dt>\u0622\u062E\u0631\u06CC\u0646 \u0648\u0628\u0647\u0648\u06A9</dt><dd>").concat(ago(client.last_webhook_at), "</dd>\n      </dl>\n    </section>\n\n    <section class=\"card\">\n      <label class=\"check\">\n        <span><strong>\u0633\u0627\u06CC\u062A \u0641\u0639\u0627\u0644 \u0627\u0633\u062A</strong><br><span class=\"muted small\">\u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u06A9\u0631\u062F\u0646\u060C \u0627\u0646\u062A\u0634\u0627\u0631 \u0627\u0632 \u0627\u06CC\u0646 \u0633\u0627\u06CC\u062A \u0631\u0627 \u0641\u0648\u0631\u0627\u064B \u0645\u062A\u0648\u0642\u0641 \u0645\u06CC\u200C\u06A9\u0646\u062F.</span></span>\n        <span class=\"switch\">\n          <input type=\"checkbox\" id=\"siteEnabled\" ").concat(client.enabled ? "checked" : "", "\n                 ").concat(can("clients.disable") ? "" : "disabled", " aria-label=\"\u0641\u0639\u0627\u0644 \u0628\u0648\u062F\u0646 \u0633\u0627\u06CC\u062A\">\n          <span class=\"track\"></span>\n        </span>\n      </label>\n    </section>\n\n    ").concat(can("clients.rotate_secret") ? "<section class=\"card\">\n      <h3>\u0631\u0645\u0632 \u0648\u0628\u0647\u0648\u06A9</h3>\n      <p class=\"muted small\">\u0628\u0627\u0632\u062A\u0648\u0644\u06CC\u062F \u0631\u0645\u0632\u060C \u0627\u062A\u0635\u0627\u0644 \u0641\u0639\u0644\u06CC \u0627\u0641\u0632\u0648\u0646\u0647 \u0631\u0627 \u0642\u0637\u0639 \u0645\u06CC\u200C\u06A9\u0646\u062F \u062A\u0627 \u0631\u0645\u0632 \u062C\u062F\u06CC\u062F \u062F\u0631 \u0648\u0631\u062F\u067E\u0631\u0633 \u062B\u0628\u062A \u0634\u0648\u062F.</p>\n      <button class=\"btn danger\" id=\"rotateSecret\">\u0628\u0627\u0632\u062A\u0648\u0644\u06CC\u062F \u0631\u0645\u0632 \u0648\u0628\u0647\u0648\u06A9</button>\n    </section>" : "", "\n\n    ").concat(can("platforms.test") ? "<section class=\"card\">\n      <h3>\u0622\u0632\u0645\u0627\u06CC\u0634 \u0627\u062A\u0635\u0627\u0644</h3>\n      <p class=\"muted small\">\u0628\u0631\u0631\u0633\u06CC \u0645\u06CC\u200C\u06A9\u0646\u062F \u06A9\u0647 \u0631\u0628\u0627\u062A \u0628\u0647 \u06A9\u0627\u0646\u0627\u0644 \u06CC\u0627 \u0686\u062A \u062A\u0646\u0638\u06CC\u0645\u200C\u0634\u062F\u0647 \u062F\u0633\u062A\u0631\u0633\u06CC \u062F\u0627\u0631\u062F.</p>\n      <div class=\"row-actions\">\n        <button class=\"btn ghost\" data-test-platform=\"telegram\">\u062A\u0644\u06AF\u0631\u0627\u0645</button>\n        <button class=\"btn ghost\" data-test-platform=\"bale\">\u0628\u0644\u0647</button>\n        <button class=\"btn ghost\" data-test-platform=\"all\">\u0647\u0645\u0647</button>\n      </div>\n      <div id=\"testResult\" style=\"margin-top:var(--space-3)\"></div>\n    </section>" : "");
            toggle = $("#siteEnabled");
            if (toggle && can("clients.disable")) {
                toggle.onchange = function () { return __awaiter(_this, void 0, void 0, function () {
                    var error_7;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                toggle.disabled = true;
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, 4, 5]);
                                return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/enabled"), {
                                        method: "POST", body: JSON.stringify({ enabled: toggle.checked }),
                                    })];
                            case 2:
                                _a.sent();
                                toast(toggle.checked ? "سایت فعال شد" : "سایت غیرفعال شد");
                                return [3 /*break*/, 5];
                            case 3:
                                error_7 = _a.sent();
                                toggle.checked = !toggle.checked;
                                toast(error_7.message, "error");
                                return [3 /*break*/, 5];
                            case 4:
                                toggle.disabled = false;
                                return [7 /*endfinally*/];
                            case 5: return [2 /*return*/];
                        }
                    });
                }); };
            }
            rotate = $("#rotateSecret");
            if (rotate) {
                rotate.onclick = function () { return confirmModal({
                    title: "بازتولید رمز وبهوک",
                    lead: "رمز فعلی بلافاصله باطل می‌شود و افزونه وردپرس این سایت تا ثبت رمز جدید کار نخواهد کرد. رمز جدید فقط یک‌بار نمایش داده می‌شود.",
                    confirm: "بله، رمز را بازتولید کن",
                    onConfirm: function (values_1, _a) { return __awaiter(_this, [values_1, _a], void 0, function (values, _b) {
                        var result;
                        var close = _b.close;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/rotate-secret"), { method: "POST" })];
                                case 1:
                                    result = _c.sent();
                                    close();
                                    setTimeout(function () {
                                        var _a, _b;
                                        return credentialsModal({
                                            id: client.id,
                                            webhook_url: (_a = result.client) === null || _a === void 0 ? void 0 : _a.webhook_url,
                                            webhook_secret: (_b = result.client) === null || _b === void 0 ? void 0 : _b.webhook_secret,
                                        });
                                    }, 0);
                                    return [2 /*return*/, true];
                            }
                        });
                    }); },
                }); };
            }
            $$("[data-test-platform]").forEach(function (button) {
                button.onclick = function () { return __awaiter(_this, void 0, void 0, function () {
                    var target, result, path, response, items, error_8;
                    var _a;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                target = button.dataset.testPlatform;
                                result = $("#testResult");
                                result.innerHTML = '<div class="skeleton skeleton-line"></div>';
                                button.disabled = true;
                                _b.label = 1;
                            case 1:
                                _b.trys.push([1, 3, 4, 5]);
                                path = target === "all"
                                    ? "/clients/".concat(encodeURIComponent(client.id), "/test")
                                    : "/clients/".concat(encodeURIComponent(client.id), "/test/").concat(target);
                                return [4 /*yield*/, adminApi(path, { method: "POST", body: JSON.stringify({ mode: "check" }) })];
                            case 2:
                                response = _b.sent();
                                items = ((_a = response.test) === null || _a === void 0 ? void 0 : _a.results) || [response.test];
                                result.innerHTML = items.map(function (item) { return "\n          <div class=\"record\" style=\"margin:0 0 var(--space-2)\">\n            <div class=\"record-main\">\n              <span>".concat(esc(item.platform || target), "</span>\n              <span class=\"chip ").concat(item.ok ? "ok" : "bad", "\">").concat(item.ok ? "متصل" : esc(item.error || "ناموفق"), "</span>\n            </div>\n          </div>"); }).join("");
                                return [3 /*break*/, 5];
                            case 3:
                                error_8 = _b.sent();
                                result.innerHTML = "<div class=\"notice danger\">".concat(esc(error_8.message), "</div>");
                                return [3 /*break*/, 5];
                            case 4:
                                button.disabled = false;
                                return [7 /*endfinally*/];
                            case 5: return [2 /*return*/];
                        }
                    });
                }); };
            });
            return [2 /*return*/];
        });
    });
}
function sitePlatformsTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var row, edit;
        var _this = this;
        return __generator(this, function (_a) {
            row = function (label, value, hint) { return "\n    <div class=\"record\" style=\"margin-bottom:var(--space-2)\">\n      <div>\n        <div class=\"record-main\">\n          <div>\n            <div class=\"record-title\">".concat(esc(label), "</div>\n            <div class=\"record-meta\"><span class=\"mono\">").concat(esc(value || "تنظیم نشده"), "</span></div>\n          </div>\n          <span class=\"chip ").concat(value ? "ok" : "", "\">").concat(value ? "تنظیم شده" : "خالی", "</span>\n        </div>\n        <p class=\"muted small\" style=\"margin:var(--space-2) 0 0\">").concat(esc(hint), "</p>\n      </div>\n    </div>"); };
            body.innerHTML = "\n    ".concat(row("کانال تلگرام", client.telegram_channel_id, "شناسه یا نام کاربری کانالی که آگهی‌ها در آن منتشر می‌شود."), "\n    ").concat(row("چت بله", client.bale_chat_id, "شناسه عددی چت یا کانال بله."), "\n    ").concat(row("واتساپ", client.whatsapp_target, "در صورت فعال بودن سرویس واتساپ."), "\n    <div class=\"notice\">\u062A\u0648\u06A9\u0646\u200C\u0647\u0627 \u0648 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0648\u0631\u0648\u062F \u067E\u0644\u062A\u0641\u0631\u0645\u200C\u0647\u0627 \u0641\u0642\u0637 \u062F\u0631 \u0633\u0631\u0648\u0631 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0645\u06CC\u200C\u0634\u0648\u0646\u062F \u0648 \u0647\u0631\u06AF\u0632 \u062F\u0631 \u0627\u06CC\u0646 \u067E\u0646\u0644 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0646\u0645\u06CC\u200C\u0634\u0648\u0646\u062F.</div>\n    ").concat(can("clients.update") ? '<button class="btn" id="editTargets">ویرایش مقصدها</button>' : "");
            edit = $("#editTargets");
            if (edit) {
                edit.onclick = function () { return modal({
                    title: "مقصدهای انتشار",
                    lead: "خالی گذاشتن هر کادر، انتشار روی آن پلتفرم را متوقف می‌کند.",
                    fields: [
                        { name: "telegram_channel_id", label: "کانال تلگرام", value: client.telegram_channel_id || "" },
                        { name: "bale_chat_id", label: "چت بله", value: client.bale_chat_id || "" },
                    ],
                    confirm: "ذخیره",
                    onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id)), {
                                        method: "PATCH",
                                        body: JSON.stringify({
                                            telegram_channel_id: String(values.telegram_channel_id || "").trim(),
                                            bale_chat_id: String(values.bale_chat_id || "").trim(),
                                        }),
                                    })];
                                case 1:
                                    _a.sent();
                                    toast("مقصدها ذخیره شد");
                                    return [4 /*yield*/, openSite(client.id, "platforms")];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); },
                }); };
            }
            return [2 /*return*/];
        });
    });
}
function siteFieldsTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var data, list, editable;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/fields"))];
                case 1:
                    data = _a.sent();
                    list = data.fields || [];
                    editable = can("fields.manage");
                    body.innerHTML = list.length
                        ? "<p class=\"muted small\">\u0641\u0647\u0631\u0633\u062A \u0627\u0632 \u0627\u0641\u0632\u0648\u0646\u0647 \u0648\u0631\u062F\u067E\u0631\u0633 \u0645\u06CC\u200C\u0622\u06CC\u062F. \u062A\u063A\u06CC\u06CC\u0631\u0627\u062A \u0627\u06CC\u0646\u200C\u062C\u0627 \u0628\u0627 \u0627\u0646\u062A\u0634\u0627\u0631 \u0628\u0639\u062F\u06CC \u0628\u0627\u0632\u0646\u0648\u06CC\u0633\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F.</p>\n       ".concat(list.map(function (field, index) { return fieldRow(field, index, list.length, editable); }).join(""))
                        : emptyState("🧩", "فیلدی دریافت نشده", "پس از اولین انتشار از وردپرس، فیلدها این‌جا فهرست می‌شوند.");
                    if (!editable)
                        return [2 /*return*/];
                    wireFieldControls(client.id, list, function () { return openSite(client.id, "fields"); });
                    return [2 /*return*/];
            }
        });
    });
}
/** Shared by the customer field screen and the admin site tab. */
function wireFieldControls(siteId, list, refresh) {
    var _this = this;
    $$("[data-field-platform]").forEach(function (input) {
        input.onchange = function () { return __awaiter(_this, void 0, void 0, function () {
            var error_9;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        input.disabled = true;
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(siteId), "/fields/").concat(encodeURIComponent(input.dataset.fieldKey)), {
                                method: "PATCH", body: JSON.stringify({ platforms: (_a = {}, _a[input.dataset.fieldPlatform] = input.checked, _a) }),
                            })];
                    case 2:
                        _b.sent();
                        toast("بروزرسانی شد");
                        return [3 /*break*/, 5];
                    case 3:
                        error_9 = _b.sent();
                        input.checked = !input.checked;
                        toast(error_9.message, "error");
                        return [3 /*break*/, 5];
                    case 4:
                        input.disabled = false;
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        }); };
    });
    $$("[data-field-hidden]").forEach(function (input) {
        input.onchange = function () { return __awaiter(_this, void 0, void 0, function () {
            var error_10;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        input.disabled = true;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(siteId), "/fields/").concat(encodeURIComponent(input.dataset.fieldHidden)), {
                                method: "PATCH", body: JSON.stringify({ hidden: input.checked }),
                            })];
                    case 2:
                        _a.sent();
                        toast(input.checked ? "فیلد پنهان شد" : "فیلد نمایش داده می‌شود");
                        return [4 /*yield*/, refresh()];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_10 = _a.sent();
                        input.checked = !input.checked;
                        input.disabled = false;
                        toast(error_10.message, "error");
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        }); };
    });
    $$("[data-field-label]").forEach(function (button) {
        button.onclick = function () { return modal({
            title: "نام نمایشی فیلد",
            lead: "\u0627\u0641\u0632\u0648\u0646\u0647 \u0648\u0631\u062F\u067E\u0631\u0633 \u0627\u06CC\u0646 \u0641\u06CC\u0644\u062F \u0631\u0627 \u00AB".concat(button.dataset.pluginLabel, "\u00BB \u0645\u06CC\u200C\u0646\u0627\u0645\u062F. \u0628\u0631\u0627\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0622\u0646\u060C \u06A9\u0627\u062F\u0631 \u0631\u0627 \u062E\u0627\u0644\u06CC \u0628\u06AF\u0630\u0627\u0631\u06CC\u062F."),
            fields: [{ name: "label", label: "نام نمایشی", value: button.dataset.currentLabel, placeholder: button.dataset.pluginLabel }],
            confirm: "ذخیره",
            onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                var label;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            label = String(values.label || "").trim();
                            return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(siteId), "/fields/").concat(encodeURIComponent(button.dataset.fieldLabel)), {
                                    method: "PATCH", body: JSON.stringify({ label_override: label || null }),
                                })];
                        case 1:
                            _a.sent();
                            toast(label ? "ذخیره شد" : "به نام افزونه بازگشت");
                            return [4 /*yield*/, refresh()];
                        case 2:
                            _a.sent();
                            return [2 /*return*/];
                    }
                });
            }); },
        }); };
    });
    $$("[data-field-move]").forEach(function (button) {
        button.onclick = function () { return __awaiter(_this, void 0, void 0, function () {
            var order, from, to, error_11;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        order = list.map(function (field) { return field.field_key; });
                        from = order.indexOf(button.dataset.fieldMove);
                        to = from + Number(button.dataset.direction);
                        if (from < 0 || to < 0 || to >= order.length)
                            return [2 /*return*/];
                        order.splice(to, 0, order.splice(from, 1)[0]);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(siteId), "/fields/reorder"), {
                                method: "POST", body: JSON.stringify({ order: order }),
                            })];
                    case 2:
                        _a.sent();
                        haptic();
                        return [4 /*yield*/, refresh()];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_11 = _a.sent();
                        toast(error_11.message, "error");
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        }); };
    });
}
function siteMembersTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var data, manage, refresh, add;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/members"))];
                case 1:
                    data = _a.sent();
                    manage = can("clients.update");
                    body.innerHTML = "\n    ".concat(manage ? '<button class="btn block" id="adminAddMember" style="margin-bottom:var(--space-3)">+ افزودن عضو با شناسه</button>' : "", "\n    ").concat(data.owner ? memberRow(data.owner, { manage: false }) : '<div class="notice warn">مالکی برای این سایت تعیین نشده است.</div>', "\n    ").concat(data.members.length ? data.members.map(function (member) { return memberRow(member, { manage: manage }); }).join("")
                        : emptyState("👤", "عضو دیگری ثبت نشده"));
                    refresh = function () { return openSite(client.id, "members"); };
                    add = $("#adminAddMember");
                    if (add) {
                        add.onclick = function () { return modal({
                            title: "افزودن عضو",
                            lead: "کاربر باید قبلاً ربات جارچی را استارت کرده باشد تا شناسه او شناخته شود.",
                            fields: [
                                { name: "platform", label: "پلتفرم", type: "select", value: "telegram",
                                    options: [{ value: "telegram", label: "تلگرام" }, { value: "bale", label: "بله" }] },
                                { name: "platform_user_id", label: "شناسه عددی", required: true, inputMode: "numeric" },
                                { name: "role", label: "نقش", type: "select", value: "support",
                                    options: [{ value: "support", label: "پشتیبان" }, { value: "admin", label: "مدیر سایت" }] },
                            ],
                            confirm: "افزودن",
                            onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/members"), {
                                                method: "POST",
                                                body: JSON.stringify({
                                                    platform: values.platform,
                                                    platform_user_id: String(values.platform_user_id || "").trim(),
                                                    role: values.role,
                                                }),
                                            })];
                                        case 1:
                                            _a.sent();
                                            toast("عضو اضافه شد");
                                            return [4 /*yield*/, refresh()];
                                        case 2:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); },
                        }); };
                    }
                    $$("[data-member-role]").forEach(function (button) {
                        button.onclick = function () { return modal({
                            title: "تغییر نقش",
                            fields: [{ name: "role", label: "نقش جدید", type: "select", value: button.dataset.currentRole,
                                    options: [{ value: "support", label: "پشتیبان" }, { value: "admin", label: "مدیر سایت" }] }],
                            confirm: "ذخیره",
                            onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/members/").concat(encodeURIComponent(button.dataset.memberRole)), {
                                                method: "PATCH", body: JSON.stringify({ role: values.role }),
                                            })];
                                        case 1:
                                            _a.sent();
                                            toast("نقش بروزرسانی شد");
                                            return [4 /*yield*/, refresh()];
                                        case 2:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); },
                        }); };
                    });
                    $$("[data-member-remove]").forEach(function (button) {
                        button.onclick = function () { return confirmModal({
                            title: "حذف دسترسی",
                            lead: "".concat(button.dataset.memberName || "این کاربر", " \u067E\u0633 \u0627\u0632 \u062D\u0630\u0641 \u062F\u06CC\u06AF\u0631 \u0628\u0647 \u0627\u06CC\u0646 \u0633\u0627\u06CC\u062A \u062F\u0633\u062A\u0631\u0633\u06CC \u0646\u062E\u0648\u0627\u0647\u062F \u062F\u0627\u0634\u062A."),
                            confirm: "حذف",
                            onConfirm: function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/members/").concat(encodeURIComponent(button.dataset.memberRemove)), { method: "DELETE" })];
                                        case 1:
                                            _a.sent();
                                            toast("دسترسی حذف شد");
                                            return [4 /*yield*/, refresh()];
                                        case 2:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); },
                        }); };
                    });
                    return [2 /*return*/];
            }
        });
    });
}
function sitePublicationsTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var data, items;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/publications?page_size=25"))];
                case 1:
                    data = _a.sent();
                    items = data.items || data.publications || [];
                    body.innerHTML = items.length ? items.map(function (item) { return "\n    <article class=\"record\">\n      <div>\n        <div class=\"record-main\">\n          <div>\n            <div class=\"record-title\">".concat(esc(item.title || "\u067E\u0633\u062A ".concat(item.post_id)), "</div>\n            <div class=\"record-meta\">\n              <span>").concat(esc(item.platform), "</span>\n              <span>").concat(ago(item.created_at), "</span>\n            </div>\n          </div>\n          <span class=\"chip ").concat(item.status === "published" ? "ok" : item.status === "failed" ? "bad" : "warn", "\">").concat(esc(item.status), "</span>\n        </div>\n        ").concat(item.error ? "<p class=\"muted small\" style=\"margin:var(--space-2) 0 0\">".concat(esc(item.error), "</p>") : "", "\n      </div>\n    </article>"); }).join("") : emptyState("📢", "هنوز انتشاری ثبت نشده");
                    return [2 /*return*/];
            }
        });
    });
}
function siteWebhooksTab(body, client) {
    return __awaiter(this, void 0, void 0, function () {
        var data, items;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, adminApi("/clients/".concat(encodeURIComponent(client.id), "/webhooks?page_size=25"))];
                case 1:
                    data = _a.sent();
                    items = data.items || data.events || [];
                    body.innerHTML = items.length ? items.map(function (item) {
                        var _a;
                        return "\n    <article class=\"record\">\n      <div>\n        <div class=\"record-main\">\n          <div>\n            <div class=\"record-title\">".concat(esc(item.event_type || "webhook"), "</div>\n            <div class=\"record-meta\">\n              <span>").concat(ago(item.created_at), "</span>\n              ").concat(item.post_id ? "<span class=\"mono\">#".concat(esc(item.post_id), "</span>") : "", "\n              ").concat(item.auth_result ? "<span>".concat(esc(item.auth_result), "</span>") : "", "\n              ").concat(item.duration_ms ? "<span>".concat(n(item.duration_ms), "ms</span>") : "", "\n            </div>\n          </div>\n          <span class=\"chip ").concat(Number(item.http_status) < 400 ? "ok" : "bad", "\">").concat(esc((_a = item.http_status) !== null && _a !== void 0 ? _a : "—"), "</span>\n        </div>\n        ").concat(item.error ? "<p class=\"muted small\" style=\"margin:var(--space-2) 0 0\">".concat(esc(item.error), "</p>") : "", "\n      </div>\n    </article>");
                    }).join("") : emptyState("🔗", "رویداد وبهوکی ثبت نشده");
                    return [2 /*return*/];
            }
        });
    });
}
/* ------------------------------ quick assign ------------------------------ */
/*
 * Grants a person access to a site by the id an operator actually has in front
 * of them. The lookup runs before anything is granted, so the confirmation says
 * who is about to receive access rather than just echoing a number back.
 */
SCREENS.assign = function assign() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, sitesResult, recent;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    skeleton(2);
                    return [4 /*yield*/, Promise.all([
                            adminApi("/clients?page_size=100"),
                            adminApi("/clients/assignments?limit=10").catch(function () { return ({ assignments: [] }); }),
                        ])];
                case 1:
                    _a = __read.apply(void 0, [_b.sent(), 2]), sitesResult = _a[0], recent = _a[1];
                    state.adminSites = sitesResult.clients || sitesResult.items || [];
                    state.assignments = recent.assignments || [];
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow\">\u0645\u062F\u06CC\u0631\u06CC\u062A</span>\n        <h2>\u0627\u0639\u0637\u0627\u06CC \u062F\u0633\u062A\u0631\u0633\u06CC \u0633\u0631\u06CC\u0639</h2>\n        <p class=\"muted small\">\u0628\u0627 \u0634\u0646\u0627\u0633\u0647 \u062A\u0644\u06AF\u0631\u0627\u0645 \u06CC\u0627 \u0628\u0644\u0647\u060C \u0628\u0647 \u06CC\u06A9 \u0646\u0641\u0631 \u0631\u0648\u06CC \u06CC\u06A9 \u0633\u0627\u06CC\u062A \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u062F\u0647\u06CC\u062F.</p>\n      </div>\n    </div>\n\n    <section class=\"card\">\n      <form id=\"assignForm\">\n        <label class=\"field\"><span>\u067E\u0644\u062A\u0641\u0631\u0645</span>\n          <select name=\"platform\">\n            <option value=\"telegram\">\u062A\u0644\u06AF\u0631\u0627\u0645</option>\n            <option value=\"bale\">\u0628\u0644\u0647</option>\n          </select>\n        </label>\n        <label class=\"field\"><span>\u0634\u0646\u0627\u0633\u0647 \u0639\u062F\u062F\u06CC \u06A9\u0627\u0631\u0628\u0631</span>\n          <input name=\"platform_user_id\" inputmode=\"numeric\" required placeholder=\"\u0645\u062B\u0644\u0627\u064B \u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9\">\n        </label>\n        <label class=\"field\"><span>\u0633\u0627\u06CC\u062A</span>\n          <select name=\"site_id\" required>\n            <option value=\"\">\u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F\u2026</option>\n            ".concat(state.adminSites.map(function (site) { return "<option value=\"".concat(esc(site.id), "\">").concat(esc(site.name || site.id), "</option>"); }).join(""), "\n          </select>\n        </label>\n        <label class=\"field\"><span>\u0646\u0642\u0634</span>\n          <select name=\"role\" required>\n            <option value=\"support\">\u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u2014 \u06A9\u0627\u0631 \u0631\u0648\u06CC \u0633\u0627\u06CC\u062A</option>\n            <option value=\"admin\">\u0645\u062F\u06CC\u0631 \u2014 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0639\u0636\u0627 \u0647\u0645 \u062F\u0627\u0631\u062F</option>\n            <option value=\"owner\">\u0645\u0627\u0644\u06A9 \u2014 \u0627\u0646\u062A\u0642\u0627\u0644 \u0645\u0627\u0644\u06A9\u06CC\u062A \u0633\u0627\u06CC\u062A</option>\n          </select>\n        </label>\n        <button class=\"btn block\" type=\"submit\">\u0628\u0631\u0631\u0633\u06CC \u0648 \u0627\u0639\u0637\u0627\u06CC \u062F\u0633\u062A\u0631\u0633\u06CC</button>\n      </form>\n    </section>\n\n    <section>\n      <h3 style=\"margin-bottom:var(--space-3)\">\u06F1\u06F0 \u062A\u063A\u06CC\u06CC\u0631 \u062F\u0633\u062A\u0631\u0633\u06CC \u0627\u062E\u06CC\u0631</h3>\n      ").concat(state.assignments.length
                        ? state.assignments.map(assignmentRow).join("")
                        : emptyState("🔑", "هنوز دسترسی‌ای ثبت نشده"), "\n    </section>");
                    $("#assignForm").onsubmit = function (event) { return __awaiter(_this, void 0, void 0, function () {
                        var submit, values, platformUserId, found, site, person, error_12;
                        var _this = this;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    event.preventDefault();
                                    submit = event.target.querySelector('button[type="submit"]');
                                    values = Object.fromEntries(new FormData(event.target).entries());
                                    platformUserId = String(values.platform_user_id || "").trim();
                                    submit.disabled = true;
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, 4, 5]);
                                    return [4 /*yield*/, adminApi("/clients/lookup/".concat(values.platform, "/").concat(encodeURIComponent(platformUserId)))];
                                case 2:
                                    found = _a.sent();
                                    site = state.adminSites.find(function (item) { return item.id === values.site_id; });
                                    person = found.user.display_name || found.user.username || "\u06A9\u0627\u0631\u0628\u0631 ".concat(found.user.id);
                                    confirmModal({
                                        title: "تایید اعطای دسترسی",
                                        lead: values.role === "owner"
                                            ? "\u0645\u0627\u0644\u06A9\u06CC\u062A \u00AB".concat((site === null || site === void 0 ? void 0 : site.name) || values.site_id, "\u00BB \u0628\u0647 ").concat(person, " \u0645\u0646\u062A\u0642\u0644 \u0645\u06CC\u200C\u0634\u0648\u062F. \u0645\u0627\u0644\u06A9 \u0641\u0639\u0644\u06CC \u0628\u0647\u200C\u0639\u0646\u0648\u0627\u0646 \u0645\u062F\u06CC\u0631 \u0633\u0627\u06CC\u062A \u0628\u0627\u0642\u06CC \u0645\u06CC\u200C\u0645\u0627\u0646\u062F.")
                                            : "".concat(person, " \u0628\u0627 \u0646\u0642\u0634 \u00AB").concat(roleLabel(values.role), "\u00BB \u0628\u0647 \u00AB").concat((site === null || site === void 0 ? void 0 : site.name) || values.site_id, "\u00BB \u0627\u0636\u0627\u0641\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F."),
                                        confirm: "اعطای دسترسی",
                                        tone: values.role === "owner" ? "danger" : "",
                                        onConfirm: function () { return __awaiter(_this, void 0, void 0, function () {
                                            return __generator(this, function (_a) {
                                                switch (_a.label) {
                                                    case 0: return [4 /*yield*/, adminApi("/clients/assign", {
                                                            method: "POST",
                                                            body: JSON.stringify({
                                                                platform: values.platform,
                                                                platform_user_id: platformUserId,
                                                                site_id: values.site_id,
                                                                role: values.role,
                                                            }),
                                                        })];
                                                    case 1:
                                                        _a.sent();
                                                        haptic("medium");
                                                        toast("دسترسی اعطا شد");
                                                        return [4 /*yield*/, go("assign")];
                                                    case 2:
                                                        _a.sent();
                                                        return [2 /*return*/];
                                                }
                                            });
                                        }); },
                                    });
                                    return [3 /*break*/, 5];
                                case 3:
                                    error_12 = _a.sent();
                                    // "has not started the bot" is the common case and is already phrased
                                    // as an instruction by the server, so it is shown as-is.
                                    toast(error_12.message, "error");
                                    return [3 /*break*/, 5];
                                case 4:
                                    submit.disabled = false;
                                    return [7 /*endfinally*/];
                                case 5: return [2 /*return*/];
                            }
                        });
                    }); };
                    return [2 /*return*/];
            }
        });
    });
};
var ASSIGNMENT_LABELS = {
    "site.role.assign": "اعطای دسترسی",
    "site.member.add": "افزودن عضو",
    "site.member.role": "تغییر نقش",
    "site.member.remove": "حذف دسترسی",
};
function assignmentRow(entry) {
    var meta = entry.metadata || {};
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(ASSIGNMENT_LABELS[entry.action] || entry.action), "</div>\n          <div class=\"record-meta\">\n            <span>").concat(esc(entry.site_name || entry.site_id), "</span>\n            ").concat(meta.user_id ? "<span class=\"mono\">#".concat(esc(meta.user_id), "</span>") : "", "\n            <span>").concat(ago(entry.created_at), "</span>\n          </div>\n        </div>\n        ").concat(meta.role ? "<span class=\"chip ".concat(entry.success === false ? "bad" : "brand", "\">").concat(esc(roleLabel(meta.role)), "</span>") : "", "\n      </div>\n      ").concat(entry.actor_label ? "<div class=\"record-meta\"><span class=\"muted\">\u062A\u0648\u0633\u0637 ".concat(esc(entry.actor_label), "</span></div>") : "", "\n    </div>\n  </article>");
}
/* ------------------------------ AI products ------------------------------- */
/*
 * The AI product workflow from 2.1.x, in the new shell. The backend contract is
 * unchanged: a draft is created, jobs run asynchronously, and the draft is
 * approved before it can be published to WooCommerce.
 */
var PRODUCT_STATUS = {
    draft: "پیش‌نویس", generating: "در حال تولید", ready: "آماده بررسی",
    approved: "تایید شده", rejected: "رد شده", published: "منتشر شده", failed: "ناموفق",
};
var productStatus = function (status) { return PRODUCT_STATUS[String(status || "").toLowerCase()] || String(status || "—"); };
SCREENS.products = function products() {
    return __awaiter(this, void 0, void 0, function () {
        var site, _a, data, status, list, available, create;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    site = state.currentSite;
                    if (!site) {
                        $("#content").innerHTML = emptyState("🤖", "ابتدا یک سایت انتخاب کنید");
                        return [2 /*return*/];
                    }
                    skeleton(3);
                    return [4 /*yield*/, Promise.all([
                            nativeApi("/ai/products?site_id=".concat(encodeURIComponent(site.id), "&page_size=30")),
                            nativeApi("/ai/status").catch(function () { return ({ ai: { available: false } }); }),
                        ])];
                case 1:
                    _a = __read.apply(void 0, [_c.sent(), 2]), data = _a[0], status = _a[1];
                    list = data.products || [];
                    available = ((_b = status.ai) === null || _b === void 0 ? void 0 : _b.available) !== false;
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow\">".concat(esc(site.name || site.id), "</span>\n        <h2>\u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0647\u0648\u0634\u0645\u0646\u062F</h2>\n        <p class=\"muted small\">\u062A\u0648\u0644\u06CC\u062F \u0645\u062D\u062A\u0648\u0627\u060C \u0633\u0626\u0648\u060C \u062A\u0635\u0648\u06CC\u0631 \u0648 \u0627\u0646\u062A\u0634\u0627\u0631 \u062F\u0631 \u0648\u0648\u06A9\u0627\u0645\u0631\u0633.</p>\n      </div>\n      ").concat(available ? '<button class="btn" id="newProduct">+ محصول جدید</button>' : "", "\n    </div>\n\n    ").concat(available ? "" : '<div class="notice warn">سرویس هوش مصنوعی در این نصب فعال نیست. محصولات موجود قابل مشاهده‌اند اما تولید تازه انجام نمی‌شود.</div>', "\n\n    ").concat(list.length ? list.map(productCard).join("")
                        : emptyState("🤖", "هنوز محصولی نساخته‌اید", "با «محصول جدید» شروع کنید؛ توضیح کوتاه کافی است."));
                    create = $("#newProduct");
                    if (create)
                        create.onclick = function () { return newProductModal(site.id); };
                    $$("[data-open-product]").forEach(function (button) {
                        button.onclick = function () { return openProduct(button.dataset.openProduct); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function productCard(product) {
    var status = String(product.status || "draft").toLowerCase();
    var tone = status === "published" || status === "approved" ? "ok"
        : status === "failed" || status === "rejected" ? "bad"
            : status === "generating" ? "warn" : "";
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(product.title || "محصول بدون عنوان"), "</div>\n          <div class=\"record-meta\">\n            <span>").concat(ago(product.updated_at || product.created_at), "</span>\n            ").concat(product.price ? "<span>".concat(n(product.price), " \u062A\u0648\u0645\u0627\u0646</span>") : "", "\n          </div>\n        </div>\n        <span class=\"chip ").concat(tone, "\">").concat(esc(productStatus(status)), "</span>\n      </div>\n      ").concat(product.short_description || product.description
        ? "<p class=\"muted small\" style=\"margin:var(--space-2) 0 0\">".concat(esc(String(product.short_description || product.description).slice(0, 140)), "</p>")
        : "", "\n    </div>\n    <div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-open-product=\"").concat(esc(product.id), "\">\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646</button>\n    </div>\n  </article>");
}
function newProductModal(siteId) {
    var _this = this;
    modal({
        title: "محصول جدید",
        lead: "یک نام و توضیح کوتاه کافی است؛ بقیه محتوا تولید می‌شود.",
        fields: [
            { name: "title", label: "نام محصول", required: true },
            { name: "description", label: "توضیح کوتاه", type: "textarea", placeholder: "مثلاً کتری برقی ۱.۷ لیتری با بدنه استیل" },
            { name: "price", label: "قیمت (تومان)", inputMode: "numeric" },
            { name: "generate", label: "همین حالا محتوا تولید شود", type: "checkbox", value: true },
        ],
        confirm: "ایجاد",
        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
            var result;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, nativeApi("/ai/products", {
                            method: "POST",
                            // A retried submit must not create a second draft.
                            headers: { "Idempotency-Key": crypto.randomUUID() },
                            body: JSON.stringify({
                                site_id: siteId,
                                input: { title: values.title, description: values.description, price: values.price },
                                generate: values.generate === true,
                            }),
                        })];
                    case 1:
                        result = _b.sent();
                        toast("محصول ایجاد شد");
                        if (!((_a = result.product) === null || _a === void 0 ? void 0 : _a.id)) return [3 /*break*/, 3];
                        return [4 /*yield*/, openProduct(result.product.id)];
                    case 2:
                        _b.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, go("products")];
                    case 4:
                        _b.sent();
                        _b.label = 5;
                    case 5: return [2 /*return*/];
                }
            });
        }); },
    });
}
function openProduct(id) {
    return __awaiter(this, void 0, void 0, function () {
        var result, product, job, queue;
        var _this = this;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/ai/products/".concat(encodeURIComponent(id)))];
                case 1:
                    result = _b.sent();
                    product = result.product;
                    job = result.job;
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow mono\">#".concat(esc(product.id), "</span>\n        <h2>").concat(esc(product.title || "بدون عنوان"), "</h2>\n      </div>\n      <button class=\"btn ghost small\" id=\"backProducts\">\u0628\u0627\u0632\u06AF\u0634\u062A</button>\n    </div>\n\n    <div class=\"chips\" style=\"margin-bottom:var(--space-3)\">\n      <span class=\"chip\">").concat(esc(productStatus(product.status)), "</span>\n      ").concat(product.version ? "<span class=\"chip\">\u0646\u0633\u062E\u0647 ".concat(n(product.version), "</span>") : "", "\n      ").concat(product.wc_product_id ? "<span class=\"chip ok\">\u0648\u0648\u06A9\u0627\u0645\u0631\u0633 #".concat(esc(product.wc_product_id), "</span>") : '<span class="chip">منتشر نشده</span>', "\n      ").concat(job && ["queued", "running"].includes(job.status) ? '<span class="chip warn">کار AI در حال اجرا</span>' : "", "\n    </div>\n\n    <section class=\"card\">\n      <label class=\"field\"><span>\u0639\u0646\u0648\u0627\u0646</span><input id=\"pTitle\" value=\"").concat(esc(product.title || ""), "\"></label>\n      <label class=\"field\"><span>\u0642\u06CC\u0645\u062A</span><input id=\"pPrice\" inputmode=\"numeric\" value=\"").concat(esc((_a = product.price) !== null && _a !== void 0 ? _a : ""), "\"></label>\n      <label class=\"field\"><span>\u062A\u0648\u0636\u06CC\u062D\u0627\u062A</span><textarea id=\"pDesc\" rows=\"6\">").concat(esc(product.description || ""), "</textarea></label>\n      <label class=\"field\"><span>\u0639\u0646\u0648\u0627\u0646 \u0633\u0626\u0648</span><input id=\"pSeoTitle\" value=\"").concat(esc(product.seo_title || ""), "\"></label>\n      <label class=\"field\"><span>\u062A\u0648\u0636\u06CC\u062D \u0645\u062A\u0627</span><textarea id=\"pMeta\" rows=\"3\">").concat(esc(product.meta_description || ""), "</textarea></label>\n      <label class=\"field\"><span>\u0628\u0631\u0686\u0633\u0628\u200C\u0647\u0627 (\u0628\u0627 \u0648\u06CC\u0631\u06AF\u0648\u0644)</span><input id=\"pTags\" value=\"").concat(esc((product.tags || []).join("، ")), "\"></label>\n      <button class=\"btn block\" id=\"saveProduct\">\u0630\u062E\u06CC\u0631\u0647 \u062A\u063A\u06CC\u06CC\u0631\u0627\u062A</button>\n    </section>\n\n    <section class=\"card\">\n      <h3>\u0639\u0645\u0644\u06CC\u0627\u062A</h3>\n      <div class=\"row-actions\" style=\"margin-top:var(--space-3)\">\n        <button class=\"btn ghost\" id=\"regen\">\u062A\u0648\u0644\u06CC\u062F \u0645\u062C\u062F\u062F \u0645\u062D\u062A\u0648\u0627</button>\n        <button class=\"btn ghost\" id=\"genImage\">\u0633\u0627\u062E\u062A \u062A\u0635\u0648\u06CC\u0631</button>\n        ").concat(product.status === "approved" || product.status === "published" ? "" : '<button class="btn" id="approve">تایید</button>', "\n        ").concat(product.status === "approved" ? '<button class="btn" id="publish">انتشار در ووکامرس</button>' : "", "\n      </div>\n    </section>");
                    $("#backProducts").onclick = function () { return go("products"); };
                    $("#saveProduct").onclick = function (event) { return __awaiter(_this, void 0, void 0, function () {
                        var error_13;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    event.target.disabled = true;
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, 4, 5]);
                                    return [4 /*yield*/, nativeApi("/ai/products/".concat(encodeURIComponent(id)), {
                                            method: "PATCH",
                                            body: JSON.stringify({
                                                title: $("#pTitle").value,
                                                price: $("#pPrice").value,
                                                description: $("#pDesc").value,
                                                seo_title: $("#pSeoTitle").value,
                                                meta_description: $("#pMeta").value,
                                                tags: $("#pTags").value.split(/[،,]/).map(function (tag) { return tag.trim(); }).filter(Boolean),
                                            }),
                                        })];
                                case 2:
                                    _a.sent();
                                    toast("ذخیره شد");
                                    return [3 /*break*/, 5];
                                case 3:
                                    error_13 = _a.sent();
                                    toast(error_13.message, "error");
                                    return [3 /*break*/, 5];
                                case 4:
                                    event.target.disabled = false;
                                    return [7 /*endfinally*/];
                                case 5: return [2 /*return*/];
                            }
                        });
                    }); };
                    queue = function (path, body, message) { return function (event) { return __awaiter(_this, void 0, void 0, function () {
                        var error_14;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    event.target.disabled = true;
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 4, , 5]);
                                    return [4 /*yield*/, nativeApi("/ai/products/".concat(encodeURIComponent(id), "/").concat(path), { method: "POST", body: JSON.stringify(body) })];
                                case 2:
                                    _a.sent();
                                    toast(message);
                                    return [4 /*yield*/, pollJob(id)];
                                case 3:
                                    _a.sent();
                                    return [3 /*break*/, 5];
                                case 4:
                                    error_14 = _a.sent();
                                    toast(error_14.message, "error");
                                    event.target.disabled = false;
                                    return [3 /*break*/, 5];
                                case 5: return [2 /*return*/];
                            }
                        });
                    }); }; };
                    $("#regen").onclick = queue("regenerate", { section: "content" }, "درخواست در صف قرار گرفت");
                    $("#genImage").onclick = queue("images/generate", { purpose: "product" }, "تولید تصویر در صف قرار گرفت");
                    if ($("#approve"))
                        $("#approve").onclick = queue("approve", {}, "تایید شد");
                    if ($("#publish"))
                        $("#publish").onclick = queue("publish", {}, "انتشار آغاز شد");
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Waits for an async AI job to settle.
 *
 * Bounded on purpose: a job that has not finished within this window is still
 * running server-side, so the screen says so rather than spinning forever.
 */
function pollJob(id) {
    return __awaiter(this, void 0, void 0, function () {
        var attempt, result, status;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    attempt = 0;
                    _b.label = 1;
                case 1:
                    if (!(attempt < 30)) return [3 /*break*/, 6];
                    return [4 /*yield*/, new Promise(function (resolve) { setTimeout(resolve, 2000); })];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, nativeApi("/ai/products/".concat(encodeURIComponent(id))).catch(function () { return null; })];
                case 3:
                    result = _b.sent();
                    status = (_a = result === null || result === void 0 ? void 0 : result.job) === null || _a === void 0 ? void 0 : _a.status;
                    if (!["succeeded", "failed", "cancelled"].includes(status)) return [3 /*break*/, 5];
                    toast(status === "succeeded" ? "کار هوش مصنوعی انجام شد" : "اجرای هوش مصنوعی پایان یافت", status === "succeeded" ? "ok" : "error");
                    return [4 /*yield*/, openProduct(id)];
                case 4:
                    _b.sent();
                    return [2 /*return*/];
                case 5:
                    attempt += 1;
                    return [3 /*break*/, 1];
                case 6:
                    toast("کار هنوز در حال اجراست؛ بعداً دوباره باز کنید", "warn");
                    return [4 /*yield*/, openProduct(id)];
                case 7:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/* --------------------------------- tickets -------------------------------- */
var TICKET_STATUS = {
    open: "باز", waiting: "در انتظار", reviewing: "در حال بررسی", answered: "پاسخ داده شده", closed: "بسته",
};
var ticketStatus = function (status) { return TICKET_STATUS[String(status || "").toLowerCase()] || String(status || "—"); };
SCREENS.tickets = function tickets() {
    return __awaiter(this, void 0, void 0, function () {
        var site, filter, query, data, list;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    site = state.currentSite;
                    if (!site) {
                        $("#content").innerHTML = emptyState("🎫", "ابتدا یک سایت انتخاب کنید");
                        return [2 /*return*/];
                    }
                    skeleton(3);
                    filter = state.ticketFilter || "all";
                    query = new URLSearchParams({ per_page: "40" });
                    if (filter !== "all")
                        query.set("status", filter);
                    return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(site.id), "/tickets?").concat(query))];
                case 1:
                    data = _a.sent();
                    list = data.tickets || [];
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">".concat(esc(site.name || site.id), "</span><h2>\u062A\u06CC\u06A9\u062A\u200C\u0647\u0627\u06CC \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC</h2></div>\n      <button class=\"btn\" id=\"newTicket\">+ \u062A\u06CC\u06A9\u062A \u062C\u062F\u06CC\u062F</button>\n    </div>\n\n    <div class=\"subtabs\" role=\"tablist\">\n      ").concat([["all", "همه"], ["open", "باز"], ["waiting", "در انتظار"], ["closed", "بسته"]].map(function (_a) {
                        var _b = __read(_a, 2), value = _b[0], label = _b[1];
                        return "<button role=\"tab\" data-ticket-filter=\"".concat(value, "\" aria-selected=\"").concat(filter === value, "\">").concat(label, "</button>");
                    }).join(""), "\n    </div>\n\n    ").concat(list.length ? list.map(ticketRow).join("") : emptyState("🎫", "تیکتی در این وضعیت نیست"));
                    $("#newTicket").onclick = function () { return newTicketModal(site.id); };
                    $$("[data-ticket-filter]").forEach(function (button) {
                        button.onclick = function () { state.ticketFilter = button.dataset.ticketFilter; go("tickets"); };
                    });
                    $$("[data-open-ticket]").forEach(function (button) {
                        button.onclick = function () { return openTicket(site.id, button.dataset.openTicket); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function ticketRow(ticket) {
    var _a, _b, _c;
    var status = String(ticket.status || "").toLowerCase();
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(ticket.subject || "\u062A\u06CC\u06A9\u062A ".concat(ticket.number)), "</div>\n          <div class=\"record-meta\">\n            <span class=\"mono\">#").concat(esc((_a = ticket.number) !== null && _a !== void 0 ? _a : ticket.id), "</span>\n            <span>").concat(esc(((_b = ticket.customer) === null || _b === void 0 ? void 0 : _b.name) || ""), "</span>\n            <span>").concat(ago(ticket.updated_at || ticket.created_at), "</span>\n          </div>\n        </div>\n        <span class=\"chip ").concat(status === "closed" ? "" : status === "waiting" ? "warn" : "ok", "\">").concat(esc(ticketStatus(status)), "</span>\n      </div>\n    </div>\n    <div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-open-ticket=\"").concat(esc((_c = ticket.id) !== null && _c !== void 0 ? _c : ticket.number), "\">\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646</button>\n    </div>\n  </article>");
}
function newTicketModal(siteId) {
    return __awaiter(this, void 0, void 0, function () {
        var meta;
        var _this = this;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/ticket-meta")).catch(function () { return ({}); })];
                case 1:
                    meta = _b.sent();
                    modal({
                        title: "تیکت جدید",
                        fields: __spreadArray(__spreadArray([
                            { name: "subject", label: "موضوع", required: true }
                        ], __read((((_a = meta.departments) === null || _a === void 0 ? void 0 : _a.length) ? [{ name: "department", label: "دپارتمان", type: "select", value: "0",
                                options: __spreadArray([{ value: "0", label: "عمومی" }], __read(meta.departments.map(function (item) { return ({ value: String(item.id), label: item.name }); })), false) }] : [])), false), [
                            { name: "priority", label: "اولویت", type: "select", value: "normal",
                                options: [{ value: "low", label: "کم" }, { value: "normal", label: "عادی" }, { value: "high", label: "بالا" }, { value: "urgent", label: "فوری" }] },
                            { name: "body", label: "پیام", type: "textarea", required: true },
                        ], false),
                        confirm: "ثبت تیکت",
                        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/tickets"), {
                                            method: "POST",
                                            body: JSON.stringify({
                                                subject: values.subject,
                                                body: values.body,
                                                department: Number(values.department || 0),
                                                priority: values.priority,
                                            }),
                                        })];
                                    case 1:
                                        _a.sent();
                                        toast("تیکت ثبت شد");
                                        state.ticketFilter = "all";
                                        return [4 /*yield*/, go("tickets")];
                                    case 2:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); },
                    });
                    return [2 /*return*/];
            }
        });
    });
}
function openTicket(siteId, id) {
    return __awaiter(this, void 0, void 0, function () {
        var result, ticket, form;
        var _this = this;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/tickets/").concat(encodeURIComponent(id)))];
                case 1:
                    result = _c.sent();
                    ticket = result.ticket;
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div>\n        <span class=\"eyebrow mono\">#".concat(esc((_a = ticket.number) !== null && _a !== void 0 ? _a : id), "</span>\n        <h2>").concat(esc(ticket.subject || ""), "</h2>\n        <p class=\"muted small\">").concat(esc(((_b = ticket.customer) === null || _b === void 0 ? void 0 : _b.name) || ""), "</p>\n      </div>\n      <button class=\"btn ghost small\" id=\"backTickets\">\u0628\u0627\u0632\u06AF\u0634\u062A</button>\n    </div>\n\n    <div class=\"chips\" style=\"margin-bottom:var(--space-3)\">\n      <span class=\"chip\">").concat(esc(ticketStatus(ticket.status)), "</span>\n      ").concat(ticket.priority ? "<span class=\"chip\">".concat(esc(ticket.priority), "</span>") : "", "\n      ").concat(ticket.department ? "<span class=\"chip\">".concat(esc(ticket.department), "</span>") : "", "\n    </div>\n\n    <div class=\"grid\">\n      ").concat((ticket.messages || []).map(function (message) { return "\n        <article class=\"card tight\">\n          <div class=\"record-meta\" style=\"margin-bottom:var(--space-2)\">\n            <strong>".concat(esc(message.author || ""), "</strong>\n            <span>").concat(date(message.created_at), "</span>\n          </div>\n          <div style=\"white-space:pre-wrap\">").concat(esc(message.body || ""), "</div>\n        </article>"); }).join(""), "\n    </div>\n\n    ").concat(ticket.status === "closed" ? '<div class="notice">این تیکت بسته شده است.</div>' : "\n      <section class=\"card\" style=\"margin-top:var(--space-3)\">\n        <form id=\"replyForm\">\n          <label class=\"field\"><span>\u067E\u0627\u0633\u062E</span><textarea name=\"body\" rows=\"5\" required></textarea></label>\n          <button class=\"btn block\" type=\"submit\">\u0627\u0631\u0633\u0627\u0644 \u067E\u0627\u0633\u062E</button>\n        </form>\n      </section>", "\n\n    <div class=\"row-actions\" style=\"margin-top:var(--space-3)\">\n      <button class=\"btn ghost small\" data-ticket-status=\"closed\">\u0628\u0633\u062A\u0646</button>\n      <button class=\"btn ghost small\" data-ticket-status=\"reviewing\">\u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0631\u0633\u06CC</button>\n      <button class=\"btn ghost small\" data-ticket-status=\"waiting\">\u0628\u0627\u0632\u06AF\u0634\u0627\u06CC\u06CC</button>\n    </div>");
                    $("#backTickets").onclick = function () { return go("tickets"); };
                    form = $("#replyForm");
                    if (form) {
                        form.onsubmit = function (event) { return __awaiter(_this, void 0, void 0, function () {
                            var submit, error_15;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        event.preventDefault();
                                        submit = event.target.querySelector('button[type="submit"]');
                                        submit.disabled = true;
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 4, , 5]);
                                        return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/tickets/").concat(encodeURIComponent(id), "/reply"), {
                                                method: "POST",
                                                body: JSON.stringify({ body: new FormData(event.target).get("body") }),
                                            })];
                                    case 2:
                                        _a.sent();
                                        toast("پاسخ ارسال شد");
                                        return [4 /*yield*/, openTicket(siteId, id)];
                                    case 3:
                                        _a.sent();
                                        return [3 /*break*/, 5];
                                    case 4:
                                        error_15 = _a.sent();
                                        toast(error_15.message, "error");
                                        submit.disabled = false;
                                        return [3 /*break*/, 5];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); };
                    }
                    $$("[data-ticket-status]").forEach(function (button) {
                        button.onclick = function () { return __awaiter(_this, void 0, void 0, function () {
                            var error_16;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        button.disabled = true;
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 4, , 5]);
                                        return [4 /*yield*/, nativeApi("/sites/".concat(encodeURIComponent(siteId), "/tickets/").concat(encodeURIComponent(id), "/status"), {
                                                method: "POST", body: JSON.stringify({ status: button.dataset.ticketStatus }),
                                            })];
                                    case 2:
                                        _a.sent();
                                        return [4 /*yield*/, openTicket(siteId, id)];
                                    case 3:
                                        _a.sent();
                                        return [3 /*break*/, 5];
                                    case 4:
                                        error_16 = _a.sent();
                                        toast(error_16.message, "error");
                                        button.disabled = false;
                                        return [3 /*break*/, 5];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); };
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/* ------------------------------ observability ----------------------------- */
SCREENS.observability = function observability() {
    return __awaiter(this, void 0, void 0, function () {
        var data, m, memory, db, logs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, adminApi("/observability?lines=120")];
                case 1:
                    data = _a.sent();
                    m = data.metrics || {};
                    memory = m.memory || {};
                    db = m.database || {};
                    logs = data.logs || [];
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">\u0633\u06CC\u0633\u062A\u0645</span><h2>\u0645\u0627\u0646\u06CC\u062A\u0648\u0631\u06CC\u0646\u06AF \u0648 \u0644\u0627\u06AF</h2><p class=\"muted small\">\u0648\u0636\u0639\u06CC\u062A \u0644\u062D\u0638\u0647\u200C\u0627\u06CC Node.js \u0648 PostgreSQL \u0648 \u0622\u062E\u0631\u06CC\u0646 \u0631\u062E\u062F\u0627\u062F\u0647\u0627.</p></div>\n      <button class=\"btn ghost small\" id=\"refreshObs\">\u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC</button>\n    </div>\n    <div class=\"grid-2\">\n      ".concat(metricCard("نسخه", esc(m.version || "—"), "release"), "\n      ").concat(metricCard("RAM", "".concat(n(Math.round((memory.rss || 0) / 1024 / 1024)), " MB"), "memory"), "\n      ").concat(metricCard("اتصال‌های DB", "".concat(n(db.idle || 0), " \u0622\u0632\u0627\u062F / ").concat(n(db.total || 0), " \u06A9\u0644"), "database"), "\n      ").concat(metricCard("در انتظار DB", n(db.waiting || 0), "queue"), "\n    </div>\n    <section class=\"card\">\n      <div class=\"section-head\"><div><h3>\u0644\u0627\u06AF \u0627\u062E\u06CC\u0631</h3><p class=\"muted small\">\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u062D\u0633\u0627\u0633 \u062F\u0631 backend \u0645\u0627\u0633\u06A9 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.</p></div><span class=\"chip\">").concat(n(logs.length), " \u062E\u0637</span></div>\n      <div class=\"log-viewer\">").concat(logs.length ? logs.map(function (row) { return "<div class=\"log-line level-".concat(esc(row.level || "info"), "\"><span class=\"mono\">").concat(esc(row.ts || ""), "</span><strong>").concat(esc(row.level || ""), "</strong><span>").concat(esc(row.message || row.raw || ""), "</span></div>"); }).join("") : emptyState("🧾", "لاگی پیدا نشد"), "</div>\n    </section>");
                    $("#refreshObs").onclick = function () { return go("observability"); };
                    return [2 /*return*/];
            }
        });
    });
};
function metricCard(label, value, icon) {
    return "<article class=\"metric-card\"><div class=\"metric-icon\">".concat(icon === "memory" ? "🧠" : icon === "database" ? "🗄️" : icon === "queue" ? "⏳" : "⚙️", "</div><div><span>").concat(esc(label), "</span><strong>").concat(value, "</strong></div></article>");
}
/* --------------------------------- users ---------------------------------- */
SCREENS.users = function users() {
    return __awaiter(this, void 0, void 0, function () {
        var query, data, list, canManage, timer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    query = String(state.userSearch || "").trim();
                    return [4 /*yield*/, adminApi("/users?page=1&page_size=50".concat(query ? "&q=".concat(encodeURIComponent(query)) : ""))];
                case 1:
                    data = _a.sent();
                    list = data.items || data.users || [];
                    canManage = can("subscriptions.manage");
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">\u0645\u062F\u06CC\u0631\u06CC\u062A</span><h2>\u06A9\u0627\u0631\u0628\u0631\u0627\u0646 \u0631\u0628\u0627\u062A</h2><p class=\"muted small\">\u06A9\u0627\u0631\u0628\u0631\u0627\u0646 Telegram/Bale \u062B\u0628\u062A\u200C\u0634\u062F\u0647 \u062F\u0631 \u062C\u0627\u0631\u0686\u06CC \u0631\u0627 \u0628\u0628\u06CC\u0646\u06CC\u062F \u0648 \u062F\u0633\u062A\u0631\u0633\u06CC \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u06CC\u0627 \u067E\u0644\u0646 \u0631\u0627 \u0628\u0631\u0627\u06CC \u062A\u0633\u062A \u0641\u0639\u0627\u0644 \u06A9\u0646\u06CC\u062F.</p></div>\n      <button class=\"btn\" id=\"refreshUsers\">\u21BB \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC</button>\n    </div>\n    <section class=\"card\">\n      <label class=\"field\"><span>\u062C\u0633\u062A\u062C\u0648\u06CC \u06A9\u0627\u0631\u0628\u0631</span>\n        <input id=\"userSearch\" value=\"".concat(esc(query), "\" placeholder=\"\u0646\u0627\u0645\u060C username \u06CC\u0627 \u0634\u0646\u0627\u0633\u0647 Telegram\" autocomplete=\"off\">\n      </label>\n    </section>\n    <section id=\"userList\">\n      ").concat(list.length ? list.map(adminUserRow).join("") : emptyState("👤", "کاربری پیدا نشد", "بعد از /start در ربات، کاربر اینجا ظاهر می‌شود."), "\n    </section>");
                    $("#refreshUsers").onclick = function () { return go("users"); };
                    timer = null;
                    $("#userSearch").oninput = function (event) {
                        clearTimeout(timer);
                        state.userSearch = event.target.value;
                        timer = setTimeout(function () { return go("users"); }, 350);
                    };
                    if (canManage) {
                        $$('[data-user-grant]').forEach(function (button) {
                            button.onclick = function () { return grantUserPlanModal(Number(button.dataset.userGrant), button.dataset.userName || "کاربر"); };
                        });
                    }
                    $$('[data-user-detail]').forEach(function (button) {
                        button.onclick = function () { return userDetailModal(Number(button.dataset.userDetail)); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function adminUserRow(user) {
    var status = user.status === "active" ? "فعال" : "تعلیق";
    var hasSub = user.subscription_plan;
    var expires = user.subscription_expires_at ? date(user.subscription_expires_at) : "بدون اشتراک";
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(user.display_name || user.username || "\u06A9\u0627\u0631\u0628\u0631 ".concat(user.id)), "</div>\n          <div class=\"record-meta\">\n            ").concat(user.telegram_id ? "<span class=\"mono\">TG:".concat(esc(user.telegram_id), "</span>") : "", "\n            ").concat(user.username ? "<span>@".concat(esc(user.username), "</span>") : "", "\n            <span>").concat(esc(status), "</span>\n          </div>\n        </div>\n        <span class=\"chip ").concat(hasSub ? "ok" : "", "\">").concat(esc(user.subscription_plan || "بدون پلن"), "</span>\n      </div>\n      <div class=\"record-meta\" style=\"margin-top:var(--space-2)\">\n        <span>\u0627\u0646\u0642\u0636\u0627: ").concat(esc(expires), "</span><span>\u0633\u0627\u06CC\u062A\u200C\u0647\u0627: ").concat(n(user.site_count || 0), "</span>\n      </div>\n    </div>\n    <div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-user-detail=\"").concat(esc(user.id), "\">\u062C\u0632\u0626\u06CC\u0627\u062A</button>\n      ").concat(can("subscriptions.manage") ? "<button class=\"btn small\" data-user-grant=\"".concat(esc(user.id), "\" data-user-name=\"").concat(esc(user.display_name || user.username || "\u06A9\u0627\u0631\u0628\u0631 ".concat(user.id)), "\">\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u067E\u0644\u0646</button>") : "", "\n    </div>\n  </article>");
}
function userDetailModal(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var result, user_1, identities, subs, access, body, error_17;
        var _this = this;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    _e.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, adminApi("/users/".concat(encodeURIComponent(userId)))];
                case 1:
                    result = _e.sent();
                    user_1 = result.user;
                    identities = (user_1.identities || []).map(function (i) { return "".concat(i.platform === "bale" ? "بله" : "تلگرام", ": ").concat(i.platform_user_id).concat(i.username ? " (@".concat(i.username, ")") : ""); }).join(" · ") || "—";
                    subs = (user_1.subscriptions || []).slice(0, 8).map(function (sub) { return "<div class=\"record-meta\"><span>".concat(esc(sub.plan_name || sub.plan_id), "</span><span>").concat(esc(sub.status), "</span><span>").concat(date(sub.expires_at), "</span></div>"); }).join("") || "<p class=\"muted small\">\u0627\u0634\u062A\u0631\u0627\u06A9\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647.</p>";
                    access = __spreadArray(__spreadArray([], __read((user_1.sites || []).map(function (site) { return (__assign(__assign({}, site), { role: "owner" })); })), false), __read((user_1.memberships || [])), false).map(function (site) { return "<div class=\"record\"><div><strong>".concat(esc(site.site_name || site.name || site.site_id), "</strong><div class=\"record-meta\"><span>").concat(esc(site.role || "—"), "</span><span>").concat(esc(site.wordpress_url || ""), "</span></div></div>").concat(site.role !== "owner" ? "<button class=\"btn danger small\" data-revoke-site=\"".concat(esc(site.site_id), "\">\u062D\u0630\u0641 \u062F\u0633\u062A\u0631\u0633\u06CC</button>") : "", "</div>"); }).join("") || "<p class=\"muted small\">\u062F\u0633\u062A\u0631\u0633\u06CC \u0633\u0627\u06CC\u062A\u06CC \u0646\u062F\u0627\u0631\u062F.</p>";
                    body = "<div class=\"kv\"><div><b>\u0646\u0627\u0645</b><span>".concat(esc(user_1.display_name || "—"), "</span></div><div><b>\u0648\u0636\u0639\u06CC\u062A</b><span>").concat(esc(user_1.status || "—"), "</span></div><div><b>\u0634\u0646\u0627\u0633\u0647\u200C\u0647\u0627</b><span class=\"mono\">").concat(esc(identities), "</span></div></div><div class=\"row-actions\" style=\"margin-top:12px\">").concat(can("subscriptions.manage") ? "<button type=\"button\" class=\"btn small\" id=\"detailGrant\">\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u067E\u0644\u0646</button>" : "").concat(can("users.update") ? "<button type=\"button\" class=\"btn ghost small\" id=\"detailStatus\">".concat(user_1.status === "active" ? "تعلیق کاربر" : "فعال‌سازی کاربر", "</button>") : "").concat(can("users.sessions.revoke") ? "<button type=\"button\" class=\"btn ghost small\" id=\"detailRevoke\">\u062E\u0631\u0648\u062C \u0627\u0632 \u0647\u0645\u0647 \u062C\u0644\u0633\u0627\u062A</button>" : "").concat(can("users.update") ? "<button type=\"button\" class=\"btn ghost small\" id=\"detailSiteAccess\">\u0627\u0639\u0637\u0627\u06CC \u062F\u0633\u062A\u0631\u0633\u06CC \u0633\u0627\u06CC\u062A</button>" : "", "</div><hr><h4>\u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627</h4>").concat(subs, "<hr><h4>\u062F\u0633\u062A\u0631\u0633\u06CC \u0633\u0627\u06CC\u062A</h4>").concat(access);
                    modal({ title: "\u06A9\u0627\u0631\u0628\u0631 #".concat(user_1.id), body: body, fields: [], confirm: "بستن", onSubmit: function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/];
                        }); }); } });
                    (_a = $("#detailGrant")) === null || _a === void 0 ? void 0 : _a.addEventListener("click", function () { return grantUserPlanModal(user_1.id, user_1.display_name || user_1.username || "\u06A9\u0627\u0631\u0628\u0631 ".concat(user_1.id)); });
                    (_b = $("#detailStatus")) === null || _b === void 0 ? void 0 : _b.addEventListener("click", function () { return __awaiter(_this, void 0, void 0, function () {
                        var next;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    next = user_1.status === "active" ? "suspended" : "active";
                                    return [4 /*yield*/, adminApi("/users/".concat(encodeURIComponent(user_1.id), "/status"), { method: "POST", body: JSON.stringify({ status: next }) })];
                                case 1:
                                    _a.sent();
                                    toast(next === "active" ? "کاربر فعال شد" : "کاربر تعلیق شد");
                                    return [4 /*yield*/, go("users")];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    (_c = $("#detailRevoke")) === null || _c === void 0 ? void 0 : _c.addEventListener("click", function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, adminApi("/users/".concat(encodeURIComponent(user_1.id), "/sessions/revoke"), { method: "POST" })];
                                case 1:
                                    _a.sent();
                                    toast("جلسه‌های فعال کاربر بسته شد");
                                    return [4 /*yield*/, userDetailModal(user_1.id)];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    (_d = $("#detailSiteAccess")) === null || _d === void 0 ? void 0 : _d.addEventListener("click", function () { return siteAccessModal(user_1.id); });
                    $$('[data-revoke-site]').forEach(function (button) { return button.addEventListener("click", function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, adminApi("/users/".concat(encodeURIComponent(user_1.id), "/site-access/").concat(encodeURIComponent(button.dataset.revokeSite)), { method: "DELETE" })];
                                case 1:
                                    _a.sent();
                                    toast("دسترسی سایت حذف شد");
                                    return [4 /*yield*/, userDetailModal(user_1.id)];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); }); });
                    return [3 /*break*/, 3];
                case 2:
                    error_17 = _e.sent();
                    toast(error_17.message, "error");
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function siteAccessModal(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var data, sites, error_18;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, adminApi("/clients?page_size=100")];
                case 1:
                    data = _a.sent();
                    sites = data.items || data.clients || [];
                    if (!sites.length)
                        return [2 /*return*/, toast("سایتی برای واگذاری دسترسی وجود ندارد", "warn")];
                    modal({
                        title: "اعطای دسترسی سایت",
                        lead: "این دسترسی فقط برای همان سایت اعمال می‌شود.",
                        fields: [
                            { name: "site_id", label: "سایت", type: "select", required: true, options: sites.map(function (site) { return ({ value: site.id, label: site.name || site.id }); }) },
                            { name: "role", label: "نقش", type: "select", required: true, options: [{ value: "admin", label: "مدیر سایت" }, { value: "support", label: "پشتیبان" }] },
                        ],
                        confirm: "ثبت دسترسی",
                        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, adminApi("/users/".concat(encodeURIComponent(userId), "/site-access"), { method: "POST", body: JSON.stringify({ site_id: values.site_id, role: values.role }) })];
                                case 1:
                                    _a.sent();
                                    toast("دسترسی سایت ثبت شد");
                                    return [4 /*yield*/, userDetailModal(userId)];
                                case 2:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        }); }); }
                    });
                    return [3 /*break*/, 3];
                case 2:
                    error_18 = _a.sent();
                    toast(error_18.message, "error");
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function grantUserPlanModal(userId, userName) {
    return __awaiter(this, void 0, void 0, function () {
        var data, plans, error_19;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, adminApi("/plans?include_inactive=false")];
                case 1:
                    data = _a.sent();
                    plans = (data.plans || []).filter(function (plan) { return plan.active; });
                    modal({
                        title: "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0628\u0631\u0627\u06CC ".concat(userName),
                        lead: "پلن مستقیماً توسط Super Admin/مدیر مجاز فعال می‌شود و در Audit ثبت خواهد شد. برای تست، می‌توانید پلن آزمایشی ۷ روزه یا هر پلن فعال دیگری را انتخاب کنید.",
                        fields: [
                            { name: "plan_id", label: "پلن", type: "select", required: true, options: plans.map(function (p) { return ({ value: p.id, label: "".concat(p.name, " \u2014 ").concat(n(p.duration_days), " \u0631\u0648\u0632") }); }) },
                            { name: "days", label: "مدت سفارشی (اختیاری)", inputType: "number", inputMode: "numeric", placeholder: "مثلاً 7" },
                            { name: "reason", label: "دلیل اعطا", required: true, placeholder: "مثلاً تست امکانات Mini App" },
                        ],
                        confirm: "فعال‌سازی",
                        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
                            var body;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        body = { user_id: userId, plan_id: values.plan_id, days: values.days ? Number(values.days) : undefined, replace_active: true, reason: String(values.reason || "تست دسترسی Mini App").slice(0, 240) };
                                        return [4 /*yield*/, adminApi("/subscriptions/grant", { method: "POST", body: JSON.stringify(body) })];
                                    case 1:
                                        _a.sent();
                                        toast("پلن فعال شد");
                                        return [4 /*yield*/, go("users")];
                                    case 2:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); },
                    });
                    return [3 /*break*/, 3];
                case 2:
                    error_19 = _a.sent();
                    toast(error_19.message, "error");
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/* --------------------------------- plans ---------------------------------- */
var PLAN_FEATURES = [
    ["site_control", "کنترل سایت"],
    ["remote_tickets", "تیکت از راه دور"],
    ["remote_announcements", "اطلاعیه"],
    ["remote_products", "محصولات هوشمند"],
    ["analytics", "گزارش‌ها"],
];
SCREENS.plans = function plans() {
    return __awaiter(this, void 0, void 0, function () {
        var data, list, manage, create;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, adminApi("/plans?include_inactive=true")];
                case 1:
                    data = _a.sent();
                    list = data.plans || [];
                    manage = can("plans.manage");
                    $("#content").innerHTML = "\n    <div class=\"section-head\">\n      <div><span class=\"eyebrow\">\u0645\u062F\u06CC\u0631\u06CC\u062A</span><h2>\u067E\u0644\u0646\u200C\u0647\u0627 \u0648 \u0642\u06CC\u0645\u062A\u200C\u0647\u0627</h2></div>\n      ".concat(manage ? '<button class="btn" id="newPlan">+ پلن جدید</button>' : "", "\n    </div>\n    ").concat(list.length ? list.map(function (plan) { return adminPlanRow(plan, manage); }).join("") : emptyState("🏷", "پلنی تعریف نشده"));
                    create = $("#newPlan");
                    if (create)
                        create.onclick = function () { return planModal(null); };
                    $$("[data-edit-plan]").forEach(function (button) {
                        button.onclick = function () { return planModal(list.find(function (plan) { return plan.id === button.dataset.editPlan; })); };
                    });
                    $$("[data-plan-active]").forEach(function (input) {
                        input.onchange = function () { return __awaiter(_this, void 0, void 0, function () {
                            var error_20;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        input.disabled = true;
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 3, 4, 5]);
                                        return [4 /*yield*/, adminApi("/plans/".concat(encodeURIComponent(input.dataset.planActive)), {
                                                method: "PATCH", body: JSON.stringify({ active: input.checked }),
                                            })];
                                    case 2:
                                        _a.sent();
                                        toast(input.checked ? "پلن فعال شد" : "پلن غیرفعال شد");
                                        return [3 /*break*/, 5];
                                    case 3:
                                        error_20 = _a.sent();
                                        input.checked = !input.checked;
                                        toast(error_20.message, "error");
                                        return [3 /*break*/, 5];
                                    case 4:
                                        input.disabled = false;
                                        return [7 /*endfinally*/];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); };
                    });
                    $$("[data-delete-plan]").forEach(function (button) {
                        button.onclick = function () { return deletePlanModal(list.find(function (plan) { return plan.id === button.dataset.deletePlan; })); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function adminPlanRow(plan, manage) {
    var _a, _b, _c;
    var features = plan.features || {};
    var active = Number((_a = plan.active_subscription_count) !== null && _a !== void 0 ? _a : 0);
    var deletable = manage && !plan.is_trial && active === 0 && Number((_b = plan.invoice_count) !== null && _b !== void 0 ? _b : 0) === 0;
    return "<article class=\"record\">\n    <div>\n      <div class=\"record-main\">\n        <div>\n          <div class=\"record-title\">".concat(esc(plan.name), " ").concat(plan.is_trial ? '<span class="chip">آزمایشی</span>' : "", "</div>\n          <div class=\"record-meta\">\n            <span class=\"mono\">").concat(esc(plan.id), "</span>\n            <span>").concat(n(plan.duration_days), " \u0631\u0648\u0632</span>\n            <span>").concat(n(plan.price_toman), " \u062A\u0648\u0645\u0627\u0646</span>\n          </div>\n          <div class=\"record-meta\">\n            <span>").concat(n(active), " \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644</span>\n            <span>").concat(n((_c = plan.subscription_count) !== null && _c !== void 0 ? _c : 0), " \u06A9\u0644</span>\n          </div>\n        </div>\n        <span class=\"chip ").concat(plan.active ? "ok" : "", "\">").concat(plan.active ? "فعال" : "غیرفعال", "</span>\n      </div>\n      <div class=\"chips\" style=\"margin-top:var(--space-2)\">\n        ").concat(PLAN_FEATURES.map(function (_a) {
        var _b = __read(_a, 2), key = _b[0], label = _b[1];
        return "<span class=\"chip ".concat(features[key] ? "ok" : "", "\">").concat(esc(label), " ").concat(features[key] ? "✓" : "—", "</span>");
    }).join(""), "\n      </div>\n      ").concat(manage ? "<label class=\"check\">\n        <span class=\"small\">\u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0645\u0634\u062A\u0631\u06CC\u0627\u0646</span>\n        <span class=\"switch\">\n          <input type=\"checkbox\" data-plan-active=\"".concat(esc(plan.id), "\" ").concat(plan.active ? "checked" : "", " aria-label=\"\u0641\u0639\u0627\u0644 \u0628\u0648\u062F\u0646 ").concat(esc(plan.name), "\">\n          <span class=\"track\"></span>\n        </span>\n      </label>") : "", "\n    </div>\n    ").concat(manage ? "<div class=\"record-actions\">\n      <button class=\"btn ghost small\" data-edit-plan=\"".concat(esc(plan.id), "\">\u0648\u06CC\u0631\u0627\u06CC\u0634</button>\n      <button class=\"btn danger small\" data-delete-plan=\"").concat(esc(plan.id), "\" ").concat(deletable ? "" : "disabled", "\n              title=\"").concat(deletable ? "حذف پلن" : plan.is_trial ? "پلن آزمایشی برای ثبت‌نام لازم است" : "پلن در حال استفاده است؛ فقط می‌توان غیرفعالش کرد", "\">\u062D\u0630\u0641</button>\n    </div>") : "", "\n  </article>");
}
function planModal(plan) {
    var _this = this;
    var _a, _b, _c;
    var editing = Boolean(plan);
    var features = (plan === null || plan === void 0 ? void 0 : plan.features) || {};
    modal({
        title: editing ? "\u0648\u06CC\u0631\u0627\u06CC\u0634 ".concat(plan.name) : "پلن جدید",
        lead: editing
            ? "تغییر قیمت فقط روی خریدهای بعدی اثر دارد؛ فاکتورهای صادرشده دست‌نخورده می‌مانند."
            : "شناسه پلن پس از ساخت قابل تغییر نیست.",
        fields: __spreadArray(__spreadArray(__spreadArray([], __read((editing ? [] : [{ name: "id", label: "شناسه پلن (انگلیسی)", required: true, placeholder: "monthly_pro" }])), false), [
            { name: "name", label: "نام نمایشی", required: true, value: (plan === null || plan === void 0 ? void 0 : plan.name) || "" },
            { name: "duration_days", label: "مدت (روز)", required: true, inputType: "number", inputMode: "numeric", value: (_a = plan === null || plan === void 0 ? void 0 : plan.duration_days) !== null && _a !== void 0 ? _a : 30 },
            { name: "price_toman", label: "قیمت (تومان)", inputType: "number", inputMode: "numeric", value: (_b = plan === null || plan === void 0 ? void 0 : plan.price_toman) !== null && _b !== void 0 ? _b : 0 },
            { name: "telegram_stars", label: "قیمت با Stars", inputType: "number", inputMode: "numeric", value: (_c = plan === null || plan === void 0 ? void 0 : plan.telegram_stars) !== null && _c !== void 0 ? _c : 0 }
        ], false), __read(PLAN_FEATURES.map(function (_a) {
            var _b = __read(_a, 2), key = _b[0], label = _b[1];
            return ({ name: "feature_".concat(key), label: label, type: "checkbox", value: features[key] === true });
        })), false),
        confirm: editing ? "ذخیره" : "ساخت پلن",
        onSubmit: function (values) { return __awaiter(_this, void 0, void 0, function () {
            var payload;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        payload = {
                            name: String(values.name).trim(),
                            duration_days: Number(values.duration_days),
                            price_toman: Number(values.price_toman || 0),
                            telegram_stars: Number(values.telegram_stars || 0),
                            features: Object.fromEntries(PLAN_FEATURES.map(function (_a) {
                                var _b = __read(_a, 1), key = _b[0];
                                return [key, values["feature_".concat(key)] === true];
                            })),
                        };
                        if (!editing) return [3 /*break*/, 2];
                        return [4 /*yield*/, adminApi("/plans/".concat(encodeURIComponent(plan.id)), { method: "PATCH", body: JSON.stringify(payload) })];
                    case 1:
                        _a.sent();
                        toast("پلن ذخیره شد");
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, adminApi("/plans", { method: "POST", body: JSON.stringify(__assign(__assign({}, payload), { id: String(values.id).trim() })) })];
                    case 3:
                        _a.sent();
                        toast("پلن ساخته شد");
                        _a.label = 4;
                    case 4: return [4 /*yield*/, go("plans")];
                    case 5:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); },
    });
}
function deletePlanModal(plan) {
    var _this = this;
    if (!plan)
        return;
    confirmModal({
        title: "\u062D\u0630\u0641 ".concat(plan.name),
        lead: "این پلن هیچ اشتراک فعال و هیچ فاکتوری ندارد، بنابراین حذف آن بی‌خطر است. این کار قابل بازگشت نیست.",
        confirm: "حذف پلن",
        onConfirm: function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, adminApi("/plans/".concat(encodeURIComponent(plan.id)), { method: "DELETE" })];
                    case 1:
                        _a.sent();
                        toast("پلن حذف شد");
                        return [4 /*yield*/, go("plans")];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); },
    });
}
/* --------------------------- unified account ----------------------------- */
SCREENS.account = function accountScreen() {
    return __awaiter(this, void 0, void 0, function () {
        var data, identities, connected, identityCard, links;
        var _this = this;
        var _a, _b, _c, _d, _e, _f, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    skeleton(3);
                    return [4 /*yield*/, nativeApi("/account/identities")];
                case 1:
                    data = _h.sent();
                    state.account = data.account || null;
                    identities = ((_a = state.account) === null || _a === void 0 ? void 0 : _a.identities) || {};
                    connected = Boolean((_b = state.account) === null || _b === void 0 ? void 0 : _b.unified);
                    identityCard = function (key, label, icon, identity) {
                        if (identity) {
                            return "<article class=\"record\">\n        <div>\n          <div class=\"record-main\">\n            <div>\n              <div class=\"record-title\">".concat(icon, " ").concat(label, "</div>\n              <div class=\"record-meta\"><span class=\"chip ok\">\u0645\u062A\u0635\u0644</span><span class=\"mono\">").concat(esc(identity.platform_user_id), "</span>").concat(identity.username ? "<span>@".concat(esc(identity.username), "</span>") : "", "</div>\n            </div>\n          </div>\n          <p class=\"muted small\" style=\"margin-top:var(--space-2)\">\u0627\u06CC\u0646 \u0647\u0648\u06CC\u062A \u0627\u0632 \u0647\u0645\u0627\u0646 \u062D\u0633\u0627\u0628 \u062C\u0627\u0631\u0686\u06CC\u060C \u067E\u0644\u0646 \u0648 \u062F\u0633\u062A\u0631\u0633\u06CC\u200C\u0647\u0627\u06CC \u0634\u0645\u0627 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0645\u06CC\u200C\u06A9\u0646\u062F.</p>\n        </div>\n        ").concat(Object.values(identities).filter(Boolean).length > 1 ? "<div class=\"record-actions\"><button class=\"btn danger ghost small\" data-unlink=\"".concat(key, "\">\u0642\u0637\u0639 \u0627\u062A\u0635\u0627\u0644</button></div>") : "", "\n      </article>");
                        }
                        return "<article class=\"record\">\n      <div>\n        <div class=\"record-title\">".concat(icon, " ").concat(label, "</div>\n        <div class=\"record-meta\"><span class=\"chip warn\">\u0645\u062A\u0635\u0644 \u0646\u06CC\u0633\u062A</span></div>\n        <p class=\"muted small\" style=\"margin-top:var(--space-2)\">\u0628\u0627 \u0627\u062A\u0635\u0627\u0644 ").concat(label, " \u0647\u0645\u06CC\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9\u060C \u0633\u0627\u06CC\u062A\u200C\u0647\u0627\u060C \u062A\u06CC\u06A9\u062A\u200C\u0647\u0627\u060C \u0646\u0642\u0634\u200C\u0647\u0627 \u0648 \u0648\u0636\u0639\u06CC\u062A AI \u062F\u0631 \u0647\u0631 \u062F\u0648 \u067E\u0644\u062A\u0641\u0631\u0645 \u0645\u0634\u062A\u0631\u06A9 \u0645\u06CC\u200C\u0634\u0648\u062F.</p>\n      </div>\n      <div class=\"record-actions\"><button class=\"btn small\" data-link=\"").concat(key, "\">\u0627\u062A\u0635\u0627\u0644 ").concat(label, "</button></div>\n    </article>");
                    };
                    links = [identityCard("telegram", "تلگرام", "✈️", identities.telegram), identityCard("bale", "بله", "🟠", identities.bale)].join("");
                    $("#content").innerHTML = "\n    <div class=\"hero\">\n      <div>\n        <span class=\"eyebrow\">\u062D\u0633\u0627\u0628 \u06CC\u06A9\u067E\u0627\u0631\u0686\u0647</span>\n        <h2>".concat(esc(((_c = state.user) === null || _c === void 0 ? void 0 : _c.display_name) || "حساب جارچی"), "</h2>\n        <p>").concat(connected ? "حساب تلگرام و بله شما به یک حساب جارچی متصل هستند؛ پلن و دسترسی‌ها مشترک است." : "می‌توانید تلگرام و بله را به یک حساب جارچی متصل کنید و بین دو پلتفرم بدون از دست دادن وضعیت کار ادامه دهید.", "</p>\n      </div>\n      <span class=\"chip ").concat(connected ? "ok" : "brand", "\">").concat(connected ? "یکپارچه ✓" : "یک پلتفرم متصل", "</span>\n    </div>\n    <section class=\"card\">\n      <div class=\"section-head\"><div><span class=\"eyebrow\">\u0634\u0646\u0627\u0633\u0647 \u0627\u0635\u0644\u06CC</span><h3>Jarchi Account #").concat(n(((_d = state.account) === null || _d === void 0 ? void 0 : _d.user_id) || ((_e = state.user) === null || _e === void 0 ? void 0 : _e.id) || 0), "</h3></div></div>\n      <div class=\"chips\"><span class=\"chip\">\u0627\u0634\u062A\u0631\u0627\u06A9: ").concat(esc(((_f = state.subscription) === null || _f === void 0 ? void 0 : _f.plan_name) || ((_g = state.subscription) === null || _g === void 0 ? void 0 : _g.plan_id) || "بدون اشتراک"), "</span><span class=\"chip\">\u0633\u0627\u06CC\u062A\u200C\u0647\u0627: ").concat(n(state.sites.length), "</span><span class=\"chip\">\u067E\u0644\u0646 \u0645\u0634\u062A\u0631\u06A9 \u0628\u06CC\u0646 \u067E\u0644\u062A\u0641\u0631\u0645\u200C\u0647\u0627</span></div>\n    </section>\n    ").concat(links, "\n    <section class=\"card\">\n      <h3>\u0642\u0627\u0646\u0648\u0646 \u0627\u062A\u0635\u0627\u0644 \u062D\u0633\u0627\u0628</h3>\n      <p class=\"muted small\">\u0628\u0631\u0627\u06CC \u0627\u0645\u0646\u06CC\u062A\u060C \u062A\u0634\u062E\u06CC\u0635 \u0647\u0648\u06CC\u062A \u0628\u0631 \u0627\u0633\u0627\u0633 \u0646\u0627\u0645 \u06CC\u0627 username \u0627\u0646\u062C\u0627\u0645 \u0646\u0645\u06CC\u200C\u0634\u0648\u062F. \u0627\u062A\u0635\u0627\u0644 \u0641\u0642\u0637 \u0628\u0627 \u06CC\u06A9 \u0644\u06CC\u0646\u06A9 \u06CC\u06A9\u200C\u0628\u0627\u0631\u0645\u0635\u0631\u0641 \u0648 \u0645\u062D\u062F\u0648\u062F \u0628\u0647 \u0632\u0645\u0627\u0646 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u0634\u0648\u062F. \u0647\u0631 \u062D\u0633\u0627\u0628 \u062C\u0627\u0631\u0686\u06CC \u062D\u062F\u0627\u06A9\u062B\u0631 \u06CC\u06A9 \u0647\u0648\u06CC\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u0648 \u06CC\u06A9 \u0647\u0648\u06CC\u062A \u0628\u0644\u0647 \u062F\u0627\u0631\u062F.</p>\n    </section>");
                    $$('[data-link]').forEach(function (button) {
                        button.onclick = function () { return __awaiter(_this, void 0, void 0, function () {
                            var target, result, error_21;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        button.disabled = true;
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 4, 5, 6]);
                                        target = button.dataset.link;
                                        return [4 /*yield*/, nativeApi("/account/identities/link", { method: "POST", body: JSON.stringify({ target_platform: target }) })];
                                    case 2:
                                        result = _a.sent();
                                        return [4 /*yield*/, showLinkChallenge(result, target)];
                                    case 3:
                                        _a.sent();
                                        return [3 /*break*/, 6];
                                    case 4:
                                        error_21 = _a.sent();
                                        toast(error_21.message, "error");
                                        return [3 /*break*/, 6];
                                    case 5:
                                        button.disabled = false;
                                        return [7 /*endfinally*/];
                                    case 6: return [2 /*return*/];
                                }
                            });
                        }); };
                    });
                    $$('[data-unlink]').forEach(function (button) {
                        button.onclick = function () { return confirmModal({
                            title: "\u0642\u0637\u0639 \u0627\u062A\u0635\u0627\u0644 ".concat(button.dataset.unlink === "telegram" ? "تلگرام" : "بله"),
                            lead: "دسترسی‌های این حساب حذف نمی‌شود، اما ورود از این پلتفرم قطع و نشست‌های همان پلتفرم لغو می‌شود. اگر این آخرین هویت باشد امکان قطع وجود ندارد.",
                            confirm: "قطع اتصال",
                            onConfirm: function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, nativeApi("/account/identities/".concat(encodeURIComponent(button.dataset.unlink)), { method: "DELETE" })];
                                        case 1:
                                            _a.sent();
                                            toast("اتصال قطع شد");
                                            return [4 /*yield*/, go("account")];
                                        case 2:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); },
                        }); };
                    });
                    return [2 /*return*/];
            }
        });
    });
};
function showLinkChallenge(result, target) {
    return __awaiter(this, void 0, void 0, function () {
        var label, seconds, left, root, timer;
        var _this = this;
        return __generator(this, function (_a) {
            label = target === "telegram" ? "تلگرام" : "بله";
            seconds = Number(result.expires_in_seconds || 600);
            left = seconds;
            root = document.createElement("div");
            root.innerHTML = "<p class=\"muted small\">".concat(label, " \u0631\u0627 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F \u0648 \u062F\u06A9\u0645\u0647 \u0634\u0631\u0648\u0639 \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F \u062A\u0627 \u0627\u062A\u0635\u0627\u0644 \u0627\u0645\u0646 \u06A9\u0627\u0645\u0644 \u0634\u0648\u062F.</p><div class=\"mono\" style=\"word-break:break-all;padding:var(--space-3);background:var(--surface-soft);border-radius:12px\">").concat(esc(result.deep_link), "</div><p class=\"notice\" id=\"linkTimer\">\u0627\u0639\u062A\u0628\u0627\u0631: ").concat(n(left), " \u062B\u0627\u0646\u06CC\u0647</p>");
            modal({
                title: "\u0627\u062A\u0635\u0627\u0644 ".concat(label),
                body: root.innerHTML,
                fields: [],
                confirm: "باز کردن لینک",
                onSubmit: function () { return __awaiter(_this, void 0, void 0, function () {
                    var _a;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                _b.trys.push([0, 1, , 3]);
                                window.location.href = result.deep_link;
                                return [3 /*break*/, 3];
                            case 1:
                                _a = _b.sent();
                                return [4 /*yield*/, copyText(result.deep_link, "لینک اتصال کپی شد")];
                            case 2:
                                _b.sent();
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/, true];
                        }
                    });
                }); },
            });
            timer = setInterval(function () {
                left -= 1;
                var el = document.querySelector("#linkTimer");
                if (el)
                    el.textContent = "\u0627\u0639\u062A\u0628\u0627\u0631: ".concat(n(Math.max(0, left)), " \u062B\u0627\u0646\u06CC\u0647");
                if (left <= 0)
                    clearInterval(timer);
            }, 1000);
            return [2 /*return*/];
        });
    });
}
/* --------------------------------- start ---------------------------------- */
applyTheme(currentTheme());
// 20s is longer than the normal API budget, but short enough to avoid an
// apparently frozen Mini App if a proxy or WebView never resolves fetch().
var BOOT_WATCHDOG = setTimeout(function () {
    var host = $("#content");
    if (host === null || host === void 0 ? void 0 : host.querySelector(".skeleton-page")) {
        var stage = String(window.__JARCHI_BOOT_STAGE__ || "startup");
        errorState("\u067E\u0627\u0633\u062E \u0627\u0648\u0644\u06CC\u0647 \u067E\u0646\u0644 \u06A9\u0627\u0645\u0644 \u0646\u0634\u062F (\u0645\u0631\u062D\u0644\u0647: ".concat(stage, "). \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0632 \u0631\u0628\u0627\u062A \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F."), { retry: true });
    }
}, 20000);
$("#themeToggle").onclick = function () {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
    haptic();
};
$("#menuButton").onclick = function () { return toggleDrawer(!$("#drawer").classList.contains("open")); };
$("#scrim").onclick = function () { return toggleDrawer(false); };
document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape")
        return;
    if ($("#modalRoot").innerHTML) {
        $("#modalRoot").innerHTML = "";
        return;
    }
    toggleDrawer(false);
});
bootstrap();
