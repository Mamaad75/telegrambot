/**
 * Platform-aware error handling.
 *
 * Every adapter (Telegram, Bale, WhatsApp) converts its failures into a
 * PlatformError so the publication engine, the retry queue and the admin UI all
 * reason about the same categories instead of parsing message strings.
 */

export const ERROR_CATEGORIES = Object.freeze({
  TIMEOUT: "timeout",
  NETWORK: "network",
  RATE_LIMITED: "rate_limited",
  AUTH: "auth",
  NOT_FOUND: "not_found",
  INVALID_REQUEST: "invalid_request",
  SERVER_ERROR: "server_error",
  CONFIG: "config",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown",
});

/** Only transport-ish failures are worth repeating; config errors never fix themselves. */
const RETRYABLE = new Set([
  ERROR_CATEGORIES.TIMEOUT,
  ERROR_CATEGORIES.NETWORK,
  ERROR_CATEGORIES.RATE_LIMITED,
  ERROR_CATEGORIES.SERVER_ERROR,
]);

export class PlatformError extends Error {
  constructor(message, { platform = "", category = ERROR_CATEGORIES.UNKNOWN, status = 0, retryAfterMs = 0, cause } = {}) {
    super(message);
    this.name = "PlatformError";
    this.platform = platform;
    this.category = category;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retryable = RETRYABLE.has(category);
    if (cause) this.cause = cause;
  }
}

export function isRetryableError(error) {
  if (error instanceof PlatformError) return error.retryable;
  // Unclassified errors (bugs, DB issues) are not blindly repeated.
  return false;
}

/** Maps an HTTP status + payload from a Bot-API-shaped response to a category. */
export function categorizeHttpStatus(status, description = "") {
  const text = String(description).toLowerCase();
  if (status === 429) return ERROR_CATEGORIES.RATE_LIMITED;
  if (status === 401 || status === 403) {
    // "chat not found"/"bot is not a member" is a configuration problem even
    // though Telegram answers 403.
    if (/chat not found|not a member|kicked|blocked/.test(text)) return ERROR_CATEGORIES.CONFIG;
    return ERROR_CATEGORIES.AUTH;
  }
  if (status === 404) return ERROR_CATEGORIES.NOT_FOUND;
  if (status === 400) {
    if (/chat not found|chat_id is empty|invalid chat/.test(text)) return ERROR_CATEGORIES.CONFIG;
    return ERROR_CATEGORIES.INVALID_REQUEST;
  }
  if (status >= 500) return ERROR_CATEGORIES.SERVER_ERROR;
  if (status >= 400) return ERROR_CATEGORIES.INVALID_REQUEST;
  return ERROR_CATEGORIES.UNKNOWN;
}

export function categorizeThrown(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").toLowerCase();
  if (name === "AbortError" || /timeout|timed out|etimedout/.test(message)) return ERROR_CATEGORIES.TIMEOUT;
  if (/econnrefused|econnreset|enotfound|eai_again|socket hang up|network|fetch failed/.test(message)) {
    return ERROR_CATEGORIES.NETWORK;
  }
  if (/not configured|missing|is disabled/.test(message)) return ERROR_CATEGORIES.CONFIG;
  return ERROR_CATEGORIES.UNKNOWN;
}

/**
 * JSON HTTP call with a hard timeout, used by every adapter that speaks to a
 * platform REST API. 1.2.0 used bare `fetch`, so a hung platform could hold a
 * webhook request open indefinitely.
 */
export async function fetchJson(url, { timeoutMs = 15000, platform = "", ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new PlatformError(
      categorizeThrown(error) === ERROR_CATEGORIES.TIMEOUT
        ? `${platform || "platform"} request timed out after ${timeoutMs}ms`
        : `${platform || "platform"} request failed: ${error.message}`,
      { platform, category: categorizeThrown(error), cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data, ok: response.ok };
}

export function retryAfterMsFromHeaders(response, data) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const parameter = Number(data?.parameters?.retry_after);
  if (Number.isFinite(parameter) && parameter > 0) return parameter * 1000;
  return 0;
}
