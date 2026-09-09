import pino from 'pino';
import { loadEnv } from '../config/env';

export interface LoggerOptions {
  level: string;
  transport?: { target: string; options?: Record<string, unknown> };
  redact?: string[];
}

/**
 * Fields stripped from every log line, in the HTTP server and the worker alike.
 *
 * This list is the reason a stack trace can be pasted into a ticket without leaking a
 * credential: an object carrying `apiKey` or `secrets` still logs, but with the value
 * replaced. Add to it whenever a new secret-bearing shape appears.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  '*.passwordHash',
  '*.apiKey',
  '*.api_key',
  '*.secrets',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  'DATABASE_URL',
  'JWT_SECRET',
  'APP_ENCRYPTION_KEY',
];

/** Pino options shared by the HTTP server and the worker. */
export function loggerOptions(): LoggerOptions {
  const e = loadEnv();
  return { level: e.LOG_LEVEL, redact: REDACTED_PATHS };
}

/**
 * The logger used outside a request: workers, schedules, services, CLI scripts.
 *
 * Structured on purpose. Every interesting operation carries the identifiers needed to
 * follow it afterwards — `requestId`, `jobId`, `leadId`, `campaignId`, `runId`,
 * `providerKey` — so a complaint like "this lead never got a score" can be answered by
 * one query over the logs instead of by guesswork.
 *
 *     logger.info({ leadId, jobId, stage: 'audit_website' }, 'audit finished');
 *
 * Prefer `jobLogger(...)` / `leadLogger(...)` below, which bind those fields once.
 */
export const logger: pino.Logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: REDACTED_PATHS,
  base: { service: 'baimar' },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/** Context carried through a background job, so one line identifies the whole run. */
export interface JobLogContext {
  jobId?: string;
  jobName?: string;
  leadId?: string;
  campaignId?: string;
  runId?: string;
  providerKey?: string;
  requestId?: string;
}

/** A child logger with the job's identifiers bound to every line it writes. */
export function jobLogger(context: JobLogContext): pino.Logger {
  const clean = Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined && v !== null));
  return logger.child(clean);
}
