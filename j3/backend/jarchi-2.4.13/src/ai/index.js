import { config } from "./config-bridge.js";
import { AiError, AI_ERROR_CODES } from "./errors.js";
import { OpenAiProvider } from "./providers/openai.js";
import { MockAiProvider } from "./providers/mock.js";

/**
 * Provider selection.
 *
 * Services ask for "the provider" and get whatever the deployment configured.
 * Tests inject the mock through setAiProvider so no test ever needs a real key.
 */
let override = null;
let cached = null;

const FACTORIES = {
  openai: (options) => new OpenAiProvider(options),
  mock: (options) => new MockAiProvider(options),
};

export function setAiProvider(provider) {
  override = provider;
  cached = null;
}

export function resetAiProvider() {
  override = null;
  cached = null;
}

export function getAiProvider() {
  if (override) return override;
  if (cached) return cached;

  if (!config.ai.enabled) {
    throw new AiError(AI_ERROR_CODES.AI_DISABLED, "AI features are disabled (AI_ENABLED=false)", {
      retryable: false,
    });
  }

  const factory = FACTORIES[String(config.ai.provider).toLowerCase()];
  if (!factory) {
    throw new AiError(AI_ERROR_CODES.AI_PROVIDER_ERROR, `Unknown AI provider: ${config.ai.provider}`, {
      retryable: false,
      safeMessage: "سرویس هوش مصنوعی پیکربندی نشده است.",
    });
  }

  cached = factory({});
  return cached;
}

/** True when AI features can actually run, without throwing. */
export function aiAvailable() {
  if (override) return true;
  if (!config.ai.enabled) return false;
  if (String(config.ai.provider).toLowerCase() === "mock") return true;
  return Boolean(config.ai.apiKey);
}

export { AI_CAPABILITIES } from "./providers/base.js";
export { AiError, AI_ERROR_CODES, isAiError, toAiError } from "./errors.js";
