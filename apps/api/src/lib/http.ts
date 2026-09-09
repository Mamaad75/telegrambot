import { Agent, fetch as undiciFetch } from 'undici';
import { loadEnv } from '../config/env';
import { ProviderError } from './errors';
import { guardUrl, guardedLookup } from './url-guard';

/**
 * Dispatcher used for every fetch of an attacker-influenced URL.
 *
 * The custom `lookup` validates the address at the moment the socket connects, so a
 * hostname cannot resolve to a public address for our pre-check and to 127.0.0.1 for
 * the actual connection (DNS rebinding). Built lazily because it reads configuration.
 */
let guardedAgent: Agent | null = null;
function getGuardedAgent(): Agent {
  if (!guardedAgent) {
    guardedAgent = new Agent({
      connect: { lookup: guardedLookup as never, timeout: 10_000 },
      // A crawl is many hosts, one or two requests each; long-lived pools only tie up memory.
      keepAliveTimeout: 5_000,
      keepAliveMaxTimeout: 10_000,
    });
  }
  return guardedAgent;
}

/** Release the guarded connection pool (tests and graceful shutdown). */
export async function closeHttpAgent(): Promise<void> {
  if (guardedAgent) {
    await guardedAgent.close().catch(() => undefined);
    guardedAgent = null;
  }
}

/**
 * Content types the crawler is willing to parse.
 *
 * Anything else — an installer, an archive, a video — is a download, not a web page, and
 * is refused before the body is read. This is both a safety rule and a bandwidth rule.
 */
const PARSEABLE_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/xml',
  'application/xml',
  'application/json',
  'application/rss+xml',
  'application/atom+xml',
  'text/css',
  'application/javascript',
  'text/javascript',
];

export function isParseableContentType(contentType: string | undefined): boolean {
  if (!contentType) return true; // no header: decided by what the body actually contains
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return PARSEABLE_CONTENT_TYPES.includes(mime);
}

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
  /**
   * Validate the URL — and every redirect hop — against the SSRF rules, and connect
   * through the guarded dispatcher.
   *
   * Switch this on for anything a user or a third party influenced: a lead's website,
   * a link found while crawling, a URL from an uploaded CSV. Leave it off for calls to
   * a provider endpoint an administrator configured deliberately, since one of those
   * (a local model server on 127.0.0.1) is legitimately private.
   */
  ssrfGuard?: boolean;
  /** Redirect hops to follow when `ssrfGuard` is on. Defaults to CRAWLER_MAX_REDIRECTS. */
  maxRedirects?: number;
  /** Refuse bodies whose content-type is not parseable as a web document. */
  requireParseableContentType?: boolean;
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
  const maxRedirects = opts.maxRedirects ?? env.CRAWLER_MAX_REDIRECTS;
  const providerKey = opts.providerKey ?? 'http';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    try {
      const res = opts.ssrfGuard
        ? await guardedFetch(url, opts, controller.signal, env.CRAWLER_USER_AGENT, maxRedirects)
        : await fetch(url, {
            method: opts.method ?? 'GET',
            headers: { 'user-agent': env.CRAWLER_USER_AGENT, ...(opts.headers ?? {}) },
            body: opts.body,
            signal: controller.signal,
            redirect: opts.redirect ?? 'follow',
          });

      if (opts.requireParseableContentType && !isParseableContentType(res.headers.get('content-type') ?? undefined)) {
        // Never download an executable, an archive or a video: cancel before reading.
        await res.body?.cancel().catch(() => undefined);
        throw new ProviderError(
          providerKey,
          `Refusing to download ${res.headers.get('content-type')} from ${new URL(url).host} — not a web document.`,
          { retryable: false },
        );
      }

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
      // A refusal by the SSRF guard is a permanent verdict, not a transient fault:
      // retrying it would only repeat the same decision three times.
      if (err instanceof ProviderError && !err.retryable) throw err;
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

/**
 * Fetch with the SSRF guard applied to the initial URL and to every redirect hop.
 *
 * Redirects are followed by hand rather than by `fetch`, because `redirect: 'follow'`
 * hides the intermediate URLs: a permitted page that 302s to
 * http://169.254.169.254/latest/meta-data/ would be fetched with nobody looking. Each
 * hop here is re-validated as if a user had typed it.
 */
async function guardedFetch(
  url: string,
  opts: HttpRequestOptions,
  signal: AbortSignal,
  userAgent: string,
  maxRedirects: number,
): Promise<Response> {
  const providerKey = opts.providerKey ?? 'http';
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await guardUrl(current);
    if (!verdict.allowed) {
      throw new ProviderError(providerKey, `Blocked: ${verdict.reason ?? 'unsafe URL'}`, {
        retryable: false,
        statusCode: 400,
      });
    }

    // undici's own fetch, not the global one: the dispatcher must come from the same
    // copy of undici that consumes it, and this way the guarded Agent is guaranteed to
    // be the one doing the connecting. The Response it returns is API-compatible with
    // the global Response, which is all the caller uses.
    const res = (await undiciFetch(verdict.url!.href, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': userAgent, ...(opts.headers ?? {}) },
      body: opts.body,
      signal,
      redirect: 'manual',
      dispatcher: getGuardedAgent(),
    })) as unknown as Response;

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      if (hop === maxRedirects) {
        throw new ProviderError(providerKey, `Too many redirects (more than ${maxRedirects}) from ${url}`, {
          retryable: false,
        });
      }
      // A relative Location is resolved against the hop we just fetched.
      try {
        current = new URL(location, verdict.url!.href).toString();
      } catch {
        throw new ProviderError(providerKey, `Unusable redirect target "${location}"`, { retryable: false });
      }
      continue;
    }

    // `res.url` is empty under redirect: 'manual'; report the URL actually fetched.
    Object.defineProperty(res, 'url', { value: verdict.url!.href, configurable: true });
    return res;
  }

  throw new ProviderError(providerKey, `Too many redirects from ${url}`, { retryable: false });
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
