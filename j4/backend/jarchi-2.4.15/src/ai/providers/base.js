import { AiError, AI_ERROR_CODES } from "../errors.js";

/**
 * The interface every AI vendor is reached through.
 *
 * Business logic depends on this shape only. Adding a vendor means adding a
 * subclass here; it must never mean touching the product services.
 */
export const AI_CAPABILITIES = Object.freeze({
  TEXT: "text",
  STRUCTURED: "structured",
  VISION: "vision",
  IMAGE_GENERATION: "image_generation",
  IMAGE_EDIT: "image_edit",
  EMBEDDINGS: "embeddings",
});

export class AiProvider {
  constructor({ name, model, visionModel, imageModel } = {}) {
    this.name = name || "unknown";
    this.model = model || "";
    this.visionModel = visionModel || model || "";
    this.imageModel = imageModel || "";
  }

  /** Capabilities this provider actually implements. */
  capabilities() {
    return [];
  }

  supports(capability) {
    return this.capabilities().includes(capability);
  }

  assertSupports(capability) {
    if (!this.supports(capability)) {
      throw new AiError(
        AI_ERROR_CODES.AI_PROVIDER_ERROR,
        `Provider ${this.name} does not support ${capability}`,
        { retryable: false, safeMessage: "این قابلیت در سرویس هوش مصنوعی فعلی پشتیبانی نمی‌شود." },
      );
    }
  }

  /**
   * Generates JSON matching a schema.
   * @returns {Promise<{ data: object, usage: object, model: string }>}
   */
  async generateStructured() {
    this.assertSupports(AI_CAPABILITIES.STRUCTURED);
  }

  /**
   * Generates JSON from a prompt plus images.
   * @returns {Promise<{ data: object, usage: object, model: string }>}
   */
  async analyzeImages() {
    this.assertSupports(AI_CAPABILITIES.VISION);
  }

  /**
   * Generates an image.
   * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string, usage: object }>}
   */
  async generateImage() {
    this.assertSupports(AI_CAPABILITIES.IMAGE_GENERATION);
  }
}

/** Normalizes provider usage reporting into one shape. */
export const usageFrom = (raw = {}) => ({
  tokens_in: Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0,
  tokens_out: Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0,
});
