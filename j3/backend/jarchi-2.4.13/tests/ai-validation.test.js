import test from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedProduct, validateProductEdit } from "../src/ai/schemas/generatedProduct.js";
import { reviewSeo, keywordDensity, containsKeyword, SEO_LIMITS } from "../src/ai/seo/rules.js";

const usable = {
  title: "گوشی موبایل سامسونگ گلکسی A54",
  short_description: "یک گوشی میان‌رده با دوربین خوب و باتری پرظرفیت برای استفاده روزمره کاربران.",
  description: `<p>${"متن توضیحات محصول با جزئیات کافی برای خریدار. ".repeat(12)}</p>`,
  seo_title: "خرید گوشی موبایل سامسونگ گلکسی A54 با قیمت مناسب",
  meta_description: "گوشی موبایل سامسونگ گلکسی A54 با دوربین ۵۰ مگاپیکسلی و باتری ۵۰۰۰ میلی‌آمپری، مناسب استفاده روزمره و عکاسی.",
  slug: "samsung-galaxy-a54",
  focus_keyword: "گوشی موبایل سامسونگ",
  secondary_keywords: ["خرید گلکسی A54", "قیمت گلکسی A54"],
  tags: ["سامسونگ", "گوشی موبایل", "گلکسی"],
  categories: ["موبایل"],
  attributes: [{ name: "رنگ", value: "مشکی", source: "user_provided" }],
  image_alt_texts: ["گوشی سامسونگ گلکسی A54"],
  suggested_price: 15900000,
  confidence: 0.9,
  warnings: [],
};

test("valid AI output is accepted and normalized", () => {
  const { product, warnings } = validateGeneratedProduct(usable, { language: "fa" });
  assert.equal(product.title, usable.title);
  assert.equal(product.slug, "samsung-galaxy-a54");
  assert.equal(product.language, "fa");
  assert.equal(product.suggested_price, 15900000);
  assert.equal(product.attributes[0].requires_review, false);
  assert.ok(Array.isArray(warnings));
});

test("structurally unusable output is rejected, not stored", () => {
  for (const bad of [null, "a string", 42, [], { description: "no title" }, { title: "" }, { title: "   " }]) {
    assert.throws(
      () => validateGeneratedProduct(bad, {}),
      (error) => error.code === "AI_VALIDATION_ERROR",
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test("wrong types in AI output do not crash validation", () => {
  const { product } = validateGeneratedProduct({
    ...usable,
    tags: "not-an-array",
    secondary_keywords: { nope: true },
    attributes: "nope",
    image_alt_texts: 5,
    suggested_price: "abc",
    confidence: "high",
  }, {});
  assert.deepEqual(product.tags, []);
  assert.deepEqual(product.secondary_keywords, []);
  assert.deepEqual(product.attributes, []);
  assert.deepEqual(product.image_alt_texts, []);
  assert.equal(product.suggested_price, null);
  assert.equal(product.confidence, 0.5, "an unparseable confidence falls back, it does not throw");
});

test("dangerous markup never survives into product content", () => {
  const { product } = validateGeneratedProduct({
    ...usable,
    description: '<p>سالم</p><script>fetch("//evil")</script><iframe src="x"></iframe><a href="javascript:alert(1)">لینک</a><img src=x onerror=alert(1)>',
    title: "<b>عنوان</b><script>bad()</script>",
  }, {});
  assert.doesNotMatch(product.description, /script|iframe|javascript:|onerror/i);
  assert.match(product.description, /سالم/);
  assert.doesNotMatch(product.title, /</);
});

test("prices arrive in many shapes and are normalized or dropped", () => {
  const cases = [["15,900,000", 15900000], [" 1200.5 ", 1200.5], [0, 0], [-5, null], ["abc", null], [null, null], [1e15, null]];
  for (const [input, expected] of cases) {
    const { product } = validateGeneratedProduct({ ...usable, suggested_price: input }, {});
    assert.equal(product.suggested_price, expected, `price ${JSON.stringify(input)}`);
  }
});

test("inferred attributes are marked for review and warned about", () => {
  const { product, warnings } = validateGeneratedProduct({
    ...usable,
    attributes: [
      { name: "رنگ", value: "مشکی", source: "user_provided" },
      { name: "جنس", value: "آلومینیوم", source: "inferred" },
      { name: "وزن", value: "۲۰۰ گرم", source: "made_up_source" },
    ],
  }, {});

  assert.equal(product.attributes[0].requires_review, false);
  assert.equal(product.attributes[1].requires_review, true);
  // An unknown source is treated as inferred, never as a user-provided fact.
  assert.equal(product.attributes[2].source, "inferred");
  assert.equal(product.attributes[2].requires_review, true);
  assert.ok(warnings.some((warning) => warning.code === "inferred_attributes"));
});

test("tags are deduplicated, bounded and stripped of junk", () => {
  const { product } = validateGeneratedProduct({
    ...usable,
    tags: ["سامسونگ", "سامسونگ", "SAMSUNG", "a", "", "  ", ...Array.from({ length: 30 }, (_, i) => `تگ${i}`)],
  }, {});
  assert.ok(product.tags.length <= SEO_LIMITS.tags.max);
  assert.equal(product.tags.filter((tag) => tag === "سامسونگ").length, 1);
  assert.ok(!product.tags.includes("a"));
});

test("model-declared warnings survive into the draft", () => {
  const { warnings } = validateGeneratedProduct({
    ...usable,
    warnings: ["ابعاد دقیق مشخص نیست", "جنس بدنه حدس زده شده است"],
  }, {});
  const messages = warnings.filter((warning) => warning.code === "model_warning").map((warning) => warning.message);
  assert.equal(messages.length, 2);
  assert.ok(messages[0].includes("ابعاد"));
});

test("low confidence is surfaced as a warning", () => {
  const { warnings } = validateGeneratedProduct({ ...usable, confidence: 0.2 }, {});
  assert.ok(warnings.some((warning) => warning.code === "low_confidence"));
  // Percentages are accepted too.
  const { product } = validateGeneratedProduct({ ...usable, confidence: 85 }, {});
  assert.equal(product.confidence, 0.85);
});

test("a missing slug is derived rather than failing the generation", () => {
  const { product } = validateGeneratedProduct({ ...usable, slug: "" }, {});
  assert.ok(product.slug.length > 0);
  assert.doesNotMatch(product.slug, /\s/);
});

test("SEO review reports length and keyword problems without rejecting", () => {
  const warnings = reviewSeo({
    title: "محصول",
    seo_title: "کوتاه",
    meta_description: "خیلی کوتاه",
    description: "متن کوتاه",
    slug: "x",
    focus_keyword: "چیز دیگری",
    tags: ["یک"],
  });
  const codes = warnings.map((warning) => warning.code);
  assert.ok(codes.includes("too_short"));
  assert.ok(codes.includes("keyword_missing"));
  assert.ok(codes.includes("few_tags"));
});

test("keyword stuffing is detected", () => {
  const stuffed = { ...usable, description: `<p>${"گوشی موبایل سامسونگ ".repeat(30)}</p>` };
  const warnings = reviewSeo(stuffed);
  assert.ok(warnings.some((warning) => warning.code === "keyword_stuffing"));
  assert.ok(keywordDensity("گوشی گوشی گوشی چیز", "گوشی") > 50);
  assert.equal(containsKeyword("خرید گوشی موبایل سامسونگ", "گوشی سامسونگ"), true);
  assert.equal(containsKeyword("خرید لپ‌تاپ", "گوشی سامسونگ"), false);
});

test("customer edits are sanitized like generated content", () => {
  const edit = validateProductEdit({
    title: "<b>عنوان جدید</b>",
    description: '<p>متن</p><script>alert(1)</script>',
    slug: "  عنوان جدید!!  ",
    tags: ["تگ", "تگ"],
    unknown_field: "ignored",
  });
  assert.equal(edit.title, "عنوان جدید");
  assert.doesNotMatch(edit.description, /script/);
  assert.equal(edit.slug, "عنوان-جدید");
  assert.deepEqual(edit.tags, ["تگ"]);
  assert.equal("unknown_field" in edit, false, "unknown fields are never written");
});

test("an edit must contain something editable", () => {
  assert.throws(() => validateProductEdit({}), (error) => error.code === "PRODUCT_VALIDATION_ERROR");
  assert.throws(() => validateProductEdit({ nope: 1 }), (error) => error.code === "PRODUCT_VALIDATION_ERROR");
  assert.throws(() => validateProductEdit({ title: "x" }), (error) => error.code === "PRODUCT_VALIDATION_ERROR");
});
