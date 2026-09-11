import { query } from "../db/db.js";
import { upsertIdentity, createSession } from "../services/users.js";
import { ensureTrial, getPlans } from "../services/billing.js";
import { readContactPhone } from "../core/publication.js";
import { logger } from "../logger.js";
import { faNumber } from "./format.js";
import { config } from "../config.js";
import { completeLinkFromBot } from "../services/unifiedIdentity.js";

/**
 * Customer-facing bot: onboarding, Mini App entry, plans and Telegram Stars.
 * Unchanged in behaviour from 1.2.0 apart from the contact-button lookup, which
 * now reads the encrypted phone column instead of publication metadata.
 */

const panelUrl = (base, token) => `${base}/app/?platform=telegram#session=${encodeURIComponent(token)}`;

export async function handleStart(bot, msg, publicBaseUrl) {
  const startPayload = String(msg.text || "").trim().split(/\s+/, 2)[1] || "";
  if (startPayload.startsWith("link_")) {
    try {
      const linked = await completeLinkFromBot("telegram", msg.from.id, {
        display_name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
        username: msg.from.username || "",
      }, startPayload);
      const token = await createSession(linked.userId, "telegram", 24);
      await bot.sendMessage(msg.chat.id, "✅ حساب تلگرام شما با حساب جارچی متصل شد. حالا همان اشتراک، سایت‌ها، تیکت‌ها و دسترسی‌ها را در این پلتفرم هم دارید.", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 باز کردن پنل جارچی", web_app: { url: panelUrl(publicBaseUrl, token) } }]] },
      });
      return;
    } catch (error) {
      logger.error("telegram identity link failed", { error, telegram_user_id: msg.from?.id });
      await bot.sendMessage(msg.chat.id, `❌ ${String(error.message || "اتصال حساب انجام نشد")}`);
      return;
    }
  }

  const user = await upsertIdentity("telegram", msg.from.id, {
    display_name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
    username: msg.from.username || "",
  });

  // Claim any client provisioned for this Telegram id before the owner started the bot.
  await query(
    "UPDATE sites SET owner_user_id=$1 WHERE owner_telegram_id=$2 AND owner_user_id IS NULL",
    [user.id, String(msg.from.id)],
  );

  const existed = await query("SELECT 1 FROM subscriptions WHERE user_id=$1 LIMIT 1", [user.id]);
  let text = `👋 سلام ${msg.from.first_name || ""}!\n\nبه <b>جارچی</b> خوش آمدی.`;
  if (!existed.rowCount && config.autoTrialOnStart) {
    await ensureTrial(user.id);
    text += "\n🎁 اشتراک آزمایشی ۷ روزه برایت فعال شد.";
  }

  const token = await createSession(user.id, "telegram", 24);
  await bot.sendMessage(msg.chat.id, text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 پنل کاربری", web_app: { url: panelUrl(publicBaseUrl, token) } }],
      ],
    },
  });
}

export async function handlePanel(bot, msg, publicBaseUrl) {
  const user = await upsertIdentity("telegram", msg.from.id, {
    display_name: msg.from.first_name || "",
    username: msg.from.username || "",
  });
  const token = await createSession(user.id, "telegram", 24);
  await bot.sendMessage(msg.chat.id, "👤 پنل کاربری جارچی", {
    reply_markup: { inline_keyboard: [[{ text: "🚀 باز کردن پنل", web_app: { url: panelUrl(publicBaseUrl, token) } }]] },
  });
}

function decodeContactCallback(data) {
  const encoded = String(data).slice("contact:".length);
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return { siteId: String(parsed.s || ""), postId: String(parsed.p || "") };
}

/**
 * Contact button on a published ad. The number is decrypted only here, only for
 * the specific publication the button belongs to, and is never logged.
 */
export async function handleContactCallback(bot, callbackQuery) {
  const { siteId, postId } = decodeContactCallback(callbackQuery.data);
  const publication = (await query(
    `SELECT id,contact_phone_enc FROM publications
      WHERE site_id=$1 AND post_id=$2 AND status='published'
      ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1`,
    [siteId, postId],
  )).rows[0];

  const phone = publication ? readContactPhone(publication) : "";
  if (!phone) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "شماره تماس در دسترس نیست.", show_alert: true });
    return;
  }

  await bot.answerCallbackQuery(callbackQuery.id);
  await bot.sendMessage(callbackQuery.message.chat.id, `📞 شماره تماس آگهی‌دهنده:\n${phone}`);
}

export async function handlePlansCallback(bot, callbackQuery) {
  const plans = (await getPlans()).filter((plan) => !plan.is_trial);
  const keyboard = plans.map((plan) => [{
    text: `${plan.name} — ${plan.telegram_stars} ⭐`,
    callback_data: `buy:${plan.id}`,
  }]);

  await bot.sendMessage(callbackQuery.message.chat.id, [
    "💳 پلن‌های جارچی:",
    "",
    ...plans.map((plan) => `• ${plan.name} — ${faNumber(plan.price_toman)} تومان — ${plan.telegram_stars} ⭐`),
  ].join("\n"), { reply_markup: { inline_keyboard: keyboard } });
}

export async function handleBuyCallback(bot, callbackQuery, planId) {
  const plan = (await getPlans()).find((item) => item.id === planId);
  if (!plan || plan.is_trial) throw new Error("Invalid paid plan");

  const stars = Number(plan.telegram_stars || 0);
  if (!stars) throw new Error("Telegram Stars is not configured for this plan");

  await bot.sendInvoice(
    callbackQuery.message.chat.id,
    `اشتراک جارچی - ${plan.name}`,
    `فعال‌سازی ${plan.name} به مدت ${plan.duration_days} روز`,
    JSON.stringify({ type: "jarchi_subscription", plan_id: plan.id }),
    "",
    "XTR",
    [{ label: plan.name, amount: stars }],
    { need_name: false, need_phone_number: false, need_email: false, need_shipping_address: false },
  );
}

export async function handlePreCheckout(bot, preCheckoutQuery) {
  try {
    const payload = JSON.parse(preCheckoutQuery.invoice_payload || "{}");
    const exists = (await query("SELECT 1 FROM plans WHERE id=$1 AND active=true", [payload.plan_id])).rowCount;
    if (payload.type !== "jarchi_subscription" || !exists) throw new Error("Invalid subscription");
    await bot.answerPreCheckoutQuery(preCheckoutQuery.id, true);
  } catch (error) {
    await bot.answerPreCheckoutQuery(preCheckoutQuery.id, false, { error_message: error.message.slice(0, 180) });
  }
}

/** Telegram Stars payment; the charge id makes activation idempotent. */
export async function handleSuccessfulPayment(bot, msg) {
  try {
    const payment = msg.successful_payment;
    const payload = JSON.parse(payment.invoice_payload || "{}");
    const user = await upsertIdentity("telegram", msg.from.id, {
      display_name: msg.from.first_name || "",
      username: msg.from.username || "",
    });
    const plan = (await query("SELECT * FROM plans WHERE id=$1", [payload.plan_id])).rows[0];
    if (payload.type !== "jarchi_subscription" || !plan) throw new Error("Invalid payment");

    const duplicate = await query(
      "SELECT 1 FROM telegram_star_payments WHERE telegram_charge_id=$1",
      [payment.telegram_payment_charge_id],
    );
    if (duplicate.rowCount) return;

    const active = await query(
      `SELECT expires_at FROM subscriptions
        WHERE user_id=$1 AND status='active' AND expires_at>NOW() ORDER BY expires_at DESC LIMIT 1`,
      [user.id],
    );
    const start = active.rowCount ? new Date(active.rows[0].expires_at) : new Date();
    const end = new Date(start.getTime() + Number(plan.duration_days) * 86400000);

    await query(
      `INSERT INTO telegram_star_payments(user_id,plan_id,telegram_charge_id,provider_charge_id,total_amount_stars)
       VALUES($1,$2,$3,$4,$5)`,
      [user.id, plan.id, payment.telegram_payment_charge_id, payment.provider_payment_charge_id, payment.total_amount],
    );
    await query(
      `INSERT INTO subscriptions(user_id,plan_id,starts_at,expires_at,status,source)
       VALUES($1,$2,$3,$4,'active','telegram_stars')`,
      [user.id, plan.id, start, end],
    );

    logger.info("telegram stars payment activated", {
      user_id: user.id, plan_id: plan.id, stars: payment.total_amount,
    });
    await bot.sendMessage(msg.chat.id, "✅ پرداخت موفق بود؛ اشتراک جارچی فعال شد.");
  } catch (error) {
    logger.error("telegram stars payment failed", { error, telegram_user_id: msg.from?.id });
  }
}
