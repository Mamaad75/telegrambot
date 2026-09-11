import { query } from "../db/db.js";
import { config } from "../config.js";
import { getPreference } from "../services/preferences.js";
import { getConnection } from "../services/platformConnections.js";
import { publishBale } from "../platforms/bale.js";
import { publishTelegramText, updateTelegramPublication } from "../platforms/telegram.js";
import { sendWhatsAppText } from "../platforms/whatsapp.js";
import { formatTelegram } from "../formatters/telegram.js";
import { formatBale } from "../formatters/bale.js";
import { formatPlain } from "../formatters/text.js";
import { resolvePublicationTargets } from "./publicationPolicy.js";
import { resolveContactPhone, applyFieldOverrides } from "./fieldPolicy.js";
import { resolveContactButton } from "./contactButton.js";
import { getFieldOverrides } from "../services/fields.js";
import { deletePublication } from "./deletionService.js";
import { applyPublicationOutcome, getSite } from "../services/clients.js";
import { maybeEnqueueAutomatic } from "../services/retry.js";
import { encryptText, decryptText } from "../utils/security.js";
import { PlatformError, ERROR_CATEGORIES } from "../platforms/errors.js";
import { logger } from "../logger.js";

/** Telegram photo captions cap at 1024 characters; plain messages at 4096. */
const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

const PUBLISHABLE_EVENTS = new Set(["created", "published", "updated"]);
const DELETION_EVENTS = new Set(["deleted", "deleted_from_trash"]);

async function ownerId(siteId) {
  return (await query("SELECT owner_user_id FROM sites WHERE id=$1", [siteId])).rows[0]?.owner_user_id || null;
}

/**
 * Publishing is gated on the client's subscription. A client without an owner
 * (env-provisioned, no billing relationship) is allowed, matching 1.2.0.
 */
async function allowed(ownerUserId) {
  if (!ownerUserId) return true;
  const result = await query(
    `SELECT 1 FROM subscriptions
      WHERE user_id=$1 AND status='active' AND starts_at<=NOW() AND expires_at>NOW()
      ORDER BY expires_at DESC LIMIT 1`,
    [ownerUserId],
  );
  return result.rowCount > 0;
}

function callbackToken(siteId, postId) {
  return Buffer.from(JSON.stringify({ s: siteId, p: postId })).toString("base64url");
}

function selectedKeysForPreference(preference) {
  return Array.isArray(preference?.field_keys) && preference.field_keys.length ? preference.field_keys : null;
}

const isUpdate = (eventType) => eventType === "updated";

async function latestPublication(siteId, postId, platform) {
  return (await query(
    `SELECT * FROM publications
      WHERE site_id=$1 AND post_id=$2 AND platform=$3 AND status='published'
      ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1`,
    [siteId, postId, platform],
  )).rows[0] || null;
}

/**
 * Reads back the advertiser phone stored with a publication.
 * Encrypted since 1.3.0; older rows kept it in metadata, which the 0006
 * migration cleared, so only the encrypted column is consulted.
 */
export function readContactPhone(publication) {
  const encrypted = publication?.contact_phone_enc;
  if (!encrypted || !config.credentialKey) return "";
  try {
    return decryptText(encrypted, config.credentialKey);
  } catch (error) {
    logger.warn("contact phone could not be decrypted", { publication_id: publication?.id, error: error.message });
    return "";
  }
}

async function savePublication({ ad, platform, status, sent, errorMessage = null, errorCode = null, metadata = {}, durationMs = null, phone = "", attempt = 1 }) {
  const encryptedPhone = phone && config.credentialKey ? encryptText(phone, config.credentialKey) : null;
  return (await query(
    `INSERT INTO publications(
       site_id,post_id,event_type,platform,status,external_message_ids,error_message,error_code,
       published_at,metadata,duration_ms,attempt_count,contact_phone_enc,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT(site_id,post_id,event_type,platform) DO UPDATE SET
       status=EXCLUDED.status,
       external_message_ids=EXCLUDED.external_message_ids,
       error_message=EXCLUDED.error_message,
       error_code=EXCLUDED.error_code,
       published_at=EXCLUDED.published_at,
       metadata=EXCLUDED.metadata,
       duration_ms=EXCLUDED.duration_ms,
       contact_phone_enc=COALESCE(EXCLUDED.contact_phone_enc, publications.contact_phone_enc),
       -- every re-publish of the same event (edit, retry) is another attempt
       attempt_count=publications.attempt_count+1,
       updated_at=NOW()
     RETURNING id`,
    [
      ad.site_id, ad.post_id, ad.event_type, platform, status,
      JSON.stringify(sent?.message_ids || []),
      errorMessage, errorCode,
      status === "published" ? new Date() : null,
      JSON.stringify({ ...(metadata || {}), attempt: Math.max(1, Number(attempt) || 1) }),
      durationMs,
      1,
      encryptedPhone,
    ],
  )).rows[0];
}

/**
 * Publishes one ad to one resolved target. Shared by the live webhook path and
 * the retry worker, so a retry follows exactly the same rules as the original
 * attempt (policy, field visibility, buttons, edit-vs-post).
 */
async function publishToTarget({ ad, site, target, ownerUserId, attempt = 1 }) {
  const started = Date.now();
  const platform = target.platform;

  const preference = ownerUserId ? await getPreference(ownerUserId, ad.site_id, platform) : null;
  if (preference?.enabled === false) {
    return { platform, status: "skipped", reason: "platform_disabled" };
  }

  const selectedKeys = selectedKeysForPreference(preference);
  const previous = isUpdate(ad.event_type) ? await latestPublication(ad.site_id, ad.post_id, platform) : null;

  const phone = resolveContactPhone(ad, platform);
  const buttons = { ...(ad.buttons || {}) };
  const contactState = resolveContactButton(buttons.contact, phone);

  if (buttons.contact) {
    buttons.contact = { ...buttons.contact, enabled: contactState.enabled };
  }

  const enrichedAd = {
    ...ad,
    _telegram_target: target.target,
    _bale_target: target.target,
    buttons,
    contactCallbackData: contactState.needsCallback
      ? `contact:${callbackToken(ad.site_id, ad.post_id)}`
      : null,
  };

  const metadata = {
    formatter: "jarchi-structured-v2",
    contract_version: ad.contract_version || "1.0",
    fields_count: Object.keys(ad.fields || {}).length,
    has_contact_phone: Boolean(phone),
    ...(platform === "telegram" ? { telegram_target: target.target } : {}),
    ...(platform === "bale" ? { bale_target: target.target } : {}),
  };

  try {
    let sent;

    if (platform === "telegram") {
      const formatted = formatTelegram(enrichedAd, selectedKeys, {
        maxLength: ad.images?.length ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT,
      });
      if (previous && isUpdate(ad.event_type)) {
        try {
          sent = await updateTelegramPublication(previous, formatted, enrichedAd);
          metadata.mode = "edited";
        } catch (editError) {
          logger.warn("telegram edit failed; falling back to new publication", {
            site_id: ad.site_id, post_id: ad.post_id, error: editError.message,
          });
          sent = await publishTelegramText(enrichedAd, target.target, formatted);
          metadata.mode = "republished_after_edit_failure";
        }
      } else {
        sent = await publishTelegramText(enrichedAd, target.target, formatted);
        metadata.mode = "published";
      }
      metadata.buttons_count = formatted.buttons.length;
    } else if (platform === "bale") {
      const formatted = formatBale(enrichedAd, selectedKeys);
      sent = await publishBale(enrichedAd, target.target, formatted);
      metadata.mode = "published";
      metadata.buttons_count = formatted.buttons.length;
    } else if (platform === "whatsapp") {
      const connection = ownerUserId ? await getConnection(ownerUserId, "whatsapp", config.credentialKey) : null;
      if (!connection) {
        throw new PlatformError("No WhatsApp connection for client", { platform, category: ERROR_CATEGORIES.CONFIG });
      }
      const recipient = String(
        connection.settings?.recipient_phone ||
        connection.settings?.recipient ||
        "",
      ).replace(/[^0-9+]/g, "");
      if (!recipient) {
        throw new PlatformError("WhatsApp recipient is not configured for this client", {
          platform, category: ERROR_CATEGORIES.CONFIG,
        });
      }
      const text = formatPlain(enrichedAd, selectedKeys, "whatsapp");
      const view = enrichedAd.buttons?.view;
      sent = await sendWhatsAppText({
        accessToken: connection.credentials.accessToken,
        phoneNumberId: connection.credentials.phoneNumberId,
        to: recipient,
        // WhatsApp text messages have no inline buttons, so an enabled view
        // button becomes a trailing link rather than being dropped silently.
        text: view?.enabled && enrichedAd.url ? `${text}\n\n🔗 ${view.label || "مشاهده آگهی"}: ${enrichedAd.url}` : text,
      });
      metadata.mode = "published";
    } else {
      return { platform, status: "skipped", reason: "unknown_platform" };
    }

    const durationMs = Date.now() - started;
    const saved = await savePublication({
      ad, platform, status: "published", sent, metadata, durationMs, phone, attempt,
    });
    if (previous && String(previous.id) !== String(saved?.id)) {
      await query("UPDATE publications SET status='superseded', updated_at=NOW() WHERE id=$1 AND status='published'", [previous.id]);
    }

    logger.info("publication succeeded", {
      site_id: ad.site_id, post_id: ad.post_id, event_type: ad.event_type, platform,
      message_ids: sent?.message_ids || [], attempt, duration_ms: durationMs,
    });
    return { platform, status: "published", publication_id: saved?.id, result: sent, duration_ms: durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const errorCode = error instanceof PlatformError ? error.category : ERROR_CATEGORIES.UNKNOWN;
    const saved = await savePublication({
      ad, platform, status: "failed", sent: null,
      errorMessage: error.message, errorCode,
      metadata: { ...metadata, mode: "failed" },
      durationMs, phone, attempt,
    });

    logger.error("publication failed", {
      site_id: ad.site_id, post_id: ad.post_id, event_type: ad.event_type, platform,
      error, error_code: errorCode, attempt, duration_ms: durationMs,
    });

    return {
      platform,
      status: "failed",
      publication_id: saved?.id,
      error: error.message,
      error_code: errorCode,
      retryable: Boolean(error?.retryable),
      duration_ms: durationMs,
      _error: error,
    };
  }
}

export async function publishAd(originalAd, site) {
  const started = Date.now();
  const ownerUserId = site?.owner_user_id ?? await ownerId(originalAd.site_id);

  // Operator field overrides are folded in once, here, so every target and
  // every formatter below sees a single already-resolved field_meta.
  const ad = applyFieldOverrides(originalAd, await getFieldOverrides(originalAd.site_id));

  if (!(await allowed(ownerUserId))) {
    logger.warn("publication blocked by subscription", {
      site_id: ad.site_id, post_id: ad.post_id, event_type: ad.event_type, reason: "subscription_expired",
    });
    return [{ platform: "all", status: "blocked", reason: "subscription_expired" }];
  }

  if (DELETION_EVENTS.has(ad.event_type)) {
    const deleted = await deletePublication(ad);
    logger.info("publication deletion completed", {
      site_id: ad.site_id, post_id: ad.post_id, results: deleted, duration_ms: Date.now() - started,
    });
    return deleted;
  }

  if (!PUBLISHABLE_EVENTS.has(ad.event_type)) {
    return [{ platform: "all", status: "ignored", reason: "unsupported_event" }];
  }

  const targets = resolvePublicationTargets(ad, site);
  const results = [];

  for (const target of targets) {
    if (!target.enabled) continue;
    const result = await publishToTarget({ ad, site, target, ownerUserId });

    if (result.status === "failed") {
      const queued = await maybeEnqueueAutomatic({
        ad, platform: target.platform, publicationId: result.publication_id, error: result._error,
      });
      result.retry_queued = Boolean(queued);
    }
    delete result._error;
    results.push(result);
  }

  const succeeded = results.filter((item) => item.status === "published").length;
  const failed = results.filter((item) => item.status === "failed").length;
  await applyPublicationOutcome(ad.site_id, {
    succeeded,
    failed,
    lastError: results.find((item) => item.status === "failed")?.error || null,
  });

  return results;
}

/**
 * Re-runs one platform for one ad. Used by the retry worker and by the admin
 * "retry publication" action; resolves targets from current site configuration
 * so a fixed channel id takes effect on the next attempt.
 */
export async function republishTarget(originalAd, platform, { attempt = 1 } = {}) {
  const ad = applyFieldOverrides(originalAd, await getFieldOverrides(originalAd.site_id));
  const site = await getSite(ad.site_id);
  if (!site) return { platform, status: "failed", error: "Site no longer exists" };
  if (!site.enabled) return { platform, status: "skipped", reason: "site_disabled" };

  const ownerUserId = site.owner_user_id;
  if (!(await allowed(ownerUserId))) return { platform, status: "blocked", reason: "subscription_expired" };

  const target = resolvePublicationTargets(ad, site).find((item) => item.platform === platform);
  if (!target) return { platform, status: "skipped", reason: "unknown_platform" };
  if (!target.enabled || !target.target) return { platform, status: "skipped", reason: "target_not_configured" };

  const result = await publishToTarget({ ad, site, target, ownerUserId, attempt });
  await applyPublicationOutcome(ad.site_id, {
    succeeded: result.status === "published" ? 1 : 0,
    failed: result.status === "failed" ? 1 : 0,
    lastError: result.error || null,
  });
  delete result._error;
  return result;
}
