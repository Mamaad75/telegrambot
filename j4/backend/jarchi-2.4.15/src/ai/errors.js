/**
 * Error taxonomy for the AI product domain.
 *
 * Every failure that leaves this domain carries a category, a safe
 * customer-facing message, and (separately) the technical detail that goes to
 * the log. Raw provider errors never reach a customer response.
 */

export const AI_ERROR_CODES = Object.freeze({
  AI_PROVIDER_ERROR: "AI_PROVIDER_ERROR",
  AI_VALIDATION_ERROR: "AI_VALIDATION_ERROR",
  AI_QUOTA_ERROR: "AI_QUOTA_ERROR",
  AI_DISABLED: "AI_DISABLED",
  IMAGE_VALIDATION_ERROR: "IMAGE_VALIDATION_ERROR",
  MEDIA_UPLOAD_ERROR: "MEDIA_UPLOAD_ERROR",
  WORDPRESS_AUTH_ERROR: "WORDPRESS_AUTH_ERROR",
  WORDPRESS_API_ERROR: "WORDPRESS_API_ERROR",
  WOOCOMMERCE_API_ERROR: "WOOCOMMERCE_API_ERROR",
  PRODUCT_VALIDATION_ERROR: "PRODUCT_VALIDATION_ERROR",
  JOB_ERROR: "JOB_ERROR",
  PERMISSION_ERROR: "PERMISSION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
});

/** Messages shown to customers; details stay in the logs. */
const SAFE_MESSAGES = Object.freeze({
  AI_PROVIDER_ERROR: "سرویس هوش مصنوعی در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
  AI_VALIDATION_ERROR: "خروجی هوش مصنوعی معتبر نبود؛ لطفاً دوباره تولید کنید.",
  AI_QUOTA_ERROR: "سهمیه هوش مصنوعی شما در این دوره تمام شده است.",
  AI_DISABLED: "قابلیت هوش مصنوعی در این نصب فعال نیست.",
  IMAGE_VALIDATION_ERROR: "تصویر ارسالی معتبر نیست.",
  MEDIA_UPLOAD_ERROR: "بارگذاری تصویر در وردپرس انجام نشد.",
  WORDPRESS_AUTH_ERROR: "اتصال به وردپرس با اطلاعات فعلی برقرار نشد.",
  WORDPRESS_API_ERROR: "ارتباط با وردپرس ناموفق بود.",
  WOOCOMMERCE_API_ERROR: "ارتباط با ووکامرس ناموفق بود.",
  PRODUCT_VALIDATION_ERROR: "اطلاعات محصول کامل یا معتبر نیست.",
  JOB_ERROR: "پردازش این درخواست انجام نشد.",
  PERMISSION_ERROR: "دسترسی لازم را ندارید.",
  NOT_FOUND: "موردی یافت نشد.",
  CONFLICT: "این عملیات در وضعیت فعلی قابل انجام نیست.",
});

/** Categories a repeat could plausibly fix. */
const RETRYABLE = new Set([
  AI_ERROR_CODES.AI_PROVIDER_ERROR,
  AI_ERROR_CODES.WORDPRESS_API_ERROR,
  AI_ERROR_CODES.WOOCOMMERCE_API_ERROR,
  AI_ERROR_CODES.MEDIA_UPLOAD_ERROR,
  AI_ERROR_CODES.JOB_ERROR,
]);

const HTTP_STATUS = Object.freeze({
  AI_QUOTA_ERROR: 402,
  AI_DISABLED: 503,
  PERMISSION_ERROR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  AI_VALIDATION_ERROR: 422,
  PRODUCT_VALIDATION_ERROR: 400,
  IMAGE_VALIDATION_ERROR: 400,
  WORDPRESS_AUTH_ERROR: 400,
});

export class AiError extends Error {
  /**
   * @param {string} code     one of AI_ERROR_CODES
   * @param {string} detail   technical detail for logs (never sent to the client)
   * @param {object} options  { status, retryable, safeMessage, cause, meta }
   */
  constructor(code, detail = "", options = {}) {
    super(detail || SAFE_MESSAGES[code] || code);
    this.name = "AiError";
    this.code = AI_ERROR_CODES[code] ? code : AI_ERROR_CODES.JOB_ERROR;
    this.detail = detail;
    this.safeMessage = options.safeMessage || SAFE_MESSAGES[this.code] || SAFE_MESSAGES.JOB_ERROR;
    this.status = options.status || HTTP_STATUS[this.code] || 500;
    this.retryable = options.retryable === undefined ? RETRYABLE.has(this.code) : Boolean(options.retryable);
    this.meta = options.meta || {};
    if (options.cause) this.cause = options.cause;
  }

  /** The only shape that may be returned to a customer. */
  toResponse() {
    return { success: false, error: this.safeMessage, error_code: this.code };
  }
}

export const isAiError = (error) => error instanceof AiError;

/** Wraps an unknown throwable so nothing unclassified escapes the domain. */
export function toAiError(error, fallbackCode = AI_ERROR_CODES.JOB_ERROR) {
  if (isAiError(error)) return error;
  return new AiError(fallbackCode, String(error?.message || error), { cause: error });
}
