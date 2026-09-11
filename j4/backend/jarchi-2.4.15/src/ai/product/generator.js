import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { getAiProvider } from "../index.js";
import { AI_CAPABILITIES } from "../providers/base.js";
import { AiError, AI_ERROR_CODES } from "../errors.js";
import { getPrompt, CURRENT_PROMPT_VERSIONS } from "../prompts/index.js";
import { validateGeneratedProduct } from "../schemas/generatedProduct.js";
import { sanitizePromptText, looksLikeInjection, sanitizeTerm } from "../sanitize.js";

/**
 * Orchestrates the AI calls behind a product draft.
 *
 * This module owns the *sequence* (analyse, then write, then classify) and the
 * recovery behaviour. It does not own persistence, quota or WooCommerce — those
 * belong to services, so the same generation can be driven from a job, a test,
 * or later an agent.
 */

/** Everything reaching a prompt is sanitized and length-bounded first. */
function buildInputContext(input = {}, images = []) {
  const facts = {};
  const suspicious = [];

  const textField = (key, maxLength) => {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") return;
    if (looksLikeInjection(raw)) suspicious.push(key);
    facts[key] = sanitizePromptText(raw, { maxLength });
  };

  textField("name", 200);
  textField("short_description", 1000);
  textField("description", 4000);
  textField("category", 120);
  textField("keywords", 400);
  textField("instructions", 1000);
  textField("sku", 64);
  textField("brand", 120);
  textField("color", 60);

  if (input.price !== undefined && input.price !== null && input.price !== "") {
    const price = Number(String(input.price).replace(/[,\s]/g, ""));
    if (Number.isFinite(price) && price >= 0) facts.price = price;
  }
  if (Array.isArray(input.attributes)) {
    facts.attributes = input.attributes.slice(0, 20).map((attribute) => ({
      name: sanitizeTerm(attribute?.name, { maxLength: 60 }),
      value: sanitizeTerm(attribute?.value, { maxLength: 200 }),
    })).filter((attribute) => attribute.name && attribute.value);
  }

  facts.image_count = images.length;
  return { facts, suspicious };
}

/**
 * Runs a structured call, retrying when the model returns something the schema
 * cannot accept. A malformed response is worth one more attempt with a firmer
 * instruction; a provider outage is not retried here (the job queue owns that).
 */
async function structuredWithRecovery({ provider, prompt, promptArgs, schemaName, validate, context }) {
  const attempts = Math.max(1, config.ai.maxRetries + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const built = prompt.build(promptArgs);
    const system = attempt === 1
      ? built.system
      : `${built.system}\nThe previous response could not be parsed against the schema. Return only valid JSON matching the schema, with no commentary.`;

    let response;
    try {
      response = await provider.generateStructured({
        system,
        user: built.user,
        schema: prompt.schema,
        schemaName,
        temperature: attempt === 1 ? 0.7 : 0.3,
      });
    } catch (error) {
      // Provider-level failures propagate immediately; only schema failures retry here.
      if (error instanceof AiError && error.code === AI_ERROR_CODES.AI_VALIDATION_ERROR) {
        lastError = error;
        logger.warn("ai response unparseable, retrying", {
          ...context, attempt, prompt: `${prompt.id}@${prompt.version}`, error: error.detail,
        });
        continue;
      }
      throw error;
    }

    try {
      const validated = validate(response.data);
      return { ...validated, usage: response.usage, model: response.model, attempts: attempt };
    } catch (error) {
      lastError = error;
      logger.warn("ai output failed validation, retrying", {
        ...context, attempt, prompt: `${prompt.id}@${prompt.version}`, error: error.detail || error.message,
      });
    }
  }

  throw lastError || new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI output could not be validated");
}

/** Vision pass over the draft's images. Failure degrades, it does not abort. */
export async function analyzeProductImages({ images = [], language, userNotes = "", context = {} }) {
  if (!images.length) return { analysis: [], usage: { tokens_in: 0, tokens_out: 0 }, model: null };

  const provider = getAiProvider();
  if (!provider.supports(AI_CAPABILITIES.VISION)) {
    return { analysis: [], usage: { tokens_in: 0, tokens_out: 0 }, model: null, skipped: "vision_unsupported" };
  }

  const prompt = getPrompt("product-analysis");
  const built = prompt.build({ language, userNotes: sanitizePromptText(userNotes, { maxLength: 500 }) });
  const started = Date.now();

  const response = await provider.analyzeImages({
    system: built.system,
    user: built.user,
    images: images.map((image) => ({ mimeType: image.mimeType, base64: image.base64 })),
    schema: prompt.schema,
    schemaName: "analysis",
  });

  logger.info("ai image analysis complete", {
    ...context, images: images.length, model: response.model, duration_ms: Date.now() - started,
  });

  const data = response.data && typeof response.data === "object" ? response.data : {};
  return {
    analysis: [{
      product_type: sanitizeTerm(data.product_type, { maxLength: 120 }),
      observations: Array.isArray(data.observations) ? data.observations.slice(0, 20) : [],
      colors: Array.isArray(data.colors) ? data.colors.slice(0, 8).map((c) => sanitizeTerm(c)) : [],
      visible_materials: Array.isArray(data.visible_materials) ? data.visible_materials.slice(0, 8).map((m) => sanitizeTerm(m)) : [],
      visible_text: Array.isArray(data.visible_text) ? data.visible_text.slice(0, 10).map((t) => sanitizePromptText(t, { maxLength: 120 })) : [],
      style: sanitizeTerm(data.style, { maxLength: 80 }),
      suggested_category: sanitizeTerm(data.suggested_category, { maxLength: 80 }),
      confidence: Number(data.confidence) || 0,
    }],
    usage: response.usage,
    model: response.model,
    promptVersion: `${prompt.id}@${prompt.version}`,
  };
}

/** Full generation: analysis (optional) → content → validation. */
export async function generateProductContent({
  input = {},
  images = [],
  imageAnalysis = [],
  siteTaxonomy = {},
  settings = {},
  language,
  context = {},
}) {
  const provider = getAiProvider();
  const prompt = getPrompt("product-content");
  const resolvedLanguage = language || settings.language || config.ai.defaultLanguage;
  const { facts, suspicious } = buildInputContext(input, images);
  const started = Date.now();

  const result = await structuredWithRecovery({
    provider,
    prompt,
    schemaName: "product",
    context,
    promptArgs: {
      language: resolvedLanguage,
      input: facts,
      imageAnalysis,
      siteTaxonomy,
      tone: settings.tone || "",
      extraInstructions: sanitizePromptText(settings.extra_instructions || "", { maxLength: 800 }),
      imageCount: images.length,
    },
    validate: (data) => validateGeneratedProduct(data, { language: resolvedLanguage }),
  });

  if (suspicious.length) {
    result.warnings.push({
      field: "input",
      code: "prompt_injection_filtered",
      message: `متن ورودی در فیلدهای ${suspicious.join("، ")} حاوی الگوی دستوری بود و پاک‌سازی شد.`,
    });
  }

  logger.info("ai product content generated", {
    ...context,
    provider: provider.name,
    model: result.model,
    prompt: `${prompt.id}@${prompt.version}`,
    attempts: result.attempts,
    warnings: result.warnings.length,
    duration_ms: Date.now() - started,
  });

  return {
    ...result,
    provider: provider.name,
    promptVersion: `${prompt.id}@${prompt.version}`,
    language: resolvedLanguage,
  };
}

/** SEO-only regeneration; body copy is passed in and left untouched. */
export async function generateSeo({ product, siteTaxonomy = {}, language, context = {} }) {
  const provider = getAiProvider();
  const prompt = getPrompt("product-seo");
  const resolvedLanguage = language || config.ai.defaultLanguage;

  const response = await provider.generateStructured({
    ...prompt.build({ language: resolvedLanguage, product, siteTaxonomy }),
    schema: prompt.schema,
    schemaName: "seo",
    temperature: 0.5,
  });

  const merged = validateGeneratedProduct(
    { ...product, ...response.data },
    { language: resolvedLanguage },
  );

  logger.info("ai seo regenerated", { ...context, provider: provider.name, model: response.model });
  return {
    ...merged,
    usage: response.usage,
    model: response.model,
    provider: provider.name,
    promptVersion: `${prompt.id}@${prompt.version}`,
  };
}

/** Tag and category regeneration. */
export async function generateTaxonomy({ product, siteTaxonomy = {}, language, context = {} }) {
  const provider = getAiProvider();
  const prompt = getPrompt("product-tags");
  const resolvedLanguage = language || config.ai.defaultLanguage;

  const response = await provider.generateStructured({
    ...prompt.build({ language: resolvedLanguage, product, siteTaxonomy }),
    schema: prompt.schema,
    schemaName: "taxonomy",
    temperature: 0.4,
  });

  const merged = validateGeneratedProduct(
    { ...product, tags: response.data?.tags, categories: response.data?.categories },
    { language: resolvedLanguage },
  );

  logger.info("ai taxonomy regenerated", { ...context, provider: provider.name, model: response.model });
  return {
    ...merged,
    usage: response.usage,
    model: response.model,
    provider: provider.name,
    promptVersion: `${prompt.id}@${prompt.version}`,
  };
}

export { CURRENT_PROMPT_VERSIONS };
