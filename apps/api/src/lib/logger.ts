import { loadEnv } from '../config/env';

export interface LoggerOptions {
  level: string;
  transport?: { target: string; options?: Record<string, unknown> };
  redact?: string[];
}

/**
 * Pino options shared by the HTTP server and the worker.
 * `redact` guarantees credentials never reach the log stream.
 */
export function loggerOptions(): LoggerOptions {
  const e = loadEnv();
  return {
    level: e.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.passwordHash',
      '*.apiKey',
      '*.secrets',
      '*.refreshToken',
      '*.accessToken',
    ],
  };
}
