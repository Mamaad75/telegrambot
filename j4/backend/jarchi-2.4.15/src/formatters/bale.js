import { buildAutomaticText, buildFormatContext, sanitizeCustomMessage, shouldUseCustomMessage } from "./base.js";
import { resolveContactPhone } from "../core/fieldPolicy.js";

export function formatBale(ad, selectedKeys = null) {
  const context = buildFormatContext(ad, "bale", selectedKeys);
  const custom = String(ad?.message || "").trim();
  const text = shouldUseCustomMessage(ad) && custom
    ? sanitizeCustomMessage(custom, 4096).replace(/<[^>]+>/g, "")
    : buildAutomaticText(context, { html: false, maxLength: 4096 });
  const buttons = [];
  if (ad?.buttons?.view?.enabled === true && context.permalink) {
    buttons.push({ text: String(ad.buttons.view.label || "مشاهده آگهی"), url: context.permalink });
  }
  const contact = ad?.buttons?.contact;

  /*
   * A support link needs no callback handler, so unlike the reveal-the-number
   * button below it can be rendered on Bale today. That is the whole reason
   * the contact button was unavailable here.
   */
  if (contact?.enabled === true && contact.mode === "support" && contact.url) {
    buttons.push({
      text: String(contact.label || "تماس با پشتیبانی"),
      url: String(contact.url),
    });
  } else if (contact?.enabled === true && resolveContactPhone(ad, "bale")) {
    // Bale callback queries are not handled by the current Jarchi bot webhook,
    // so do not emit a button that appears clickable but has no server handler.
    // Intentionally omitted until a Bale callback/webhook handler is available.
  }
  return { text, buttons };
}
