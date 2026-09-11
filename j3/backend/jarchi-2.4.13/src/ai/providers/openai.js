import { config } from "../../config.js";
import { AiError, AI_ERROR_CODES } from "../errors.js";
import { AiProvider, AI_CAPABILITIES, usageFrom } from "./base.js";

/**
 * OpenAI-compatible provider.
 *
 * Speaks the Chat Completions and Images endpoints over plain fetch — no SDK
 * dependency. Any vendor exposing the same shape works by pointing AI_BASE_URL
 * at it. The API key is read from configuration here and nowhere else.
 */
export class OpenAiProvider extends AiProvider {
  constructor(options = {}) {
    super({
      name: "openai",
      model: options.model || config.ai.textModel,
      visionModel: options.visionModel || config.ai.visionModel,
      imageModel: options.imageModel || config.ai.imageModel,
    });
    this.apiKey = options.apiKey || config.ai.apiKey;
    this.baseUrl = (options.baseUrl || config.ai.baseUrl).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs || config.ai.timeoutMs;
    this.maxOutputTokens = options.maxOutputTokens || config.ai.maxOutputTokens;
  }

  capabilities() {
    return [
      AI_CAPABILITIES.TEXT,
      AI_CAPABILITIES.STRUCTURED,
      AI_CAPABILITIES.VISION,
      ...(config.ai.enableImageGeneration ? [AI_CAPABILITIES.IMAGE_GENERATION] : []),
    ];
  }

  async #call(path, body) {
    if (!this.apiKey) {
      throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, "AI_API_KEY is not configured", {
        retryable: false,
        safeMessage: "سرویس هوش مصنوعی پیکربندی نشده است.",
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      throw new AiError(
        AI_ERROR_CODES.AI_PROVIDER_ERROR,
        timedOut ? `AI request timed out after ${this.timeoutMs}ms` : `AI request failed: ${error.message}`,
        { retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // The provider's message is kept for the log only; the customer sees the
      // safe message from the error taxonomy.
      const detail = payload?.error?.message || `HTTP ${response.status}`;
      const permanent = response.status === 400 || response.status === 401 || response.status === 403;
      throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, `AI provider error: ${detail}`, {
        retryable: !permanent,
        meta: { status: response.status },
      });
    }
    return payload;
  }

  #parseJsonContent(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI response contained no content");
    }
    try {
      return JSON.parse(content);
    } catch {
      // Some models wrap JSON in prose or a fenced block; recover the object
      // rather than failing the whole job on formatting.
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch { /* fall through */ }
      }
      throw new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI response was not valid JSON");
    }
  }

  async generateStructured({ system, user, schema, schemaName = "result", model, temperature = 0.7 }) {
    const payload = await this.#call("/chat/completions", {
      model: model || this.model,
      temperature,
      max_tokens: this.maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      response_format: schema
        ? { type: "json_schema", json_schema: { name: schemaName, schema, strict: false } }
        : { type: "json_object" },
    });

    return {
      data: this.#parseJsonContent(payload),
      usage: usageFrom(payload?.usage),
      model: payload?.model || model || this.model,
    };
  }

  async analyzeImages({ system, user, images = [], schema, schemaName = "analysis", model }) {
    const content = [
      { type: "text", text: JSON.stringify(user) },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "low" },
      })),
    ];

    const payload = await this.#call("/chat/completions", {
      model: model || this.visionModel,
      temperature: 0.2,
      max_tokens: this.maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: schema
        ? { type: "json_schema", json_schema: { name: schemaName, schema, strict: false } }
        : { type: "json_object" },
    });

    return {
      data: this.#parseJsonContent(payload),
      usage: usageFrom(payload?.usage),
      model: payload?.model || model || this.visionModel,
    };
  }

  async generateImage({ prompt, size = "1024x1024", model }) {
    this.assertSupports(AI_CAPABILITIES.IMAGE_GENERATION);
    const payload = await this.#call("/images/generations", {
      model: model || this.imageModel,
      prompt,
      size,
      n: 1,
    });

    const first = payload?.data?.[0];
    if (!first?.b64_json) {
      throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, "Image provider returned no image data");
    }
    return {
      buffer: Buffer.from(first.b64_json, "base64"),
      mimeType: "image/png",
      model: model || this.imageModel,
      usage: usageFrom(payload?.usage),
    };
  }
}
