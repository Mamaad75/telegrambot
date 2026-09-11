import { config } from "../config.js";

/**
 * Resolves which platforms an ad should go to.
 *
 * Precedence, unchanged from 1.2.0 and relied on by older WordPress installs:
 *   1. per-post `publication_targets` from the plugin (contract >= 1.2)
 *   2. site defaults stored on the client record
 *   3. legacy fallback: no `publication_targets` at all means "publish wherever
 *      this client has a target configured"
 *
 * A platform is only ever enabled when the client actually has a target for it,
 * so a per-post request can narrow the site defaults but never invent a channel.
 */
function normalizeTelegramTargetValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("@")) return raw;
  const match = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]+)\/?$/i);
  return match ? `@${match[1]}` : raw;
}

export function resolvePublicationTargets(ad, site) {
  const requested = ad?.publication_targets && typeof ad.publication_targets === "object"
    ? ad.publication_targets
    : null;
  const legacyMode = !requested;
  const whatsappEnabled = config.whatsapp.enabled;

  const telegramRequested = legacyMode
    ? Boolean(site?.telegram_channel_id)
    : requested?.telegram?.enabled === true;
  const baleRequested = legacyMode
    ? Boolean(site?.bale_chat_id)
    : requested?.bale?.enabled === true;
  const whatsappRequested = legacyMode
    ? Boolean(whatsappEnabled && (ad?.author?.phone || ad?.fields?.phone))
    : requested?.whatsapp?.enabled === true;

  return [
    {
      platform: "telegram",
      enabled: telegramRequested && Boolean(site?.telegram_channel_id),
      target: normalizeTelegramTargetValue(site?.telegram_channel_id),
    },
    {
      platform: "bale",
      enabled: baleRequested && Boolean(site?.bale_chat_id),
      target: String(site?.bale_chat_id || "").trim(),
    },
    {
      platform: "whatsapp",
      enabled: whatsappRequested && whatsappEnabled,
      // Recipient is resolved from the server-side client connection, never from WordPress payload.
      target: "",
    },
  ];
}

export function normalizeTelegramTarget(value) {
  return normalizeTelegramTargetValue(value);
}
