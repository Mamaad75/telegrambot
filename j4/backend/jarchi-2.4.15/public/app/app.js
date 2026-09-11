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

/* ------------------------------- platform -------------------------------- */

window.__JARCHI_APP_STARTED__ = true;
window.__JARCHI_BOOT_STAGE__ = "app_loaded";

const params = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
let tg = window.Telegram?.WebApp || null;
let bale = window.Bale?.WebApp || null;
const requestedPlatform = params.get("platform") || hashParams.get("platform") || "";
const platform = requestedPlatform || (bale ? "bale" : tg ? "telegram" : "web");

let sessionToken = params.get("session") || hashParams.get("session") || "";
try {
  if (platform === "bale") {
    // Bale Web runs the Mini App inside an iframe. Its own documentation warns
    // against browser-history routing in the web client, so keep the fallback
    // bot session only in memory and do not mutate history/sessionStorage here.
  } else if (sessionToken) {
    sessionStorage.setItem("jarchi.session", sessionToken);
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("session");
    const cleanHash = new URLSearchParams(String(cleanUrl.hash || "").replace(/^#/, ""));
    cleanHash.delete("session");
    cleanUrl.hash = cleanHash.toString() ? `#${cleanHash.toString()}` : "";
    history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  } else {
    sessionToken = sessionStorage.getItem("jarchi.session") || "";
  }
} catch { /* private mode / embedded navigation restrictions */ }
let initData = platform === "bale" ? (bale?.initData || "") : platform === "telegram" ? (tg?.initData || "") : "";

let platformReadySignalled = false;
function signalPlatformReady() {
  if (platformReadySignalled) return;
  const sdk = platform === "bale" ? bale : platform === "telegram" ? tg : null;
  if (!sdk) return;
  try { sdk.ready?.(); } catch { /* old client */ }
  try { sdk.expand?.(); } catch { /* old client */ }
  platformReadySignalled = true;
}

function refreshPlatformSdk() {
  tg = window.Telegram?.WebApp || tg || null;
  bale = window.Bale?.WebApp || bale || null;
  initData = platform === "bale" ? (bale?.initData || "") : platform === "telegram" ? (tg?.initData || "") : "";
  signalPlatformReady();
}

refreshPlatformSdk();

// The Bale SDK is intentionally async so a slow/unreachable CDN can never
// freeze Jarchi before app.js runs. Keep attaching for a short window; when the
// SDK arrives, ready()/expand() are signalled immediately. Authentication of
// /panel links does not depend on this SDK.
if (platform === "bale" && !bale) {
  let baleAttachAttempts = 0;
  const baleAttachTimer = setInterval(() => {
    baleAttachAttempts += 1;
    refreshPlatformSdk();
    if (bale || baleAttachAttempts >= 60) clearInterval(baleAttachTimer);
  }, 250);
}

async function waitForPlatformAuthContext() {
  refreshPlatformSdk();
  // Bot-issued session links do not need a third-party SDK to authenticate.
  // For direct Mini App launches, wait briefly for the platform SDK/initData
  // while the local app remains alive (and its watchdog can still fire).
  if (sessionToken || initData || !["telegram", "bale"].includes(platform)) return;
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    refreshPlatformSdk();
    if (initData) return;
  }
}

// Never leave the user on an infinite skeleton when a WebView/runtime throws
// before bootstrap can render an error. This also gives Support a concrete
// client-side failure to report without exposing secrets.
window.addEventListener("error", (event) => {
  try {
    const rawMessage = String(event?.error?.message || event?.message || "").trim();
    // Browsers report opaque failures from cross-origin SDKs as "Script error."
    // with no usable stack/source. It is not evidence that our bootstrap failed.
    if (!event?.error && /^script error\.?$/i.test(rawMessage)) return;
    const message = rawMessage || "خطای اجرای برنامه";
    const host = document.querySelector("#content");
    if (host && host.querySelector(".skeleton-page")) {
      host.innerHTML = `<div class="state error"><div class="state-icon">⚠️</div><h3>اجرای پنل با خطا مواجه شد</h3><p>${esc(message)}</p><button class="btn" onclick="location.reload()">بارگذاری مجدد</button></div>`;
    }
  } catch {}
});
window.addEventListener("unhandledrejection", (event) => {
  try {
    const message = String(event?.reason?.message || event?.reason || "").trim();
    // Third-party SDKs occasionally reject bookkeeping promises without a
    // reason. Do not replace a healthy bootstrap skeleton with a generic error.
    if (!message) return;
    const host = document.querySelector("#content");
    if (host && host.querySelector(".skeleton-page")) {
      host.innerHTML = `<div class="state error"><div class="state-icon">⚠️</div><h3>ارتباط با پنل با خطا مواجه شد</h3><p>${esc(message)}</p><button class="btn" onclick="location.reload()">بارگذاری مجدد</button></div>`;
    }
  } catch {}
});

/* --------------------------------- utils --------------------------------- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function esc(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/** Persian digits everywhere a number is shown to a reader. */
function n(value) { return Number(value || 0).toLocaleString("fa-IR"); }

function date(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("fa-IR"); } catch { return "—"; }
}

function ago(value) {
  if (!value) return "—";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${n(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${n(hours)} ساعت پیش`;
  return `${n(Math.round(hours / 24))} روز پیش`;
}

function daysLeft(value) {
  return value ? Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000)) : 0;
}

function initials(name) {
  const text = String(name || "").trim();
  return text ? text.slice(0, 1) : "ج";
}

/* -------------------------------- feedback -------------------------------- */

function toast(message, tone = "ok") {
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.textContent = message;
  $("#toastRoot").appendChild(element);
  setTimeout(() => element.remove(), 3000);
}

function haptic(kind = "light") {
  try { (tg || bale)?.HapticFeedback?.impactOccurred?.(kind); } catch { /* unsupported */ }
}

/** Skeletons match the shape of what is loading, so nothing jumps on arrival. */
function skeleton(rows = 3, { title = true } = {}) {
  $("#content").innerHTML = `
    <div class="skeleton-page" aria-busy="true" aria-label="در حال بارگذاری">
      ${title ? '<div class="skeleton skeleton-title"></div>' : ""}
      ${Array.from({ length: rows }, () => '<div class="skeleton skeleton-card"></div>').join("")}
    </div>`;
}

function emptyState(icon, title, body = "", action = "") {
  return `<div class="state">
    <div class="state-icon" aria-hidden="true">${icon}</div>
    <h3>${esc(title)}</h3>
    ${body ? `<p>${esc(body)}</p>` : ""}
    ${action}
  </div>`;
}

function errorState(message, { retry = true } = {}) {
  $("#content").innerHTML = `<div class="state error">
    <div class="state-icon" aria-hidden="true">⚠️</div>
    <h3>مشکلی پیش آمد</h3>
    <p>${esc(message)}</p>
    ${retry ? '<button class="btn" id="retryBtn">تلاش مجدد</button>' : ""}
  </div>`;
  const button = $("#retryBtn");
  if (button) button.onclick = () => go(state.tab);
}

/* ---------------------------------- api ----------------------------------- */

/*
 * The single request helper. `admin` picks the admin-authenticated mount, which
 * runs the same RBAC router behind Mini App identity; everything else goes to
 * the customer API. Signature is unchanged from 2.1.x so existing calls work.
 */
async function api(path, opts = {}, admin = false) {
  const headers = { "accept": "application/json", "content-type": "application/json", ...(opts.headers || {}) };
  const omitSessionBearer = opts.omitSessionBearer === true;
  if (sessionToken && !omitSessionBearer) headers.authorization = `Bearer ${sessionToken}`;
  if (initData && platform === "telegram") headers["X-Telegram-Init-Data"] = initData;
  if (initData && platform === "bale") headers["X-Bale-Init-Data"] = initData;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(opts.timeoutMs || 15000));
  const requestOpts = { ...opts, headers, credentials: "same-origin", cache: "no-store", signal: controller.signal };
  delete requestOpts.timeoutMs;
  delete requestOpts.omitSessionBearer;
  let response;
  try {
    const requestPath = `/api${admin ? "/admin-mini" : ""}${path}`;
    response = await fetch(requestPath, requestOpts);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("زمان پاسخ سرور تمام شد؛ دوباره تلاش کنید.");
    throw error;
  } finally { clearTimeout(timeout); }

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok || data?.success === false) {
    const error = new Error(friendlyError(data, response.status));
    error.status = response.status;
    error.code = data?.error_code || data?.error?.code || "";
    error.data = data;
    throw error;
  }
  return data;
}

const nativeApi = (path, opts = {}) => api(path, opts, false);
const adminApi = (path, opts = {}) => api(path, opts, true);

/**
 * A message a person can act on.
 *
 * The server already writes Persian for the cases it expects; this fills in the
 * transport-level failures, which otherwise surface as "Failed to fetch" or a
 * bare status code and tell a customer nothing.
 */
function friendlyError(data, status) {
  const server = typeof data?.error === "string"
    ? data.error
    : typeof data?.error?.message === "string" ? data.error.message : "";
  if (server) return server;
  if (status === 401) return "نشست شما منقضی شده است. لطفاً پنل را از داخل ربات دوباره باز کنید.";
  if (status === 402) return "این بخش نیازمند اشتراک فعال است.";
  if (status === 403) return "شما به این بخش دسترسی ندارید.";
  if (status === 404) return "موردی پیدا نشد.";
  if (status === 409) return "این عملیات با وضعیت فعلی سازگار نیست.";
  if (status === 429) return "درخواست‌ها زیاد است. کمی صبر کنید.";
  if (status >= 500) return "سرور پاسخ نداد. کمی بعد دوباره تلاش کنید.";
  return "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.";
}

/* --------------------------------- state ---------------------------------- */

const state = {
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

const can = (permission) => Boolean(state.admin?.permissions?.includes(permission));
const isSuperAdmin = () => state.admin?.role === "super_admin";
const siteRole = () => String(state.currentSite?.site_role || "");
const canManageMembers = () => ["owner", "admin"].includes(siteRole()) || can("clients.update");
const hasFeature = (name) => Boolean(state.currentSite?.entitlements?.features?.[name]
  ?? state.entitlements?.features?.[name]);

/* --------------------------------- theme ---------------------------------- */

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("#themeIcon").textContent = theme === "light" ? "☾" : "☀";
  $("#themeToggle").setAttribute("aria-label", theme === "light" ? "پوسته تیره" : "پوسته روشن");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f8fafc" : "#0b1220");
  // A viewer in a private window still gets a working toggle; it just forgets.
  try { localStorage.setItem("jarchi.theme", theme); } catch { /* storage blocked */ }
}

/* ------------------------------- navigation ------------------------------- */

/*
 * One list drives the drawer and the bottom bar. `when` is evaluated after
 * /api/me and /api/admin-mini/me have answered, so a tab appears only for
 * someone the server would actually serve it to.
 */
const TABS = [
  { id: "home", label: "خانه", icon: "🏠", primary: true, when: () => true },
  { id: "sites", label: "سایت‌ها", icon: "🌐", primary: true, when: () => state.sites.length > 0 },
  { id: "team", label: "اعضا", icon: "👥", primary: true, when: () => Boolean(state.currentSite) },
  { id: "fields", label: "فیلدها", icon: "🧩", when: () => Boolean(state.currentSite) && ["owner", "admin"].includes(siteRole()) },
  { id: "products", label: "محصولات", icon: "🤖", when: () => Boolean(state.currentSite) && hasFeature("remote_products") },
  { id: "tickets", label: "تیکت‌ها", icon: "🎫", when: () => Boolean(state.currentSite) && hasFeature("remote_tickets") },
  // Orders carry a customer's name, telephone number and address, so the tab
  // is offered only to the two roles the server will actually serve it to.
  { id: "orders", label: "سفارش‌ها", icon: "📦", when: () => Boolean(state.currentSite) && ["owner", "admin"].includes(siteRole()) },
  { id: "billing", label: "اشتراک", icon: "💳", primary: true, when: () => true },
  { id: "account", label: "حساب‌های متصل", icon: "🔗", when: () => Boolean(state.user) },
  { id: "clients", label: "مدیریت سایت‌ها", icon: "🗂", admin: true, when: () => isSuperAdmin() },
  { id: "assign", label: "اعطای دسترسی", icon: "🔑", admin: true, when: () => isSuperAdmin() },
  { id: "users", label: "کاربران", icon: "👤", admin: true, when: () => isSuperAdmin() },
  { id: "plans", label: "پلن‌ها", icon: "🏷", admin: true, when: () => can("plans.view") },
  { id: "observability", label: "مانیتورینگ", icon: "📈", admin: true, when: () => can("audit.view") },
];

const visibleTabs = () => TABS.filter((tab) => { try { return tab.when(); } catch { return false; } });

function renderNav() {
  const tabs = visibleTabs();

  $("#drawerNav").innerHTML = tabs.map((tab) => `
    <li><button data-tab="${tab.id}" ${state.tab === tab.id ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${tab.icon}</span>
      <span>${esc(tab.label)}</span>
      ${tab.admin ? '<span class="chip brand small" style="margin-inline-start:auto">مدیر</span>' : ""}
    </button></li>`).join("");

  // The bottom bar holds the few destinations a thumb needs; the rest live in
  // the drawer, so the bar never becomes a scrolling strip of tiny targets.
  const primary = tabs.filter((tab) => tab.primary).slice(0, 4);
  $("#tabbar").innerHTML = [
    ...primary.map((tab) => `
      <button data-tab="${tab.id}" ${state.tab === tab.id ? 'aria-current="page"' : ""}>
        <span class="nav-icon" aria-hidden="true">${tab.icon}</span><span>${esc(tab.label)}</span>
      </button>`),
    `<button data-drawer="1" aria-label="بیشتر">
       <span class="nav-icon" aria-hidden="true">☰</span><span>بیشتر</span>
     </button>`,
  ].join("");

  $$("[data-tab]").forEach((button) => { button.onclick = () => go(button.dataset.tab); });
  $$("[data-drawer]").forEach((button) => { button.onclick = () => toggleDrawer(true); });
}

function toggleDrawer(open) {
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  $("#menuButton").setAttribute("aria-expanded", open ? "true" : "false");
  scrim.hidden = !open;
  requestAnimationFrame(() => scrim.classList.toggle("open", open));
}

/* --------------------------------- modal ---------------------------------- */

/*
 * Modals are built from a field list rather than raw HTML so a caller cannot
 * accidentally interpolate an unescaped value into the markup, and so every
 * dialog gets the same labels, sizing and 48px targets.
 */
function modal({ title, lead = "", fields = [], confirm = "تایید", tone = "", body = "", onSubmit }) {
  const root = $("#modalRoot");
  const renderField = (field) => {
    if (field.type === "checkbox") {
      return `<label class="check">
        <span>${esc(field.label)}</span>
        <span class="switch">
          <input type="checkbox" name="${esc(field.name)}" ${field.value ? "checked" : ""}>
          <span class="track"></span>
        </span>
      </label>`;
    }
    if (field.type === "select") {
      return `<label class="field"><span>${esc(field.label)}</span>
        <select name="${esc(field.name)}" ${field.required ? "required" : ""}>
          ${(field.options || []).map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(field.value ?? "") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
        </select></label>`;
    }
    if (field.type === "textarea") {
      return `<label class="field"><span>${esc(field.label)}</span>
        <textarea name="${esc(field.name)}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}">${esc(field.value || "")}</textarea></label>`;
    }
    return `<label class="field"><span>${esc(field.label)}</span>
      <input name="${esc(field.name)}" type="${esc(field.inputType || "text")}"
             value="${esc(field.value ?? "")}" placeholder="${esc(field.placeholder || "")}"
             ${field.required ? "required" : ""} ${field.inputMode ? `inputmode="${esc(field.inputMode)}"` : ""}></label>`;
  };

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>
        ${lead ? `<p class="modal-lead">${esc(lead)}</p>` : ""}
        <form id="modalForm" novalidate>
          ${body}
          ${fields.map(renderField).join("")}
          <div class="row-actions">
            <button class="btn ${tone}" type="submit">${esc(confirm)}</button>
            <button class="btn ghost" type="button" id="modalCancel">انصراف</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ""; };
  $("#modalCancel").onclick = close;
  $(".modal-backdrop").onclick = (event) => { if (event.target === event.currentTarget) close(); };

  $("#modalForm").onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.target).entries());
      for (const field of fields) {
        if (field.type === "checkbox") values[field.name] = values[field.name] === "on";
      }
      // The handler closes the dialog itself when it wants to chain into
      // another one, so a follow-up modal is not wiped by this close.
      const keepOpen = await onSubmit(values, { close });
      if (!keepOpen) close();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
    }
  };
  return { close };
}

/** A destructive action always states what it will do before it does it. */
function confirmModal({ title, lead, confirm = "تایید", tone = "danger", onConfirm }) {
  return modal({ title, lead, confirm, tone, fields: [], onSubmit: onConfirm });
}

async function copyText(value, label = "کپی شد") {
  try {
    await navigator.clipboard.writeText(value);
    toast(label);
  } catch {
    // Clipboard access is refused in some in-app webviews; selecting the text
    // is the only thing left that works, so offer that instead of failing.
    toast("امکان کپی خودکار نبود؛ متن را دستی انتخاب کنید", "warn");
  }
}

/* ------------------------------- bootstrap -------------------------------- */

async function exchangeLaunchSession({ keepBearer = false } = {}) {
  if (!sessionToken) return false;
  try {
    await nativeApi("/session/exchange", {
      method: "POST",
      body: JSON.stringify({ session: sessionToken }),
      timeoutMs: 10000,
      omitSessionBearer: true,
    });
    if (!keepBearer) {
      sessionToken = "";
      try { sessionStorage.removeItem("jarchi.session"); } catch { /* private mode */ }
    }
    return true;
  } catch (error) {
    sessionToken = "";
    try { sessionStorage.removeItem("jarchi.session"); } catch { /* private mode */ }
    if (error?.status === 401) {
      throw new Error(platform === "bale"
        ? "نشست بله منقضی شده است؛ پنل را دوباره از ربات جارچی باز کنید."
        : "نشست منقضی شده است؛ پنل را دوباره از ربات جارچی باز کنید.");
    }
    throw error;
  }
}

async function establishSession() {
  // A /panel link is minted by our own bot and is therefore the most
  // deterministic credential in Bale Web. Prefer it even when the SDK also
  // exposes initData; this keeps the embedded web client independent of SDK
  // timing/signature quirks. Direct Bale Mini App launches without a bot link
  // still authenticate with validated initData below.
  if (platform === "bale" && sessionToken) {
    await exchangeLaunchSession({ keepBearer: true });
    return;
  }

  if (initData) {
    sessionToken = "";
    if (platform !== "bale") {
      try { sessionStorage.removeItem("jarchi.session"); } catch { /* private mode */ }
    }
    return;
  }

  if (!sessionToken) return;
  await exchangeLaunchSession({ keepBearer: false });
}

async function bootstrap() {
  try {
    window.__JARCHI_BOOT_STAGE__ = "platform_context";
    await waitForPlatformAuthContext();
    window.__JARCHI_BOOT_STAGE__ = "session_exchange";
    await establishSession();
    window.__JARCHI_BOOT_STAGE__ = "me";
    const me = await nativeApi("/me");
    state.user = me.user;
    state.subscription = me.subscription;
    state.entitlements = me.entitlements;

    // Being an operator is a separate question from being a customer, and not
    // being one is the normal case — so a refusal here is not an error.
    window.__JARCHI_BOOT_STAGE__ = "admin_me";
    state.admin = await adminApi("/me").then((result) => result.admin).catch(() => null);

    window.__JARCHI_BOOT_STAGE__ = "initial_data";
    const [sites, health, account] = await Promise.all([
      nativeApi("/sites").catch(() => ({ sites: [] })),
      nativeApi("/health").catch(() => ({})),
      nativeApi("/account/identities").catch(() => ({ account: null })),
    ]);
    state.sites = sites.sites || [];
    state.currentSite = state.sites[0] || null;
    state.version = health.version || "";
    state.account = account.account || null;

    window.__JARCHI_BOOT_STAGE__ = "render";
    renderIdentity();
    renderNav();
    await go(params.get("tab") || "home");
    window.__JARCHI_BOOT_STAGE__ = "ready";
    clearTimeout(BOOT_WATCHDOG);
  } catch (error) {
    renderNav();
    clearTimeout(BOOT_WATCHDOG);
    errorState(error.message, { retry: true });
    $("#content").insertAdjacentHTML("beforeend",
      '<p class="muted small" style="text-align:center">اگر این پیام تکرار شد، پنل را از داخل ربات دوباره باز کنید.</p>');
  }
}

function renderIdentity() {
  const name = state.user?.display_name || state.user?.username || "کاربر جارچی";
  $("#drawerName").textContent = name;
  $("#drawerAvatar").textContent = initials(name);
  $("#drawerMeta").textContent = state.admin
    ? `${roleLabel(state.admin.role)} · ${platformLabel()}`
    : platformLabel();
  $("#versionLabel").textContent = state.version ? `نسخه ${state.version}` : "";

  const badge = $("#roleBadge");
  if (state.admin) {
    badge.hidden = false;
    badge.textContent = roleLabel(state.admin.role);
  } else {
    badge.hidden = true;
  }

  const switcher = $("#drawerSite");
  if (state.sites.length > 1) {
    switcher.hidden = false;
    $("#siteSwitcher").innerHTML = state.sites
      .map((site) => `<option value="${esc(site.id)}" ${state.currentSite?.id === site.id ? "selected" : ""}>${esc(site.name || site.id)}</option>`)
      .join("");
    $("#siteSwitcher").onchange = (event) => {
      state.currentSite = state.sites.find((site) => site.id === event.target.value) || null;
      renderNav();
      go(state.tab);
    };
  } else {
    switcher.hidden = true;
  }
}

const ROLE_LABELS = {
  super_admin: "مدیر ارشد", admin: "مدیر", support: "پشتیبان", viewer: "بازدیدکننده", owner: "مالک",
};
const roleLabel = (role) => ROLE_LABELS[String(role || "").toLowerCase()] || String(role || "—");
const platformLabel = () => ({ telegram: "تلگرام", bale: "بله", web: "وب" }[platform] || platform);

const SCREENS = {};

async function go(tab) {
  const target = SCREENS[tab] ? tab : "home";
  state.tab = target;
  toggleDrawer(false);
  renderNav();
  $("#pageTitle").textContent = TABS.find((item) => item.id === target)?.label || "مرکز کنترل";
  $("#content").scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    await SCREENS[target]();
  } catch (error) {
    errorState(error.message);
  }
}

/* --------------------------------- home ----------------------------------- */

SCREENS.home = async function home() {
  skeleton(2);
  const site = state.currentSite;
  const subscription = state.subscription;

  $("#content").innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">مرکز کنترل</span>
        <h2>${esc(state.user?.display_name || "خوش آمدید")}</h2>
        <p>سایت، اعضا، فیلدها و اشتراک را از همین‌جا مدیریت کنید.</p>
      </div>
      <div class="hero-icon" aria-hidden="true">✦</div>
    </div>

    <div class="grid-2">
      <div class="stat"><small>سایت‌ها</small><strong>${n(state.sites.length)}</strong></div>
      <div class="stat"><small>نقش شما</small><strong>${esc(site ? roleLabel(site.site_role) : "—")}</strong></div>
      <div class="stat"><small>پلن</small><strong>${esc(subscription?.plan_name || "بدون اشتراک")}</strong></div>
      <div class="stat"><small>مانده</small><strong>${subscription ? `${n(daysLeft(subscription.expires_at))} روز` : "—"}</strong></div>
    </div>

    ${site ? `<section class="card">
      <h3>${esc(site.name || site.id)}</h3>
      <div class="chips" style="margin:var(--space-2) 0 var(--space-3)">
        <span class="chip ${site.enabled ? "ok" : "bad"}">${site.enabled ? "فعال" : "غیرفعال"}</span>
        <span class="chip">${site.telegram_channel_id ? "تلگرام ✓" : "تلگرام —"}</span>
        <span class="chip">${site.bale_chat_id ? "بله ✓" : "بله —"}</span>
      </div>
      <dl class="kv">
        <dt>آدرس</dt><dd class="mono">${esc(site.wordpress_url || "—")}</dd>
        <dt>آخرین انتشار</dt><dd>${ago(site.last_publication_at)}</dd>
        <dt>آخرین وبهوک</dt><dd>${ago(site.last_webhook_at)}</dd>
      </dl>
    </section>` : emptyState("🌐", "هنوز سایتی به شما متصل نیست",
      "پس از اتصال افزونه وردپرس، سایت شما این‌جا ظاهر می‌شود.")}

    ${renderCapabilities()}`;
};

function renderCapabilities() {
  const features = state.currentSite?.entitlements?.features || state.entitlements?.features;
  if (!features) return "";
  const labels = {
    site_control: "کنترل سایت", remote_tickets: "تیکت از راه دور",
    remote_announcements: "اطلاعیه", remote_products: "محصولات هوشمند", analytics: "گزارش‌ها",
  };
  return `<section class="card">
    <h3>امکانات اشتراک شما</h3>
    <div class="chips" style="margin-top:var(--space-3)">
      ${Object.entries(labels).map(([key, label]) =>
        `<span class="chip ${features[key] ? "ok" : ""}">${esc(label)} ${features[key] ? "✓" : "—"}</span>`).join("")}
    </div>
  </section>`;
}

/* -------------------------------- my sites -------------------------------- */

SCREENS.sites = async function sites() {
  skeleton(3);
  const refreshed = await nativeApi("/sites");
  state.sites = refreshed.sites || [];
  if (state.currentSite) {
    state.currentSite = state.sites.find((site) => site.id === state.currentSite.id) || state.sites[0] || null;
  }
  renderIdentity();

  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">اتصال‌ها</span><h2>سایت‌های من</h2></div>
    </div>
    ${state.sites.length ? state.sites.map(siteCard).join("")
      : emptyState("🌐", "سایتی ثبت نشده", "اتصال سایت از طریق افزونه وردپرس انجام می‌شود.")}`;

  $$("[data-select-site]").forEach((button) => {
    button.onclick = () => {
      state.currentSite = state.sites.find((site) => site.id === button.dataset.selectSite) || null;
      renderIdentity();
      renderNav();
      toast(`سایت فعال: ${state.currentSite?.name || ""}`);
      go("team");
    };
  });
};

function siteCard(site) {
  const active = state.currentSite?.id === site.id;
  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(site.name || site.id)}</div>
          <div class="record-meta">
            <span class="mono">${esc(site.wordpress_url || "—")}</span>
          </div>
        </div>
        <span class="chip ${site.enabled ? "ok" : "bad"}">${site.enabled ? "فعال" : "غیرفعال"}</span>
      </div>
      <div class="chips" style="margin-top:var(--space-2)">
        <span class="chip brand">${esc(roleLabel(site.site_role))}</span>
        <span class="chip">${site.telegram_channel_id ? "تلگرام ✓" : "تلگرام —"}</span>
        <span class="chip">${site.bale_chat_id ? "بله ✓" : "بله —"}</span>
        <span class="chip">${site.remote_access ? "کنترل از راه دور ✓" : "کنترل از راه دور —"}</span>
      </div>
    </div>
    <div class="record-actions">
      <button class="btn ${active ? "ghost" : ""} small" data-select-site="${esc(site.id)}" ${active ? "disabled" : ""}>
        ${active ? "سایت فعال" : "انتخاب"}
      </button>
    </div>
  </article>`;
}

/* ------------------------------ site members ------------------------------ */

SCREENS.team = async function team() {
  const site = state.currentSite;
  if (!site) {
    $("#content").innerHTML = emptyState("👥", "ابتدا یک سایت انتخاب کنید");
    return;
  }

  skeleton(3);
  const data = await nativeApi(`/sites/${encodeURIComponent(site.id)}/members`);
  const manage = data.can_manage;

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(site.name || site.id)}</span>
        <h2>اعضای سایت</h2>
        <p class="muted small">نقش شما: ${esc(roleLabel(data.site_role))}</p>
      </div>
      ${manage ? '<button class="btn" id="addMember">+ افزودن عضو</button>' : ""}
    </div>

    ${manage ? "" : '<div class="notice">شما به‌عنوان پشتیبان فقط می‌توانید اعضا را ببینید. تغییر دسترسی‌ها با مالک یا مدیر سایت است.</div>'}

    ${data.owner ? memberRow(data.owner, { manage: false }) : ""}
    ${data.members.length
      ? data.members.map((member) => memberRow(member, { manage })).join("")
      : emptyState("👤", "عضو دیگری ثبت نشده",
          manage ? "با شناسه تلگرام یا بله می‌توانید همکار اضافه کنید." : "")}`;

  if (manage) $("#addMember").onclick = () => addMemberModal(site.id);
  $$("[data-member-role]").forEach((button) => {
    button.onclick = () => changeMemberRoleModal(site.id, button.dataset.memberRole, button.dataset.currentRole);
  });
  $$("[data-member-remove]").forEach((button) => {
    button.onclick = () => removeMemberModal(site.id, button.dataset.memberRemove, button.dataset.memberName);
  });
};

function memberRow(member, { manage }) {
  const isOwner = member.role === "owner";
  const ids = (member.identities || [])
    .map((identity) => `${identity.platform === "bale" ? "بله" : "تلگرام"}: ${identity.platform_user_id}`)
    .join(" · ");

  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(member.display_name || member.username || `کاربر ${member.user_id}`)}</div>
          <div class="record-meta">
            ${ids ? `<span class="mono">${esc(ids)}</span>` : '<span class="muted">بدون شناسه ثبت‌شده</span>'}
            ${member.created_at ? `<span>${esc(date(member.created_at))}</span>` : ""}
          </div>
        </div>
        <span class="chip ${isOwner ? "brand" : member.role === "admin" ? "ok" : ""}">${esc(roleLabel(member.role))}</span>
      </div>
    </div>
    ${manage && !isOwner ? `<div class="record-actions">
      <button class="btn ghost small" data-member-role="${esc(member.user_id)}" data-current-role="${esc(member.role)}">تغییر نقش</button>
      <button class="btn danger small" data-member-remove="${esc(member.user_id)}" data-member-name="${esc(member.display_name || member.username || "")}">حذف</button>
    </div>` : ""}
  </article>`;
}

function addMemberModal(siteId) {
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
    onSubmit: async (values) => {
      await nativeApi(`/sites/${encodeURIComponent(siteId)}/members`, {
        method: "POST",
        body: JSON.stringify({
          platform: values.platform,
          platform_user_id: String(values.platform_user_id || "").trim(),
          role: values.role,
        }),
      });
      haptic("medium");
      toast("عضو اضافه شد");
      await go("team");
    },
  });
}

function changeMemberRoleModal(siteId, userId, currentRole) {
  modal({
    title: "تغییر نقش",
    lead: "پشتیبان فقط روی سایت کار می‌کند؛ مدیر می‌تواند اعضا را هم تغییر دهد.",
    fields: [
      { name: "role", label: "نقش جدید", type: "select", value: currentRole,
        options: [{ value: "support", label: "پشتیبان" }, { value: "admin", label: "مدیر" }] },
    ],
    confirm: "ذخیره",
    onSubmit: async (values) => {
      await nativeApi(`/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role: values.role }),
      });
      toast("نقش بروزرسانی شد");
      await go("team");
    },
  });
}

function removeMemberModal(siteId, userId, name) {
  confirmModal({
    title: "حذف دسترسی",
    lead: `${name || "این کاربر"} پس از حذف، دیگر به این سایت دسترسی نخواهد داشت. این کار قابل بازگشت است؛ می‌توانید دوباره او را اضافه کنید.`,
    confirm: "حذف دسترسی",
    onConfirm: async () => {
      await nativeApi(`/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
      haptic("medium");
      toast("دسترسی حذف شد");
      await go("team");
    },
  });
}

/* ------------------------------ field control ----------------------------- */

/*
 * The field list belongs to WordPress: the plugin decides what exists and what
 * it is called. What can be changed here is presentation and routing, and every
 * row shows the plugin's own answer next to the override so it is always clear
 * which of the two is in effect.
 */
SCREENS.fields = async function fields() {
  const site = state.currentSite;
  if (!site) { $("#content").innerHTML = emptyState("🧩", "ابتدا یک سایت انتخاب کنید"); return; }

  skeleton(4);

  /*
   * Two kinds of person can edit these, through two different routes.
   *
   * A Jarchi operator goes through the platform RBAC route. A site owner or
   * admin — who is usually not a Jarchi operator at all — goes through the
   * customer route, which authorizes them against their own site.
   *
   * This used to pick the operator route for anybody with an owner/admin site
   * role, so a site owner saw editable controls that answered 403. The screen
   * offered an edit it could not perform.
   */
  const isOperator = can("fields.manage");
  const isSiteManager = hasFeature("site_control") && ["owner", "admin"].includes(siteRole());
  const editable = isOperator || isSiteManager;

  const data = isOperator
    ? await adminApi(`/clients/${encodeURIComponent(site.id)}/fields`)
    : await nativeApi(`/fields/${encodeURIComponent(site.id)}`);
  const list = data.fields || [];

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(site.name || site.id)}</span>
        <h2>فیلدهای انتشار</h2>
        <p class="muted small">فهرست فیلدها از افزونه وردپرس می‌آید؛ این‌جا فقط نمایش و مقصد آن‌ها را تنظیم می‌کنید. هر تغییر روی انتشارهای بعدی تلگرام و بله اثر می‌گذارد.</p>
      </div>
      ${editable ? '<button class="btn ghost" id="fieldPreset">✨ پیشنهاد جارچی</button>' : ""}
    </div>

    ${list.length
      ? `<div id="fieldList">${list.map((field, index) => fieldRow(field, index, list.length, editable)).join("")}</div>`
      : emptyState("🧩", "هنوز فیلدی دریافت نشده",
          "پس از اولین انتشار از وردپرس، فیلدها این‌جا فهرست می‌شوند.")}`;

  if (!editable) return;
  // Same controls as the operator's per-site tab; one implementation so the two
  // screens cannot drift in what a toggle actually does.
  wireFieldControls(site.id, list, () => go("fields"), { operator: isOperator });

  const preset = $("#fieldPreset");
  if (preset) {
    preset.onclick = () => modal({
      title: "پیشنهاد جارچی",
      lead: "یک پیکربندی معقول برای آگهی: عنوان، توضیح کوتاه، قیمت، مکان و راه تماس روشن می‌شوند و بقیه پنهان. بعد از اعمال، هر فیلد را جداگانه می‌توانید تغییر دهید.",
      confirm: "اعمال کن",
      onSubmit: async () => {
        const result = await nativeApi(`/fields/${encodeURIComponent(site.id)}/preset`, {
          method: "POST", body: JSON.stringify({ preset: "jarchi_recommended" }),
        });
        toast(`${n(result.enabled?.length || 0)} فیلد روشن شد`);
        await go("fields");
      },
    });
  }
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
  const key = field.field_key;
  const label = field.effective_label || field.label_override || field.label || key;
  const platforms = field.effective_platforms || {};
  const renamed = Boolean(field.label_override) && field.label_override !== field.label;

  const PLATFORM_LABELS = { telegram: "تلگرام", bale: "بله", whatsapp: "واتساپ" };
  const toggle = (name) => `
    <label class="check" style="min-height:36px">
      <span class="small">${PLATFORM_LABELS[name]}</span>
      <span class="switch">
        <input type="checkbox" data-field-platform="${name}" data-field-key="${esc(key)}"
               ${platforms[name] ? "checked" : ""} ${field.hidden ? "disabled" : ""}
               aria-label="${PLATFORM_LABELS[name]} برای ${esc(label)}">
        <span class="track"></span>
      </span>
    </label>`;

  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(label)}</div>
          <div class="record-meta">
            <span class="mono">${esc(key)}</span>
            ${field.field_type ? `<span>${esc(field.field_type)}</span>` : ""}
            ${renamed ? `<span class="muted">نام افزونه: ${esc(field.label)}</span>` : ""}
          </div>
        </div>
        ${field.hidden ? '<span class="chip bad">پنهان</span>' : ""}
      </div>

      ${editable ? `<div class="grid" style="margin-top:var(--space-2)">
        ${toggle("telegram")}
        ${toggle("bale")}
        ${toggle("whatsapp")}
        <label class="check" style="min-height:36px">
          <span class="small">پنهان از همه پلتفرم‌ها</span>
          <span class="switch">
            <input type="checkbox" data-field-hidden="${esc(key)}" ${field.hidden ? "checked" : ""}
                   aria-label="پنهان کردن ${esc(label)}">
            <span class="track"></span>
          </span>
        </label>
      </div>` : `<div class="chips" style="margin-top:var(--space-2)">
        ${Object.keys(PLATFORM_LABELS).map((name) =>
          `<span class="chip ${platforms[name] ? "ok" : ""}">${PLATFORM_LABELS[name]} ${platforms[name] ? "✓" : "—"}</span>`).join("")}
      </div>`}
    </div>

    ${editable ? `<div class="record-actions">
      <button class="btn ghost small" data-field-label="${esc(key)}"
              data-current-label="${esc(field.label_override || "")}"
              data-plugin-label="${esc(field.label || key)}">نام نمایشی</button>
      <button class="btn ghost small" data-field-move="${esc(key)}" data-direction="-1"
              ${index === 0 ? "disabled" : ""} aria-label="انتقال ${esc(label)} به بالا">↑</button>
      <button class="btn ghost small" data-field-move="${esc(key)}" data-direction="1"
              ${index === total - 1 ? "disabled" : ""} aria-label="انتقال ${esc(label)} به پایین">↓</button>
    </div>` : ""}
  </article>`;
}

/* -------------------------------- billing --------------------------------- */

SCREENS.billing = async function billing() {
  skeleton(3);
  const data = await nativeApi("/plans");
  state.paymentUrl = data.payment_url || state.paymentUrl;
  const subscription = state.subscription;

  $("#content").innerHTML = `
    <div class="section-head"><div><span class="eyebrow">اشتراک</span><h2>پلن‌ها</h2></div></div>

    ${subscription ? `<section class="card">
      <h3>${esc(subscription.plan_name || subscription.plan_id)}</h3>
      <dl class="kv" style="margin-top:var(--space-2)">
        <dt>وضعیت</dt><dd>${esc(subscription.status === "active" ? "فعال" : subscription.status)}</dd>
        <dt>انقضا</dt><dd>${date(subscription.expires_at)} (${n(daysLeft(subscription.expires_at))} روز)</dd>
      </dl>
    </section>` : '<div class="notice">اشتراک فعالی ندارید.</div>'}

    ${(data.plans || []).map(planCard).join("")}

    <div class="notice">پرداخت در مرورگر امن سایت شما انجام می‌شود و پس از تکمیل، اشتراک در همین پنل بروزرسانی می‌گردد.</div>`;

  $$("[data-buy]").forEach((button) => { button.onclick = () => buyPlan(button.dataset.buy); });
};

function planCard(plan) {
  const features = plan.features || {};
  const labels = {
    site_control: "کنترل سایت", remote_tickets: "تیکت", remote_announcements: "اطلاعیه",
    remote_products: "محصولات هوشمند", analytics: "گزارش",
  };
  const included = Object.entries(labels).filter(([key]) => features[key]);

  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(plan.name)}</div>
          <div class="record-meta"><span>${n(plan.duration_days)} روز</span></div>
        </div>
        <strong>${n(plan.price_toman)} تومان</strong>
      </div>
      ${included.length ? `<div class="chips" style="margin-top:var(--space-2)">
        ${included.map(([, label]) => `<span class="chip ok">${esc(label)}</span>`).join("")}
      </div>` : ""}
    </div>
    <div class="record-actions"><button class="btn small" data-buy="${esc(plan.id)}">خرید</button></div>
  </article>`;
}

function buyPlan(planId) {
  if (!state.paymentUrl) { toast("لینک پرداخت هنوز تنظیم نشده است", "error"); return; }
  const url = new URL(state.paymentUrl);
  url.searchParams.set("plan_id", planId);
  url.searchParams.set("source", platform);
  url.searchParams.set("return_to", location.href);
  url.searchParams.set("jarchi_return", "1");
  // Telegram's in-app webview cannot complete a gateway flow; the SDK hands it
  // to the real browser instead, and a plain browser just follows the link.
  if (tg?.openLink) tg.openLink(url.toString());
  else window.location.href = url.toString();
}

/* ========================================================================== *
 *                          operator (admin) screens                          *
 * ========================================================================== */

/* ----------------------------- site management ---------------------------- */

SCREENS.clients = async function clients() {
  skeleton(4);
  const data = await adminApi("/clients?page_size=100");
  state.adminSites = data.clients || data.items || [];

  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">مدیریت</span><h2>سایت‌های مشتریان</h2></div>
      ${can("clients.create") ? '<button class="btn" id="newSite">+ سایت جدید</button>' : ""}
    </div>
    ${state.adminSites.length
      ? state.adminSites.map(adminSiteCard).join("")
      : emptyState("🗂", "هنوز سایتی ثبت نشده", "با دکمه «سایت جدید» اولین مشتری را اضافه کنید.")}`;

  const create = $("#newSite");
  if (create) create.onclick = createSiteModal;
  $$("[data-open-site]").forEach((button) => { button.onclick = () => openSite(button.dataset.openSite); });
};

function adminSiteCard(site) {
  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(site.name || site.id)}</div>
          <div class="record-meta">
            <span class="mono">${esc(site.id)}</span>
            <span>${esc(site.wordpress_url || "—")}</span>
          </div>
        </div>
        <span class="chip ${site.enabled ? "ok" : "bad"}">${site.enabled ? "فعال" : "غیرفعال"}</span>
      </div>
    </div>
    <div class="record-actions">
      <button class="btn ghost small" data-open-site="${esc(site.id)}">مدیریت</button>
    </div>
  </article>`;
}

/**
 * Creating a site produces credentials that exist in readable form exactly
 * once. The dialog that shows them is opened from the create handler after it
 * closes its own dialog, so the parent's cleanup cannot wipe the child.
 */
function createSiteModal() {
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
    onSubmit: async (values, { close }) => {
      const payload = { name: values.name, wordpress_url: values.wordpress_url };
      for (const key of ["owner_telegram_id", "telegram_channel_id", "bale_chat_id"]) {
        const value = String(values[key] || "").trim();
        if (value) payload[key] = value;
      }
      const result = await adminApi("/clients", { method: "POST", body: JSON.stringify(payload) });
      close();
      haptic("medium");
      toast("سایت ساخته شد");
      // Next frame, so this dialog's removal cannot take the next one with it.
      setTimeout(() => credentialsModal(result.client || result.site), 0);
      return true;
    },
  });
}

function credentialsModal(client) {
  if (!client) return;
  const rows = [
    ["شناسه سایت", client.id],
    ["آدرس وبهوک", client.webhook_url || `${location.origin}/webhook`],
    ["رمز وبهوک", client.webhook_secret],
  ].filter(([, value]) => value);

  modal({
    title: "اطلاعات اتصال",
    lead: "این اطلاعات فقط همین یک‌بار نمایش داده می‌شود. رمز وبهوک بعداً قابل بازیابی نیست و در صورت نیاز باید بازتولید شود.",
    body: `<div class="grid">
      ${rows.map(([label, value], index) => `
        <div>
          <div class="small muted">${esc(label)}</div>
          <div class="copy-row">
            <code id="cred${index}">${esc(value)}</code>
            <button class="btn ghost small" type="button" data-copy="${index}">کپی</button>
          </div>
        </div>`).join("")}
      <div class="notice warn">تا وقتی این مقادیر در افزونه وردپرس ثبت نشوند، انتشار از آن سایت کار نخواهد کرد.</div>
    </div>`,
    confirm: "ثبت کردم، ببند",
    onSubmit: async () => { await go("clients"); },
  });

  $$("[data-copy]").forEach((button) => {
    button.onclick = () => copyText($(`#cred${button.dataset.copy}`).textContent, "در حافظه کپی شد");
  });
}

/* ---------------------------- one site, in tabs --------------------------- */

const SITE_TABS = [
  { id: "overview", label: "کلی" },
  { id: "platforms", label: "پلتفرم‌ها" },
  { id: "fields", label: "فیلدها" },
  { id: "members", label: "اعضا" },
  { id: "publications", label: "انتشارها" },
  { id: "webhooks", label: "وبهوک‌ها" },
];

async function openSite(siteId, tab = "overview") {
  skeleton(3);
  const detail = await adminApi(`/clients/${encodeURIComponent(siteId)}`);
  const client = detail.client || detail;

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow mono">${esc(client.id)}</span>
        <h2>${esc(client.name || client.id)}</h2>
      </div>
      <button class="btn ghost small" id="backToClients">بازگشت</button>
    </div>
    <div class="subtabs" role="tablist">
      ${SITE_TABS.map((item) => `<button role="tab" data-site-tab="${item.id}" aria-selected="${item.id === tab}">${esc(item.label)}</button>`).join("")}
    </div>
    <div id="siteTabBody"><div class="skeleton skeleton-card"></div></div>`;

  $("#backToClients").onclick = () => go("clients");
  $$("[data-site-tab]").forEach((button) => {
    button.onclick = () => openSite(siteId, button.dataset.siteTab);
  });

  const body = $("#siteTabBody");
  try {
    if (tab === "overview") await siteOverviewTab(body, client);
    else if (tab === "platforms") await sitePlatformsTab(body, client);
    else if (tab === "fields") await siteFieldsTab(body, client);
    else if (tab === "members") await siteMembersTab(body, client);
    else if (tab === "publications") await sitePublicationsTab(body, client);
    else if (tab === "webhooks") await siteWebhooksTab(body, client);
  } catch (error) {
    body.innerHTML = `<div class="state error"><div class="state-icon">⚠️</div><p>${esc(error.message)}</p></div>`;
  }
}

async function siteOverviewTab(body, client) {
  body.innerHTML = `
    <section class="card">
      <dl class="kv">
        <dt>آدرس وردپرس</dt><dd class="mono">${esc(client.wordpress_url || "—")}</dd>
        <dt>مالک</dt><dd>${esc(client.owner_display_name || client.owner_username || (client.owner_user_id ? `#${client.owner_user_id}` : "تعیین نشده"))}</dd>
        <dt>ساخته شده</dt><dd>${date(client.created_at)}</dd>
        <dt>آخرین انتشار</dt><dd>${ago(client.last_publication_at)}</dd>
        <dt>آخرین وبهوک</dt><dd>${ago(client.last_webhook_at)}</dd>
      </dl>
    </section>

    <section class="card">
      <label class="check">
        <span><strong>سایت فعال است</strong><br><span class="muted small">غیرفعال کردن، انتشار از این سایت را فوراً متوقف می‌کند.</span></span>
        <span class="switch">
          <input type="checkbox" id="siteEnabled" ${client.enabled ? "checked" : ""}
                 ${can("clients.disable") ? "" : "disabled"} aria-label="فعال بودن سایت">
          <span class="track"></span>
        </span>
      </label>
    </section>

    ${can("clients.rotate_secret") ? `<section class="card">
      <h3>رمز وبهوک</h3>
      <p class="muted small">بازتولید رمز، اتصال فعلی افزونه را قطع می‌کند تا رمز جدید در وردپرس ثبت شود.</p>
      <button class="btn danger" id="rotateSecret">بازتولید رمز وبهوک</button>
    </section>` : ""}

    ${can("platforms.test") ? `<section class="card">
      <h3>آزمایش اتصال</h3>
      <p class="muted small">بررسی می‌کند که ربات به کانال یا چت تنظیم‌شده دسترسی دارد.</p>
      <div class="row-actions">
        <button class="btn ghost" data-test-platform="telegram">تلگرام</button>
        <button class="btn ghost" data-test-platform="bale">بله</button>
        <button class="btn ghost" data-test-platform="all">همه</button>
      </div>
      <div id="testResult" style="margin-top:var(--space-3)"></div>
    </section>` : ""}`;

  const toggle = $("#siteEnabled");
  if (toggle && can("clients.disable")) {
    toggle.onchange = async () => {
      toggle.disabled = true;
      try {
        await adminApi(`/clients/${encodeURIComponent(client.id)}/enabled`, {
          method: "POST", body: JSON.stringify({ enabled: toggle.checked }),
        });
        toast(toggle.checked ? "سایت فعال شد" : "سایت غیرفعال شد");
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(error.message, "error");
      } finally { toggle.disabled = false; }
    };
  }

  const rotate = $("#rotateSecret");
  if (rotate) {
    rotate.onclick = () => confirmModal({
      title: "بازتولید رمز وبهوک",
      lead: "رمز فعلی بلافاصله باطل می‌شود و افزونه وردپرس این سایت تا ثبت رمز جدید کار نخواهد کرد. رمز جدید فقط یک‌بار نمایش داده می‌شود.",
      confirm: "بله، رمز را بازتولید کن",
      onConfirm: async (values, { close }) => {
        const result = await adminApi(`/clients/${encodeURIComponent(client.id)}/rotate-secret`, { method: "POST" });
        close();
        setTimeout(() => credentialsModal({
          id: client.id,
          webhook_url: result.client?.webhook_url,
          webhook_secret: result.client?.webhook_secret,
        }), 0);
        return true;
      },
    });
  }

  $$("[data-test-platform]").forEach((button) => {
    button.onclick = async () => {
      const target = button.dataset.testPlatform;
      const result = $("#testResult");
      result.innerHTML = '<div class="skeleton skeleton-line"></div>';
      button.disabled = true;
      try {
        const path = target === "all"
          ? `/clients/${encodeURIComponent(client.id)}/test`
          : `/clients/${encodeURIComponent(client.id)}/test/${target}`;
        const response = await adminApi(path, { method: "POST", body: JSON.stringify({ mode: "check" }) });
        const items = response.test?.results || [response.test];
        result.innerHTML = items.map((item) => `
          <div class="record" style="margin:0 0 var(--space-2)">
            <div class="record-main">
              <span>${esc(item.platform || target)}</span>
              <span class="chip ${item.ok ? "ok" : "bad"}">${item.ok ? "متصل" : esc(item.error || "ناموفق")}</span>
            </div>
          </div>`).join("");
      } catch (error) {
        result.innerHTML = `<div class="notice danger">${esc(error.message)}</div>`;
      } finally { button.disabled = false; }
    };
  });
}

async function sitePlatformsTab(body, client) {
  const row = (label, value, hint) => `
    <div class="record" style="margin-bottom:var(--space-2)">
      <div>
        <div class="record-main">
          <div>
            <div class="record-title">${esc(label)}</div>
            <div class="record-meta"><span class="mono">${esc(value || "تنظیم نشده")}</span></div>
          </div>
          <span class="chip ${value ? "ok" : ""}">${value ? "تنظیم شده" : "خالی"}</span>
        </div>
        <p class="muted small" style="margin:var(--space-2) 0 0">${esc(hint)}</p>
      </div>
    </div>`;

  body.innerHTML = `
    ${row("کانال تلگرام", client.telegram_channel_id, "شناسه یا نام کاربری کانالی که آگهی‌ها در آن منتشر می‌شود.")}
    ${row("چت بله", client.bale_chat_id, "شناسه عددی چت یا کانال بله.")}
    ${row("واتساپ", client.whatsapp_target, "در صورت فعال بودن سرویس واتساپ.")}
    <div class="notice">توکن‌ها و اطلاعات ورود پلتفرم‌ها فقط در سرور نگهداری می‌شوند و هرگز در این پنل نمایش داده نمی‌شوند.</div>
    ${can("clients.update") ? '<button class="btn" id="editTargets">ویرایش مقصدها</button>' : ""}`;

  const edit = $("#editTargets");
  if (edit) {
    edit.onclick = () => modal({
      title: "مقصدهای انتشار",
      lead: "خالی گذاشتن هر کادر، انتشار روی آن پلتفرم را متوقف می‌کند.",
      fields: [
        { name: "telegram_channel_id", label: "کانال تلگرام", value: client.telegram_channel_id || "" },
        { name: "bale_chat_id", label: "چت بله", value: client.bale_chat_id || "" },
      ],
      confirm: "ذخیره",
      onSubmit: async (values) => {
        await adminApi(`/clients/${encodeURIComponent(client.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            telegram_channel_id: String(values.telegram_channel_id || "").trim(),
            bale_chat_id: String(values.bale_chat_id || "").trim(),
          }),
        });
        toast("مقصدها ذخیره شد");
        await openSite(client.id, "platforms");
      },
    });
  }
}

async function siteFieldsTab(body, client) {
  const data = await adminApi(`/clients/${encodeURIComponent(client.id)}/fields`);
  const list = data.fields || [];
  const editable = can("fields.manage");

  body.innerHTML = list.length
    ? `<p class="muted small">فهرست از افزونه وردپرس می‌آید. تغییرات این‌جا با انتشار بعدی بازنویسی نمی‌شود.</p>
       ${list.map((field, index) => fieldRow(field, index, list.length, editable)).join("")}`
    : emptyState("🧩", "فیلدی دریافت نشده", "پس از اولین انتشار از وردپرس، فیلدها این‌جا فهرست می‌شوند.");

  if (!editable) return;
  wireFieldControls(client.id, list, () => openSite(client.id, "fields"));
}

/** Shared by the customer field screen and the admin site tab. */
function wireFieldControls(siteId, list, refresh, { operator = true } = {}) {
  /*
   * The same three controls, through whichever route the viewer is entitled to.
   *
   * A Jarchi operator writes through the platform RBAC route; a site owner or
   * admin writes through the customer route, authorized against their own site.
   * Both end at setFieldOverride and therefore at the same column the
   * publication formatter reads — there is no second copy of this
   * configuration, and a toggle here changes the next real message.
   */
  const writeField = (key, patch) => (operator
    ? adminApi(`/clients/${encodeURIComponent(siteId)}/fields/${encodeURIComponent(key)}`, {
      method: "PATCH", body: JSON.stringify(patch),
    })
    : nativeApi(`/fields/${encodeURIComponent(siteId)}/${encodeURIComponent(key)}`, {
      method: "PATCH", body: JSON.stringify(patch),
    }));

  $$("[data-field-platform]").forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      try {
        await writeField(input.dataset.fieldKey, { platforms: { [input.dataset.fieldPlatform]: input.checked } });
        toast("بروزرسانی شد");
      } catch (error) {
        input.checked = !input.checked;
        toast(error.message, "error");
      } finally { input.disabled = false; }
    };
  });

  $$("[data-field-hidden]").forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      try {
        await writeField(input.dataset.fieldHidden, { hidden: input.checked });
        toast(input.checked ? "فیلد پنهان شد" : "فیلد نمایش داده می‌شود");
        await refresh();
      } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        toast(error.message, "error");
      }
    };
  });

  $$("[data-field-label]").forEach((button) => {
    button.onclick = () => modal({
      title: "نام نمایشی فیلد",
      lead: `افزونه وردپرس این فیلد را «${button.dataset.pluginLabel}» می‌نامد. برای بازگشت به آن، کادر را خالی بگذارید.`,
      fields: [{ name: "label", label: "نام نمایشی", value: button.dataset.currentLabel, placeholder: button.dataset.pluginLabel }],
      confirm: "ذخیره",
      onSubmit: async (values) => {
        const label = String(values.label || "").trim();
        await writeField(button.dataset.fieldLabel, { label_override: label || null });
        toast(label ? "ذخیره شد" : "به نام افزونه بازگشت");
        await refresh();
      },
    });
  });

  $$("[data-field-move]").forEach((button) => {
    button.onclick = async () => {
      const order = list.map((field) => field.field_key);
      const from = order.indexOf(button.dataset.fieldMove);
      const to = from + Number(button.dataset.direction);
      if (from < 0 || to < 0 || to >= order.length) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      try {
        await (operator
          ? adminApi(`/clients/${encodeURIComponent(siteId)}/fields/reorder`, {
            method: "POST", body: JSON.stringify({ order }),
          })
          : nativeApi(`/fields/${encodeURIComponent(siteId)}/reorder`, {
            method: "POST", body: JSON.stringify({ order }),
          }));
        haptic();
        await refresh();
      } catch (error) { toast(error.message, "error"); }
    };
  });
}

async function siteMembersTab(body, client) {
  const data = await adminApi(`/clients/${encodeURIComponent(client.id)}/members`);
  const manage = can("clients.update");

  body.innerHTML = `
    ${manage ? '<button class="btn block" id="adminAddMember" style="margin-bottom:var(--space-3)">+ افزودن عضو با شناسه</button>' : ""}
    ${data.owner ? memberRow(data.owner, { manage: false }) : '<div class="notice warn">مالکی برای این سایت تعیین نشده است.</div>'}
    ${data.members.length ? data.members.map((member) => memberRow(member, { manage })).join("")
      : emptyState("👤", "عضو دیگری ثبت نشده")}`;

  const refresh = () => openSite(client.id, "members");
  const add = $("#adminAddMember");
  if (add) {
    add.onclick = () => modal({
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
      onSubmit: async (values) => {
        await adminApi(`/clients/${encodeURIComponent(client.id)}/members`, {
          method: "POST",
          body: JSON.stringify({
            platform: values.platform,
            platform_user_id: String(values.platform_user_id || "").trim(),
            role: values.role,
          }),
        });
        toast("عضو اضافه شد");
        await refresh();
      },
    });
  }

  $$("[data-member-role]").forEach((button) => {
    button.onclick = () => modal({
      title: "تغییر نقش",
      fields: [{ name: "role", label: "نقش جدید", type: "select", value: button.dataset.currentRole,
        options: [{ value: "support", label: "پشتیبان" }, { value: "admin", label: "مدیر سایت" }] }],
      confirm: "ذخیره",
      onSubmit: async (values) => {
        await adminApi(`/clients/${encodeURIComponent(client.id)}/members/${encodeURIComponent(button.dataset.memberRole)}`, {
          method: "PATCH", body: JSON.stringify({ role: values.role }),
        });
        toast("نقش بروزرسانی شد");
        await refresh();
      },
    });
  });

  $$("[data-member-remove]").forEach((button) => {
    button.onclick = () => confirmModal({
      title: "حذف دسترسی",
      lead: `${button.dataset.memberName || "این کاربر"} پس از حذف دیگر به این سایت دسترسی نخواهد داشت.`,
      confirm: "حذف",
      onConfirm: async () => {
        await adminApi(`/clients/${encodeURIComponent(client.id)}/members/${encodeURIComponent(button.dataset.memberRemove)}`, { method: "DELETE" });
        toast("دسترسی حذف شد");
        await refresh();
      },
    });
  });
}

async function sitePublicationsTab(body, client) {
  const data = await adminApi(`/clients/${encodeURIComponent(client.id)}/publications?page_size=25`);
  const items = data.items || data.publications || [];

  body.innerHTML = items.length ? items.map((item) => `
    <article class="record">
      <div>
        <div class="record-main">
          <div>
            <div class="record-title">${esc(item.title || `پست ${item.post_id}`)}</div>
            <div class="record-meta">
              <span>${esc(item.platform)}</span>
              <span>${ago(item.created_at)}</span>
            </div>
          </div>
          <span class="chip ${item.status === "published" ? "ok" : item.status === "failed" ? "bad" : "warn"}">${esc(item.status)}</span>
        </div>
        ${item.error ? `<p class="muted small" style="margin:var(--space-2) 0 0">${esc(item.error)}</p>` : ""}
      </div>
    </article>`).join("") : emptyState("📢", "هنوز انتشاری ثبت نشده");
}

async function siteWebhooksTab(body, client) {
  const data = await adminApi(`/clients/${encodeURIComponent(client.id)}/webhooks?page_size=25`);
  const items = data.items || data.events || [];

  body.innerHTML = items.length ? items.map((item) => `
    <article class="record">
      <div>
        <div class="record-main">
          <div>
            <div class="record-title">${esc(item.event_type || "webhook")}</div>
            <div class="record-meta">
              <span>${ago(item.created_at)}</span>
              ${item.post_id ? `<span class="mono">#${esc(item.post_id)}</span>` : ""}
              ${item.auth_result ? `<span>${esc(item.auth_result)}</span>` : ""}
              ${item.duration_ms ? `<span>${n(item.duration_ms)}ms</span>` : ""}
            </div>
          </div>
          <span class="chip ${Number(item.http_status) < 400 ? "ok" : "bad"}">${esc(item.http_status ?? "—")}</span>
        </div>
        ${item.error ? `<p class="muted small" style="margin:var(--space-2) 0 0">${esc(item.error)}</p>` : ""}
      </div>
    </article>`).join("") : emptyState("🔗", "رویداد وبهوکی ثبت نشده");
}

/* ------------------------------ quick assign ------------------------------ */

/*
 * Grants a person access to a site by the id an operator actually has in front
 * of them. The lookup runs before anything is granted, so the confirmation says
 * who is about to receive access rather than just echoing a number back.
 */
SCREENS.assign = async function assign() {
  skeleton(2);
  const [sitesResult, recent] = await Promise.all([
    adminApi("/clients?page_size=100"),
    adminApi("/clients/assignments?limit=10").catch(() => ({ assignments: [] })),
  ]);
  state.adminSites = sitesResult.clients || sitesResult.items || [];
  state.assignments = recent.assignments || [];

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">مدیریت</span>
        <h2>اعطای دسترسی سریع</h2>
        <p class="muted small">با شناسه تلگرام یا بله، به یک نفر روی یک سایت دسترسی بدهید.</p>
      </div>
    </div>

    <section class="card">
      <form id="assignForm">
        <label class="field"><span>پلتفرم</span>
          <select name="platform">
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
          </select>
        </label>
        <label class="field"><span>شناسه عددی کاربر</span>
          <input name="platform_user_id" inputmode="numeric" required placeholder="مثلاً ۱۲۳۴۵۶۷۸۹">
        </label>
        <label class="field"><span>سایت</span>
          <select name="site_id" required>
            <option value="">انتخاب کنید…</option>
            ${state.adminSites.map((site) => `<option value="${esc(site.id)}">${esc(site.name || site.id)}</option>`).join("")}
          </select>
        </label>
        <label class="field"><span>نقش</span>
          <select name="role" required>
            <option value="support">پشتیبان — کار روی سایت</option>
            <option value="admin">مدیر — مدیریت اعضا هم دارد</option>
            <option value="owner">مالک — انتقال مالکیت سایت</option>
          </select>
        </label>
        <button class="btn block" type="submit">بررسی و اعطای دسترسی</button>
      </form>
    </section>

    <section>
      <h3 style="margin-bottom:var(--space-3)">۱۰ تغییر دسترسی اخیر</h3>
      ${state.assignments.length
        ? state.assignments.map(assignmentRow).join("")
        : emptyState("🔑", "هنوز دسترسی‌ای ثبت نشده")}
    </section>`;

  $("#assignForm").onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(event.target).entries());
    const platformUserId = String(values.platform_user_id || "").trim();
    submit.disabled = true;

    try {
      // Resolve first, so the confirmation names a person, not a number.
      const found = await adminApi(`/clients/lookup/${values.platform}/${encodeURIComponent(platformUserId)}`);
      const site = state.adminSites.find((item) => item.id === values.site_id);
      const person = found.user.display_name || found.user.username || `کاربر ${found.user.id}`;

      confirmModal({
        title: "تایید اعطای دسترسی",
        lead: values.role === "owner"
          ? `مالکیت «${site?.name || values.site_id}» به ${person} منتقل می‌شود. مالک فعلی به‌عنوان مدیر سایت باقی می‌ماند.`
          : `${person} با نقش «${roleLabel(values.role)}» به «${site?.name || values.site_id}» اضافه می‌شود.`,
        confirm: "اعطای دسترسی",
        tone: values.role === "owner" ? "danger" : "",
        onConfirm: async () => {
          await adminApi("/clients/assign", {
            method: "POST",
            body: JSON.stringify({
              platform: values.platform,
              platform_user_id: platformUserId,
              site_id: values.site_id,
              role: values.role,
            }),
          });
          haptic("medium");
          toast("دسترسی اعطا شد");
          await go("assign");
        },
      });
    } catch (error) {
      // "has not started the bot" is the common case and is already phrased
      // as an instruction by the server, so it is shown as-is.
      toast(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  };
};

const ASSIGNMENT_LABELS = {
  "site.role.assign": "اعطای دسترسی",
  "site.member.add": "افزودن عضو",
  "site.member.role": "تغییر نقش",
  "site.member.remove": "حذف دسترسی",
};

function assignmentRow(entry) {
  const meta = entry.metadata || {};
  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(ASSIGNMENT_LABELS[entry.action] || entry.action)}</div>
          <div class="record-meta">
            <span>${esc(entry.site_name || entry.site_id)}</span>
            ${meta.user_id ? `<span class="mono">#${esc(meta.user_id)}</span>` : ""}
            <span>${ago(entry.created_at)}</span>
          </div>
        </div>
        ${meta.role ? `<span class="chip ${entry.success === false ? "bad" : "brand"}">${esc(roleLabel(meta.role))}</span>` : ""}
      </div>
      ${entry.actor_label ? `<div class="record-meta"><span class="muted">توسط ${esc(entry.actor_label)}</span></div>` : ""}
    </div>
  </article>`;
}

/* ------------------------------ AI products ------------------------------- */

/*
 * The AI product workflow from 2.1.x, in the new shell. The backend contract is
 * unchanged: a draft is created, jobs run asynchronously, and the draft is
 * approved before it can be published to WooCommerce.
 */
const PRODUCT_STATUS = {
  draft: "پیش‌نویس", generating: "در حال تولید", ready: "آماده بررسی",
  approved: "تایید شده", rejected: "رد شده", published: "منتشر شده", failed: "ناموفق",
};
const productStatus = (status) => PRODUCT_STATUS[String(status || "").toLowerCase()] || String(status || "—");

SCREENS.products = async function products() {
  const site = state.currentSite;
  if (!site) { $("#content").innerHTML = emptyState("🤖", "ابتدا یک سایت انتخاب کنید"); return; }

  skeleton(3);
  const [data, status] = await Promise.all([
    nativeApi(`/ai/products?site_id=${encodeURIComponent(site.id)}&page_size=30`),
    nativeApi("/ai/status").catch(() => ({ ai: { available: false } })),
  ]);
  const list = data.products || [];
  const available = status.ai?.available !== false;

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(site.name || site.id)}</span>
        <h2>محصولات هوشمند</h2>
        <p class="muted small">تولید محتوا، سئو، تصویر و انتشار در ووکامرس.</p>
      </div>
      ${available ? '<button class="btn" id="newProduct">+ محصول جدید</button>' : ""}
    </div>

    ${available ? "" : '<div class="notice warn">سرویس هوش مصنوعی در این نصب فعال نیست. محصولات موجود قابل مشاهده‌اند اما تولید تازه انجام نمی‌شود.</div>'}

    ${list.length ? list.map(productCard).join("")
      : emptyState("🤖", "هنوز محصولی نساخته‌اید", "با «محصول جدید» شروع کنید؛ توضیح کوتاه کافی است.")}`;

  const create = $("#newProduct");
  if (create) create.onclick = () => newProductModal(site.id);
  $$("[data-open-product]").forEach((button) => {
    button.onclick = () => openProduct(button.dataset.openProduct);
  });
};

function productCard(product) {
  const status = String(product.status || "draft").toLowerCase();
  const tone = status === "published" || status === "approved" ? "ok"
    : status === "failed" || status === "rejected" ? "bad"
    : status === "generating" ? "warn" : "";

  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(product.title || "محصول بدون عنوان")}</div>
          <div class="record-meta">
            <span>${ago(product.updated_at || product.created_at)}</span>
            ${product.price ? `<span>${n(product.price)} تومان</span>` : ""}
          </div>
        </div>
        <span class="chip ${tone}">${esc(productStatus(status))}</span>
      </div>
      ${product.short_description || product.description
        ? `<p class="muted small" style="margin:var(--space-2) 0 0">${esc(String(product.short_description || product.description).slice(0, 140))}</p>`
        : ""}
    </div>
    <div class="record-actions">
      <button class="btn ghost small" data-open-product="${esc(product.id)}">باز کردن</button>
    </div>
  </article>`;
}

function newProductModal(siteId) {
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
    onSubmit: async (values) => {
      const result = await nativeApi("/ai/products", {
        method: "POST",
        // A retried submit must not create a second draft.
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          site_id: siteId,
          input: { title: values.title, description: values.description, price: values.price },
          generate: values.generate === true,
        }),
      });
      toast("محصول ایجاد شد");
      if (result.product?.id) await openProduct(result.product.id);
      else await go("products");
    },
  });
}

async function openProduct(id) {
  skeleton(3);
  const result = await nativeApi(`/ai/products/${encodeURIComponent(id)}`);
  const product = result.product;
  const job = result.job;

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow mono">#${esc(product.id)}</span>
        <h2>${esc(product.title || "بدون عنوان")}</h2>
      </div>
      <button class="btn ghost small" id="backProducts">بازگشت</button>
    </div>

    <div class="chips" style="margin-bottom:var(--space-3)">
      <span class="chip">${esc(productStatus(product.status))}</span>
      ${product.version ? `<span class="chip">نسخه ${n(product.version)}</span>` : ""}
      ${product.wc_product_id ? `<span class="chip ok">ووکامرس #${esc(product.wc_product_id)}</span>` : '<span class="chip">منتشر نشده</span>'}
      ${job && ["queued", "running"].includes(job.status) ? '<span class="chip warn">کار AI در حال اجرا</span>' : ""}
    </div>

    <section class="card">
      <label class="field"><span>عنوان</span><input id="pTitle" value="${esc(product.title || "")}"></label>
      <label class="field"><span>قیمت</span><input id="pPrice" inputmode="numeric" value="${esc(product.price ?? "")}"></label>
      <label class="field"><span>توضیحات</span><textarea id="pDesc" rows="6">${esc(product.description || "")}</textarea></label>
      <label class="field"><span>عنوان سئو</span><input id="pSeoTitle" value="${esc(product.seo_title || "")}"></label>
      <label class="field"><span>توضیح متا</span><textarea id="pMeta" rows="3">${esc(product.meta_description || "")}</textarea></label>
      <label class="field"><span>برچسب‌ها (با ویرگول)</span><input id="pTags" value="${esc((product.tags || []).join("، "))}"></label>
      <button class="btn block" id="saveProduct">ذخیره تغییرات</button>
    </section>

    <section class="card">
      <h3>عملیات</h3>
      <div class="row-actions" style="margin-top:var(--space-3)">
        <button class="btn ghost" id="regen">تولید مجدد محتوا</button>
        <button class="btn ghost" id="genImage">ساخت تصویر</button>
        ${product.status === "approved" || product.status === "published" ? "" : '<button class="btn" id="approve">تایید</button>'}
        ${product.status === "approved" ? '<button class="btn" id="publish">انتشار در ووکامرس</button>' : ""}
      </div>
    </section>`;

  $("#backProducts").onclick = () => go("products");

  $("#saveProduct").onclick = async (event) => {
    event.target.disabled = true;
    try {
      await nativeApi(`/ai/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: $("#pTitle").value,
          price: $("#pPrice").value,
          description: $("#pDesc").value,
          seo_title: $("#pSeoTitle").value,
          meta_description: $("#pMeta").value,
          tags: $("#pTags").value.split(/[،,]/).map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      toast("ذخیره شد");
    } catch (error) { toast(error.message, "error"); }
    finally { event.target.disabled = false; }
  };

  const queue = (path, body, message) => async (event) => {
    event.target.disabled = true;
    try {
      await nativeApi(`/ai/products/${encodeURIComponent(id)}/${path}`, { method: "POST", body: JSON.stringify(body) });
      toast(message);
      await pollJob(id);
    } catch (error) { toast(error.message, "error"); event.target.disabled = false; }
  };

  $("#regen").onclick = queue("regenerate", { section: "content" }, "درخواست در صف قرار گرفت");
  $("#genImage").onclick = queue("images/generate", { purpose: "product" }, "تولید تصویر در صف قرار گرفت");
  if ($("#approve")) $("#approve").onclick = queue("approve", {}, "تایید شد");
  if ($("#publish")) $("#publish").onclick = queue("publish", {}, "انتشار آغاز شد");
}

/**
 * Waits for an async AI job to settle.
 *
 * Bounded on purpose: a job that has not finished within this window is still
 * running server-side, so the screen says so rather than spinning forever.
 */
async function pollJob(id) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const result = await nativeApi(`/ai/products/${encodeURIComponent(id)}`).catch(() => null);
    const status = result?.job?.status;
    if (["succeeded", "failed", "cancelled"].includes(status)) {
      toast(status === "succeeded" ? "کار هوش مصنوعی انجام شد" : "اجرای هوش مصنوعی پایان یافت",
        status === "succeeded" ? "ok" : "error");
      await openProduct(id);
      return;
    }
  }
  toast("کار هنوز در حال اجراست؛ بعداً دوباره باز کنید", "warn");
  await openProduct(id);
}

/* --------------------------------- tickets -------------------------------- */

const TICKET_STATUS = {
  open: "باز", waiting: "در انتظار", reviewing: "در حال بررسی", answered: "پاسخ داده شده", closed: "بسته",
};
const ticketStatus = (status) => TICKET_STATUS[String(status || "").toLowerCase()] || String(status || "—");

/* --------------------------------- orders ---------------------------------- */

/*
 * WooCommerce orders.
 *
 * Everything on this screen is answered by the server under the same site
 * authorization the rest of the customer API uses, so the list a viewer sees is
 * the list the server would serve them. The tab being hidden for a support
 * member is a convenience, not the control: /api/sites/:id/orders refuses them
 * whether or not the button was rendered.
 */

const ORDER_STATUS_LABELS = {
  pending: "در انتظار پرداخت",
  processing: "در حال انجام",
  "on-hold": "در انتظار بررسی",
  completed: "تکمیل‌شده",
  cancelled: "لغوشده",
  refunded: "بازپرداخت‌شده",
  failed: "ناموفق",
};

const ORDER_STATUS_TONE = {
  completed: "ok",
  processing: "brand",
  pending: "warn",
  "on-hold": "warn",
  cancelled: "bad",
  failed: "bad",
  refunded: "",
};

const orderStatusLabel = (status) => ORDER_STATUS_LABELS[String(status || "")] || String(status || "—");

/** Money, in the shop's own currency, without inventing a figure that is absent. */
function orderMoney(amount, currency = "") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";

  const suffix = { IRT: "تومان", TOMAN: "تومان", IRR: "ریال" }[String(currency || "").toUpperCase()] || currency || "";
  return `${value.toLocaleString("fa-IR", { maximumFractionDigits: 0 })}${suffix ? ` ${suffix}` : ""}`;
}

function orderRow(order) {
  const tone = ORDER_STATUS_TONE[order.status] ?? "";

  return `<article class="record" data-order="${esc(String(order.order_id))}" role="button" tabindex="0">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">#${esc(order.order_number || String(order.order_id))}</div>
          <div class="record-meta">
            <span>${esc(order.customer_name || "مشتری مهمان")}</span>
            <span>${esc(ago(order.created_at))}</span>
          </div>
        </div>
        <span class="chip ${tone}">${esc(orderStatusLabel(order.status))}</span>
      </div>
      <div class="record-meta"><strong>${esc(orderMoney(order.total, order.currency))}</strong></div>
    </div>
  </article>`;
}

SCREENS.orders = async function orders() {
  const site = state.currentSite;
  if (!site) { $("#content").innerHTML = emptyState("📦", "ابتدا یک سایت انتخاب کنید"); return; }

  skeleton(3);

  const filter = state.orderFilter || "";
  const page = Math.max(1, Number(state.orderPage || 1));
  const search = String(state.orderSearch || "");

  // Paged deliberately. A shop with thirty thousand orders must not be asked
  // for all of them because a phone opened a tab.
  const query = new URLSearchParams({ page: String(page), per_page: "20" });
  if (filter) query.set("status", filter);
  if (search) query.set("search", search);

  let data;
  try {
    data = await nativeApi(`/sites/${encodeURIComponent(site.id)}/orders?${query}`);
  } catch (error) {
    $("#content").innerHTML = emptyState("📦", "سفارش‌ها بارگذاری نشد", error.message);
    return;
  }

  const list = data.orders || [];
  const statuses = data.statuses || Object.keys(ORDER_STATUS_LABELS);

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(site.name || site.id)}</span>
        <h2>سفارش‌های ووکامرس</h2>
        <p class="muted small">${n(data.total || 0)} سفارش</p>
      </div>
      <button class="btn ghost" id="orderSettings">تنظیم اعلان</button>
    </div>

    <div class="subtabs" role="tablist">
      ${[["", "همه"], ...statuses.map((value) => [value, orderStatusLabel(value)])]
        .map(([value, label]) => `<button role="tab" data-order-filter="${esc(value)}" aria-selected="${filter === value}">${esc(label)}</button>`)
        .join("")}
    </div>

    <div class="card" style="margin-bottom:var(--space-3)">
      <label class="small" for="orderSearch">جستجو با شمارهٔ سفارش یا نام مشتری</label>
      <input id="orderSearch" type="search" value="${esc(search)}" placeholder="مثلاً 12548" />
    </div>

    ${list.length ? list.map(orderRow).join("") : emptyState("📦", "سفارشی در این وضعیت نیست",
      "سفارش‌ها پس از ثبت در ووکامرس این‌جا فهرست می‌شوند.")}

    ${data.pages > 1 ? `<div class="pager">
      <button class="btn ghost" id="orderPrev" ${page <= 1 ? "disabled" : ""}>قبلی</button>
      <span class="small">صفحهٔ ${n(page)} از ${n(data.pages)}</span>
      <button class="btn ghost" id="orderNext" ${page >= data.pages ? "disabled" : ""}>بعدی</button>
    </div>` : ""}`;

  $$("[data-order-filter]").forEach((button) => {
    button.onclick = () => {
      state.orderFilter = button.dataset.orderFilter;
      state.orderPage = 1;
      go("orders");
    };
  });

  $$("[data-order]").forEach((card) => {
    const open = () => openOrder(site.id, card.dataset.order);
    card.onclick = open;
    card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
  });

  const searchInput = $("#orderSearch");
  if (searchInput) {
    searchInput.onchange = () => {
      state.orderSearch = searchInput.value.trim();
      state.orderPage = 1;
      go("orders");
    };
  }

  const prev = $("#orderPrev");
  if (prev) prev.onclick = () => { state.orderPage = page - 1; go("orders"); };

  const next = $("#orderNext");
  if (next) next.onclick = () => { state.orderPage = page + 1; go("orders"); };

  $("#orderSettings").onclick = () => orderSettingsModal(site.id);
};

/** One order, with the live WooCommerce state when the shop can be reached. */
async function openOrder(siteId, orderId) {
  let data;
  try {
    data = await nativeApi(`/sites/${encodeURIComponent(siteId)}/orders/${encodeURIComponent(orderId)}`);
  } catch (error) {
    toast(error.message, "error");
    return;
  }

  const order = data.order || {};
  const detail = order.detail || {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const statuses = data.statuses || Object.keys(ORDER_STATUS_LABELS);

  const line = (label, value) => (value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : "");

  modal({
    title: `سفارش #${order.order_number || order.order_id}`,
    lead: data.source === "snapshot"
      // Said plainly: the figures are the last thing the shop reported, not a
      // live read, and the operator should know which they are looking at.
      ? "فروشگاه در دسترس نبود؛ این اطلاعات آخرین وضعیت ثبت‌شده است."
      : "",
    body: `
      <div class="chips" style="margin-bottom:var(--space-3)">
        <span class="chip ${ORDER_STATUS_TONE[order.status] ?? ""}">${esc(orderStatusLabel(order.status))}</span>
        <span class="chip">${esc(orderMoney(order.total, order.currency))}</span>
      </div>

      <dl class="kv">
        ${line("مشتری", order.customer_name)}
        ${line("تلفن", order.customer_phone)}
        ${line("ایمیل", order.customer_email)}
        ${line("پرداخت", order.payment_method)}
        ${line("وضعیت پرداخت", detail.payment_status)}
        ${line("ثبت", ago(order.created_at))}
        ${line("آدرس صورتحساب", detail.billing_address)}
        ${line("آدرس ارسال", detail.shipping_address)}
        ${line("یادداشت مشتری", detail.customer_note)}
      </dl>

      ${items.length ? `<h4 style="margin-top:var(--space-3)">کالاها</h4>
        <ul class="plain">${items.map((item) => `
          <li>${esc(item.name)} × ${n(item.quantity)}
            <span class="muted small">${esc(orderMoney(item.total, order.currency))}</span></li>`).join("")}</ul>` : ""}

      <dl class="kv" style="margin-top:var(--space-3)">
        ${line("جمع اقلام", detail.subtotal === null || detail.subtotal === undefined ? "" : orderMoney(detail.subtotal, order.currency))}
        ${line("تخفیف", detail.discount ? orderMoney(detail.discount, order.currency) : "")}
        ${line("ارسال", detail.shipping_total === null || detail.shipping_total === undefined ? "" : orderMoney(detail.shipping_total, order.currency))}
      </dl>

      <h4 style="margin-top:var(--space-3)">تغییر وضعیت</h4>
      <p class="muted small">وضعیت مستقیماً در ووکامرس تغییر می‌کند. تا وقتی وردپرس تأیید نکند، چیزی عوض نمی‌شود.</p>
      <select id="orderStatus">
        ${statuses.map((value) => `<option value="${esc(value)}" ${value === order.status ? "selected" : ""}>${esc(orderStatusLabel(value))}</option>`).join("")}
      </select>`,
    confirm: "ذخیرهٔ وضعیت",
    onSubmit: async () => {
      const wanted = $("#orderStatus")?.value || order.status;
      if (wanted === order.status) return;

      const result = await nativeApi(
        `/sites/${encodeURIComponent(siteId)}/orders/${encodeURIComponent(orderId)}/status`,
        { method: "PATCH", body: JSON.stringify({ status: wanted }) },
      );

      // The confirmed status, which WooCommerce may have adjusted.
      toast(result.adjusted
        ? `ووکامرس وضعیت را «${orderStatusLabel(result.status)}» ثبت کرد`
        : `وضعیت به «${orderStatusLabel(result.status)}» تغییر کرد`);

      await go("orders");
    },
  });
}

/** Which fields this site's order notification may carry. */
async function orderSettingsModal(siteId) {
  let data;
  try {
    data = await nativeApi(`/sites/${encodeURIComponent(siteId)}/order-settings`);
  } catch (error) {
    toast(error.message, "error");
    return;
  }

  const settings = data.settings || {};
  const catalog = settings.catalog || [];
  const groups = data.groups || {};

  const byGroup = {};
  for (const field of catalog) (byGroup[field.group] ||= []).push(field);

  modal({
    title: "فیلدهای اعلان سفارش",
    lead: "هر چیزی که این‌جا خاموش باشد در پیام تلگرام نمی‌آید. آدرس و ایمیل مشتری به‌صورت پیش‌فرض خاموش‌اند.",
    body: `
      <label class="check">
        <span>ارسال اعلان سفارش</span>
        <span class="switch">
          <input type="checkbox" id="orderNotify" ${settings.notify_enabled ? "checked" : ""}>
          <span class="track"></span>
        </span>
      </label>

      ${Object.entries(byGroup).map(([group, fields]) => `
        <h4 style="margin-top:var(--space-3)">${esc(groups[group] || group)}</h4>
        ${fields.map((field) => `
          <label class="check">
            <span>${esc(field.label)}${field.sensitive ? ' <span class="chip small">اطلاعات شخصی</span>' : ""}</span>
            <span class="switch">
              <input type="checkbox" data-order-field="${esc(field.key)}" ${field.enabled ? "checked" : ""}>
              <span class="track"></span>
            </span>
          </label>`).join("")}`).join("")}`,
    confirm: "ذخیره",
    onSubmit: async () => {
      const fields = {};
      $$("[data-order-field]").forEach((input) => { fields[input.dataset.orderField] = input.checked; });

      await nativeApi(`/sites/${encodeURIComponent(siteId)}/order-settings`, {
        method: "PATCH",
        body: JSON.stringify({ notify_enabled: $("#orderNotify")?.checked !== false, fields }),
      });

      toast("ذخیره شد");
    },
  });
}

SCREENS.tickets = async function tickets() {
  const site = state.currentSite;
  if (!site) { $("#content").innerHTML = emptyState("🎫", "ابتدا یک سایت انتخاب کنید"); return; }

  skeleton(3);
  const filter = state.ticketFilter || "all";
  const query = new URLSearchParams({ per_page: "40" });
  if (filter !== "all") query.set("status", filter);

  const data = await nativeApi(`/sites/${encodeURIComponent(site.id)}/tickets?${query}`);
  const list = data.tickets || [];

  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">${esc(site.name || site.id)}</span><h2>تیکت‌های پشتیبانی</h2></div>
      <button class="btn" id="newTicket">+ تیکت جدید</button>
    </div>

    <div class="subtabs" role="tablist">
      ${[["all", "همه"], ["open", "باز"], ["waiting", "در انتظار"], ["closed", "بسته"]].map(([value, label]) =>
        `<button role="tab" data-ticket-filter="${value}" aria-selected="${filter === value}">${label}</button>`).join("")}
    </div>

    ${list.length ? list.map(ticketRow).join("") : emptyState("🎫", "تیکتی در این وضعیت نیست")}`;

  $("#newTicket").onclick = () => newTicketModal(site.id);
  $$("[data-ticket-filter]").forEach((button) => {
    button.onclick = () => { state.ticketFilter = button.dataset.ticketFilter; go("tickets"); };
  });
  $$("[data-open-ticket]").forEach((button) => {
    button.onclick = () => openTicket(site.id, button.dataset.openTicket);
  });
};

function ticketRow(ticket) {
  const status = String(ticket.status || "").toLowerCase();
  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(ticket.subject || `تیکت ${ticket.number}`)}</div>
          <div class="record-meta">
            <span class="mono">#${esc(ticket.number ?? ticket.id)}</span>
            <span>${esc(ticket.customer?.name || "")}</span>
            <span>${ago(ticket.updated_at || ticket.created_at)}</span>
          </div>
        </div>
        <span class="chip ${status === "closed" ? "" : status === "waiting" ? "warn" : "ok"}">${esc(ticketStatus(status))}</span>
      </div>
    </div>
    <div class="record-actions">
      <button class="btn ghost small" data-open-ticket="${esc(ticket.id ?? ticket.number)}">باز کردن</button>
    </div>
  </article>`;
}

async function newTicketModal(siteId) {
  const meta = await nativeApi(`/sites/${encodeURIComponent(siteId)}/ticket-meta`).catch(() => ({}));
  modal({
    title: "تیکت جدید",
    fields: [
      { name: "subject", label: "موضوع", required: true },
      ...(meta.departments?.length ? [{ name: "department", label: "دپارتمان", type: "select", value: "0",
        options: [{ value: "0", label: "عمومی" }, ...meta.departments.map((item) => ({ value: String(item.id), label: item.name }))] }] : []),
      { name: "priority", label: "اولویت", type: "select", value: "normal",
        options: [{ value: "low", label: "کم" }, { value: "normal", label: "عادی" }, { value: "high", label: "بالا" }, { value: "urgent", label: "فوری" }] },
      { name: "body", label: "پیام", type: "textarea", required: true },
    ],
    confirm: "ثبت تیکت",
    onSubmit: async (values) => {
      await nativeApi(`/sites/${encodeURIComponent(siteId)}/tickets`, {
        method: "POST",
        body: JSON.stringify({
          subject: values.subject,
          body: values.body,
          department: Number(values.department || 0),
          priority: values.priority,
        }),
      });
      toast("تیکت ثبت شد");
      state.ticketFilter = "all";
      await go("tickets");
    },
  });
}

async function openTicket(siteId, id) {
  skeleton(3);
  const result = await nativeApi(`/sites/${encodeURIComponent(siteId)}/tickets/${encodeURIComponent(id)}`);
  const ticket = result.ticket;

  $("#content").innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow mono">#${esc(ticket.number ?? id)}</span>
        <h2>${esc(ticket.subject || "")}</h2>
        <p class="muted small">${esc(ticket.customer?.name || "")}</p>
      </div>
      <button class="btn ghost small" id="backTickets">بازگشت</button>
    </div>

    <div class="chips" style="margin-bottom:var(--space-3)">
      <span class="chip">${esc(ticketStatus(ticket.status))}</span>
      ${ticket.priority ? `<span class="chip">${esc(ticket.priority)}</span>` : ""}
      ${ticket.department ? `<span class="chip">${esc(ticket.department)}</span>` : ""}
    </div>

    <div class="grid">
      ${(ticket.messages || []).map((message) => `
        <article class="card tight">
          <div class="record-meta" style="margin-bottom:var(--space-2)">
            <strong>${esc(message.author || "")}</strong>
            <span>${date(message.created_at)}</span>
          </div>
          <div style="white-space:pre-wrap">${esc(message.body || "")}</div>
        </article>`).join("")}
    </div>

    ${ticket.status === "closed" ? '<div class="notice">این تیکت بسته شده است.</div>' : `
      <section class="card" style="margin-top:var(--space-3)">
        <form id="replyForm">
          <label class="field"><span>پاسخ</span><textarea name="body" rows="5" required></textarea></label>
          <button class="btn block" type="submit">ارسال پاسخ</button>
        </form>
      </section>`}

    <div class="row-actions" style="margin-top:var(--space-3)">
      <button class="btn ghost small" data-ticket-status="closed">بستن</button>
      <button class="btn ghost small" data-ticket-status="reviewing">در حال بررسی</button>
      <button class="btn ghost small" data-ticket-status="waiting">بازگشایی</button>
    </div>`;

  $("#backTickets").onclick = () => go("tickets");

  const form = $("#replyForm");
  if (form) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = event.target.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await nativeApi(`/sites/${encodeURIComponent(siteId)}/tickets/${encodeURIComponent(id)}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: new FormData(event.target).get("body") }),
        });
        toast("پاسخ ارسال شد");
        await openTicket(siteId, id);
      } catch (error) { toast(error.message, "error"); submit.disabled = false; }
    };
  }

  $$("[data-ticket-status]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await nativeApi(`/sites/${encodeURIComponent(siteId)}/tickets/${encodeURIComponent(id)}/status`, {
          method: "POST", body: JSON.stringify({ status: button.dataset.ticketStatus }),
        });
        await openTicket(siteId, id);
      } catch (error) { toast(error.message, "error"); button.disabled = false; }
    };
  });
}

/* ------------------------------ observability ----------------------------- */

SCREENS.observability = async function observability() {
  skeleton(3);
  const data = await adminApi("/observability?lines=120");
  const m = data.metrics || {};
  const memory = m.memory || {};
  const db = m.database || {};
  const logs = data.logs || [];
  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">سیستم</span><h2>مانیتورینگ و لاگ</h2><p class="muted small">وضعیت لحظه‌ای Node.js و PostgreSQL و آخرین رخدادها.</p></div>
      <button class="btn ghost small" id="refreshObs">به‌روزرسانی</button>
    </div>
    <div class="grid-2">
      ${metricCard("نسخه", esc(m.version || "—"), "release")}
      ${metricCard("RAM", `${n(Math.round((memory.rss || 0)/1024/1024))} MB`, "memory")}
      ${metricCard("اتصال‌های DB", `${n(db.idle || 0)} آزاد / ${n(db.total || 0)} کل`, "database")}
      ${metricCard("در انتظار DB", n(db.waiting || 0), "queue")}
    </div>
    <section class="card">
      <div class="section-head"><div><h3>لاگ اخیر</h3><p class="muted small">اطلاعات حساس در backend ماسک می‌شوند.</p></div><span class="chip">${n(logs.length)} خط</span></div>
      <div class="log-viewer">${logs.length ? logs.map((row) => `<div class="log-line level-${esc(row.level || "info")}"><span class="mono">${esc(row.ts || "")}</span><strong>${esc(row.level || "")}</strong><span>${esc(row.message || row.raw || "")}</span></div>`).join("") : emptyState("🧾", "لاگی پیدا نشد")}</div>
    </section>`;
  $("#refreshObs").onclick = () => go("observability");
};

function metricCard(label, value, icon) {
  return `<article class="metric-card"><div class="metric-icon">${icon === "memory" ? "🧠" : icon === "database" ? "🗄️" : icon === "queue" ? "⏳" : "⚙️"}</div><div><span>${esc(label)}</span><strong>${value}</strong></div></article>`;
}

/* --------------------------------- users ---------------------------------- */

SCREENS.users = async function users() {
  skeleton(3);
  const query = String(state.userSearch || "").trim();
  const data = await adminApi(`/users?page=1&page_size=50${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  const list = data.items || data.users || [];
  const canManage = can("subscriptions.manage");

  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">مدیریت</span><h2>کاربران ربات</h2><p class="muted small">کاربران Telegram/Bale ثبت‌شده در جارچی را ببینید و دسترسی آزمایشی یا پلن را برای تست فعال کنید.</p></div>
      <button class="btn" id="refreshUsers">↻ بروزرسانی</button>
    </div>
    <section class="card">
      <label class="field"><span>جستجوی کاربر</span>
        <input id="userSearch" value="${esc(query)}" placeholder="نام، username یا شناسه Telegram" autocomplete="off">
      </label>
    </section>
    <section id="userList">
      ${list.length ? list.map(adminUserRow).join("") : emptyState("👤", "کاربری پیدا نشد", "بعد از /start در ربات، کاربر اینجا ظاهر می‌شود.")}
    </section>`;

  $("#refreshUsers").onclick = () => go("users");
  let timer = null;
  $("#userSearch").oninput = (event) => {
    clearTimeout(timer);
    state.userSearch = event.target.value;
    timer = setTimeout(() => go("users"), 350);
  };
  if (canManage) {
    $$('[data-user-grant]').forEach((button) => {
      button.onclick = () => grantUserPlanModal(Number(button.dataset.userGrant), button.dataset.userName || "کاربر");
    });
  }
  $$('[data-user-detail]').forEach((button) => {
    button.onclick = () => userDetailModal(Number(button.dataset.userDetail));
  });
};

function adminUserRow(user) {
  const status = user.status === "active" ? "فعال" : "تعلیق";
  const hasSub = user.subscription_plan;
  const expires = user.subscription_expires_at ? date(user.subscription_expires_at) : "بدون اشتراک";
  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(user.display_name || user.username || `کاربر ${user.id}`)}</div>
          <div class="record-meta">
            ${user.telegram_id ? `<span class="mono">TG:${esc(user.telegram_id)}</span>` : ""}
            ${user.username ? `<span>@${esc(user.username)}</span>` : ""}
            <span>${esc(status)}</span>
          </div>
        </div>
        <span class="chip ${hasSub ? "ok" : ""}">${esc(user.subscription_plan || "بدون پلن")}</span>
      </div>
      <div class="record-meta" style="margin-top:var(--space-2)">
        <span>انقضا: ${esc(expires)}</span><span>سایت‌ها: ${n(user.site_count || 0)}</span>
      </div>
    </div>
    <div class="record-actions">
      <button class="btn ghost small" data-user-detail="${esc(user.id)}">جزئیات</button>
      ${can("subscriptions.manage") ? `<button class="btn small" data-user-grant="${esc(user.id)}" data-user-name="${esc(user.display_name || user.username || `کاربر ${user.id}`)}">فعال‌سازی پلن</button>` : ""}
    </div>
  </article>`;
}

async function userDetailModal(userId) {
  try {
    const result = await adminApi(`/users/${encodeURIComponent(userId)}`);
    const user = result.user;
    const identities = (user.identities || []).map((i) => `${i.platform === "bale" ? "بله" : "تلگرام"}: ${i.platform_user_id}${i.username ? ` (@${i.username})` : ""}`).join(" · ") || "—";
    const subs = (user.subscriptions || []).slice(0, 8).map((sub) => `<div class="record-meta"><span>${esc(sub.plan_name || sub.plan_id)}</span><span>${esc(sub.status)}</span><span>${date(sub.expires_at)}</span></div>`).join("") || `<p class="muted small">اشتراکی ثبت نشده.</p>`;
    const access = [...(user.sites || []).map((site) => ({...site, role:"owner"})), ...(user.memberships || [])].map((site) => `<div class="record"><div><strong>${esc(site.site_name || site.name || site.site_id)}</strong><div class="record-meta"><span>${esc(site.role || "—")}</span><span>${esc(site.wordpress_url || "")}</span></div></div>${site.role !== "owner" ? `<button class="btn danger small" data-revoke-site="${esc(site.site_id)}">حذف دسترسی</button>` : ""}</div>`).join("") || `<p class="muted small">دسترسی سایتی ندارد.</p>`;
    const body = `<div class="kv"><div><b>نام</b><span>${esc(user.display_name || "—")}</span></div><div><b>وضعیت</b><span>${esc(user.status || "—")}</span></div><div><b>شناسه‌ها</b><span class="mono">${esc(identities)}</span></div></div><div class="row-actions" style="margin-top:12px">${can("subscriptions.manage") ? `<button type="button" class="btn small" id="detailGrant">فعال‌سازی پلن</button>` : ""}${can("users.update") ? `<button type="button" class="btn ghost small" id="detailStatus">${user.status === "active" ? "تعلیق کاربر" : "فعال‌سازی کاربر"}</button>` : ""}${can("users.sessions.revoke") ? `<button type="button" class="btn ghost small" id="detailRevoke">خروج از همه جلسات</button>` : ""}${can("users.update") ? `<button type="button" class="btn ghost small" id="detailSiteAccess">اعطای دسترسی سایت</button>` : ""}</div><hr><h4>اشتراک‌ها</h4>${subs}<hr><h4>دسترسی سایت</h4>${access}`;
    modal({ title: `کاربر #${user.id}`, body, fields: [], confirm: "بستن", onSubmit: async () => {} });
    $("#detailGrant")?.addEventListener("click", () => grantUserPlanModal(user.id, user.display_name || user.username || `کاربر ${user.id}`));
    $("#detailStatus")?.addEventListener("click", async () => {
      const next = user.status === "active" ? "suspended" : "active";
      await adminApi(`/users/${encodeURIComponent(user.id)}/status`, { method:"POST", body: JSON.stringify({status: next}) });
      toast(next === "active" ? "کاربر فعال شد" : "کاربر تعلیق شد"); await go("users");
    });
    $("#detailRevoke")?.addEventListener("click", async () => {
      await adminApi(`/users/${encodeURIComponent(user.id)}/sessions/revoke`, { method:"POST" });
      toast("جلسه‌های فعال کاربر بسته شد"); await userDetailModal(user.id);
    });
    $("#detailSiteAccess")?.addEventListener("click", () => siteAccessModal(user.id));
    $$('[data-revoke-site]').forEach((button) => button.addEventListener("click", async () => {
      await adminApi(`/users/${encodeURIComponent(user.id)}/site-access/${encodeURIComponent(button.dataset.revokeSite)}`, { method:"DELETE" });
      toast("دسترسی سایت حذف شد"); await userDetailModal(user.id);
    }));
  } catch (error) { toast(error.message, "error"); }
}

async function siteAccessModal(userId) {
  try {
    const data = await adminApi("/clients?page_size=100");
    const sites = data.items || data.clients || [];
    if (!sites.length) return toast("سایتی برای واگذاری دسترسی وجود ندارد", "warn");
    modal({
      title: "اعطای دسترسی سایت",
      lead: "این دسترسی فقط برای همان سایت اعمال می‌شود.",
      fields: [
        { name:"site_id", label:"سایت", type:"select", required:true, options:sites.map((site)=>({value:site.id,label:site.name || site.id})) },
        { name:"role", label:"نقش", type:"select", required:true, options:[{value:"admin",label:"مدیر سایت"},{value:"support",label:"پشتیبان"}] },
      ],
      confirm:"ثبت دسترسی",
      onSubmit:async (values)=>{ await adminApi(`/users/${encodeURIComponent(userId)}/site-access`, {method:"POST", body:JSON.stringify({site_id:values.site_id, role:values.role})}); toast("دسترسی سایت ثبت شد"); await userDetailModal(userId); }
    });
  } catch (error) { toast(error.message, "error"); }
}

async function grantUserPlanModal(userId, userName) {
  try {
    const data = await adminApi("/plans?include_inactive=false");
    const plans = (data.plans || []).filter((plan) => plan.active);
    modal({
      title: `فعال‌سازی برای ${userName}`,
      lead: "پلن مستقیماً توسط Super Admin/مدیر مجاز فعال می‌شود و در Audit ثبت خواهد شد. برای تست، می‌توانید پلن آزمایشی ۷ روزه یا هر پلن فعال دیگری را انتخاب کنید.",
      fields: [
        { name: "plan_id", label: "پلن", type: "select", required: true, options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${n(p.duration_days)} روز` })) },
        { name: "days", label: "مدت سفارشی (اختیاری)", inputType: "number", inputMode: "numeric", placeholder: "مثلاً 7" },
        { name: "reason", label: "دلیل اعطا", required: true, placeholder: "مثلاً تست امکانات Mini App" },
      ],
      confirm: "فعال‌سازی",
      onSubmit: async (values) => {
        const body = { user_id: userId, plan_id: values.plan_id, days: values.days ? Number(values.days) : undefined, replace_active: true, reason: String(values.reason || "تست دسترسی Mini App").slice(0, 240) };
        await adminApi("/subscriptions/grant", { method: "POST", body: JSON.stringify(body) });
        toast("پلن فعال شد");
        await go("users");
      },
    });
  } catch (error) { toast(error.message, "error"); }
}

/* --------------------------------- plans ---------------------------------- */

const PLAN_FEATURES = [
  ["site_control", "کنترل سایت"],
  ["remote_tickets", "تیکت از راه دور"],
  ["remote_announcements", "اطلاعیه"],
  ["remote_products", "محصولات هوشمند"],
  ["analytics", "گزارش‌ها"],
];

SCREENS.plans = async function plans() {
  skeleton(3);
  const data = await adminApi("/plans?include_inactive=true");
  const list = data.plans || [];
  const manage = can("plans.manage");

  $("#content").innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">مدیریت</span><h2>پلن‌ها و قیمت‌ها</h2></div>
      ${manage ? '<button class="btn" id="newPlan">+ پلن جدید</button>' : ""}
    </div>
    ${list.length ? list.map((plan) => adminPlanRow(plan, manage)).join("") : emptyState("🏷", "پلنی تعریف نشده")}`;

  const create = $("#newPlan");
  if (create) create.onclick = () => planModal(null);
  $$("[data-edit-plan]").forEach((button) => {
    button.onclick = () => planModal(list.find((plan) => plan.id === button.dataset.editPlan));
  });
  $$("[data-plan-active]").forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      try {
        await adminApi(`/plans/${encodeURIComponent(input.dataset.planActive)}`, {
          method: "PATCH", body: JSON.stringify({ active: input.checked }),
        });
        toast(input.checked ? "پلن فعال شد" : "پلن غیرفعال شد");
      } catch (error) {
        input.checked = !input.checked;
        toast(error.message, "error");
      } finally { input.disabled = false; }
    };
  });
  $$("[data-delete-plan]").forEach((button) => {
    button.onclick = () => deletePlanModal(list.find((plan) => plan.id === button.dataset.deletePlan));
  });
};

function adminPlanRow(plan, manage) {
  const features = plan.features || {};
  const active = Number(plan.active_subscription_count ?? 0);
  const deletable = manage && !plan.is_trial && active === 0 && Number(plan.invoice_count ?? 0) === 0;

  return `<article class="record">
    <div>
      <div class="record-main">
        <div>
          <div class="record-title">${esc(plan.name)} ${plan.is_trial ? '<span class="chip">آزمایشی</span>' : ""}</div>
          <div class="record-meta">
            <span class="mono">${esc(plan.id)}</span>
            <span>${n(plan.duration_days)} روز</span>
            <span>${n(plan.price_toman)} تومان</span>
          </div>
          <div class="record-meta">
            <span>${n(active)} اشتراک فعال</span>
            <span>${n(plan.subscription_count ?? 0)} کل</span>
          </div>
        </div>
        <span class="chip ${plan.active ? "ok" : ""}">${plan.active ? "فعال" : "غیرفعال"}</span>
      </div>
      <div class="chips" style="margin-top:var(--space-2)">
        ${PLAN_FEATURES.map(([key, label]) => `<span class="chip ${features[key] ? "ok" : ""}">${esc(label)} ${features[key] ? "✓" : "—"}</span>`).join("")}
      </div>
      ${manage ? `<label class="check">
        <span class="small">در دسترس مشتریان</span>
        <span class="switch">
          <input type="checkbox" data-plan-active="${esc(plan.id)}" ${plan.active ? "checked" : ""} aria-label="فعال بودن ${esc(plan.name)}">
          <span class="track"></span>
        </span>
      </label>` : ""}
    </div>
    ${manage ? `<div class="record-actions">
      <button class="btn ghost small" data-edit-plan="${esc(plan.id)}">ویرایش</button>
      <button class="btn danger small" data-delete-plan="${esc(plan.id)}" ${deletable ? "" : "disabled"}
              title="${deletable ? "حذف پلن" : plan.is_trial ? "پلن آزمایشی برای ثبت‌نام لازم است" : "پلن در حال استفاده است؛ فقط می‌توان غیرفعالش کرد"}">حذف</button>
    </div>` : ""}
  </article>`;
}

function planModal(plan) {
  const editing = Boolean(plan);
  const features = plan?.features || {};

  modal({
    title: editing ? `ویرایش ${plan.name}` : "پلن جدید",
    lead: editing
      ? "تغییر قیمت فقط روی خریدهای بعدی اثر دارد؛ فاکتورهای صادرشده دست‌نخورده می‌مانند."
      : "شناسه پلن پس از ساخت قابل تغییر نیست.",
    fields: [
      ...(editing ? [] : [{ name: "id", label: "شناسه پلن (انگلیسی)", required: true, placeholder: "monthly_pro" }]),
      { name: "name", label: "نام نمایشی", required: true, value: plan?.name || "" },
      { name: "duration_days", label: "مدت (روز)", required: true, inputType: "number", inputMode: "numeric", value: plan?.duration_days ?? 30 },
      { name: "price_toman", label: "قیمت (تومان)", inputType: "number", inputMode: "numeric", value: plan?.price_toman ?? 0 },
      { name: "telegram_stars", label: "قیمت با Stars", inputType: "number", inputMode: "numeric", value: plan?.telegram_stars ?? 0 },
      ...PLAN_FEATURES.map(([key, label]) => ({ name: `feature_${key}`, label, type: "checkbox", value: features[key] === true })),
    ],
    confirm: editing ? "ذخیره" : "ساخت پلن",
    onSubmit: async (values) => {
      const payload = {
        name: String(values.name).trim(),
        duration_days: Number(values.duration_days),
        price_toman: Number(values.price_toman || 0),
        telegram_stars: Number(values.telegram_stars || 0),
        features: Object.fromEntries(PLAN_FEATURES.map(([key]) => [key, values[`feature_${key}`] === true])),
      };
      if (editing) {
        await adminApi(`/plans/${encodeURIComponent(plan.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("پلن ذخیره شد");
      } else {
        await adminApi("/plans", { method: "POST", body: JSON.stringify({ ...payload, id: String(values.id).trim() }) });
        toast("پلن ساخته شد");
      }
      await go("plans");
    },
  });
}

function deletePlanModal(plan) {
  if (!plan) return;
  confirmModal({
    title: `حذف ${plan.name}`,
    lead: "این پلن هیچ اشتراک فعال و هیچ فاکتوری ندارد، بنابراین حذف آن بی‌خطر است. این کار قابل بازگشت نیست.",
    confirm: "حذف پلن",
    onConfirm: async () => {
      await adminApi(`/plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
      toast("پلن حذف شد");
      await go("plans");
    },
  });
}


/* --------------------------- unified account ----------------------------- */

SCREENS.account = async function accountScreen() {
  skeleton(3);
  const data = await nativeApi("/account/identities");
  state.account = data.account || null;
  const identities = state.account?.identities || {};
  const connected = Boolean(state.account?.unified);

  const identityCard = (key, label, icon, identity) => {
    if (identity) {
      return `<article class="record">
        <div>
          <div class="record-main">
            <div>
              <div class="record-title">${icon} ${label}</div>
              <div class="record-meta"><span class="chip ok">متصل</span><span class="mono">${esc(identity.platform_user_id)}</span>${identity.username ? `<span>@${esc(identity.username)}</span>` : ""}</div>
            </div>
          </div>
          <p class="muted small" style="margin-top:var(--space-2)">این هویت از همان حساب جارچی، پلن و دسترسی‌های شما استفاده می‌کند.</p>
        </div>
        ${Object.values(identities).filter(Boolean).length > 1 ? `<div class="record-actions"><button class="btn danger ghost small" data-unlink="${key}">قطع اتصال</button></div>` : ""}
      </article>`;
    }
    return `<article class="record">
      <div>
        <div class="record-title">${icon} ${label}</div>
        <div class="record-meta"><span class="chip warn">متصل نیست</span></div>
        <p class="muted small" style="margin-top:var(--space-2)">با اتصال ${label} همین اشتراک، سایت‌ها، تیکت‌ها، نقش‌ها و وضعیت AI در هر دو پلتفرم مشترک می‌شود.</p>
      </div>
      <div class="record-actions"><button class="btn small" data-link="${key}">اتصال ${label}</button></div>
    </article>`;
  };

  const links = [identityCard("telegram", "تلگرام", "✈️", identities.telegram), identityCard("bale", "بله", "🟠", identities.bale)].join("");
  $("#content").innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">حساب یکپارچه</span>
        <h2>${esc(state.user?.display_name || "حساب جارچی")}</h2>
        <p>${connected ? "حساب تلگرام و بله شما به یک حساب جارچی متصل هستند؛ پلن و دسترسی‌ها مشترک است." : "می‌توانید تلگرام و بله را به یک حساب جارچی متصل کنید و بین دو پلتفرم بدون از دست دادن وضعیت کار ادامه دهید."}</p>
      </div>
      <span class="chip ${connected ? "ok" : "brand"}">${connected ? "یکپارچه ✓" : "یک پلتفرم متصل"}</span>
    </div>
    <section class="card">
      <div class="section-head"><div><span class="eyebrow">شناسه اصلی</span><h3>Jarchi Account #${n(state.account?.user_id || state.user?.id || 0)}</h3></div></div>
      <div class="chips"><span class="chip">اشتراک: ${esc(state.subscription?.plan_name || state.subscription?.plan_id || "بدون اشتراک")}</span><span class="chip">سایت‌ها: ${n(state.sites.length)}</span><span class="chip">پلن مشترک بین پلتفرم‌ها</span></div>
    </section>
    ${links}
    <section class="card">
      <h3>قانون اتصال حساب</h3>
      <p class="muted small">برای امنیت، تشخیص هویت بر اساس نام یا username انجام نمی‌شود. اتصال فقط با یک لینک یک‌بارمصرف و محدود به زمان انجام می‌شود. هر حساب جارچی حداکثر یک هویت تلگرام و یک هویت بله دارد.</p>
    </section>`;

  $$('[data-link]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const target = button.dataset.link;
        const result = await nativeApi("/account/identities/link", { method: "POST", body: JSON.stringify({ target_platform: target }) });
        await showLinkChallenge(result, target);
      } catch (error) {
        toast(error.message, "error");
      } finally { button.disabled = false; }
    };
  });

  $$('[data-unlink]').forEach((button) => {
    button.onclick = () => confirmModal({
      title: `قطع اتصال ${button.dataset.unlink === "telegram" ? "تلگرام" : "بله"}`,
      lead: "دسترسی‌های این حساب حذف نمی‌شود، اما ورود از این پلتفرم قطع و نشست‌های همان پلتفرم لغو می‌شود. اگر این آخرین هویت باشد امکان قطع وجود ندارد.",
      confirm: "قطع اتصال",
      onConfirm: async () => {
        await nativeApi(`/account/identities/${encodeURIComponent(button.dataset.unlink)}`, { method: "DELETE" });
        toast("اتصال قطع شد");
        await go("account");
      },
    });
  });
};

async function showLinkChallenge(result, target) {
  const label = target === "telegram" ? "تلگرام" : "بله";
  const seconds = Number(result.expires_in_seconds || 600);
  let left = seconds;
  const root = document.createElement("div");
  root.innerHTML = `<p class="muted small">${label} را باز کنید و دکمه شروع را بزنید تا اتصال امن کامل شود.</p><div class="mono" style="word-break:break-all;padding:var(--space-3);background:var(--surface-soft);border-radius:12px">${esc(result.deep_link)}</div><p class="notice" id="linkTimer">اعتبار: ${n(left)} ثانیه</p>`;
  modal({
    title: `اتصال ${label}`,
    body: root.innerHTML,
    fields: [],
    confirm: "باز کردن لینک",
    onSubmit: async () => {
      try { window.location.href = result.deep_link; } catch { await copyText(result.deep_link, "لینک اتصال کپی شد"); }
      return true;
    },
  });
  const timer = setInterval(() => {
    left -= 1;
    const el = document.querySelector("#linkTimer");
    if (el) el.textContent = `اعتبار: ${n(Math.max(0, left))} ثانیه`;
    if (left <= 0) clearInterval(timer);
  }, 1000);
}

/* --------------------------------- start ---------------------------------- */

applyTheme(currentTheme());

// 20s is longer than the normal API budget, but short enough to avoid an
// apparently frozen Mini App if a proxy or WebView never resolves fetch().
const BOOT_WATCHDOG = setTimeout(() => {
  const host = $("#content");
  if (host?.querySelector(".skeleton-page")) {
    const stage = String(window.__JARCHI_BOOT_STAGE__ || "startup");
    errorState(`پاسخ اولیه پنل کامل نشد (مرحله: ${stage}). دوباره از ربات باز کنید.`, { retry: true });
  }
}, 20000);

$("#themeToggle").onclick = () => {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
  haptic();
};
$("#menuButton").onclick = () => toggleDrawer(!$("#drawer").classList.contains("open"));
$("#scrim").onclick = () => toggleDrawer(false);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("#modalRoot").innerHTML) { $("#modalRoot").innerHTML = ""; return; }
  toggleDrawer(false);
});

bootstrap();
