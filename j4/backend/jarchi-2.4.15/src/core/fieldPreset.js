/**
 * "Jarchi Recommended" — one sensible publication configuration, applied at once.
 *
 * A newly connected site reports every field its post type has: forty of them
 * on a JetEngine classifieds build, most of which are internal bookkeeping. The
 * operator's real question is which of those belong in a Telegram message, and
 * answering it by hand is one decision per field before the first advert goes
 * out looking right.
 *
 * This is the shape of a classified advert that works: what it is, what it
 * costs, where it is, how to reach them. Nothing here is clever — it is a
 * default somebody would otherwise have to assemble by clicking, and every
 * field it touches stays individually editable afterwards.
 *
 * Deliberately *not* a separate settings store. The plan is expressed as
 * ordinary field overrides, written through the same column the publication
 * formatter reads, so applying the preset and flipping the toggles by hand
 * produce exactly the same state.
 */

const PLATFORMS = ["telegram", "bale", "whatsapp"];

/**
 * Word fragments that identify a field's purpose, most specific first.
 *
 * Matched against the key and the label together. The label is what the site's
 * own author wrote and is far more reliable than a storage type, which is
 * `text` for a price, a city and an internal reference alike. Persian and
 * English both, because a single post type routinely has some of each.
 */
const GROUPS = Object.freeze([
  {
    id: "identity",
    rank: 1,
    limit: 2,
    hints: ["title", "name", "subject", "headline", "brand", "company",
      "عنوان", "نام", "موضوع", "برند", "شرکت"],
  },
  {
    id: "summary",
    rank: 2,
    limit: 1,
    hints: ["description", "content", "summary", "excerpt", "about",
      "توضیح", "شرح", "معرفی"],
  },
  {
    id: "price",
    rank: 3,
    limit: 2,
    hints: ["price", "cost", "amount", "salary", "rent", "deposit", "fee",
      "قیمت", "مبلغ", "هزینه", "حقوق", "اجاره", "رهن", "ودیعه"],
  },
  {
    id: "location",
    rank: 4,
    limit: 2,
    hints: ["city", "province", "state", "address", "location", "region", "country",
      "شهر", "استان", "آدرس", "نشانی", "منطقه", "کشور"],
  },
  {
    id: "contact",
    rank: 5,
    limit: 1,
    hints: ["phone", "mobile", "tel", "whatsapp", "telegram",
      "تلفن", "موبایل", "همراه", "تماس"],
  },
  {
    id: "spec",
    rank: 6,
    limit: 5,
    // No hints: this is where a field lands when nothing else claimed it and it
    // still looks like an attribute of the thing being advertised.
    hints: [],
  },
]);

/**
 * Fields that are never published as a line of text.
 *
 * Images travel as photographs on the message itself, so listing the gallery
 * would print a URL where a picture already is. The rest are internal.
 */
const NEVER = Object.freeze([
  "image", "gallery", "photo", "thumbnail", "attachment", "file", "video", "logo", "banner",
  "تصویر", "عکس", "گالری", "فایل", "ویدیو", "لوگو",
  "_id", "guid", "slug", "internal", "reference", "meta", "hash", "token", "secret",
  "کد داخلی", "شناسه",
]);

/** Lowercases and folds the letter forms that otherwise make matching miss. */
function normalise(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    // A site built on an Arabic keyboard writes ي and ك where a Persian one
    // writes ی and ک. They look identical and would otherwise never match.
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const matches = (haystack, hints) => hints.some((hint) => haystack.includes(normalise(hint)));

/**
 * Whether a field is an attribute worth publishing, as opposed to bookkeeping.
 *
 * A select, a number or a taxonomy that nobody named recognisably is almost
 * always a property of the thing being advertised — rooms, mileage, grade.
 */
function looksLikeSpec(field) {
  return ["select", "checkbox", "taxonomy", "number", "boolean", "radio"].includes(
    String(field.field_type || "").toLowerCase(),
  );
}

/**
 * Builds the preset for one site's catalog.
 *
 * @param {Array<object>} catalog Rows from listFieldCatalog().
 * @returns {{apply: Array<{field_key: string, hidden: boolean, platforms: object, order: number}>,
 *            enabled: string[], hiddenKeys: string[]}} The plan.
 */
export function recommendFieldPreset(catalog = []) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const claimed = new Map();
  const taken = Object.fromEntries(GROUPS.map((group) => [group.id, 0]));

  for (const field of rows) {
    const key = String(field.field_key || "");
    if (!key) continue;

    const haystack = normalise(`${key} ${field.label || ""} ${field.effective_label || ""}`);

    // Excluded outright, whatever else it looks like.
    if (matches(haystack, NEVER)) continue;

    const group = GROUPS.find((candidate) => candidate.hints.length && matches(haystack, candidate.hints))
      || (looksLikeSpec(field) ? GROUPS.find((candidate) => candidate.id === "spec") : null);

    if (!group) continue;

    // A budget per group. One price is informative; six price-ish fields is a
    // spreadsheet nobody reads.
    if (taken[group.id] >= group.limit) continue;

    taken[group.id] += 1;
    claimed.set(key, { group, position: taken[group.id] });
  }

  const enabled = [...claimed.keys()];
  const hiddenKeys = rows
    .map((field) => String(field.field_key || ""))
    .filter((key) => key && !claimed.has(key));

  const apply = [];

  for (const field of rows) {
    const key = String(field.field_key || "");
    if (!key) continue;

    const claim = claimed.get(key);
    const platforms = Object.fromEntries(PLATFORMS.map((platform) => [platform, Boolean(claim)]));

    apply.push({
      field_key: key,
      hidden: !claim,
      platforms,
      // Reading order of a classified advert: title, summary, price, place,
      // contact, then the rest. Ranks are spaced so a field can be nudged
      // between two others afterwards without renumbering everything.
      order: claim ? claim.group.rank * 100 + claim.position : 9000,
    });
  }

  return { apply, enabled, hiddenKeys };
}
