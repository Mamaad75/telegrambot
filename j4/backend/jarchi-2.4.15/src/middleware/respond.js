import { logger } from "../logger.js";
import { safeRequestPath } from "../utils/http.js";

/**
 * One response shape for the whole admin/user API:
 *   success: true  -> { success, data..., request_id }
 *   success: false -> { success, error: { code, message, details? }, request_id }
 */
export function ok(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, request_id: res.req?.requestId || "", ...payload });
}

export function fail(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    request_id: res.req?.requestId || "",
    error: { code, message, ...(details ? { details } : {}) },
  });
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, "bad_request", message, details);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (message) => new ApiError(409, "conflict", message);

/** Wraps async route handlers so rejected promises reach the error handler. */
export const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Terminal error middleware. Database and platform errors are logged in full
 * but never echoed to the client verbatim.
 */
export function errorMiddleware(error, req, res, _next) {
  const status = Number(error?.status) || 500;
  const code = error?.code && typeof error.code === "string" && status < 500 ? error.code : undefined;

  if (status >= 500) {
    logger.error("request failed", {
      request_id: req.requestId,
      method: req.method,
      path: safeRequestPath(req.originalUrl),
      error,
    });
    return fail(res, 500, "internal_error", "خطای داخلی سرور");
  }

  logger.warn("request rejected", {
    request_id: req.requestId,
    method: req.method,
    path: safeRequestPath(req.originalUrl),
    status,
    code: code || "error",
    message: error?.message,
  });
  return fail(res, status, code || "error", error?.message || "Request rejected", error?.details);
}
