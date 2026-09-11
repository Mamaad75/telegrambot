/*
 * Jarchi Admin Dashboard.
 *
 * A dependency-free SPA served from the backend itself. Session state lives in
 * an HttpOnly cookie (never localStorage); this file only holds the CSRF token
 * for the lifetime of the page, and the permission list used to decide which
 * controls to render. Every action is authorized again server-side.
 */

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const $ = (selector, scope = document) => scope.querySelector(selector);
const root = () => $("#root");

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const faNumber = (value) => Number(value || 0).toLocaleString("fa-IR");

function faDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch { return "—"; }
}

function faDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function relativeTime(value) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNumber(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${faNumber(hours)} ساعت پیش`;
  return `${faNumber(Math.round(hours / 24))} روز پیش`;
}

const PLATFORM_LABELS = { telegram: "تلگرام", bale: "بله", whatsapp: "واتس‌اپ" };
const ROLE_LABELS = { super_admin: "مدیر ارشد", admin: "مدیر", support: "پشتیبانی", viewer: "بازدیدکننده" };
const STATUS_LABELS = {
  published: "منتشر شد", failed: "ناموفق", skipped: "رد شد", deleted: "حذف شد",
  superseded: "جایگزین شد", blocked: "مسدود", unsupported: "پشتیبانی نمی‌شود",
  active: "فعال", expired: "منقضی", cancelled: "لغو شده", suspended: "معلق",
  pending: "در انتظار", processing: "در حال اجرا", succeeded: "موفق", paid: "پرداخت شده",
};
const label = (map, key) => map[String(key)] || String(key ?? "—");

const STATUS_TONES = {
  published: "ok", succeeded: "ok", active: "ok", paid: "ok", deleted: "info", superseded: "info",
  failed: "danger", blocked: "danger", expired: "danger", suspended: "danger", cancelled: "danger",
  pending: "warning", processing: "warning", skipped: "warning", unsupported: "warning",
};
const badge = (status, text) => `<span class="badge ${STATUS_TONES[String(status)] || ""}">${escapeHtml(text ?? label(STATUS_LABELS, status))}</span>`;

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

const theme = {
  get() {
    return localStorage.getItem("jarchi-admin-theme")
      || (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
  },
  apply(next) {
    document.documentElement.dataset.theme = next;
    localStorage.setItem("jarchi-admin-theme", next);
  },
  toggle() {
    theme.apply(theme.get() === "dark" ? "light" : "dark");
    render();
  },
};

/* ------------------------------------------------------------------ *
 * Toasts and modals
 * ------------------------------------------------------------------ */

function toast(message, { tone = "ok", detail = "" } = {}) {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<div>${escapeHtml(message)}</div>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
  $("#toasts").append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 250);
  }, 4200);
}

function closeModal() { $("#modal-root").innerHTML = ""; }

/**
 * Renders a modal. `body` is HTML; `onSubmit` receives a FormData-like object
 * built from the modal's inputs, and closes the modal when it resolves.
 */
function modal({ title, subtitle = "", body, confirmLabel = "تایید", cancelLabel = "انصراف", tone = "", onSubmit }) {
  const container = $("#modal-root");
  container.innerHTML = `
    <div class="modal-backdrop" data-close="backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="modal-sub">${escapeHtml(subtitle)}</p>` : ""}
        <form id="modal-form">
          ${body}
          <div class="modal-actions">
            <button type="submit" class="btn ${tone}">${escapeHtml(confirmLabel)}</button>
            <button type="button" class="btn ghost" data-close="cancel">${escapeHtml(cancelLabel)}</button>
          </div>
        </form>
      </div>
    </div>`;

  container.querySelectorAll("[data-close]").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target === node) closeModal();
    });
  });

  $("#modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#modal-form button[type=submit]");
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(event.target).entries());
    try {
      await onSubmit(values);
      closeModal();
    } catch (error) {
      toast(error.message || "عملیات انجام نشد", { tone: "error" });
      submit.disabled = false;
    }
  });
  container.querySelector("input, select, textarea")?.focus();
}

const confirmDialog = ({ title, message, confirmLabel = "تایید", tone = "danger", onConfirm }) => modal({
  title,
  body: `<p class="muted">${escapeHtml(message)}</p>`,
  confirmLabel,
  tone,
  onSubmit: onConfirm,
});

/* ------------------------------------------------------------------ *
 * API client
 * ------------------------------------------------------------------ */

const session = { admin: null, csrf: "", server: null };

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (session.csrf && method !== "GET") headers["X-CSRF-Token"] = session.csrf;

  const response = await fetch(`/api/admin${path}`, {
    method,
    headers,
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // The server rotates the session token periodically and hands back a new
  // CSRF token with it.
  const rotated = response.headers.get("X-CSRF-Token");
  if (rotated) session.csrf = rotated;

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (response.status === 401 && session.admin) {
    session.admin = null;
    renderLogin("نشست شما منقضی شده است؛ دوباره وارد شوید.");
    throw new ApiError("نشست منقضی شده است", "unauthenticated", 401);
  }
  if (!response.ok) {
    throw new ApiError(data?.error?.message || `خطای ${response.status}`, data?.error?.code || "error", response.status);
  }
  return data;
}

const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, body),
  patch: (path, body = {}) => request("PATCH", path, body),
};

const can = (permission) => Boolean(session.admin?.permissions?.includes(permission));

/* ------------------------------------------------------------------ *
 * Rendering primitives
 * ------------------------------------------------------------------ */

const loadingState = (message = "در حال بارگذاری…") => `
  <div class="state"><div class="spinner"></div><div>${escapeHtml(message)}</div></div>`;

const emptyState = (title = "موردی یافت نشد", hint = "") => `
  <div class="state">
    <div class="icon">📭</div>
    <h3>${escapeHtml(title)}</h3>
    ${hint ? `<p class="muted small">${escapeHtml(hint)}</p>` : ""}
  </div>`;

const errorState = (message, retryAction = "") => `
  <div class="state">
    <div class="icon">⚠️</div>
    <h3>خطا در دریافت اطلاعات</h3>
    <p class="muted small">${escapeHtml(message)}</p>
    ${retryAction ? `<button class="btn secondary" data-action="${escapeHtml(retryAction)}">تلاش مجدد</button>` : ""}
  </div>`;

function pagination(meta, action) {
  if (!meta || meta.pages <= 1) return "";
  return `
    <div class="pagination">
      <button class="btn secondary small" data-action="${action}" data-page="${meta.page - 1}" ${meta.has_previous ? "" : "disabled"}>قبلی</button>
      <span class="info">صفحه ${faNumber(meta.page)} از ${faNumber(meta.pages)} — ${faNumber(meta.total)} مورد</span>
      <button class="btn secondary small" data-action="${action}" data-page="${meta.page + 1}" ${meta.has_next ? "" : "disabled"}>بعدی</button>
    </div>`;
}

const table = (columns, rows) => `
  <div class="table-wrap">
    <table>
      <thead><tr>${columns.map((column) => `<th class="${column.numeric ? "numeric" : ""}">${escapeHtml(column.title)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;

/** Renders a link only for http(s) values; older rows may hold anything. */
const safeLink = (url, text) => (/^https?:\/\//i.test(String(url || ""))
  ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text || url)}</a>`
  : escapeHtml(text || url || "—"));

const detailItem = (title, value, { mono = false } = {}) => `
  <div class="detail-item">
    <small>${escapeHtml(title)}</small>
    <strong class="${mono ? "mono" : ""}">${value}</strong>
  </div>`;

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "dashboard", title: "داشبورد", icon: "📊", permission: "dashboard.view" },
  { id: "clients", title: "کلاینت‌ها", icon: "🌐", permission: "clients.view" },
  { id: "publications", title: "انتشارها", icon: "📢", permission: "publications.view" },
  { id: "retries", title: "صف تلاش مجدد", icon: "🔁", permission: "publications.view" },
  { id: "users", title: "کاربران", icon: "👥", permission: "users.view" },
  { id: "subscriptions", title: "اشتراک‌ها", icon: "💳", permission: "subscriptions.view" },
  { id: "plans", title: "پلن‌ها", icon: "🏷", permission: "plans.view" },
  { id: "invoices", title: "پرداخت‌ها", icon: "🧾", permission: "invoices.view" },
  { id: "platforms", title: "پلتفرم‌ها", icon: "📡", permission: "platforms.view" },
  { id: "ai", title: "هوش مصنوعی", icon: "🤖", permission: "ai.view" },
  { id: "admins", title: "مدیران", icon: "🛡", permission: "admins.view" },
  { id: "audit", title: "گزارش عملیات", icon: "📋", permission: "audit.view" },
  { id: "settings", title: "تنظیمات", icon: "⚙️", permission: "settings.view" },
];

const currentRoute = () => {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/");
  return { name, params: rest };
};

function layout(bodyHtml, { title = "" } = {}) {
  const route = currentRoute();
  const items = SECTIONS.filter((section) => can(section.permission)).map((section) => `
    <button class="nav-item ${route.name === section.id ? "active" : ""}" data-nav="${section.id}">
      <span class="icon">${section.icon}</span><span>${escapeHtml(section.title)}</span>
    </button>`).join("");

  return `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">ج</div>
          <div class="brand-text"><strong>JARCHI</strong><span>پنل مدیریت ${escapeHtml(session.server?.version || "")}</span></div>
        </div>
        ${items}
        <div class="nav-spacer"></div>
        <button class="nav-item" data-action="toggle-theme"><span class="icon">🌗</span><span>حالت روشن/تاریک</span></button>
        <button class="nav-item" data-action="logout"><span class="icon">🚪</span><span>خروج</span></button>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn ghost small menu-toggle" data-action="toggle-menu">☰</button>
          <h1>${escapeHtml(title)}</h1>
          <div class="spacer"></div>
          <span class="badge info nowrap">${escapeHtml(session.admin?.display_name || session.admin?.username || "")} · ${escapeHtml(label(ROLE_LABELS, session.admin?.role))}</span>
        </header>
        <main class="content" id="view">${bodyHtml}</main>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Views: dashboard
 * ------------------------------------------------------------------ */

function chart(volume) {
  if (!volume.length) return emptyState("داده‌ای برای نمودار نیست");
  const peak = Math.max(1, ...volume.map((day) => day.published + day.failed));
  const columns = volume.map((day) => `
    <div class="chart-col" title="${escapeHtml(day.day)} — موفق ${faNumber(day.published)} / ناموفق ${faNumber(day.failed)}">
      <div class="chart-bar failed" style="height:${(day.failed / peak) * 100}%"></div>
      <div class="chart-bar" style="height:${(day.published / peak) * 100}%"></div>
    </div>`).join("");
  const labels = volume.map((day) => `<span>${escapeHtml(day.day.slice(5))}</span>`).join("");

  return `
    <div class="chart">${columns}</div>
    <div class="chart-labels">${labels}</div>
    <div class="legend">
      <span><i style="background:var(--accent)"></i>موفق</span>
      <span><i style="background:var(--danger)"></i>ناموفق</span>
    </div>`;
}

function distributionBars(rows) {
  if (!rows.length) return emptyState("هنوز انتشاری ثبت نشده است");
  const peak = Math.max(1, ...rows.map((row) => row.total));
  return rows.map((row) => `
    <div class="bar-row">
      <span class="name">${escapeHtml(label(PLATFORM_LABELS, row.platform))}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(row.total / peak) * 100}%"></span></span>
      <span class="value">${faNumber(row.published)} / ${faNumber(row.total)}</span>
    </div>`).join("");
}

async function viewDashboard() {
  setView(loadingState("در حال محاسبه آمار…"));
  const { stats } = await api.get("/dashboard");

  const card = (title, value, trend = "") => `
    <div class="card stat">
      <small>${escapeHtml(title)}</small>
      <b>${faNumber(value)}</b>
      ${trend ? `<span class="trend">${escapeHtml(trend)}</span>` : ""}
    </div>`;

  setView(`
    <div class="grid stats">
      ${card("کل کلاینت‌ها", stats.clients.total, `فعال ${faNumber(stats.clients.active)} · غیرفعال ${faNumber(stats.clients.disabled)}`)}
      ${card("کاربران", stats.users.total, `${faNumber(stats.users.new_last_30_days)} کاربر جدید در ۳۰ روز`)}
      ${card("اشتراک فعال", stats.subscriptions.active, `${faNumber(stats.subscriptions.expiring_7_days)} مورد رو به انقضا`)}
      ${card("انتشار موفق", stats.publications.published, `امروز ${faNumber(stats.publications.today)}`)}
      ${card("انتشار ناموفق", stats.publications.failed, `۷ روز اخیر ${faNumber(stats.publications.last_7_days)} انتشار`)}
      ${card("فاکتور پرداخت‌شده", stats.invoices.paid, `${faNumber(stats.invoices.pending)} در انتظار پرداخت`)}
    </div>

    <div class="grid two">
      <section class="card">
        <div class="card-header">
          <h2>حجم انتشار ۱۴ روز اخیر</h2>
          <div class="spacer"></div>
          <button class="btn ghost small" data-action="refresh-dashboard">تازه‌سازی</button>
        </div>
        ${chart(stats.daily_volume)}
      </section>

      <section class="card">
        <h2>توزیع پلتفرم‌ها</h2>
        ${distributionBars(stats.platform_distribution)}
        <p class="muted small">مقادیر: منتشرشده / کل</p>
      </section>
    </div>

    <div class="grid two">
      <section class="card">
        <h2>آخرین خطاها</h2>
        ${stats.recent_failures.length ? table(
          [{ title: "کلاینت" }, { title: "پست" }, { title: "پلتفرم" }, { title: "خطا" }, { title: "زمان" }],
          stats.recent_failures.map((row) => `
            <tr>
              <td>${escapeHtml(row.site_name || row.site_id)}</td>
              <td class="mono">${escapeHtml(row.post_id)}</td>
              <td>${escapeHtml(label(PLATFORM_LABELS, row.platform))}</td>
              <td class="small">${escapeHtml(String(row.error_message || "").slice(0, 70))}</td>
              <td class="nowrap small">${escapeHtml(relativeTime(row.created_at))}</td>
            </tr>`),
        ) : emptyState("خطایی ثبت نشده است", "همه انتشارهای اخیر موفق بوده‌اند.")}
      </section>

      <section class="card">
        <h2>آخرین انتشارها</h2>
        ${stats.recent_publications.length ? table(
          [{ title: "کلاینت" }, { title: "پست" }, { title: "پلتفرم" }, { title: "وضعیت" }, { title: "زمان" }],
          stats.recent_publications.map((row) => `
            <tr>
              <td>${escapeHtml(row.site_name || row.site_id)}</td>
              <td class="mono">${escapeHtml(row.post_id)}</td>
              <td>${escapeHtml(label(PLATFORM_LABELS, row.platform))}</td>
              <td>${badge(row.status)}</td>
              <td class="nowrap small">${escapeHtml(relativeTime(row.created_at))}</td>
            </tr>`),
        ) : emptyState("هنوز انتشاری ثبت نشده است")}
      </section>
    </div>

    <p class="muted small">آمار در ساعت ${escapeHtml(faDateTime(stats.generated_at))} به وقت ${escapeHtml(stats.timezone)} محاسبه شده است${stats.cached ? " (از حافظه نهان)" : ""}.</p>
  `);
}

/* ------------------------------------------------------------------ *
 * Views: clients
 * ------------------------------------------------------------------ */

const clientFilters = { page: 1, q: "", enabled: "", platform: "" };

const CONNECTION_LABELS = {
  healthy: ["ok", "سالم"],
  failing: ["danger", "خطا در انتشار"],
  never_connected: ["warning", "بدون وبهوک"],
  disabled: ["", "غیرفعال"],
};

async function viewClients() {
  setView(loadingState());
  const query = new URLSearchParams({
    page: String(clientFilters.page),
    ...(clientFilters.q ? { q: clientFilters.q } : {}),
    ...(clientFilters.enabled ? { enabled: clientFilters.enabled } : {}),
    ...(clientFilters.platform ? { platform: clientFilters.platform } : {}),
  });
  const result = await api.get(`/clients?${query}`);

  const rows = result.items.map((client) => {
    const [tone, text] = CONNECTION_LABELS[client.connection_status] || ["", client.connection_status];
    return `
      <tr>
        <td>
          <strong>${escapeHtml(client.name || client.id)}</strong>
          <div class="muted small mono">${escapeHtml(client.id)}</div>
        </td>
        <td class="small">${escapeHtml(client.wordpress_url || "—")}</td>
        <td>${escapeHtml(client.owner_name || "—")}</td>
        <td>
          ${client.platforms.telegram.configured ? '<span class="badge info">تلگرام</span>' : ""}
          ${client.platforms.bale.configured ? '<span class="badge info">بله</span>' : ""}
          ${!client.platforms.telegram.configured && !client.platforms.bale.configured ? '<span class="muted small">—</span>' : ""}
        </td>
        <td>${client.subscription_status ? badge(client.subscription_status, `${label(STATUS_LABELS, client.subscription_status)} تا ${faDate(client.subscription_expires_at)}`) : '<span class="muted small">—</span>'}</td>
        <td class="numeric">${faNumber(client.publication_success_count)} / ${faNumber(client.publication_failure_count)}</td>
        <td class="nowrap small">${escapeHtml(relativeTime(client.last_webhook_at))}</td>
        <td>${badge(client.enabled ? tone : "blocked", text)}</td>
        <td class="actions"><button class="btn secondary small" data-action="open-client" data-id="${escapeHtml(client.id)}">مدیریت</button></td>
      </tr>`;
  });

  setView(`
    <section class="card">
      <div class="card-header">
        <h2>کلاینت‌ها</h2>
        <div class="spacer"></div>
        ${can("clients.create") ? '<button class="btn" data-action="new-client">➕ کلاینت جدید</button>' : ""}
      </div>

      <div class="filters">
        <input id="client-search" type="search" placeholder="جست‌وجو در نام، آدرس یا Site ID" value="${escapeHtml(clientFilters.q)}">
        <select id="client-enabled">
          <option value="">همه وضعیت‌ها</option>
          <option value="true" ${clientFilters.enabled === "true" ? "selected" : ""}>فعال</option>
          <option value="false" ${clientFilters.enabled === "false" ? "selected" : ""}>غیرفعال</option>
        </select>
        <select id="client-platform">
          <option value="">همه پلتفرم‌ها</option>
          <option value="telegram" ${clientFilters.platform === "telegram" ? "selected" : ""}>تلگرام</option>
          <option value="bale" ${clientFilters.platform === "bale" ? "selected" : ""}>بله</option>
        </select>
        <button class="btn secondary small" data-action="apply-client-filters">اعمال</button>
        <button class="btn ghost small" data-action="reset-client-filters">پاک کردن</button>
      </div>

      ${result.items.length ? table([
        { title: "کلاینت" }, { title: "وردپرس" }, { title: "مالک" }, { title: "پلتفرم" },
        { title: "اشتراک" }, { title: "موفق/ناموفق", numeric: true }, { title: "آخرین وبهوک" },
        { title: "وضعیت" }, { title: "" },
      ], rows) : emptyState("کلاینتی ثبت نشده است", "با دکمه «کلاینت جدید» اولین مشتری را اضافه کنید.")}
      ${pagination(result.pagination, "clients-page")}
    </section>
  `);
}

function clientCreateModal() {
  modal({
    title: "ساخت کلاینت جدید",
    subtitle: "پس از ساخت، Site ID و رمز وبهوک یک‌بار نمایش داده می‌شود.",
    body: `
      <div class="field">
        <label for="name">نام مشتری یا برند *</label>
        <input id="name" name="name" required maxlength="190" placeholder="فروشگاه نمونه">
      </div>
      <div class="field">
        <label for="wordpress_url">آدرس سایت وردپرس *</label>
        <input id="wordpress_url" name="wordpress_url" required type="url" dir="ltr" placeholder="https://example.com">
      </div>
      <div class="field">
        <label for="owner_telegram_id">Telegram ID مالک</label>
        <input id="owner_telegram_id" name="owner_telegram_id" dir="ltr" inputmode="numeric" placeholder="اختیاری — برای فعال‌سازی اشتراک آزمایشی">
      </div>
      <div class="field">
        <label for="telegram_channel_id">کانال تلگرام</label>
        <input id="telegram_channel_id" name="telegram_channel_id" dir="ltr" placeholder="@channel یا https://t.me/channel">
      </div>
      <div class="field">
        <label for="bale_chat_id">کانال/چت بله</label>
        <input id="bale_chat_id" name="bale_chat_id" dir="ltr" placeholder="@channel یا شناسه عددی">
        <span class="hint">توکن ربات‌ها سمت بک‌اند نگهداری می‌شود و نیازی به وارد کردن آن نیست.</span>
      </div>`,
    confirmLabel: "ساخت کلاینت",
    onSubmit: async (values) => {
      const { client } = await api.post("/clients", values);
      toast("کلاینت ساخته شد", { detail: client.id });
      showCredentials(client);
      location.hash = `#/clients/${client.id}`;
    },
  });
}

/**
 * The only place a webhook secret is ever displayed.
 *
 * Opened on the next tick: the modal that triggered it closes itself once its
 * submit handler resolves, and that would clear this one.
 */
function showCredentials(client) {
  setTimeout(() => showCredentialsNow(client), 0);
}

function showCredentialsNow(client) {
  modal({
    title: "اطلاعات اتصال مشتری",
    subtitle: "این مقادیر را در افزونه وردپرس مشتری وارد کنید. رمز فقط همین یک‌بار نمایش داده می‌شود.",
    body: `
      <div class="field">
        <label>Site ID</label>
        <div class="secret-box mono">${escapeHtml(client.id)}</div>
      </div>
      <div class="field">
        <label>Webhook URL</label>
        <div class="secret-box mono">${escapeHtml(client.webhook_url || "")}</div>
      </div>
      <div class="field">
        <label>Webhook Secret</label>
        <div class="secret-box mono">${escapeHtml(client.webhook_secret || "")}</div>
      </div>`,
    confirmLabel: "کپی کردم",
    cancelLabel: "بستن",
    onSubmit: async () => {
      await navigator.clipboard?.writeText(
        `Site ID: ${client.id}\nWebhook URL: ${client.webhook_url}\nWebhook Secret: ${client.webhook_secret}`,
      ).catch(() => {});
      toast("در حافظه کپی شد");
    },
  });
}

const clientTab = { current: "overview", publicationsPage: 1, webhooksPage: 1 };

async function viewClient(siteId) {
  setView(loadingState());
  const { client } = await api.get(`/clients/${encodeURIComponent(siteId)}`);

  const tabs = [
    ["overview", "نمای کلی"],
    ["platforms", "پلتفرم‌ها"],
    ["fields", "فیلدها"],
    ["publications", "انتشارها"],
    ["webhooks", "وبهوک"],
  ].map(([id, title]) => `<button class="tab ${clientTab.current === id ? "active" : ""}" data-action="client-tab" data-tab="${id}">${escapeHtml(title)}</button>`).join("");

  const [tone, connectionText] = CONNECTION_LABELS[client.connection_status] || ["", client.connection_status];

  setView(`
    <section class="card">
      <div class="card-header">
        <div>
          <h2>${escapeHtml(client.name || client.id)}</h2>
          <div class="muted small mono">${escapeHtml(client.id)}</div>
        </div>
        <div class="spacer"></div>
        ${badge(client.enabled ? tone : "blocked", connectionText)}
        <button class="btn ghost small" data-action="back-clients">فهرست کلاینت‌ها</button>
      </div>

      <div class="btn-row">
        ${can("clients.update") ? `<button class="btn secondary small" data-action="edit-client" data-id="${escapeHtml(client.id)}">✏️ ویرایش</button>` : ""}
        ${can("clients.disable") ? `<button class="btn ${client.enabled ? "danger" : "secondary"} small" data-action="toggle-client" data-id="${escapeHtml(client.id)}" data-enabled="${client.enabled}">${client.enabled ? "⛔ غیرفعال‌سازی" : "✅ فعال‌سازی"}</button>` : ""}
        ${can("clients.rotate_secret") ? `<button class="btn secondary small" data-action="rotate-secret" data-id="${escapeHtml(client.id)}">🔑 تعویض رمز وبهوک</button>` : ""}
        ${can("platforms.test") ? `<button class="btn secondary small" data-action="test-client" data-id="${escapeHtml(client.id)}">🔍 تست اتصال‌ها</button>` : ""}
      </div>
    </section>

    <div class="tabs">${tabs}</div>
    <div id="client-tab-body">${loadingState()}</div>
  `);

  renderClientTab(client);
}

async function renderClientTab(client) {
  const container = $("#client-tab-body");
  const setBody = (html) => { container.innerHTML = html; };

  if (clientTab.current === "overview") {
    setBody(`
      <section class="card">
        <h2>مشخصات</h2>
        <div class="detail-grid">
          ${detailItem("Site ID", escapeHtml(client.id), { mono: true })}
          ${detailItem("آدرس وردپرس", client.wordpress_url ? safeLink(client.wordpress_url) : "—")}
          ${detailItem("مالک", escapeHtml(client.owner_name || "—") + (client.owner_telegram_id ? ` <span class="muted small mono">(${escapeHtml(client.owner_telegram_id)})</span>` : ""))}
          ${detailItem("اشتراک", client.subscription ? `${escapeHtml(client.subscription.plan_name)} — ${badge(client.subscription.status)} تا ${faDate(client.subscription.expires_at)}` : "—")}
          ${detailItem("Webhook URL", escapeHtml(client.webhook_url), { mono: true })}
          ${detailItem("رمز وبهوک", `${escapeHtml(client.webhook_secret_masked)}`, { mono: true })}
          ${detailItem("آخرین وبهوک", escapeHtml(faDateTime(client.last_webhook_at)))}
          ${detailItem("آخرین انتشار", escapeHtml(faDateTime(client.last_publication_at)))}
          ${detailItem("آخرین خطا", client.last_failure_at ? `${escapeHtml(faDateTime(client.last_failure_at))}<div class="muted small">${escapeHtml(String(client.last_failure_message || "").slice(0, 120))}</div>` : "—")}
          ${detailItem("تعداد فیلدها", faNumber(client.field_count))}
          ${detailItem("ساخته شده", escapeHtml(faDateTime(client.created_at)))}
        </div>
      </section>

      <section class="card">
        <h2>آمار انتشار</h2>
        <div class="grid stats">
          <div class="stat"><small>موفق</small><b>${faNumber(client.publication_stats?.published)}</b></div>
          <div class="stat"><small>ناموفق</small><b>${faNumber(client.publication_stats?.failed)}</b></div>
          <div class="stat"><small>۷ روز اخیر</small><b>${faNumber(client.publication_stats?.last_7_days)}</b></div>
          <div class="stat"><small>رویداد وبهوک</small><b>${faNumber(client.webhook_event_count)}</b></div>
        </div>
      </section>`);
    return;
  }

  if (clientTab.current === "platforms") {
    const stats = Object.fromEntries((client.platform_stats || []).map((row) => [row.platform, row]));
    const platformCard = (platform, target) => {
      const row = stats[platform] || { published: 0, failed: 0, last_published_at: null };
      return `
        <section class="card">
          <div class="card-header">
            <h2>${escapeHtml(label(PLATFORM_LABELS, platform))}</h2>
            <div class="spacer"></div>
            ${target ? badge("active", "پیکربندی شده") : badge("pending", "پیکربندی نشده")}
          </div>
          <div class="detail-grid">
            ${detailItem("هدف", target ? escapeHtml(target) : "—", { mono: true })}
            ${detailItem("انتشار موفق", faNumber(row.published))}
            ${detailItem("انتشار ناموفق", faNumber(row.failed))}
            ${detailItem("آخرین انتشار", escapeHtml(faDateTime(row.last_published_at)))}
          </div>
          <div class="btn-row" style="margin-top:12px">
            ${can("platforms.test") ? `<button class="btn secondary small" data-action="test-platform" data-id="${escapeHtml(client.id)}" data-platform="${platform}" data-mode="check">🔍 تست اتصال</button>` : ""}
            ${can("platforms.test") && platform !== "whatsapp" ? `<button class="btn secondary small" data-action="test-platform" data-id="${escapeHtml(client.id)}" data-platform="${platform}" data-mode="send">📨 ارسال پیام تست</button>` : ""}
            ${can("platforms.update") && platform !== "whatsapp" ? `<button class="btn ghost small" data-action="edit-target" data-id="${escapeHtml(client.id)}" data-platform="${platform}">✏️ تغییر هدف</button>` : ""}
          </div>
        </section>`;
    };

    setBody(`
      ${platformCard("telegram", client.telegram_channel_id)}
      ${platformCard("bale", client.bale_chat_id)}
      ${platformCard("whatsapp", "")}
      <p class="muted small">توکن ربات‌ها و اعتبارنامه‌های واتس‌اپ سمت بک‌اند و رمزنگاری‌شده نگهداری می‌شوند و در این پنل نمایش داده نمی‌شوند.</p>`);
    return;
  }

  if (clientTab.current === "fields") {
    const { fields } = await api.get(`/clients/${encodeURIComponent(client.id)}/fields`);
    setBody(`
      <section class="card">
        <div class="card-header">
          <h2>فیلدهای انتشار</h2>
          <div class="spacer"></div>
          <span class="muted small">برچسب، ترتیب و نمایش از وردپرس می‌آید؛ بک‌اند فقط آن را نگهداری و نمایش می‌دهد.</span>
        </div>
        ${fields.length ? table(
          [{ title: "ترتیب", numeric: true }, { title: "برچسب" }, { title: "کلید" }, { title: "نوع" }, { title: "نمایش در پلتفرم" }, { title: "اولین مشاهده" }, { title: "آخرین مشاهده" }],
          fields.map((field) => `
            <tr>
              <td class="numeric">${faNumber(field.field_order)}</td>
              <td><strong>${escapeHtml(field.label || field.field_key)}</strong></td>
              <td class="mono small">${escapeHtml(field.field_key)}</td>
              <td class="small">${escapeHtml(field.field_type || "—")}</td>
              <td>${field.platforms
                ? Object.entries(field.platforms).filter(([, value]) => value === true)
                  .map(([key]) => `<span class="badge info">${escapeHtml(label(PLATFORM_LABELS, key))}</span>`).join(" ")
                  || '<span class="badge">هیچ‌کدام</span>'
                : `<span class="badge">visibility: ${escapeHtml(field.visibility || "—")}</span>`}</td>
              <td class="small nowrap">${escapeHtml(faDate(field.first_seen_at))}</td>
              <td class="small nowrap">${escapeHtml(faDate(field.last_seen_at))}</td>
            </tr>`),
        ) : emptyState("هنوز فیلدی از وردپرس دریافت نشده است", "با اولین انتشار، فهرست فیلدها ساخته می‌شود.")}
      </section>`);
    return;
  }

  if (clientTab.current === "publications") {
    const result = await api.get(`/clients/${encodeURIComponent(client.id)}/publications?page=${clientTab.publicationsPage}`);
    setBody(`
      <section class="card">
        <h2>تاریخچه انتشار</h2>
        ${result.items.length ? publicationTable(result.items) : emptyState("انتشاری ثبت نشده است")}
        ${pagination(result.pagination, "client-publications-page")}
      </section>`);
    return;
  }

  if (clientTab.current === "webhooks") {
    const result = await api.get(`/clients/${encodeURIComponent(client.id)}/webhooks?page=${clientTab.webhooksPage}`);
    setBody(`
      <section class="card">
        <h2>تشخیص وبهوک</h2>
        <div class="detail-grid">
          ${detailItem("آدرس وبهوک", escapeHtml(client.webhook_url), { mono: true })}
          ${detailItem("کل رویدادها", faNumber(client.webhook_event_count))}
          ${detailItem("رویدادهای ناموفق", faNumber(client.webhook_failure_count))}
          ${detailItem("آخرین رویداد", escapeHtml(faDateTime(client.last_webhook_at)))}
        </div>
      </section>
      <section class="card">
        <h2>آخرین درخواست‌ها</h2>
        ${result.items.length ? table(
          [{ title: "رویداد" }, { title: "پست" }, { title: "کد" }, { title: "احراز هویت" }, { title: "مدت", numeric: true }, { title: "قرارداد" }, { title: "خطا" }, { title: "زمان" }],
          result.items.map((event) => `
            <tr>
              <td>${escapeHtml(event.event_type || "—")}</td>
              <td class="mono small">${escapeHtml(event.post_id || "—")}</td>
              <td>${badge(event.http_status < 400 ? "published" : "failed", String(event.http_status))}</td>
              <td class="small">${escapeHtml(event.auth_result || "—")}</td>
              <td class="numeric">${faNumber(event.duration_ms)}ms</td>
              <td class="small">${escapeHtml(event.contract_version || "—")}</td>
              <td class="small">${escapeHtml(String(event.error || "").slice(0, 60) || "—")}</td>
              <td class="nowrap small">${escapeHtml(faDateTime(event.created_at))}</td>
            </tr>`),
        ) : emptyState("رویدادی دریافت نشده است", "آدرس وبهوک و Site ID را در افزونه وردپرس بررسی کنید.")}
        ${pagination(result.pagination, "client-webhooks-page")}
      </section>`);
  }
}

/* ------------------------------------------------------------------ *
 * Views: publications
 * ------------------------------------------------------------------ */

const publicationTable = (items) => table(
  [{ title: "شناسه" }, { title: "کلاینت" }, { title: "پست" }, { title: "پلتفرم" }, { title: "رویداد" },
    { title: "وضعیت" }, { title: "مدت", numeric: true }, { title: "زمان" }, { title: "" }],
  items.map((item) => `
    <tr>
      <td class="mono small">${faNumber(item.id)}</td>
      <td>${escapeHtml(item.site_name || item.site_id)}</td>
      <td class="mono small">${escapeHtml(item.post_id)}</td>
      <td>${escapeHtml(label(PLATFORM_LABELS, item.platform))}</td>
      <td class="small">${escapeHtml(item.event_type)}</td>
      <td>${badge(item.status)}</td>
      <td class="numeric small">${item.duration_ms ? `${faNumber(item.duration_ms)}ms` : "—"}</td>
      <td class="nowrap small">${escapeHtml(faDateTime(item.created_at))}</td>
      <td class="actions"><button class="btn ghost small" data-action="open-publication" data-id="${item.id}">جزئیات</button></td>
    </tr>`),
);

const publicationFilters = { page: 1, q: "", status: "", platform: "", event_type: "", site_id: "" };

async function viewPublications() {
  setView(loadingState());
  const query = new URLSearchParams({ page: String(publicationFilters.page) });
  for (const key of ["q", "status", "platform", "event_type", "site_id"]) {
    if (publicationFilters[key]) query.set(key, publicationFilters[key]);
  }
  const result = await api.get(`/publications?${query}`);

  setView(`
    <section class="card">
      <div class="card-header">
        <h2>تاریخچه انتشار</h2>
        <div class="spacer"></div>
        <span class="muted small">${faNumber(result.pagination.total)} رکورد</span>
      </div>

      <div class="filters">
        <input id="pub-search" type="search" placeholder="جست‌وجو در پست، خطا یا Site ID" value="${escapeHtml(publicationFilters.q)}">
        <select id="pub-status">
          <option value="">همه وضعیت‌ها</option>
          ${["published", "failed", "skipped", "deleted", "superseded"].map((status) => `
            <option value="${status}" ${publicationFilters.status === status ? "selected" : ""}>${escapeHtml(label(STATUS_LABELS, status))}</option>`).join("")}
        </select>
        <select id="pub-platform">
          <option value="">همه پلتفرم‌ها</option>
          ${Object.entries(PLATFORM_LABELS).map(([key, title]) => `
            <option value="${key}" ${publicationFilters.platform === key ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
        </select>
        <select id="pub-event">
          <option value="">همه رویدادها</option>
          ${["created", "published", "updated", "deleted", "deleted_from_trash"].map((event) => `
            <option value="${event}" ${publicationFilters.event_type === event ? "selected" : ""}>${escapeHtml(event)}</option>`).join("")}
        </select>
        <input id="pub-site" type="search" placeholder="Site ID" value="${escapeHtml(publicationFilters.site_id)}">
        <button class="btn secondary small" data-action="apply-pub-filters">اعمال</button>
        <button class="btn ghost small" data-action="reset-pub-filters">پاک کردن</button>
      </div>

      ${result.items.length ? publicationTable(result.items) : emptyState("انتشاری با این فیلترها یافت نشد")}
      ${pagination(result.pagination, "publications-page")}
    </section>`);
}

async function openPublication(id) {
  const { publication } = await api.get(`/publications/${id}`);
  const retryButton = publication.retry_eligible && can("publications.retry")
    ? `<button class="btn small" data-action="retry-publication" data-id="${publication.id}">🔁 تلاش مجدد</button>`
    : "";

  modal({
    title: `انتشار #${faNumber(publication.id)}`,
    subtitle: `${label(PLATFORM_LABELS, publication.platform)} · ${publication.event_type}`,
    body: `
      <div class="detail-grid">
        ${detailItem("کلاینت", escapeHtml(publication.site_name || publication.site_id))}
        ${detailItem("Site ID", escapeHtml(publication.site_id), { mono: true })}
        ${detailItem("پست", escapeHtml(publication.post_id), { mono: true })}
        ${detailItem("وضعیت", badge(publication.status))}
        ${detailItem("زمان", escapeHtml(faDateTime(publication.created_at)))}
        ${detailItem("مدت", publication.duration_ms ? `${faNumber(publication.duration_ms)}ms` : "—")}
        ${detailItem("تعداد تلاش", faNumber(publication.attempt_count || 1))}
        ${detailItem("شناسه پیام", escapeHtml(JSON.stringify(publication.external_message_ids || [])), { mono: true })}
        ${detailItem("شماره تماس", publication.has_contact_phone ? "ثبت شده (رمزنگاری‌شده)" : "—")}
      </div>
      ${publication.error_message ? `
        <div class="field" style="margin-top:14px">
          <label>خطا (${escapeHtml(publication.error_code || "unknown")})</label>
          <div class="secret-box small">${escapeHtml(publication.error_message)}</div>
        </div>` : ""}
      ${publication.retry ? `
        <div class="field">
          <label>وضعیت صف تلاش مجدد</label>
          <div class="detail-item">
            ${badge(publication.retry.status)}
            تلاش ${faNumber(publication.retry.attempts)} از ${faNumber(publication.retry.max_attempts)} ·
            بعدی: ${escapeHtml(faDateTime(publication.retry.next_attempt_at))}
            ${publication.retry.last_error ? `<div class="muted small">${escapeHtml(publication.retry.last_error)}</div>` : ""}
          </div>
        </div>` : ""}
      <div class="field">
        <label>فراداده</label>
        <div class="detail-item mono small" dir="ltr">${escapeHtml(JSON.stringify(publication.metadata || {}, null, 2))}</div>
      </div>
      <div class="btn-row">${retryButton}</div>`,
    confirmLabel: "بستن",
    cancelLabel: "",
    onSubmit: async () => {},
  });
  // The cancel button is hidden for a read-only detail modal.
  $("#modal-form [data-close='cancel']")?.remove();
}

async function viewRetries() {
  setView(loadingState());
  const result = await api.get("/publications/retries");
  const stats = await api.get("/publications/stats");

  setView(`
    <section class="card">
      <div class="card-header">
        <h2>صف تلاش مجدد</h2>
        <div class="spacer"></div>
        ${can("publications.retry") ? '<button class="btn small" data-action="run-retries">▶️ اجرای فوری صف</button>' : ""}
      </div>
      <div class="grid stats">
        ${["pending", "processing", "succeeded", "failed", "cancelled"].map((status) => `
          <div class="stat"><small>${escapeHtml(label(STATUS_LABELS, status))}</small><b>${faNumber(stats.retries?.[status] || 0)}</b></div>`).join("")}
      </div>
      <p class="muted small">
        تلاش مجدد فقط برای خطاهای گذرا (شبکه، وقفه، محدودیت نرخ، خطای سرور پلتفرم) به‌صورت خودکار در صف قرار می‌گیرد؛
        خطاهای پیکربندی با تلاش دوباره حل نمی‌شوند و باید اصلاح شوند.
      </p>
    </section>

    <section class="card">
      ${result.items.length ? table(
        [{ title: "شناسه" }, { title: "کلاینت" }, { title: "پست" }, { title: "پلتفرم" }, { title: "وضعیت" },
          { title: "تلاش", numeric: true }, { title: "تلاش بعدی" }, { title: "آخرین خطا" }, { title: "" }],
        result.items.map((job) => `
          <tr>
            <td class="mono small">${faNumber(job.id)}</td>
            <td>${escapeHtml(job.site_name || job.site_id)}</td>
            <td class="mono small">${escapeHtml(job.post_id)}</td>
            <td>${escapeHtml(label(PLATFORM_LABELS, job.platform))}</td>
            <td>${badge(job.status)}</td>
            <td class="numeric">${faNumber(job.attempts)}/${faNumber(job.max_attempts)}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(job.next_attempt_at))}</td>
            <td class="small">${escapeHtml(String(job.last_error || "—").slice(0, 60))}</td>
            <td class="actions">${can("publications.retry") && ["pending", "processing"].includes(job.status)
              ? `<button class="btn ghost small" data-action="cancel-retry" data-id="${job.id}">لغو</button>` : ""}</td>
          </tr>`),
      ) : emptyState("صف خالی است", "هیچ انتشاری در انتظار تلاش مجدد نیست.")}
      ${pagination(result.pagination, "retries-page")}
    </section>`);
}

/* ------------------------------------------------------------------ *
 * Views: users
 * ------------------------------------------------------------------ */

const userFilters = { page: 1, q: "", status: "", subscription: "" };

async function viewUsers() {
  setView(loadingState());
  const query = new URLSearchParams({ page: String(userFilters.page) });
  for (const key of ["q", "status", "subscription"]) if (userFilters[key]) query.set(key, userFilters[key]);
  const result = await api.get(`/users?${query}`);

  setView(`
    <section class="card">
      <div class="card-header"><h2>کاربران</h2><div class="spacer"></div>
        <span class="muted small">${faNumber(result.pagination.total)} کاربر</span></div>

      <div class="filters">
        <input id="user-search" type="search" placeholder="نام، نام کاربری یا Telegram ID" value="${escapeHtml(userFilters.q)}">
        <select id="user-status">
          <option value="">همه وضعیت‌ها</option>
          <option value="active" ${userFilters.status === "active" ? "selected" : ""}>فعال</option>
          <option value="suspended" ${userFilters.status === "suspended" ? "selected" : ""}>معلق</option>
        </select>
        <select id="user-subscription">
          <option value="">همه اشتراک‌ها</option>
          <option value="active" ${userFilters.subscription === "active" ? "selected" : ""}>اشتراک فعال</option>
          <option value="expired" ${userFilters.subscription === "expired" ? "selected" : ""}>بدون اشتراک فعال</option>
        </select>
        <button class="btn secondary small" data-action="apply-user-filters">اعمال</button>
        <button class="btn ghost small" data-action="reset-user-filters">پاک کردن</button>
      </div>

      ${result.items.length ? table(
        [{ title: "کاربر" }, { title: "Telegram" }, { title: "وضعیت" }, { title: "اشتراک" },
          { title: "سایت‌ها", numeric: true }, { title: "عضویت" }, { title: "" }],
        result.items.map((user) => `
          <tr>
            <td><strong>${escapeHtml(user.display_name || "بدون نام")}</strong>
              ${user.username ? `<div class="muted small">@${escapeHtml(user.username)}</div>` : ""}</td>
            <td class="mono small">${escapeHtml(user.telegram_id || "—")}</td>
            <td>${badge(user.status)}</td>
            <td>${user.subscription_plan ? `${escapeHtml(user.subscription_plan)} <span class="muted small">تا ${escapeHtml(faDate(user.subscription_expires_at))}</span>` : '<span class="muted small">—</span>'}</td>
            <td class="numeric">${faNumber(user.site_count)}</td>
            <td class="nowrap small">${escapeHtml(faDate(user.created_at))}</td>
            <td class="actions"><button class="btn secondary small" data-action="open-user" data-id="${user.id}">مشاهده</button></td>
          </tr>`),
      ) : emptyState("کاربری یافت نشد")}
      ${pagination(result.pagination, "users-page")}
    </section>`);
}

async function viewUser(id) {
  setView(loadingState());
  const { user } = await api.get(`/users/${id}`);

  setView(`
    <section class="card">
      <div class="card-header">
        <div><h2>${escapeHtml(user.display_name || "بدون نام")}</h2>
          <div class="muted small">${user.username ? `@${escapeHtml(user.username)}` : ""} · شناسه ${faNumber(user.id)}</div></div>
        <div class="spacer"></div>
        ${badge(user.status)}
        <button class="btn ghost small" data-action="back-users">فهرست کاربران</button>
      </div>

      <div class="btn-row">
        ${can("users.update") ? `<button class="btn ${user.status === "suspended" ? "secondary" : "danger"} small"
          data-action="toggle-user" data-id="${user.id}" data-status="${user.status}">
          ${user.status === "suspended" ? "✅ فعال‌سازی" : "⛔ تعلیق"}</button>` : ""}
        ${can("users.sessions.revoke") ? `<button class="btn secondary small" data-action="revoke-user-sessions" data-id="${user.id}">🚪 ابطال نشست‌ها</button>` : ""}
      </div>
    </section>

    <section class="card">
      <h2>مشخصات</h2>
      <div class="detail-grid">
        ${detailItem("عضویت", escapeHtml(faDateTime(user.created_at)))}
        ${detailItem("آخرین فعالیت", escapeHtml(faDateTime(user.last_seen_at)))}
        ${detailItem("شماره تماس", user.has_phone
          ? (user.phone !== undefined
            ? `<span class="mono">${escapeHtml(user.phone)}</span> <span class="muted small">(دسترسی شما اجازه مشاهده دارد و ثبت شد)</span>`
            : `<span class="mono">${escapeHtml(user.phone_masked)}</span> <span class="muted small">(سطح دسترسی شما اجازه مشاهده کامل ندارد)</span>`)
          : "—")}
        ${detailItem("هویت‌ها", user.identities.map((identity) => `${escapeHtml(identity.platform)}: <span class="mono">${escapeHtml(identity.platform_user_id)}</span>`).join("<br>") || "—")}
      </div>
    </section>

    <div class="grid two">
      <section class="card">
        <h2>اشتراک‌ها</h2>
        ${user.subscriptions.length ? table(
          [{ title: "پلن" }, { title: "وضعیت" }, { title: "انقضا" }, { title: "منبع" }],
          user.subscriptions.map((subscription) => `
            <tr>
              <td>${escapeHtml(subscription.plan_name)}</td>
              <td>${badge(subscription.status)}</td>
              <td class="nowrap small">${escapeHtml(faDate(subscription.expires_at))}</td>
              <td class="small">${escapeHtml(subscription.source)}</td>
            </tr>`),
        ) : emptyState("اشتراکی ثبت نشده است")}
      </section>

      <section class="card">
        <h2>فاکتورها</h2>
        ${user.invoices.length ? table(
          [{ title: "شناسه" }, { title: "پلن" }, { title: "مبلغ", numeric: true }, { title: "وضعیت" }],
          user.invoices.map((invoice) => `
            <tr>
              <td class="mono small">${escapeHtml(invoice.public_id)}</td>
              <td class="small">${escapeHtml(invoice.plan_id)}</td>
              <td class="numeric">${faNumber(invoice.amount_toman)}</td>
              <td>${badge(invoice.status)}</td>
            </tr>`),
        ) : emptyState("فاکتوری ثبت نشده است")}
      </section>
    </div>

    <div class="grid two">
      <section class="card">
        <h2>سایت‌ها</h2>
        ${user.sites.length ? table(
          [{ title: "کلاینت" }, { title: "وضعیت" }, { title: "آخرین انتشار" }, { title: "" }],
          user.sites.map((site) => `
            <tr>
              <td>${escapeHtml(site.name || site.id)}<div class="muted small mono">${escapeHtml(site.id)}</div></td>
              <td>${badge(site.enabled ? "active" : "blocked", site.enabled ? "فعال" : "غیرفعال")}</td>
              <td class="nowrap small">${escapeHtml(faDateTime(site.last_publication_at))}</td>
              <td class="actions">${can("clients.view") ? `<button class="btn ghost small" data-action="open-client" data-id="${escapeHtml(site.id)}">مدیریت</button>` : ""}</td>
            </tr>`),
        ) : emptyState("سایتی به این کاربر متصل نیست")}
      </section>

      <section class="card">
        <h2>نشست‌های پنل کاربری</h2>
        ${user.sessions.length ? table(
          [{ title: "پلتفرم" }, { title: "ایجاد" }, { title: "انقضا" }, { title: "وضعیت" }],
          user.sessions.map((appSession) => `
            <tr>
              <td class="small">${escapeHtml(appSession.platform || "—")}</td>
              <td class="nowrap small">${escapeHtml(faDateTime(appSession.created_at))}</td>
              <td class="nowrap small">${escapeHtml(faDateTime(appSession.expires_at))}</td>
              <td>${badge(appSession.active ? "active" : "expired", appSession.active ? "فعال" : "منقضی/باطل")}</td>
            </tr>`),
        ) : emptyState("نشستی ثبت نشده است")}
      </section>
    </div>`);
}

/* ------------------------------------------------------------------ *
 * Views: billing
 * ------------------------------------------------------------------ */

const subscriptionFilters = { page: 1, state: "", q: "" };

async function viewSubscriptions() {
  setView(loadingState());
  const query = new URLSearchParams({ page: String(subscriptionFilters.page) });
  if (subscriptionFilters.state) query.set("state", subscriptionFilters.state);
  if (subscriptionFilters.q) query.set("q", subscriptionFilters.q);
  const result = await api.get(`/subscriptions?${query}`);

  setView(`
    <section class="card">
      <div class="card-header"><h2>اشتراک‌ها</h2><div class="spacer"></div>
        ${can("subscriptions.manage") ? '<button class="btn small" data-action="grant-subscription">➕ اعطای اشتراک</button>' : ""}</div>

      <div class="filters">
        <input id="sub-search" type="search" placeholder="نام کاربر" value="${escapeHtml(subscriptionFilters.q)}">
        <select id="sub-state">
          <option value="">همه</option>
          <option value="active" ${subscriptionFilters.state === "active" ? "selected" : ""}>فعال</option>
          <option value="expiring" ${subscriptionFilters.state === "expiring" ? "selected" : ""}>رو به انقضا (۷ روز)</option>
          <option value="expired" ${subscriptionFilters.state === "expired" ? "selected" : ""}>منقضی</option>
        </select>
        <button class="btn secondary small" data-action="apply-sub-filters">اعمال</button>
      </div>

      ${result.items.length ? table(
        [{ title: "کاربر" }, { title: "پلن" }, { title: "وضعیت" }, { title: "انقضا" },
          { title: "باقیمانده", numeric: true }, { title: "منبع" }, { title: "" }],
        result.items.map((subscription) => `
          <tr>
            <td>${escapeHtml(subscription.display_name || "—")}
              ${subscription.username ? `<div class="muted small">@${escapeHtml(subscription.username)}</div>` : ""}</td>
            <td>${escapeHtml(subscription.plan_name)}</td>
            <td>${badge(subscription.status)}</td>
            <td class="nowrap small">${escapeHtml(faDate(subscription.expires_at))}</td>
            <td class="numeric">${faNumber(subscription.days_remaining)} روز</td>
            <td class="small">${escapeHtml(subscription.source)}</td>
            <td class="actions">
              ${can("subscriptions.manage") ? `
                <button class="btn ghost small" data-action="extend-subscription" data-id="${subscription.id}">تمدید</button>
                <button class="btn ghost small" data-action="expire-subscription" data-id="${subscription.id}">انقضا</button>` : ""}
            </td>
          </tr>`),
      ) : emptyState("اشتراکی یافت نشد")}
      ${pagination(result.pagination, "subscriptions-page")}
    </section>`);
}

async function viewPlans() {
  setView(loadingState());
  const { plans } = await api.get("/plans?include_inactive=true");

  setView(`
    <section class="card">
      <div class="card-header"><h2>پلن‌ها</h2><div class="spacer"></div>
        ${can("plans.manage") ? '<button class="btn small" data-action="new-plan">➕ پلن جدید</button>' : ""}</div>

      ${table(
        [{ title: "شناسه" }, { title: "نام" }, { title: "مدت", numeric: true }, { title: "قیمت (تومان)", numeric: true },
          { title: "استارز", numeric: true }, { title: "نوع" }, { title: "وضعیت" }, { title: "استفاده", numeric: true }, { title: "" }],
        plans.map((plan) => `
          <tr>
            <td class="mono small">${escapeHtml(plan.id)}</td>
            <td>${escapeHtml(plan.name)}</td>
            <td class="numeric">${faNumber(plan.duration_days)} روز</td>
            <td class="numeric">${faNumber(plan.price_toman)}</td>
            <td class="numeric">${faNumber(plan.telegram_stars)}</td>
            <td>${plan.is_trial ? '<span class="badge warning">آزمایشی</span>' : '<span class="badge">پولی</span>'}</td>
            <td>${badge(plan.active ? "active" : "expired", plan.active ? "فعال" : "غیرفعال")}</td>
            <td class="numeric small">${faNumber(plan.subscription_count)} اشتراک · ${faNumber(plan.invoice_count)} فاکتور</td>
            <td class="actions">${can("plans.manage") ? `<button class="btn ghost small" data-action="edit-plan" data-id="${escapeHtml(plan.id)}">ویرایش</button>` : ""}</td>
          </tr>`),
      )}
      <p class="muted small">تغییر قیمت پلن فقط روی خریدهای بعدی اثر دارد؛ فاکتورهای صادرشده دست‌نخورده می‌مانند.</p>
    </section>`);
}

const invoiceFilters = { page: 1, q: "", status: "" };

async function viewInvoices() {
  setView(loadingState());
  const query = new URLSearchParams({ page: String(invoiceFilters.page) });
  if (invoiceFilters.q) query.set("q", invoiceFilters.q);
  if (invoiceFilters.status) query.set("status", invoiceFilters.status);
  const result = await api.get(`/invoices?${query}`);

  setView(`
    <section class="card">
      <div class="card-header"><h2>پرداخت‌ها</h2><div class="spacer"></div>
        <span class="muted small">${faNumber(result.pagination.total)} فاکتور</span></div>

      <div class="filters">
        <input id="invoice-search" type="search" placeholder="شناسه فاکتور، کاربر یا مرجع پرداخت" value="${escapeHtml(invoiceFilters.q)}">
        <select id="invoice-status">
          <option value="">همه وضعیت‌ها</option>
          ${["pending", "paid", "failed"].map((status) => `
            <option value="${status}" ${invoiceFilters.status === status ? "selected" : ""}>${escapeHtml(label(STATUS_LABELS, status))}</option>`).join("")}
        </select>
        <button class="btn secondary small" data-action="apply-invoice-filters">اعمال</button>
      </div>

      ${result.items.length ? table(
        [{ title: "شناسه" }, { title: "کاربر" }, { title: "پلن" }, { title: "مبلغ", numeric: true },
          { title: "روش" }, { title: "وضعیت" }, { title: "پرداخت" }, { title: "" }],
        result.items.map((invoice) => `
          <tr>
            <td class="mono small">${escapeHtml(invoice.public_id)}</td>
            <td>${escapeHtml(invoice.display_name || "—")}</td>
            <td class="small">${escapeHtml(invoice.plan_name)}</td>
            <td class="numeric">${faNumber(invoice.amount_toman)}</td>
            <td class="small">${escapeHtml(invoice.payment_method)}</td>
            <td>${badge(invoice.status)}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(invoice.paid_at))}</td>
            <td class="actions"><button class="btn ghost small" data-action="open-invoice" data-id="${escapeHtml(invoice.public_id)}">جزئیات</button></td>
          </tr>`),
      ) : emptyState("فاکتوری یافت نشد")}
      ${pagination(result.pagination, "invoices-page")}
    </section>`);
}

async function openInvoice(publicId) {
  const { invoice } = await api.get(`/invoices/${encodeURIComponent(publicId)}`);
  modal({
    title: `فاکتور ${invoice.public_id}`,
    subtitle: `${invoice.plan_name} — ${label(STATUS_LABELS, invoice.status)}`,
    body: `
      <div class="detail-grid">
        ${detailItem("کاربر", escapeHtml(invoice.display_name || "—"))}
        ${detailItem("مبلغ", `${faNumber(invoice.amount_toman)} ${escapeHtml(invoice.currency)}`)}
        ${detailItem("روش پرداخت", escapeHtml(invoice.payment_method))}
        ${detailItem("درگاه", escapeHtml(invoice.gateway || "—"))}
        ${detailItem("مرجع پرداخت", escapeHtml(invoice.gateway_transaction_id || "—"), { mono: true })}
        ${detailItem("ایجاد", escapeHtml(faDateTime(invoice.created_at)))}
        ${detailItem("پرداخت", escapeHtml(faDateTime(invoice.paid_at)))}
        ${detailItem("اشتراک مرتبط", invoice.subscription ? `${escapeHtml(invoice.subscription.plan_id)} تا ${escapeHtml(faDate(invoice.subscription.expires_at))}` : "—")}
      </div>
      <div class="field" style="margin-top:12px">
        <label>فراداده</label>
        <div class="detail-item mono small" dir="ltr">${escapeHtml(JSON.stringify(invoice.metadata || {}, null, 2))}</div>
      </div>`,
    confirmLabel: "بستن",
    onSubmit: async () => {},
  });
  $("#modal-form [data-close='cancel']")?.remove();
}

/* ------------------------------------------------------------------ *
 * Views: platforms, admins, audit, settings
 * ------------------------------------------------------------------ */

async function viewPlatforms() {
  setView(loadingState("در حال بررسی اتصال پلتفرم‌ها…"));
  const { platforms } = await api.get("/platforms?probe=true");

  const card = (title, data, extra = "") => `
    <section class="card">
      <div class="card-header"><h2>${escapeHtml(title)}</h2><div class="spacer"></div>
        ${data.configured
          ? (data.reachable === false ? badge("failed", "خطا در اتصال") : badge("published", "پیکربندی شده"))
          : badge("pending", "پیکربندی نشده")}</div>
      <div class="detail-grid">
        ${detailItem("اثر انگشت توکن", escapeHtml(data.token_hint || "—"), { mono: true })}
        ${data.bot_username ? detailItem("نام ربات", `@${escapeHtml(data.bot_username)}`) : ""}
        ${data.webhook_url ? detailItem("وبهوک", escapeHtml(data.webhook_url), { mono: true }) : ""}
        ${data.api_base ? detailItem("API", escapeHtml(data.api_base), { mono: true }) : ""}
        ${data.graph_version ? detailItem("نسخه Graph API", escapeHtml(data.graph_version)) : ""}
        ${data.error ? detailItem("خطا", escapeHtml(data.error)) : ""}
      </div>
      ${extra}
    </section>`;

  setView(`
    ${card("تلگرام", platforms.telegram)}
    ${card("بله", platforms.bale)}
    ${card("واتس‌اپ", platforms.whatsapp, '<p class="muted small">اعتبارنامه‌های واتس‌اپ به‌ازای هر کلاینت و رمزنگاری‌شده ذخیره می‌شوند؛ تست اتصال از صفحه هر کلاینت انجام می‌شود.</p>')}
    <p class="muted small">مقدار توکن‌ها هرگز از بک‌اند خارج نمی‌شود؛ تنها یک اثر انگشت ماسک‌شده نمایش داده می‌شود.</p>`);
}

async function viewAdmins() {
  setView(loadingState());
  const [result, roles] = await Promise.all([api.get("/admins"), api.get("/roles")]);

  setView(`
    <section class="card">
      <div class="card-header"><h2>مدیران</h2><div class="spacer"></div>
        ${can("admins.manage") ? '<button class="btn small" data-action="new-admin">➕ مدیر جدید</button>' : ""}</div>

      ${table(
        [{ title: "نام کاربری" }, { title: "نام" }, { title: "نقش" }, { title: "Telegram" },
          { title: "وضعیت" }, { title: "آخرین ورود" }, { title: "" }],
        result.items.map((admin) => `
          <tr>
            <td class="mono">${escapeHtml(admin.username)}</td>
            <td>${escapeHtml(admin.display_name || "—")}</td>
            <td><span class="badge info">${escapeHtml(label(ROLE_LABELS, admin.role))}</span></td>
            <td class="mono small">${escapeHtml(admin.telegram_user_id || "—")}</td>
            <td>${badge(admin.status === "active" ? "active" : "expired", admin.status === "active" ? "فعال" : "غیرفعال")}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(admin.last_login_at))}</td>
            <td class="actions">${can("admins.manage") ? `
              <button class="btn ghost small" data-action="edit-admin" data-id="${admin.id}" data-role="${escapeHtml(admin.role)}" data-status="${escapeHtml(admin.status)}">ویرایش</button>
              <button class="btn ghost small" data-action="revoke-admin-sessions" data-id="${admin.id}">ابطال نشست‌ها</button>` : ""}</td>
          </tr>`),
      )}
    </section>

    <section class="card">
      <h2>سطوح دسترسی</h2>
      <div class="grid two">
        ${roles.roles.map((role) => `
          <div class="detail-item">
            <small>${escapeHtml(label(ROLE_LABELS, role.role))} — ${escapeHtml(role.role)}</small>
            <div class="small" style="margin-top:6px">
              ${role.permissions.map((permission) => `<span class="badge">${escapeHtml(permission)}</span>`).join(" ")}
            </div>
          </div>`).join("")}
      </div>
    </section>`);
}

const auditFilters = { page: 1, q: "", action: "", channel: "" };

async function viewAudit() {
  setView(loadingState());
  const query = new URLSearchParams({ page: String(auditFilters.page) });
  for (const key of ["q", "action", "channel"]) if (auditFilters[key]) query.set(key, auditFilters[key]);
  const result = await api.get(`/audit?${query}`);

  setView(`
    <section class="card">
      <div class="card-header"><h2>گزارش عملیات مدیران</h2><div class="spacer"></div>
        <span class="muted small">${faNumber(result.pagination.total)} رکورد</span></div>

      <div class="filters">
        <input id="audit-search" type="search" placeholder="عملیات، مدیر یا شناسه هدف" value="${escapeHtml(auditFilters.q)}">
        <select id="audit-channel">
          <option value="">همه کانال‌ها</option>
          <option value="web" ${auditFilters.channel === "web" ? "selected" : ""}>پنل وب</option>
          <option value="telegram" ${auditFilters.channel === "telegram" ? "selected" : ""}>ربات تلگرام</option>
          <option value="api_token" ${auditFilters.channel === "api_token" ? "selected" : ""}>توکن API</option>
        </select>
        <button class="btn secondary small" data-action="apply-audit-filters">اعمال</button>
      </div>

      ${result.items.length ? table(
        [{ title: "زمان" }, { title: "مدیر" }, { title: "نقش" }, { title: "کانال" },
          { title: "عملیات" }, { title: "هدف" }, { title: "نتیجه" }],
        result.items.map((entry) => `
          <tr>
            <td class="nowrap small">${escapeHtml(faDateTime(entry.created_at))}</td>
            <td>${escapeHtml(entry.actor_label)}</td>
            <td class="small">${escapeHtml(label(ROLE_LABELS, entry.actor_role) || "—")}</td>
            <td class="small">${escapeHtml(entry.channel)}</td>
            <td class="mono small">${escapeHtml(entry.action)}</td>
            <td class="small">${entry.target_type ? `${escapeHtml(entry.target_type)}: <span class="mono">${escapeHtml(entry.target_id)}</span>` : "—"}</td>
            <td>${badge(entry.success ? "published" : "failed", entry.success ? "موفق" : "ناموفق")}</td>
          </tr>`),
      ) : emptyState("رکوردی ثبت نشده است")}
      ${pagination(result.pagination, "audit-page")}
    </section>`);
}

async function viewSettings() {
  setView(loadingState());
  const { settings } = await api.get("/settings");

  setView(`
    <section class="card">
      <h2>پیکربندی بک‌اند</h2>
      <div class="detail-grid">
        ${detailItem("نسخه", escapeHtml(settings.version))}
        ${detailItem("قرارداد وردپرس", `${escapeHtml(settings.contract_version)} <span class="muted small">(سازگار از ${escapeHtml(settings.min_contract_version)})</span>`)}
        ${detailItem("محیط", escapeHtml(settings.environment))}
        ${detailItem("منطقه زمانی", escapeHtml(settings.timezone))}
        ${detailItem("آدرس وبهوک", escapeHtml(settings.webhook_url), { mono: true })}
        ${detailItem("واتس‌اپ", settings.whatsapp_enabled ? "فعال" : "غیرفعال")}
        ${detailItem("زرین‌پال", settings.zarinpal_enabled ? "فعال" : "غیرفعال")}
        ${detailItem("تلگرام استارز", settings.telegram_stars_enabled ? "فعال" : "غیرفعال")}
        ${detailItem("توکن API قدیمی", settings.legacy_api_token_enabled ? "فعال (سازگاری ۱.۲)" : "غیرفعال")}
      </div>
    </section>

    <div class="grid two">
      <section class="card">
        <h2>نشست مدیران</h2>
        <div class="detail-grid">
          ${detailItem("انقضای بی‌کاری", `${faNumber(settings.session.idle_minutes)} دقیقه`)}
          ${detailItem("انقضای مطلق", `${faNumber(settings.session.absolute_hours)} ساعت`)}
          ${detailItem("چرخش توکن", `${faNumber(settings.session.rotate_minutes)} دقیقه`)}
        </div>
      </section>

      <section class="card">
        <h2>تلاش مجدد انتشار</h2>
        <div class="detail-grid">
          ${detailItem("وضعیت", settings.retry.enabled ? "فعال" : "غیرفعال")}
          ${detailItem("صف خودکار", settings.retry.auto_enqueue ? "فعال" : "غیرفعال")}
          ${detailItem("حداکثر تلاش", faNumber(settings.retry.max_attempts))}
          ${detailItem("فاصله اجرای صف", `${faNumber(Math.round(settings.retry.interval_ms / 1000))} ثانیه`)}
        </div>
      </section>
    </div>

    <section class="card">
      <h2>حساب من</h2>
      <div class="btn-row">
        <button class="btn secondary small" data-action="change-password">تغییر گذرواژه</button>
        <button class="btn ghost small" data-action="revoke-my-sessions">ابطال همه نشست‌های من</button>
      </div>
    </section>`);
}


/* ------------------------------------------------------------------ *
 * Views: AI product automation
 * ------------------------------------------------------------------ */

const aiFilters = { page: 1, status: "", type: "" };

const JOB_STATUS_LABELS = {
  pending: "در انتظار", processing: "در حال اجرا", succeeded: "موفق",
  failed: "ناموفق", cancelled: "لغو شده",
};
const JOB_TYPE_LABELS = {
  generate: "تولید محتوا", regenerate: "بازتولید",
  publish: "انتشار در ووکامرس", generate_image: "تولید تصویر",
};
const DRAFT_STATUS_LABELS = {
  draft: "پیش‌نویس", analyzing: "در حال تحلیل", generated: "تولید شد",
  awaiting_review: "در انتظار بازبینی", approved: "تاییدشده", publishing: "در حال انتشار",
  published: "منتشر شد", generation_failed: "خطای تولید", validation_failed: "خطای اعتبارسنجی",
  approval_rejected: "رد شد", publishing_failed: "خطای انتشار", cancelled: "لغو شد",
};

async function viewAi() {
  setView(loadingState("در حال دریافت وضعیت هوش مصنوعی…"));
  const query = new URLSearchParams({ page: String(aiFilters.page) });
  if (aiFilters.status) query.set("status", aiFilters.status);
  if (aiFilters.type) query.set("type", aiFilters.type);

  const [overview, jobs] = await Promise.all([
    api.get("/ai/overview"),
    api.get(`/ai/jobs?${query}`),
  ]);
  const { ai, jobs: summary, drafts, recent_failures: failures, failing_connections: connections } = overview;

  const totalFor = (status) => summary
    .filter((row) => row.status === status)
    .reduce((sum, row) => sum + row.count, 0);

  setView(`
    <section class="card">
      <div class="card-header">
        <h2>هوش مصنوعی محصولات</h2>
        <div class="spacer"></div>
        ${ai.enabled ? badge("active", `فعال · ${escapeHtml(ai.provider)}`) : badge("expired", "غیرفعال")}
        ${ai.worker_enabled ? badge("published", "کارگر روشن") : badge("pending", "کارگر خاموش")}
        ${can("ai.manage") ? '<button class="btn small" data-action="ai-run">▶️ اجرای فوری صف</button>' : ""}
      </div>
      <div class="grid stats">
        ${["pending", "processing", "succeeded", "failed"].map((status) => `
          <div class="stat"><small>${escapeHtml(JOB_STATUS_LABELS[status])}</small><b>${faNumber(totalFor(status))}</b></div>`).join("")}
        <div class="stat"><small>پیش‌نویس‌ها</small><b>${faNumber(drafts.reduce((sum, row) => sum + row.count, 0))}</b></div>
        <div class="stat"><small>تولید تصویر</small>
          <span>${ai.image_generation ? badge("active", "فعال") : badge("pending", "غیرفعال")}</span></div>
      </div>
      ${drafts.length ? `<div class="legend">${drafts.map((row) => `
        <span>${escapeHtml(DRAFT_STATUS_LABELS[row.status] || row.status)}: ${faNumber(row.count)}</span>`).join("")}</div>` : ""}
    </section>

    ${connections.length ? `
    <section class="card">
      <h2>اتصال‌های ووکامرس با مشکل</h2>
      ${table(
        [{ title: "کلاینت" }, { title: "آدرس" }, { title: "آخرین تست" }, { title: "خطا" }],
        connections.map((connection) => `
          <tr>
            <td class="mono small">${escapeHtml(connection.site_id)}</td>
            <td class="small">${escapeHtml(connection.base_url)}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(connection.last_tested_at))}</td>
            <td class="small">${escapeHtml(String(connection.last_test_error || "—").slice(0, 80))}</td>
          </tr>`),
      )}
    </section>` : ""}

    <section class="card">
      <div class="card-header">
        <h2>کارها</h2>
        <div class="spacer"></div>
        <span class="muted small">${faNumber(jobs.pagination.total)} مورد</span>
      </div>
      <div class="filters">
        <select id="ai-status">
          <option value="">همه وضعیت‌ها</option>
          ${Object.entries(JOB_STATUS_LABELS).map(([value, title]) => `
            <option value="${value}" ${aiFilters.status === value ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
        </select>
        <select id="ai-type">
          <option value="">همه انواع</option>
          ${Object.entries(JOB_TYPE_LABELS).map(([value, title]) => `
            <option value="${value}" ${aiFilters.type === value ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
        </select>
        <button class="btn secondary small" data-action="apply-ai-filters">اعمال</button>
      </div>

      ${jobs.items.length ? table(
        [{ title: "شناسه" }, { title: "نوع" }, { title: "کلاینت" }, { title: "مشتری" }, { title: "وضعیت" },
          { title: "تلاش", numeric: true }, { title: "مدت", numeric: true }, { title: "خطا" }, { title: "زمان" }, { title: "" }],
        jobs.items.map((job) => `
          <tr>
            <td class="mono small">${escapeHtml(job.public_id)}</td>
            <td class="small">${escapeHtml(JOB_TYPE_LABELS[job.type] || job.type)}</td>
            <td class="mono small">${escapeHtml(job.site_id || "—")}</td>
            <td class="small">${escapeHtml(job.display_name || job.username || `#${job.user_id}`)}</td>
            <td>${badge(job.status, JOB_STATUS_LABELS[job.status] || job.status)}</td>
            <td class="numeric">${faNumber(job.attempts)}/${faNumber(job.max_attempts)}</td>
            <td class="numeric small">${job.duration_ms ? `${faNumber(job.duration_ms)}ms` : "—"}</td>
            <td class="small">${job.error_code ? `<span class="badge danger">${escapeHtml(job.error_code)}</span>` : "—"}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(job.created_at))}</td>
            <td class="actions">
              ${can("ai.manage") && job.status === "failed" ? `<button class="btn ghost small" data-action="ai-retry" data-id="${escapeHtml(job.public_id)}">تلاش مجدد</button>` : ""}
              ${can("ai.manage") && ["pending", "processing"].includes(job.status) ? `<button class="btn ghost small" data-action="ai-cancel" data-id="${escapeHtml(job.public_id)}">لغو</button>` : ""}
            </td>
          </tr>`),
      ) : emptyState("کاری ثبت نشده است", "پس از اولین درخواست تولید محصول، کارها اینجا دیده می‌شوند.")}
      ${pagination(jobs.pagination, "ai-page")}
    </section>

    ${failures.length ? `
    <section class="card">
      <h2>آخرین خطاها</h2>
      ${table(
        [{ title: "کار" }, { title: "نوع" }, { title: "کد" }, { title: "پیام" }, { title: "زمان" }],
        failures.map((failure) => `
          <tr>
            <td class="mono small">${escapeHtml(failure.public_id)}</td>
            <td class="small">${escapeHtml(JOB_TYPE_LABELS[failure.type] || failure.type)}</td>
            <td><span class="badge danger">${escapeHtml(failure.error_code || "—")}</span></td>
            <td class="small">${escapeHtml(String(failure.last_error || "—").slice(0, 90))}</td>
            <td class="nowrap small">${escapeHtml(faDateTime(failure.created_at))}</td>
          </tr>`),
      )}
    </section>` : ""}

    <p class="muted small">
      محتوای تولیدشده متعلق به مشتری است و در این پنل نمایش داده نمی‌شود؛ فقط وضعیت کارها و خطاها قابل مشاهده است.
    </p>
  `);
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const ACTIONS = {
  "toggle-theme": () => theme.toggle(),
  "toggle-menu": () => $("#sidebar")?.classList.toggle("open"),
  "refresh-dashboard": () => render(),

  logout: async () => {
    await api.post("/auth/logout", {});
    session.admin = null;
    session.csrf = "";
    renderLogin("از حساب خارج شدید.");
  },

  /* clients */
  "new-client": () => clientCreateModal(),
  "open-client": (target) => { clientTab.current = "overview"; location.hash = `#/clients/${target.dataset.id}`; },
  "back-clients": () => { location.hash = "#/clients"; },
  "client-tab": async (target) => {
    clientTab.current = target.dataset.tab;
    await render();
  },
  "clients-page": (target) => { clientFilters.page = Number(target.dataset.page); render(); },
  "apply-client-filters": () => {
    clientFilters.q = $("#client-search").value.trim();
    clientFilters.enabled = $("#client-enabled").value;
    clientFilters.platform = $("#client-platform").value;
    clientFilters.page = 1;
    render();
  },
  "reset-client-filters": () => {
    Object.assign(clientFilters, { page: 1, q: "", enabled: "", platform: "" });
    render();
  },

  "edit-client": async (target) => {
    const { client } = await api.get(`/clients/${encodeURIComponent(target.dataset.id)}`);
    modal({
      title: "ویرایش کلاینت",
      body: `
        <div class="field"><label for="name">نام</label>
          <input id="name" name="name" value="${escapeHtml(client.name || "")}" maxlength="190"></div>
        <div class="field"><label for="wordpress_url">آدرس وردپرس</label>
          <input id="wordpress_url" name="wordpress_url" dir="ltr" value="${escapeHtml(client.wordpress_url || "")}"></div>
        <div class="field"><label for="owner_telegram_id">Telegram ID مالک</label>
          <input id="owner_telegram_id" name="owner_telegram_id" dir="ltr" value="${escapeHtml(client.owner_telegram_id || "")}">
          <span class="hint">خالی گذاشتن، مالک را حذف می‌کند.</span></div>
        <div class="field"><label for="notes">یادداشت داخلی</label>
          <textarea id="notes" name="notes" rows="2" maxlength="2000">${escapeHtml(client.notes || "")}</textarea></div>`,
      confirmLabel: "ذخیره",
      onSubmit: async (values) => {
        await api.patch(`/clients/${encodeURIComponent(client.id)}`, values);
        toast("کلاینت به‌روزرسانی شد");
        render();
      },
    });
  },

  "toggle-client": (target) => {
    const enable = target.dataset.enabled !== "true";
    confirmDialog({
      title: enable ? "فعال‌سازی کلاینت" : "غیرفعال‌سازی کلاینت",
      message: enable
        ? "وبهوک این کلاینت دوباره پذیرفته می‌شود و انتشار از سر گرفته خواهد شد."
        : "با غیرفعال شدن، وبهوک وردپرس این مشتری رد می‌شود و هیچ آگهی‌ای منتشر نخواهد شد.",
      confirmLabel: enable ? "فعال کن" : "غیرفعال کن",
      tone: enable ? "" : "danger",
      onConfirm: async () => {
        await api.post(`/clients/${encodeURIComponent(target.dataset.id)}/enabled`, { enabled: enable });
        toast(enable ? "کلاینت فعال شد" : "کلاینت غیرفعال شد");
        render();
      },
    });
  },

  "rotate-secret": (target) => {
    confirmDialog({
      title: "تعویض رمز وبهوک",
      message: "رمز فعلی بلافاصله باطل می‌شود و تا وارد کردن رمز جدید در افزونه وردپرس، انتشار متوقف خواهد شد.",
      confirmLabel: "تعویض کن",
      onConfirm: async () => {
        const { client } = await api.post(`/clients/${encodeURIComponent(target.dataset.id)}/rotate-secret`, {});
        toast("رمز وبهوک تعویض شد", { tone: "ok" });
        showCredentials({ ...client, id: target.dataset.id });
      },
    });
  },

  "test-client": async (target) => {
    toast("در حال تست اتصال‌ها…");
    const { test } = await api.post(`/clients/${encodeURIComponent(target.dataset.id)}/test`, { mode: "check" });
    if (!test.tested) {
      toast("پلتفرمی برای تست پیکربندی نشده است", { tone: "error" });
      return;
    }
    for (const result of test.results) {
      toast(
        `${label(PLATFORM_LABELS, result.platform)}: ${result.ok ? "سالم" : "ناموفق"}`,
        { tone: result.ok ? "ok" : "error", detail: result.ok ? "" : `${result.error_code} — ${result.error}` },
      );
    }
  },

  "test-platform": async (target) => {
    const { id, platform, mode } = target.dataset;
    const run = async () => {
      const { test } = await api.post(`/clients/${encodeURIComponent(id)}/test/${platform}`, { mode });
      toast(
        test.ok ? `اتصال ${label(PLATFORM_LABELS, platform)} سالم است` : `تست ${label(PLATFORM_LABELS, platform)} ناموفق بود`,
        { tone: test.ok ? "ok" : "error", detail: test.ok ? `${test.duration_ms}ms` : `${test.error_code} — ${test.error}` },
      );
    };

    // Sending a probe posts a visible message into the customer's channel.
    if (mode === "send") {
      confirmDialog({
        title: "ارسال پیام تست",
        message: `یک پیام تست در کانال ${label(PLATFORM_LABELS, platform)} این مشتری ارسال می‌شود. ادامه می‌دهید؟`,
        confirmLabel: "ارسال کن",
        tone: "",
        onConfirm: run,
      });
      return;
    }
    await run();
  },

  "edit-target": async (target) => {
    const { id, platform } = target.dataset;
    const { client } = await api.get(`/clients/${encodeURIComponent(id)}`);
    const field = platform === "telegram" ? "telegram_channel_id" : "bale_chat_id";
    modal({
      title: `هدف ${label(PLATFORM_LABELS, platform)}`,
      subtitle: "برای حذف هدف، مقدار را خالی بگذارید.",
      body: `
        <div class="field">
          <label for="${field}">${platform === "telegram" ? "کانال تلگرام" : "کانال/چت بله"}</label>
          <input id="${field}" name="${field}" dir="ltr" value="${escapeHtml(client[field] || "")}"
            placeholder="${platform === "telegram" ? "@channel یا https://t.me/channel" : "@channel یا شناسه عددی"}">
        </div>`,
      confirmLabel: "ذخیره",
      onSubmit: async (values) => {
        await api.patch(`/clients/${encodeURIComponent(id)}`, values);
        toast("هدف پلتفرم به‌روزرسانی شد");
        render();
      },
    });
  },

  "client-publications-page": (target) => { clientTab.publicationsPage = Number(target.dataset.page); render(); },
  "client-webhooks-page": (target) => { clientTab.webhooksPage = Number(target.dataset.page); render(); },

  /* publications */
  "publications-page": (target) => { publicationFilters.page = Number(target.dataset.page); render(); },
  "apply-pub-filters": () => {
    publicationFilters.q = $("#pub-search").value.trim();
    publicationFilters.status = $("#pub-status").value;
    publicationFilters.platform = $("#pub-platform").value;
    publicationFilters.event_type = $("#pub-event").value;
    publicationFilters.site_id = $("#pub-site").value.trim();
    publicationFilters.page = 1;
    render();
  },
  "reset-pub-filters": () => {
    Object.assign(publicationFilters, { page: 1, q: "", status: "", platform: "", event_type: "", site_id: "" });
    render();
  },
  "open-publication": (target) => openPublication(target.dataset.id),
  "retry-publication": async (target) => {
    await api.post(`/publications/${target.dataset.id}/retry`, {});
    closeModal();
    toast("انتشار در صف تلاش مجدد قرار گرفت");
    render();
  },
  "run-retries": async () => {
    const { result } = await api.post("/publications/retries/run", {});
    toast(`صف اجرا شد: ${faNumber(result.succeeded)} موفق، ${faNumber(result.failed)} ناموفق`, {
      tone: result.failed ? "error" : "ok",
      detail: `${faNumber(result.processed)} مورد پردازش شد`,
    });
    render();
  },
  "cancel-retry": (target) => {
    confirmDialog({
      title: "لغو تلاش مجدد",
      message: "این مورد از صف خارج می‌شود و دیگر به‌صورت خودکار تلاش نخواهد شد.",
      onConfirm: async () => {
        await api.post(`/publications/retries/${target.dataset.id}/cancel`, {});
        toast("از صف خارج شد");
        render();
      },
    });
  },
  "retries-page": () => render(),

  /* users */
  "users-page": (target) => { userFilters.page = Number(target.dataset.page); render(); },
  "apply-user-filters": () => {
    userFilters.q = $("#user-search").value.trim();
    userFilters.status = $("#user-status").value;
    userFilters.subscription = $("#user-subscription").value;
    userFilters.page = 1;
    render();
  },
  "reset-user-filters": () => {
    Object.assign(userFilters, { page: 1, q: "", status: "", subscription: "" });
    render();
  },
  "open-user": (target) => { location.hash = `#/users/${target.dataset.id}`; },
  "back-users": () => { location.hash = "#/users"; },
  "toggle-user": (target) => {
    const suspend = target.dataset.status !== "suspended";
    confirmDialog({
      title: suspend ? "تعلیق کاربر" : "فعال‌سازی کاربر",
      message: suspend
        ? "دسترسی کاربر به پنل قطع و همه نشست‌های او باطل می‌شود."
        : "کاربر دوباره می‌تواند وارد پنل شود.",
      confirmLabel: suspend ? "تعلیق کن" : "فعال کن",
      tone: suspend ? "danger" : "",
      onConfirm: async () => {
        await api.post(`/users/${target.dataset.id}/status`, { status: suspend ? "suspended" : "active" });
        toast(suspend ? "کاربر تعلیق شد" : "کاربر فعال شد");
        render();
      },
    });
  },
  "revoke-user-sessions": async (target) => {
    const { revoked } = await api.post(`/users/${target.dataset.id}/sessions/revoke`, {});
    toast(`${faNumber(revoked)} نشست باطل شد`);
    render();
  },

  /* billing */
  "subscriptions-page": (target) => { subscriptionFilters.page = Number(target.dataset.page); render(); },
  "apply-sub-filters": () => {
    subscriptionFilters.q = $("#sub-search").value.trim();
    subscriptionFilters.state = $("#sub-state").value;
    subscriptionFilters.page = 1;
    render();
  },
  "extend-subscription": (target) => {
    modal({
      title: "تمدید اشتراک",
      body: `
        <div class="field"><label for="days">تعداد روز</label>
          <input id="days" name="days" type="number" min="1" max="3650" value="30" required></div>
        <div class="field"><label for="reason">دلیل (برای گزارش عملیات)</label>
          <input id="reason" name="reason" maxlength="200" placeholder="مثلاً: جبران قطعی سرویس"></div>`,
      confirmLabel: "تمدید",
      onSubmit: async (values) => {
        await api.post(`/subscriptions/${target.dataset.id}/extend`, { days: Number(values.days), reason: values.reason });
        toast("اشتراک تمدید شد");
        render();
      },
    });
  },
  "expire-subscription": (target) => {
    confirmDialog({
      title: "منقضی کردن اشتراک",
      message: "اشتراک بلافاصله منقضی می‌شود و انتشار برای کلاینت‌های این کاربر متوقف خواهد شد.",
      onConfirm: async () => {
        await api.post(`/subscriptions/${target.dataset.id}/expire`, {});
        toast("اشتراک منقضی شد");
        render();
      },
    });
  },
  "grant-subscription": async () => {
    const { plans } = await api.get("/plans?include_inactive=false");
    modal({
      title: "اعطای اشتراک",
      subtitle: "بدون پرداخت؛ در گزارش عملیات با منبع admin ثبت می‌شود.",
      body: `
        <div class="field"><label for="user_id">شناسه کاربر</label>
          <input id="user_id" name="user_id" type="number" min="1" required></div>
        <div class="field"><label for="plan_id">پلن</label>
          <select id="plan_id" name="plan_id">
            ${plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} (${faNumber(plan.duration_days)} روز)</option>`).join("")}
          </select></div>
        <div class="field"><label for="days">مدت سفارشی (روز)</label>
          <input id="days" name="days" type="number" min="1" max="3650" placeholder="اختیاری"></div>`,
      confirmLabel: "اعطا",
      onSubmit: async (values) => {
        await api.post("/subscriptions/grant", {
          user_id: Number(values.user_id),
          plan_id: values.plan_id,
          ...(values.days ? { days: Number(values.days) } : {}),
        });
        toast("اشتراک اعطا شد");
        render();
      },
    });
  },

  "new-plan": () => {
    modal({
      title: "پلن جدید",
      body: `
        <div class="field"><label for="id">شناسه (a-z0-9_)</label><input id="id" name="id" required dir="ltr" placeholder="biennial"></div>
        <div class="field"><label for="name">نام</label><input id="name" name="name" required placeholder="دو ساله"></div>
        <div class="field"><label for="duration_days">مدت (روز)</label><input id="duration_days" name="duration_days" type="number" min="1" max="3650" required value="30"></div>
        <div class="field"><label for="price_toman">قیمت (تومان)</label><input id="price_toman" name="price_toman" type="number" min="0" required value="0"></div>
        <div class="field"><label for="telegram_stars">تلگرام استارز</label><input id="telegram_stars" name="telegram_stars" type="number" min="0" required value="0"></div>`,
      confirmLabel: "ساخت",
      onSubmit: async (values) => {
        await api.post("/plans", {
          ...values,
          duration_days: Number(values.duration_days),
          price_toman: Number(values.price_toman),
          telegram_stars: Number(values.telegram_stars),
        });
        toast("پلن ساخته شد");
        render();
      },
    });
  },
  "edit-plan": async (target) => {
    const { plans } = await api.get("/plans?include_inactive=true");
    const plan = plans.find((item) => item.id === target.dataset.id);
    modal({
      title: `ویرایش پلن ${plan.id}`,
      subtitle: "تغییرات فقط روی خریدهای بعدی اثر دارد.",
      body: `
        <div class="field"><label for="name">نام</label><input id="name" name="name" value="${escapeHtml(plan.name)}"></div>
        <div class="field"><label for="duration_days">مدت (روز)</label><input id="duration_days" name="duration_days" type="number" min="1" max="3650" value="${plan.duration_days}"></div>
        <div class="field"><label for="price_toman">قیمت (تومان)</label><input id="price_toman" name="price_toman" type="number" min="0" value="${plan.price_toman}"></div>
        <div class="field"><label for="telegram_stars">تلگرام استارز</label><input id="telegram_stars" name="telegram_stars" type="number" min="0" value="${plan.telegram_stars}"></div>
        <div class="field"><label for="active">وضعیت</label>
          <select id="active" name="active">
            <option value="true" ${plan.active ? "selected" : ""}>فعال</option>
            <option value="false" ${plan.active ? "" : "selected"}>غیرفعال</option>
          </select></div>`,
      confirmLabel: "ذخیره",
      onSubmit: async (values) => {
        await api.patch(`/plans/${encodeURIComponent(plan.id)}`, {
          name: values.name,
          duration_days: Number(values.duration_days),
          price_toman: Number(values.price_toman),
          telegram_stars: Number(values.telegram_stars),
          active: values.active === "true",
        });
        toast("پلن به‌روزرسانی شد");
        render();
      },
    });
  },

  "invoices-page": (target) => { invoiceFilters.page = Number(target.dataset.page); render(); },
  "apply-invoice-filters": () => {
    invoiceFilters.q = $("#invoice-search").value.trim();
    invoiceFilters.status = $("#invoice-status").value;
    invoiceFilters.page = 1;
    render();
  },
  "open-invoice": (target) => openInvoice(target.dataset.id),

  /* admins + audit */
  "new-admin": () => {
    modal({
      title: "مدیر جدید",
      subtitle: "برای دسترسی از ربات تلگرام، شناسه تلگرام را وارد کنید.",
      body: `
        <div class="field"><label for="username">نام کاربری</label><input id="username" name="username" required dir="ltr" pattern="[A-Za-z0-9._-]{3,40}"></div>
        <div class="field"><label for="display_name">نام نمایشی</label><input id="display_name" name="display_name"></div>
        <div class="field"><label for="password">گذرواژه (حداقل ۱۰ نویسه)</label><input id="password" name="password" type="password" minlength="10" autocomplete="new-password"></div>
        <div class="field"><label for="telegram_user_id">Telegram ID</label><input id="telegram_user_id" name="telegram_user_id" dir="ltr" inputmode="numeric"></div>
        <div class="field"><label for="role">نقش</label>
          <select id="role" name="role">
            ${Object.entries(ROLE_LABELS).map(([value, title]) => `<option value="${value}" ${value === "viewer" ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
          </select></div>`,
      confirmLabel: "ساخت",
      onSubmit: async (values) => {
        await api.post("/admins", values);
        toast("مدیر ساخته شد");
        render();
      },
    });
  },
  "edit-admin": (target) => {
    const { id, role, status } = target.dataset;
    modal({
      title: "ویرایش مدیر",
      body: `
        <div class="field"><label for="role">نقش</label>
          <select id="role" name="role">
            ${Object.entries(ROLE_LABELS).map(([value, title]) => `<option value="${value}" ${value === role ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
          </select></div>
        <div class="field"><label for="status">وضعیت</label>
          <select id="status" name="status">
            <option value="active" ${status === "active" ? "selected" : ""}>فعال</option>
            <option value="disabled" ${status === "disabled" ? "selected" : ""}>غیرفعال</option>
          </select></div>
        <div class="field"><label for="password">گذرواژه جدید</label>
          <input id="password" name="password" type="password" minlength="10" autocomplete="new-password" placeholder="خالی = بدون تغییر"></div>`,
      confirmLabel: "ذخیره",
      onSubmit: async (values) => {
        const patch = { role: values.role, status: values.status };
        if (values.password) patch.password = values.password;
        await api.patch(`/admins/${id}`, patch);
        toast("مدیر به‌روزرسانی شد");
        render();
      },
    });
  },
  "revoke-admin-sessions": async (target) => {
    const { revoked } = await api.post(`/admins/${target.dataset.id}/sessions/revoke`, {});
    toast(`${faNumber(revoked)} نشست باطل شد`);
  },

  "audit-page": (target) => { auditFilters.page = Number(target.dataset.page); render(); },
  "apply-audit-filters": () => {
    auditFilters.q = $("#audit-search").value.trim();
    auditFilters.channel = $("#audit-channel").value;
    auditFilters.page = 1;
    render();
  },

  /* ai */
  "ai-page": (target) => { aiFilters.page = Number(target.dataset.page); render(); },
  "apply-ai-filters": () => {
    aiFilters.status = $("#ai-status").value;
    aiFilters.type = $("#ai-type").value;
    aiFilters.page = 1;
    render();
  },
  "ai-run": async () => {
    const { result } = await api.post("/ai/jobs/run", {});
    toast(`صف اجرا شد: ${faNumber(result.succeeded)} موفق، ${faNumber(result.failed)} ناموفق`, {
      tone: result.failed ? "error" : "ok",
      detail: `${faNumber(result.processed)} مورد پردازش شد`,
    });
    render();
  },
  "ai-retry": async (target) => {
    await api.post(`/ai/jobs/${encodeURIComponent(target.dataset.id)}/retry`, {});
    toast("کار برای اجرای مجدد در صف قرار گرفت");
    render();
  },
  "ai-cancel": (target) => {
    confirmDialog({
      title: "لغو کار",
      message: "این کار از صف خارج می‌شود و دیگر اجرا نخواهد شد.",
      onConfirm: async () => {
        await api.post(`/ai/jobs/${encodeURIComponent(target.dataset.id)}/cancel`, {});
        toast("کار لغو شد");
        render();
      },
    });
  },

  /* settings */
  "change-password": () => {
    modal({
      title: "تغییر گذرواژه",
      subtitle: "پس از تغییر، همه نشست‌های شما باطل و باید دوباره وارد شوید.",
      body: `
        <div class="field"><label for="current_password">گذرواژه فعلی</label>
          <input id="current_password" name="current_password" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="new_password">گذرواژه جدید (حداقل ۱۰ نویسه)</label>
          <input id="new_password" name="new_password" type="password" minlength="10" required autocomplete="new-password"></div>`,
      confirmLabel: "تغییر",
      onSubmit: async (values) => {
        await api.post("/auth/password", values);
        session.admin = null;
        renderLogin("گذرواژه تغییر کرد؛ دوباره وارد شوید.");
      },
    });
  },
  "revoke-my-sessions": () => {
    confirmDialog({
      title: "ابطال همه نشست‌ها",
      message: "همه نشست‌های شما، از جمله همین مرورگر، باطل می‌شود.",
      onConfirm: async () => {
        await api.post("/auth/sessions/revoke-all", {});
        session.admin = null;
        renderLogin("همه نشست‌ها باطل شد.");
      },
    });
  },
};

/* ------------------------------------------------------------------ *
 * Router and bootstrap
 * ------------------------------------------------------------------ */

const ROUTES = {
  dashboard: { title: "داشبورد", view: viewDashboard, permission: "dashboard.view" },
  clients: { title: "کلاینت‌ها", view: viewClients, detail: viewClient, permission: "clients.view" },
  publications: { title: "تاریخچه انتشار", view: viewPublications, permission: "publications.view" },
  retries: { title: "صف تلاش مجدد", view: viewRetries, permission: "publications.view" },
  users: { title: "کاربران", view: viewUsers, detail: viewUser, permission: "users.view" },
  subscriptions: { title: "اشتراک‌ها", view: viewSubscriptions, permission: "subscriptions.view" },
  plans: { title: "پلن‌ها", view: viewPlans, permission: "plans.view" },
  invoices: { title: "پرداخت‌ها", view: viewInvoices, permission: "invoices.view" },
  platforms: { title: "پلتفرم‌ها", view: viewPlatforms, permission: "platforms.view" },
  ai: { title: "هوش مصنوعی محصولات", view: viewAi, permission: "ai.view" },
  admins: { title: "مدیران", view: viewAdmins, permission: "admins.view" },
  audit: { title: "گزارش عملیات", view: viewAudit, permission: "audit.view" },
  settings: { title: "تنظیمات", view: viewSettings, permission: "settings.view" },
};

const setView = (html) => { const node = $("#view"); if (node) node.innerHTML = html; };

async function render() {
  const { name, params } = currentRoute();
  const route = ROUTES[name] || ROUTES.dashboard;

  if (!can(route.permission)) {
    root().innerHTML = layout(errorState("سطح دسترسی شما به این بخش اجازه نمی‌دهد."), { title: route.title });
    return;
  }

  root().innerHTML = layout(loadingState(), { title: route.title });
  try {
    if (params[0] && route.detail) await route.detail(decodeURIComponent(params[0]));
    else await route.view();
  } catch (error) {
    if (error.code === "unauthenticated") return;
    setView(errorState(error.message, "refresh-dashboard"));
  }
}

function renderLogin(notice = "") {
  root().innerHTML = `
    <div class="login-shell">
      <form class="login-card" id="login-form">
        <div class="brand">
          <div class="brand-mark">ج</div>
          <div class="brand-text"><strong>JARCHI</strong><span>پنل مدیریت</span></div>
        </div>
        ${notice ? `<div class="login-error">${escapeHtml(notice)}</div>` : ""}
        <div id="login-error"></div>
        <div class="field">
          <label for="username">نام کاربری</label>
          <input id="username" name="username" required autocomplete="username" dir="ltr">
        </div>
        <div class="field">
          <label for="password">گذرواژه</label>
          <input id="password" name="password" type="password" required autocomplete="current-password" dir="ltr">
        </div>
        <button class="btn" type="submit" style="width:100%;justify-content:center">ورود</button>
        <p class="muted small" style="margin-top:14px;text-align:center">
          نشست شما کوتاه‌مدت است و پس از بی‌کاری منقضی می‌شود.
        </p>
      </form>
    </div>`;

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-form button");
    button.disabled = true;
    const values = Object.fromEntries(new FormData(event.target).entries());
    try {
      const result = await request("POST", "/auth/login", values);
      session.admin = result.admin;
      session.csrf = result.csrf_token;
      session.server = result.server || session.server;
      await bootstrap();
    } catch (error) {
      $("#login-error").innerHTML = `<div class="login-error">${escapeHtml(error.message)}</div>`;
      button.disabled = false;
    }
  });
  $("#username")?.focus();
}

async function bootstrap() {
  try {
    const me = await request("GET", "/auth/me");
    session.admin = me.admin;
    session.server = me.server;
    // A cookie session that survived a page reload has no CSRF token in memory;
    // /auth/me mints a fresh one for it.
    if (me.csrf_token) session.csrf = me.csrf_token;
    await render();
  } catch (error) {
    if (error.status === 401) renderLogin();
    else root().innerHTML = `<div class="login-shell"><div class="card">${errorState(error.message)}</div></div>`;
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action],[data-nav]");
  if (!target) return;

  if (target.dataset.nav) {
    location.hash = `#/${target.dataset.nav}`;
    $("#sidebar")?.classList.remove("open");
    return;
  }

  const action = ACTIONS[target.dataset.action];
  if (!action) return;
  event.preventDefault();
  Promise.resolve(action(target)).catch((error) => {
    if (error.code !== "unauthenticated") toast(error.message || "عملیات انجام نشد", { tone: "error" });
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

document.addEventListener("submit", (event) => {
  // Filter inputs submit on Enter without a surrounding form.
  if (event.target.id === "login-form" || event.target.id === "modal-form") return;
  event.preventDefault();
});

window.addEventListener("hashchange", () => {
  if (session.admin) render();
});

theme.apply(theme.get());
bootstrap();
