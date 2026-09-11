import { buildAutomaticText, buildFormatContext, sanitizeCustomMessage, shouldUseCustomMessage } from "./base.js";
import { normalizeWhitespace } from "./utils.js";
import { resolveContactPhone } from "../core/fieldPolicy.js";

const MAX_MESSAGE = 4096;

/**
 * @param {object} ad             normalized ad
 * @param {string[]|null} selectedKeys  customer field selection, when set
 * @param {{maxLength?:number}} options  1024 for photo captions, 4096 for text
 */
export function formatTelegram(ad, selectedKeys = null, { maxLength = MAX_MESSAGE } = {}) {
  const context = buildFormatContext(ad, "telegram", selectedKeys);
  const custom = normalizeWhitespace(ad?.message || "");
  const text = shouldUseCustomMessage(ad) && custom
    ? sanitizeCustomMessage(custom, maxLength)
    : buildAutomaticText(context, { html: true, maxLength });
  const buttons = [];

  const view = ad?.buttons?.view;
  if (view?.enabled === true && context.permalink) {
    buttons.push({ text: String(view.label || "مشاهده آگهی"), url: context.permalink });
  }

  const contact = ad?.buttons?.contact;

  if (contact?.enabled === true) {
    if (contact.mode === "support" && contact.url) {
      /*
       * A fixed support account is a link, not a number to reveal. It needs
       * nothing from the advert, so unlike the author button it appears on
       * every post — including the ones with no phone number at all, which is
       * the point of the setting.
       */
      buttons.push({
        text: String(contact.label || "تماس با پشتیبانی"),
        url: String(contact.url),
      });
    } else {
      // Field policy decides whether this platform may show a contact number.
      const phone = resolveContactPhone(ad, "telegram");

      if (phone) {
        buttons.push({
          text: String(contact.label || "تماس با آگهی‌دهنده"),
          callback_data: ad.contactCallbackData || "contact:unavailable",
        });
      }
    }
  }

  return { text: text || "📋 <b>آگهی</b>", buttons };
}

export function formatTelegramCaption(ad, selectedKeys = null) {
  return formatTelegram(ad, selectedKeys, { maxLength: 1024 }).text;
}
