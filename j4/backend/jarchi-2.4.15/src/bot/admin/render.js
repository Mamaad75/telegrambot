import { config } from "../../config.js";
import { faNumber, faDate, faDateTime, escapeHtml, statusIcon, platformLabel, roleLabel, clamp } from "../format.js";

/**
 * Message bodies for the admin bot.
 *
 * These read from the shared services (the same ones the web panel uses) and
 * only handle presentation — no SQL, no policy decisions.
 */

export function renderDashboard(summary) {
  const platform = (name) => {
    const row = summary.platforms?.[name];
    return row ? `${faNumber(row.published)} موفق / ${faNumber(row.failed)} ناموفق` : "—";
  };

  return clamp([
    "📊 <b>داشبورد جارچی</b>",
    "",
    `🌐 کل کلاینت‌ها: <b>${faNumber(summary.clients.total)}</b> (فعال: ${faNumber(summary.clients.active)} | غیرفعال: ${faNumber(summary.clients.disabled)})`,
    `👥 کل کاربران: <b>${faNumber(summary.users.total)}</b>`,
    `💳 اشتراک فعال: <b>${faNumber(summary.subscriptions.active)}</b> (رو به انقضا: ${faNumber(summary.subscriptions.expiring_7_days)})`,
    "",
    `✅ انتقال موفق: <b>${faNumber(summary.publications.published)}</b>`,
    `❌ انتقال ناموفق: <b>${faNumber(summary.publications.failed)}</b>`,
    `📅 امروز: <b>${faNumber(summary.publications.today)}</b> | ۷ روز اخیر: <b>${faNumber(summary.publications.last_7_days)}</b>`,
    "",
    "<b>به تفکیک پلتفرم</b>",
    `• تلگرام: ${platform("telegram")}`,
    `• بله: ${platform("bale")}`,
    `• واتس‌اپ: ${platform("whatsapp")}`,
    "",
    `🔁 صف تلاش مجدد: در انتظار ${faNumber(summary.retries?.pending || 0)} | ناموفق ${faNumber(summary.retries?.failed || 0)}`,
    "",
    `<i>${faDateTime(summary.generated_at)} — منطقه زمانی ${escapeHtml(config.timezone)}</i>`,
  ].join("\n"));
}

export function renderClientList(result, { title = "🌐 کلاینت‌ها" } = {}) {
  if (!result.items.length) return `${title}\n\nموردی یافت نشد.`;
  const lines = result.items.map((client) => [
    `${client.enabled ? "✅" : "⛔"} <b>${escapeHtml(client.name || client.id)}</b>`,
    `<code>${escapeHtml(client.id)}</code>`,
    `${escapeHtml(client.wordpress_url || "—")}`,
    `انتشار: ${faNumber(client.publication_success_count)} موفق / ${faNumber(client.publication_failure_count)} ناموفق`,
  ].join("\n"));

  return clamp([
    `${title} (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderClientDetail(client) {
  const subscription = client.subscription
    ? `${escapeHtml(client.subscription.plan_name)} — ${statusIcon(client.subscription.status)} تا ${faDate(client.subscription.expires_at)}`
    : "بدون اشتراک";

  const statusText = {
    healthy: "✅ سالم",
    failing: "❌ آخرین انتشار ناموفق",
    never_connected: "⚠️ هنوز وبهوکی دریافت نشده",
    disabled: "⛔ غیرفعال",
  }[client.connection_status] || client.connection_status;

  return clamp([
    `🌐 <b>${escapeHtml(client.name || client.id)}</b>`,
    "",
    `Site ID: <code>${escapeHtml(client.id)}</code>`,
    `سایت: ${escapeHtml(client.wordpress_url || "—")}`,
    `مالک: ${escapeHtml(client.owner_name || "—")}${client.owner_telegram_id ? ` (<code>${escapeHtml(client.owner_telegram_id)}</code>)` : ""}`,
    `اشتراک: ${subscription}`,
    "",
    `📡 تلگرام: ${client.telegram_channel_id ? `<code>${escapeHtml(client.telegram_channel_id)}</code>` : "—"}`,
    `📡 بله: ${client.bale_chat_id ? `<code>${escapeHtml(client.bale_chat_id)}</code>` : "—"}`,
    "",
    `آخرین وبهوک: ${faDateTime(client.last_webhook_at)}`,
    `آخرین انتشار: ${faDateTime(client.last_publication_at)}`,
    `آخرین خطا: ${client.last_failure_at ? `${faDateTime(client.last_failure_at)} — ${escapeHtml(String(client.last_failure_message || "").slice(0, 120))}` : "—"}`,
    "",
    `انتشار: ✅ ${faNumber(client.publication_stats?.published)} | ❌ ${faNumber(client.publication_stats?.failed)} | ۷ روز اخیر: ${faNumber(client.publication_stats?.last_7_days)}`,
    `🧩 فیلدها: ${faNumber(client.field_count)}`,
    `وضعیت: ${statusText}`,
  ].join("\n"));
}

export function renderWebhookDiagnostics(client, events) {
  const lines = events.length
    ? events.slice(0, 5).map((event) => [
      `${Number(event.http_status) < 400 ? "✅" : "❌"} ${escapeHtml(event.event_type || "—")} · پست ${escapeHtml(event.post_id || "—")}`,
      `کد: ${faNumber(event.http_status)} · احراز: ${escapeHtml(event.auth_result || "—")} · ${faNumber(event.duration_ms)}ms`,
      `${faDateTime(event.created_at)}${event.error ? `\n⚠️ ${escapeHtml(String(event.error).slice(0, 120))}` : ""}`,
    ].join("\n")).join("\n\n")
    : "هنوز رویدادی ثبت نشده است.";

  return clamp([
    `🔗 <b>وبهوک — ${escapeHtml(client.name || client.id)}</b>`,
    "",
    `آدرس: <code>${escapeHtml(client.webhook_url)}</code>`,
    `Site ID: <code>${escapeHtml(client.id)}</code>`,
    `رمز وبهوک: <code>${escapeHtml(client.webhook_secret_masked)}</code>`,
    `تعداد رویداد: ${faNumber(client.webhook_event_count)} (ناموفق: ${faNumber(client.webhook_failure_count)})`,
    "",
    "<b>آخرین رویدادها</b>",
    lines,
  ].join("\n"));
}

export function renderFields(client, fields) {
  if (!fields.length) {
    return `🧩 <b>فیلدهای انتشار — ${escapeHtml(client.name || client.id)}</b>\n\nهنوز فیلدی از وردپرس دریافت نشده است.`;
  }

  const lines = fields.slice(0, 30).map((field) => {
    const platforms = field.platforms
      ? Object.entries(field.platforms).filter(([, value]) => value === true).map(([key]) => platformLabel(key)).join("، ") || "هیچ‌کدام"
      : `(visibility: ${escapeHtml(field.visibility || "—")})`;
    return [
      `${faNumber(field.field_order)}. <b>${escapeHtml(field.label || field.field_key)}</b> — <code>${escapeHtml(field.field_key)}</code>`,
      `نوع: ${escapeHtml(field.field_type || "—")} · نمایش: ${platforms}`,
      `اولین: ${faDate(field.first_seen_at)} · آخرین: ${faDate(field.last_seen_at)}`,
    ].join("\n");
  });

  return clamp([
    `🧩 <b>فیلدهای انتشار — ${escapeHtml(client.name || client.id)}</b>`,
    "<i>برچسب و ترتیب از وردپرس می‌آید؛ بک‌اند فقط آن را نگهداری می‌کند.</i>",
    "",
    lines.join("\n\n"),
    fields.length > 30 ? `\n… و ${faNumber(fields.length - 30)} فیلد دیگر` : "",
  ].join("\n"));
}

export function renderPublicationList(result, { title = "📢 انتشارها" } = {}) {
  if (!result.items.length) return `${title}\n\nموردی یافت نشد.`;
  const lines = result.items.map((publication) => [
    `${statusIcon(publication.status)} <b>${platformLabel(publication.platform)}</b> · ${escapeHtml(publication.event_type)}`,
    `${escapeHtml(publication.site_name || publication.site_id)} · پست <code>${escapeHtml(publication.post_id)}</code>`,
    `${faDateTime(publication.created_at)}${publication.error_message ? `\n⚠️ ${escapeHtml(String(publication.error_message).slice(0, 100))}` : ""}`,
    `شناسه: <code>${faNumber(publication.id)}</code>`,
  ].join("\n"));

  return clamp([
    `${title} (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderPublicationDetail(publication) {
  return clamp([
    `${statusIcon(publication.status)} <b>انتشار #${faNumber(publication.id)}</b>`,
    "",
    `کلاینت: ${escapeHtml(publication.site_name || publication.site_id)}`,
    `پست: <code>${escapeHtml(publication.post_id)}</code>`,
    `پلتفرم: ${platformLabel(publication.platform)}`,
    `رویداد: ${escapeHtml(publication.event_type)}`,
    `وضعیت: ${escapeHtml(publication.status)}`,
    `زمان: ${faDateTime(publication.created_at)}`,
    publication.duration_ms ? `مدت: ${faNumber(publication.duration_ms)}ms` : "",
    `تلاش: ${faNumber(publication.attempt_count || 1)}`,
    publication.error_message ? `\n⚠️ خطا (${escapeHtml(publication.error_code || "unknown")}):\n<code>${escapeHtml(String(publication.error_message).slice(0, 300))}</code>` : "",
    publication.retry
      ? `\n🔁 صف تلاش مجدد: ${escapeHtml(publication.retry.status)} — تلاش ${faNumber(publication.retry.attempts)}/${faNumber(publication.retry.max_attempts)} — بعدی ${faDateTime(publication.retry.next_attempt_at)}`
      : "",
    publication.retry_eligible ? "\n♻️ قابل تلاش مجدد" : "",
  ].filter(Boolean).join("\n"));
}

export function renderUserList(result) {
  if (!result.items.length) return "👥 کاربران\n\nموردی یافت نشد.";
  const lines = result.items.map((user) => [
    `${statusIcon(user.status)} <b>${escapeHtml(user.display_name || "بدون نام")}</b>${user.username ? ` @${escapeHtml(user.username)}` : ""}`,
    `شناسه: <code>${faNumber(user.id)}</code>${user.telegram_id ? ` · تلگرام: <code>${escapeHtml(user.telegram_id)}</code>` : ""}`,
    `اشتراک: ${user.subscription_plan ? `${escapeHtml(user.subscription_plan)} تا ${faDate(user.subscription_expires_at)}` : "—"} · سایت‌ها: ${faNumber(user.site_count)}`,
  ].join("\n"));

  return clamp([
    `👥 کاربران (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderUserDetail(user) {
  const subscription = user.subscriptions?.[0];
  return clamp([
    `👤 <b>${escapeHtml(user.display_name || "بدون نام")}</b>${user.username ? ` @${escapeHtml(user.username)}` : ""}`,
    "",
    `شناسه: <code>${faNumber(user.id)}</code>`,
    `وضعیت: ${statusIcon(user.status)} ${escapeHtml(user.status)}`,
    `عضویت: ${faDate(user.created_at)}`,
    `آخرین فعالیت: ${faDateTime(user.last_seen_at)}`,
    // Phone numbers are shown masked in the bot regardless of role: a Telegram
    // chat is not a controlled surface.
    `شماره: ${user.has_phone ? escapeHtml(user.phone_masked) : "—"}`,
    "",
    `اشتراک: ${subscription ? `${escapeHtml(subscription.plan_name)} — ${statusIcon(subscription.status)} تا ${faDate(subscription.expires_at)}` : "—"}`,
    `سایت‌ها: ${user.sites?.length ? user.sites.map((site) => escapeHtml(site.name || site.id)).join("، ") : "—"}`,
    `نشست فعال: ${faNumber((user.sessions || []).filter((session) => session.active).length)}`,
    `فاکتورها: ${faNumber((user.invoices || []).length)}`,
  ].join("\n"));
}

export function renderSubscriptionList(result, title = "💳 اشتراک‌ها") {
  if (!result.items.length) return `${title}\n\nموردی یافت نشد.`;
  const lines = result.items.map((subscription) => [
    `${statusIcon(subscription.status)} <b>${escapeHtml(subscription.display_name || "—")}</b> · ${escapeHtml(subscription.plan_name)}`,
    `تا ${faDate(subscription.expires_at)} (${faNumber(subscription.days_remaining)} روز) · منبع: ${escapeHtml(subscription.source)}`,
    `شناسه: <code>${faNumber(subscription.id)}</code>`,
  ].join("\n"));

  return clamp([
    `${title} (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderInvoiceList(result) {
  if (!result.items.length) return "🧾 پرداخت‌ها\n\nموردی یافت نشد.";
  const lines = result.items.map((invoice) => [
    `${statusIcon(invoice.status === "paid" ? "published" : invoice.status)} <code>${escapeHtml(invoice.public_id)}</code>`,
    `${escapeHtml(invoice.display_name || "—")} · ${escapeHtml(invoice.plan_name)}`,
    `${faNumber(invoice.amount_toman)} تومان · ${escapeHtml(invoice.payment_method)} · ${escapeHtml(invoice.status)}`,
    faDateTime(invoice.created_at),
  ].join("\n"));

  return clamp([
    `🧾 پرداخت‌ها (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderAuditList(result) {
  if (!result.items.length) return "📋 گزارش‌ها\n\nموردی ثبت نشده است.";
  const lines = result.items.map((entry) => [
    `${entry.success ? "✅" : "⛔"} <b>${escapeHtml(entry.action)}</b>`,
    `${escapeHtml(entry.actor_label)} (${roleLabel(entry.actor_role)}) · ${escapeHtml(entry.channel)}`,
    `${entry.target_type ? `${escapeHtml(entry.target_type)}: <code>${escapeHtml(entry.target_id)}</code> · ` : ""}${faDateTime(entry.created_at)}`,
  ].join("\n"));

  return clamp([
    `📋 گزارش عملیات مدیران (${faNumber(result.pagination.total)})`,
    `صفحه ${faNumber(result.pagination.page)} از ${faNumber(result.pagination.pages)}`,
    "",
    lines.join("\n\n"),
  ].join("\n"));
}

export function renderPlatformHealth(status) {
  const line = (name, data) => [
    `<b>${name}</b>: ${data.configured ? "✅ پیکربندی شده" : "⛔ پیکربندی نشده"}`,
    data.reachable === undefined ? "" : data.reachable ? `   ↳ در دسترس${data.bot_username ? ` (@${escapeHtml(data.bot_username)})` : ""}` : `   ↳ خطا: ${escapeHtml(String(data.error || "").slice(0, 120))}`,
  ].filter(Boolean).join("\n");

  return clamp([
    "📡 <b>وضعیت پلتفرم‌ها</b>",
    "",
    line("تلگرام", status.telegram),
    line("بله", status.bale),
    line("واتس‌اپ", status.whatsapp),
    "",
    "<i>مقادیر توکن هرگز نمایش داده نمی‌شوند.</i>",
  ].join("\n"));
}

export function renderSettings(actor) {
  return clamp([
    "⚙️ <b>تنظیمات بک‌اند</b>",
    "",
    `نسخه: <b>${escapeHtml(config.version)}</b>`,
    `قرارداد وردپرس: <b>${escapeHtml(config.contractVersion)}</b>`,
    `محیط: ${escapeHtml(config.env)}`,
    `منطقه زمانی: ${escapeHtml(config.timezone)}`,
    `آدرس وبهوک: <code>${escapeHtml(config.publicBaseUrl)}/webhook</code>`,
    "",
    `تلاش مجدد: ${config.retry.enabled ? "فعال" : "غیرفعال"} (حداکثر ${faNumber(config.retry.maxAttempts)} بار)`,
    `واتس‌اپ: ${config.whatsapp.enabled ? "فعال" : "غیرفعال"} · زرین‌پال: ${config.zarinpal.enabled ? "فعال" : "غیرفعال"}`,
    "",
    `شما: <b>${escapeHtml(actor.display_name || actor.username)}</b> — ${roleLabel(actor.role)}`,
  ].join("\n"));
}
