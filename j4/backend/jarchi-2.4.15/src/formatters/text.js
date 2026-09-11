import { buildAutomaticText, buildFormatContext } from "./base.js";

export function formatPlain(ad, selectedKeys = null, platform = "whatsapp") {
  const context = buildFormatContext(ad, platform, selectedKeys);
  return buildAutomaticText(context, { html: false, maxLength: 4096 });
}
