import { loadEnv } from '../config/env';
import { ProviderError } from './errors';

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  /** Number of retries for transient failures (429 / 5xx / network). */
  retries?: number;
  retryBaseMs?: number;
  /** Stop reading once this many bytes have arrived. */
  maxBytes?: number;
  signal?: AbortSignal;
  redirect?: 'follow' | 'manual';
  providerKey?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  url: string;
  redirected: boolean;
  durationMs: number;
  truncated: boolean;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Single HTTP entry point for every outbound call.
 *
 * Provides: timeouts, byte caps, exponential backoff with jitter for transient
 * failures, and a uniform error type so a failing provider never propagates a raw
 * fetch rejection into the request pipeline.
 */
export async function httpRequest(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  const env = loadEnv();
  const timeoutMs = opts.timeoutMs ?? env.CRAWLER_TIMEOUT_MS;
  const retries = opts.retries ?? 2;
  const retryBase = opts.retryBaseMs ?? 500;
  const maxBytes = opts.maxBytes ?? env.CRAWLER_MAX_BYTES;
  const providerKey = opts.providerKey ?? 'http';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': env.CRAWLER_USER_AGENT, ...(opts.headers ?? {}) },
        body: opts.body,
        signal: controller.signal,
        redirect: opts.redirect ?? 'follow',
      });

      const { text, bytes, truncated } = await readBody(res, maxBytes);
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });

      const response: HttpResponse = {
        status: res.status,
        ok: res.ok,
        headers,
        body: text,
        bytes,
        url: res.url || url,
        redirected: res.redirected,
        durationMs: Date.now() - started,
        truncated,
      };

      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        const retryAfter = Number(headers['retry-after']);
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : backoff(retryBase, attempt);
        await sleep(delay);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const aborted = lastError.name === 'AbortError';
      if (attempt < retries && !opts.signal?.aborted) {
        await sleep(backoff(retryBase, attempt));
        continue;
      }
      throw new ProviderError(providerKey, aborted ? `Request timed out after ${timeoutMs}ms` : lastError.message, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new ProviderError(providerKey, lastError?.message ?? 'Request failed', { retryable: true });
}

function backoff(base: number, attempt: number): number {
  const exp = base * 2 ** attempt;
  return Math.min(exp + Math.random() * base, 15_000);
}

async function readBody(res: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text();
    return { text, bytes: Buffer.byteLength(text), truncated: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf8'), bytes: total, truncated };
}

/** Convenience wrapper: parse a JSON response, raising a ProviderError on malformed input. */
export async function httpJson<T>(url: string, opts: HttpRequestOptions = {}): Promise<{ data: T; response: HttpResponse }> {
  const response = await httpRequest(url, {
    ...opts,
    headers: { accept: 'application/json', ...(opts.headers ?? {}) },
  });
  if (!response.ok) {
    throw new ProviderError(
      opts.providerKey ?? 'http',
      `HTTP ${response.status} from ${new URL(url).host}: ${response.body.slice(0, 300)}`,
      { retryable: RETRYABLE_STATUS.has(response.status), statusCode: response.status },
    );
  }
  try {
    return { data: JSON.parse(response.body) as T, response };
  } catch {
    throw new ProviderError(opts.providerKey ?? 'http', 'Response was not valid JSON', { retryable: false });
  }
}
