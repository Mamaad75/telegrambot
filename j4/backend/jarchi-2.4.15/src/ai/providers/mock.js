import crypto from "node:crypto";
import zlib from "node:zlib";
import { AiError, AI_ERROR_CODES } from "../errors.js";
import { AiProvider, AI_CAPABILITIES } from "./base.js";

/**
 * Deterministic provider for tests and local development.
 *
 * The suite must never need a real API key or spend money, and a test that
 * asserts on generated content needs the same output every run. Failures are
 * configurable so retry, validation and quota paths can be exercised
 * deliberately rather than hoped for.
 */
export class MockAiProvider extends AiProvider {
  /**
   * @param {object} options
   *  - failStructured / failVision / failImage: "provider" | "invalid_json" | "malformed" | false
   *  - failTimes: fail only the first N calls, then succeed (retry testing)
   *  - overrides: partial product object merged into the deterministic result
   */
  constructor(options = {}) {
    super({ name: "mock", model: "mock-text-1", visionModel: "mock-vision-1", imageModel: "mock-image-1" });
    this.options = options;
    this.calls = { structured: 0, vision: 0, image: 0 };
  }

  capabilities() {
    return [
      AI_CAPABILITIES.TEXT,
      AI_CAPABILITIES.STRUCTURED,
      AI_CAPABILITIES.VISION,
      AI_CAPABILITIES.IMAGE_GENERATION,
    ];
  }

  #maybeFail(mode, callCount) {
    if (!mode) return null;
    if (this.options.failTimes && callCount > this.options.failTimes) return null;

    if (mode === "provider") {
      throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, "mock provider failure", { retryable: true });
    }
    if (mode === "permanent") {
      throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, "mock permanent failure", { retryable: false });
    }
    if (mode === "invalid_json") {
      throw new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI response was not valid JSON");
    }
    if (mode === "malformed") {
      // Structurally valid JSON, semantically unusable — the schema must catch it.
      return { title: "", description: 42, tags: "not-an-array", confidence: "high" };
    }
    return null;
  }

  /** Same input always yields the same text, so assertions are stable. */
  #seed(user) {
    return crypto.createHash("sha256").update(JSON.stringify(user ?? {})).digest("hex").slice(0, 8);
  }

  async generateStructured({ user, schemaName = "result" }) {
    this.calls.structured += 1;
    const forced = this.#maybeFail(this.options.failStructured, this.calls.structured);
    if (forced) return { data: forced, usage: { tokens_in: 10, tokens_out: 5 }, model: this.model };

    const input = user?.untrusted_input || {};
    const name = String(input.name || user?.untrusted_product?.title || "محصول نمونه").slice(0, 60);
    const seed = this.#seed(user);

    if (schemaName === "seo" || user?.task === "regenerate_seo") {
      return {
        data: {
          seo_title: `خرید ${name} با بهترین قیمت`,
          meta_description: `${name} با کیفیت مناسب و ارسال سریع. مشخصات کامل، تصاویر واقعی و پشتیبانی پس از فروش در فروشگاه ما.`,
          slug: `mock-${seed}`,
          focus_keyword: name,
          secondary_keywords: [`خرید ${name}`, `قیمت ${name}`],
          warnings: [],
        },
        usage: { tokens_in: 40, tokens_out: 20 },
        model: this.model,
      };
    }

    if (user?.task === "suggest_taxonomy") {
      const existing = user?.existing_categories || [];
      return {
        data: {
          tags: [name, `خرید ${name}`, "پیشنهاد ویژه"],
          categories: existing.length ? [existing[0].name || existing[0]] : ["دسته‌بندی نمونه"],
          warnings: [],
        },
        usage: { tokens_in: 30, tokens_out: 15 },
        model: this.model,
      };
    }

    const product = {
      title: name,
      short_description: `${name} با کیفیت ساخت مناسب، طراحی کاربردی و مناسب استفاده روزمره است.`,
      description:
        `<h2>معرفی ${name}</h2><p>${`${name} یکی از گزینه‌های مناسب برای استفاده روزمره است. `.repeat(4)}</p>` +
        "<h3>ویژگی‌ها</h3><ul><li>طراحی کاربردی</li><li>کیفیت ساخت مناسب</li><li>مناسب استفاده روزانه</li></ul>" +
        "<h3>موارد استفاده</h3><p>برای استفاده شخصی و حرفه‌ای مناسب است.</p>",
      seo_title: `خرید ${name} با بهترین قیمت`,
      meta_description: `${name} با کیفیت مناسب و ارسال سریع. مشخصات کامل، تصاویر واقعی و پشتیبانی پس از فروش در فروشگاه ما.`,
      slug: `mock-${seed}`,
      focus_keyword: name,
      secondary_keywords: [`خرید ${name}`, `قیمت ${name}`, `${name} اصل`],
      tags: [name, "پرفروش", "پیشنهاد ویژه"],
      categories: (user?.store_taxonomy?.categories || []).slice(0, 1).map((category) => category.name || category),
      attributes: [
        ...(input.color ? [{ name: "رنگ", value: String(input.color), source: "user_provided" }] : []),
        { name: "سبک", value: "مدرن", source: "inferred" },
      ],
      image_prompts: [`studio photo of ${name}`],
      image_alt_texts: [`تصویر ${name}`],
      suggested_price: input.price ? Number(input.price) : 1250000,
      confidence: 0.86,
      warnings: input.name ? [] : ["نام محصول توسط کاربر ارائه نشده است."],
    };

    return {
      data: { ...product, ...(this.options.overrides || {}) },
      usage: { tokens_in: 120, tokens_out: 260 },
      model: this.model,
    };
  }

  async analyzeImages({ images = [] }) {
    this.calls.vision += 1;
    const forced = this.#maybeFail(this.options.failVision, this.calls.vision);
    if (forced) return { data: forced, usage: { tokens_in: 10, tokens_out: 5 }, model: this.visionModel };

    return {
      data: {
        product_type: "محصول عمومی",
        observations: [
          { attribute: "رنگ غالب", value: "مشکی", certainty: "likely" },
          { attribute: "جنس ظاهری", value: "پلاستیک", certainty: "uncertain" },
        ],
        colors: ["مشکی"],
        visible_materials: [],
        visible_text: [],
        style: "مدرن",
        composition: "تک محصول روی پس‌زمینه ساده",
        suggested_category: "عمومی",
        confidence: 0.7,
        image_count: images.length,
      },
      usage: { tokens_in: 80, tokens_out: 60 },
      model: this.visionModel,
    };
  }

  async generateImage({ prompt }) {
    this.calls.image += 1;
    this.#maybeFail(this.options.failImage, this.calls.image);
    return {
      buffer: makePng(64, 64),
      mimeType: "image/png",
      model: this.imageModel,
      usage: { tokens_in: 0, tokens_out: 0 },
      prompt,
    };
  }
}

/** A real, decodable 1-colour PNG so image validation runs for real in tests. */
export function makePng(width = 64, height = 64) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 3 + 1);
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[offset + 1 + x * 3] = 30;
      raw[offset + 2 + x * 3] = 120;
      raw[offset + 3 + x * 3] = 200;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}
