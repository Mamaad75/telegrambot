/** Application error carrying an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const tooManyRequests = (msg = 'Rate limit exceeded') => new AppError(429, 'RATE_LIMITED', msg);
export const serviceUnavailable = (msg: string) => new AppError(503, 'SERVICE_UNAVAILABLE', msg);

/**
 * Error raised by a provider adapter. Provider failures are contained: the caller
 * decides whether to fall back to another adapter or to continue without the data.
 */
export class ProviderError extends Error {
  readonly providerKey: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(providerKey: string, message: string, opts: { retryable?: boolean; statusCode?: number } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.providerKey = providerKey;
    this.retryable = opts.retryable ?? false;
    this.statusCode = opts.statusCode;
  }
}
