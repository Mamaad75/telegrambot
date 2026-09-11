import test from "node:test";
import assert from "node:assert/strict";
import { formatTelegram, formatTelegramCaption } from "../src/formatters/telegram.js";
import { formatBale } from "../src/formatters/bale.js";
import { formatPlain } from "../src/formatters/text.js";
import { resolvePublicationTargets } from "../src/core/publicationPolicy.js";
import { normalizeAd } from "../src/core/normalizer.js";

const baseAd = {
  contract_version: "1.3",
  title: "عنوان تست",
  description: "توضیحات تست",
  url: "https://example.com/test",
  fields: {
    company: "شرکت تست",
    hidden: "نباید نمایش داده شود",
    phone: "09120000000",
  },
  field_meta: {
    company: {
      label: "نام شرکت",
      order: 1,
      platforms: { telegram: true, bale: true, whatsapp: true },
    },
    hidden: {
      label: "مخفی",
      order: 2,
      platforms: { telegram: false, bale: false, whatsapp: false },
    },
    phone: {
      label: "شماره تماس",
      order: 3,
      platforms: { telegram: true, bale: false, whatsapp: false },
    },
  },
  taxonomy: { category: { name: "خدمات" } },
  author: { phone: "09120000000" },
  buttons: {
    view: { enabled: true, label: "مشاهده آگهی" },
    contact: { enabled: true, label: "تماس با آگهی‌دهنده" },
  },
};

test("field_meta labels, ordering, category, description", () => {
  const ad = {
    ...baseAd,
    fields: { a: "۱", b: "۲" },
    field_meta: {
      a: { label: "نام شرکت", order: 2, visibility: "telegram" },
      b: { label: "نام کالا", order: 1, visibility: "telegram" },
    },
  };
  const out = formatTelegramCaption(ad);
  assert.match(out, /نام کالا/);
  assert.match(out, /نام شرکت/);
  assert.match(out, /دسته‌بندی/);
  assert.match(out, /توضیحات/);
  assert.ok(out.indexOf("نام کالا") < out.indexOf("نام شرکت"));
  assert.ok(out.lastIndexOf("توضیحات") > out.lastIndexOf("دسته‌بندی"));
  assert.ok([...out].length <= 4096);
});

test("hidden/admin omitted", () => {
  const out = formatTelegramCaption({
    title: "x",
    fields: { a: "visible", b: "hidden" },
    field_meta: {
      a: { label: "نمایش", order: 1, visibility: "telegram" },
      b: { label: "مخفی", order: 2, visibility: "hidden" },
    },
  });
  assert.match(out, /نمایش/);
  assert.doesNotMatch(out, /مخفی/);
});

test("structured formatter builds a clean dynamic card-style message", () => {
  const out = formatTelegramCaption({
    ...baseAd,
    rendering: { mode: "structured", title: { icon: "" }, fields: { bullet: "", showLabels: true, separator: ": " } },
    field_meta: {
      company: { label: "شرکت", order: 1, platforms: { telegram: true } },
      status: { label: "وضعیت", order: 2, platforms: { telegram: true } },
      hidden: { label: "مخفی", order: 99, platforms: { telegram: false } },
    },
    fields: { company: "شرکت کشتیرانی", status: "حضورى | حقوق توافقی", hidden: "x" },
    description: "توضیح اصلی آگهی",
  });
  assert.match(out, /<b>عنوان تست<\/b>/);
  assert.match(out, /<b>شرکت<\/b>: شرکت کشتیرانی/);
  assert.match(out, /<b>وضعیت<\/b>: حضورى \| حقوق توافقی/);
  assert.match(out, /توضیح اصلی آگهی/);
  assert.doesNotMatch(out, /📝/);
  assert.doesNotMatch(out, /دسته‌بندی: خدمات/);
});

test("custom formatter remains opt-in", () => {
  const out = formatTelegramCaption({
    ...baseAd,
    rendering: { mode: "custom" },
    message: "عنوان سفارشی\nشماره: 0912",
  });
  assert.match(out, /عنوان سفارشی/);
  assert.match(out, /شماره: 0912/);
});

test("platform visibility is respected", () => {
  const telegram = formatTelegram(baseAd);
  const bale = formatBale(baseAd);

  assert.match(telegram.text, /نام شرکت/);
  assert.match(telegram.text, /شماره تماس/);
  assert.doesNotMatch(telegram.text, /نباید نمایش داده شود/);

  assert.match(bale.text, /نام شرکت/);
  assert.doesNotMatch(bale.text, /شماره تماس/);
  assert.doesNotMatch(bale.text, /نباید نمایش داده شود/);
});

test("Telegram buttons are placed on one row", () => {
  const formatted = formatTelegram(baseAd);
  assert.equal(formatted.buttons.length, 2);
  assert.equal(formatted.buttons[0].label, undefined);
  assert.equal(formatted.buttons[0].text, "مشاهده آگهی");
  assert.equal(formatted.buttons[1].text, "تماس با آگهی‌دهنده");
});

test("publication targets honor explicit per-post selection", () => {
  const targets = resolvePublicationTargets(
    {
      publication_targets: {
        telegram: { enabled: true },
        bale: { enabled: false },
        whatsapp: { enabled: false },
      },
    },
    {
      telegram_channel_id: "https://t.me/loot_loop",
      bale_chat_id: "123",
    },
  );

  assert.equal(targets.find((x) => x.platform === "telegram").enabled, true);
  assert.equal(targets.find((x) => x.platform === "telegram").target, "@loot_loop");
  assert.equal(targets.find((x) => x.platform === "bale").enabled, false);
});

test("normalizer accepts Jarchi contract 1.3", () => {
  const ad = normalizeAd({
    contract_version: "1.3",
    event_type: "created",
    site_id: "site_test",
    post_id: 123,
    publication_targets: { telegram: { enabled: true } },
    buttons: { view: { enabled: true, label: "مشاهده" } },
    fields: { title: "عنوان" },
  });

  assert.equal(ad.contract_version, "1.3");
  assert.equal(ad.publication_targets.telegram.enabled, true);
  assert.equal(ad.buttons.view.label, "مشاهده");
});

test("caption limit is respected for photo posts", () => {
  const long = { ...baseAd, description: "ط".repeat(5000) };
  const caption = formatTelegram(long, null, { maxLength: 1024 });
  const message = formatTelegram(long, null, { maxLength: 4096 });
  assert.ok([...caption.text].length <= 1024, `caption was ${[...caption.text].length}`);
  assert.ok([...message.text].length <= 4096);
  assert.ok([...message.text].length > 1024);
});

test("button configuration is honoured, never silently dropped", () => {
  const viewOnly = formatTelegram({ ...baseAd, buttons: { view: { enabled: true, label: "دیدن" } } });
  assert.deepEqual(viewOnly.buttons.map((button) => button.text), ["دیدن"]);
  assert.equal(viewOnly.buttons[0].url, baseAd.url);

  const disabled = formatTelegram({ ...baseAd, buttons: { view: { enabled: false }, contact: { enabled: false } } });
  assert.deepEqual(disabled.buttons, []);

  // A view button without a permalink cannot be rendered as a URL button.
  const noUrl = formatTelegram({ ...baseAd, url: "", buttons: { view: { enabled: true, label: "دیدن" } } });
  assert.deepEqual(noUrl.buttons, []);
});

test("contact button needs a phone the platform may show", () => {
  const withPhone = formatTelegram(baseAd);
  assert.ok(withPhone.buttons.some((button) => button.callback_data));

  const withoutPhone = formatTelegram({ ...baseAd, author: {}, fields: { company: "شرکت تست" } });
  assert.equal(withoutPhone.buttons.filter((button) => button.callback_data).length, 0);
});

test("Bale keeps its own button set", () => {
  const bale = formatBale(baseAd);
  assert.equal(bale.buttons.length, 1);
  assert.equal(bale.buttons[0].text, "مشاهده آگهی");
});

test("custom messages are sanitized, scripts stripped, HTML kept safe", () => {
  const formatted = formatTelegram({
    ...baseAd,
    // Custom rendering is opt-in; without this the structured card is used.
    rendering: { mode: "custom" },
    message: '<b>سلام</b><script>alert("x")</script><a href="javascript:evil()">بد</a><a href="https://ok.example">خوب</a>',
  });
  assert.match(formatted.text, /<b>سلام<\/b>/);
  assert.doesNotMatch(formatted.text, /script/i);
  assert.doesNotMatch(formatted.text, /javascript:/i);
  assert.match(formatted.text, /https:\/\/ok\.example/);
});

test("field values are HTML-escaped in Telegram output", () => {
  const formatted = formatTelegram({
    title: "<img src=x onerror=alert(1)>",
    fields: { note: "<script>bad</script>" },
    field_meta: { note: { label: "یادداشت", order: 1, platforms: { telegram: true } } },
  });
  assert.doesNotMatch(formatted.text, /<script>/);
  assert.doesNotMatch(formatted.text, /onerror=/);
  assert.match(formatted.text, /&lt;script&gt;/);
});

test("plain text formatter carries no markup", () => {
  const text = formatPlain(baseAd, null, "whatsapp");
  assert.doesNotMatch(text, /<[a-z]/i);
  assert.match(text, /شرکت تست/);
});

test("deleted and unsupported event types are not formatter concerns", () => {
  const ad = normalizeAd({ event_type: "DELETED_FROM_TRASH", post_id: 5 });
  assert.equal(ad.event_type, "deleted_from_trash");
});

test("normalizer keeps legacy payload fields working", () => {
  const legacy = normalizeAd({
    event: "created",
    id: 77,
    permalink: "https://example.com/legacy",
    fields: { title: "عنوان قدیمی" },
    featured_image: { url: "https://example.com/i.jpg" },
  });
  assert.equal(legacy.event_type, "created");
  assert.equal(legacy.post_id, "77");
  assert.equal(legacy.url, "https://example.com/legacy");
  assert.equal(legacy.contract_version, "1.0");
  assert.deepEqual(legacy.images, ["https://example.com/i.jpg"]);
  assert.equal(legacy.publication_targets, null);
});

test("normalizer flattens arrays and objects into displayable values", () => {
  const ad = normalizeAd({
    post_id: 1,
    title: { rendered: "عنوان" },
    fields: { tags: ["الف", "ب"] },
  });
  assert.equal(ad.title, "عنوان");
  assert.deepEqual(ad.fields.tags, ["الف", "ب"]);
});


test("Bale omits contact callback until webhook support exists", () => {
  const bale = formatBale(baseAd);
  assert.equal(bale.buttons.some((button) => button.callback_data), false);
});
