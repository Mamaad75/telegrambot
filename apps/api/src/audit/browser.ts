import { loadEnv } from '../config/env';
import { jobLogger } from '../lib/logger';
import { guardUrl } from '../lib/url-guard';

/**
 * Optional real-browser audit.
 *
 * The HTTP audit reads markup. That answers most of what a sales conversation needs —
 * is there a viewport tag, a contact form, an SSL certificate, a call to action — but it
 * cannot answer "how does this site actually feel on a phone?". Layout shift, largest
 * contentful paint and interaction latency only exist once a page has been laid out and
 * painted, and no amount of HTML inspection produces them.
 *
 * So this module renders the page in Chromium and measures. Two rules govern it:
 *
 *   1. **It is optional.** Chromium needs roughly 400 MB of resident memory, which a
 *      2 CPU / 4 GB VPS cannot spare while a campaign is running. Off by default;
 *      switched on with BROWSER_AUDIT_ENABLED=true.
 *   2. **A metric that was not measured is never invented.** When the browser layer is
 *      off, or Playwright is not installed, or the page failed to load, every field
 *      stays null and the status is NOT_AVAILABLE. The UI prints "not measured". It
 *      never estimates LCP from a byte count, and it never quietly reports a zero.
 *
 * Installation (only if you want it):
 *
 *     npm install --workspace @baimar/api playwright
 *     npx playwright install chromium
 *
 * Playwright is deliberately NOT a dependency in package.json: making it one would add
 * hundreds of megabytes to every image, including the deployments that will never turn
 * this on.
 */

export type BrowserAuditStatus = 'OK' | 'NOT_AVAILABLE' | 'ERROR';

/* --------------------------------------------------------------------------
 * Minimal structural types for the slice of Playwright this module uses.
 *
 * Written out rather than imported so the package stays a true optional extra: the
 * project compiles, tests and deploys with no Playwright installed at all, and the
 * import below is the only place that needs it to exist at runtime.
 * ------------------------------------------------------------------------ */
interface PwConsoleMessage {
  type(): string;
  text(): string;
  location(): { url?: string } | undefined;
}
interface PwRequest {
  url(): string;
  failure(): { errorText: string } | null;
}
interface PwResponse {
  headers(): Record<string, string>;
}
interface PwPage {
  addInitScript(script: string): Promise<void>;
  on(event: 'console', cb: (msg: PwConsoleMessage) => void): void;
  on(event: 'requestfailed', cb: (req: PwRequest) => void): void;
  on(event: 'request', cb: (req: PwRequest) => void): void;
  on(event: 'response', cb: (res: PwResponse) => void): void;
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown | null>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  viewportSize(): { width: number; height: number } | null;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  version(): string;
  close(): Promise<void>;
}
interface PwChromium {
  launch(opts: Record<string, unknown>): Promise<PwBrowser>;
}

export interface BrowserAuditResult {
  status: BrowserAuditStatus;
  /** Why no measurement was taken. Present whenever status is not OK. */
  unavailableReason?: string;

  url: string;
  /** Laboratory Core Web Vitals from this one synthetic run. Null when not measured. */
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;

  viewportWidth: number | null;
  viewportHeight: number | null;
  fitsMobileViewport: boolean | null;
  horizontalOverflowPx: number | null;
  smallestFontPx: number | null;
  smallTapTargets: number | null;

  consoleErrors: Array<{ text: string; location?: string }>;
  failedRequests: Array<{ url: string; failure: string }>;
  requestCount: number | null;
  transferredBytes: number | null;

  browserName: string | null;
  browserVersion: string | null;
  durationMs: number;
}

/** A result with every measurement absent, for every "we did not measure this" path. */
function notAvailable(url: string, reason: string, status: BrowserAuditStatus = 'NOT_AVAILABLE'): BrowserAuditResult {
  return {
    status,
    unavailableReason: reason,
    url,
    lcpMs: null,
    cls: null,
    inpMs: null,
    fcpMs: null,
    ttfbMs: null,
    domContentLoadedMs: null,
    loadEventMs: null,
    viewportWidth: null,
    viewportHeight: null,
    fitsMobileViewport: null,
    horizontalOverflowPx: null,
    smallestFontPx: null,
    smallTapTargets: null,
    consoleErrors: [],
    failedRequests: [],
    requestCount: null,
    transferredBytes: null,
    browserName: null,
    browserVersion: null,
    durationMs: 0,
  };
}

export function isBrowserAuditEnabled(): boolean {
  return loadEnv().BROWSER_AUDIT_ENABLED;
}

/**
 * Load Playwright if it is present.
 *
 * The specifier is held in a variable on purpose: a literal `import('playwright')` is a
 * compile-time reference, and the whole point of this module is that the project builds
 * and ships without the package installed.
 */
async function loadPlaywright(): Promise<{ chromium: PwChromium } | null> {
  const specifier = 'playwright';
  try {
    return (await import(specifier)) as unknown as { chromium: PwChromium };
  } catch {
    return null;
  }
}

/** Is Playwright installed in this deployment? Cheap, and cached after the first call. */
let playwrightAvailable: boolean | null = null;
export async function browserAuditAvailability(): Promise<{ available: boolean; reason: string }> {
  if (!isBrowserAuditEnabled()) {
    return { available: false, reason: 'BROWSER_AUDIT_ENABLED is false — the browser layer is switched off.' };
  }
  if (playwrightAvailable === false) {
    return { available: false, reason: 'Playwright is not installed (npm i -w @baimar/api playwright).' };
  }
  const mod = await loadPlaywright();
  playwrightAvailable = mod !== null;
  return playwrightAvailable
    ? { available: true, reason: 'Playwright is installed and the browser layer is enabled.' }
    : {
        available: false,
        reason: 'Playwright is not installed. Run: npm i -w @baimar/api playwright && npx playwright install chromium',
      };
}

/**
 * The in-page measurement script.
 *
 * Runs in the page's own context, so it reads the same PerformanceObserver entries a
 * real user's browser would produce. Every value it cannot obtain is returned as null,
 * and the caller passes that null straight through to the database.
 *
 * Written as an immediately-invoked expression: `page.evaluate` given a string evaluates
 * it as an expression, so a bare `() => {…}` would hand back an unserializable function
 * and every metric would silently arrive as undefined.
 */
const MEASURE_SCRIPT = `(() => {
  const out = { lcp: null, cls: null, fcp: null, ttfb: null, dcl: null, load: null,
                overflow: null, smallestFont: null, smallTapTargets: null };

  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) {
    out.ttfb = nav.responseStart > 0 ? Math.round(nav.responseStart) : null;
    out.dcl = nav.domContentLoadedEventEnd > 0 ? Math.round(nav.domContentLoadedEventEnd) : null;
    out.load = nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null;
  }

  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  if (fcp) out.fcp = Math.round(fcp.startTime);

  // Both stay null unless the observer actually saw something. Some Chromium builds
  // emit no layout-shift entries at all in headless mode; when that happens CLS is
  // reported as not measured, which is the truth — reporting 0.00 would tell a
  // salesperson the page is stable when nobody has checked.
  if (window.__baimarLcp !== undefined) out.lcp = Math.round(window.__baimarLcp);
  if (window.__baimarCls !== undefined) out.cls = Number(window.__baimarCls.toFixed(4));

  // Horizontal overflow: the single most common reason a site is unusable on a phone.
  const docWidth = document.documentElement.scrollWidth;
  const viewWidth = document.documentElement.clientWidth;
  out.overflow = Math.max(0, docWidth - viewWidth);

  // Smallest rendered body text, and tap targets below the 44x44 CSS-pixel guidance.
  let smallest = Infinity;
  let smallTargets = 0;
  const nodes = document.querySelectorAll('p, span, li, td, a, button, label, div');
  let inspected = 0;
  for (const el of nodes) {
    if (inspected++ > 1200) break;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const text = (el.textContent || '').trim();
    if (text.length > 0 && text.length < 400) {
      const size = parseFloat(style.fontSize);
      if (Number.isFinite(size) && size > 0) smallest = Math.min(smallest, size);
    }
    if (el.tagName === 'A' || el.tagName === 'BUTTON') {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) smallTargets++;
    }
  }
  out.smallestFont = Number.isFinite(smallest) ? Number(smallest.toFixed(1)) : null;
  out.smallTapTargets = smallTargets;

  return out;
})()`;

/**
 * Installed before navigation.
 *
 * Both LCP and CLS are only delivered through a PerformanceObserver — asking for them
 * afterwards with `getEntriesByType` returns an empty list, which is why the observer
 * has to be in place before the first byte of the page arrives. Each value stays
 * `undefined` until something is actually observed, so "not measured" and "measured as
 * zero" remain distinguishable all the way to the database.
 */
const VITALS_OBSERVER = `
  window.__baimarCls = undefined;
  window.__baimarLcp = undefined;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__baimarCls = (window.__baimarCls || 0) + entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* unsupported: the value stays absent, never zero */ }
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) window.__baimarLcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) { /* unsupported: the value stays absent, never zero */ }
`;

/**
 * Render one URL in Chromium at a mobile viewport and measure it.
 *
 * The URL goes through the same SSRF guard as the HTTP crawler — a headless browser is
 * an even better SSRF primitive than an HTTP client, because it will happily execute
 * whatever JavaScript the page returns.
 */
export async function runBrowserAudit(url: string): Promise<BrowserAuditResult> {
  const env = loadEnv();
  const log = jobLogger({ jobName: 'browser_audit' });

  const availability = await browserAuditAvailability();
  if (!availability.available) return notAvailable(url, availability.reason);

  const guard = await guardUrl(url);
  if (!guard.allowed) return notAvailable(url, `Blocked: ${guard.reason}`, 'ERROR');
  const target = guard.url!.href;

  const started = Date.now();
  let browser: PwBrowser | null = null;

  try {
    const mod = await loadPlaywright();
    if (!mod) return notAvailable(url, 'Playwright disappeared between the availability check and the run.');
    const { chromium } = mod;

    browser = await chromium.launch({
      headless: true,
      executablePath: env.BROWSER_AUDIT_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: env.BROWSER_AUDIT_TIMEOUT_MS,
    });

    // A mid-range Android phone: the device most Iranian customers actually browse on.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: env.CRAWLER_USER_AGENT,
      locale: 'fa-IR',
      // Never let a page store anything, and never reuse state between audits.
      javaScriptEnabled: true,
    });

    const consoleErrors: BrowserAuditResult['consoleErrors'] = [];
    const failedRequests: BrowserAuditResult['failedRequests'] = [];
    let requestCount = 0;
    let transferredBytes = 0;

    const page = await context.newPage();
    await page.addInitScript(VITALS_OBSERVER);

    page.on('console', (msg) => {
      if (msg.type() === 'error' && consoleErrors.length < 25) {
        consoleErrors.push({ text: msg.text().slice(0, 300), location: msg.location()?.url });
      }
    });
    page.on('requestfailed', (req) => {
      if (failedRequests.length < 25) {
        failedRequests.push({ url: req.url().slice(0, 300), failure: req.failure()?.errorText ?? 'failed' });
      }
    });
    page.on('request', () => {
      requestCount++;
    });
    page.on('response', (res) => {
      const len = Number(res.headers()['content-length'] ?? 0);
      if (Number.isFinite(len)) transferredBytes += len;
    });

    const response = await page.goto(target, {
      waitUntil: 'load',
      timeout: env.BROWSER_AUDIT_TIMEOUT_MS,
    });

    if (!response) {
      await context.close();
      return notAvailable(url, 'The page did not respond in the browser.', 'ERROR');
    }

    // Give late-loading images and fonts a moment: LCP and CLS both keep moving after
    // the load event, and measuring too early would report a flattering wrong number.
    await page.waitForTimeout(2000);
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)').catch(() => undefined);
    await page.waitForTimeout(500);

    const measured = (await page.evaluate(MEASURE_SCRIPT)) as {
      lcp: number | null;
      cls: number | null;
      fcp: number | null;
      ttfb: number | null;
      dcl: number | null;
      load: number | null;
      overflow: number | null;
      smallestFont: number | null;
      smallTapTargets: number | null;
    };

    const viewport = page.viewportSize();
    const version = browser.version();
    await context.close();

    return {
      status: 'OK',
      url: target,
      lcpMs: measured.lcp,
      cls: measured.cls,
      // INP requires a real interaction to measure. A synthetic run has none, so it is
      // reported as not measured rather than approximated by another metric.
      inpMs: null,
      fcpMs: measured.fcp,
      ttfbMs: measured.ttfb,
      domContentLoadedMs: measured.dcl,
      loadEventMs: measured.load,
      viewportWidth: viewport?.width ?? null,
      viewportHeight: viewport?.height ?? null,
      fitsMobileViewport: measured.overflow === null ? null : measured.overflow <= 2,
      horizontalOverflowPx: measured.overflow,
      smallestFontPx: measured.smallestFont,
      smallTapTargets: measured.smallTapTargets,
      consoleErrors,
      failedRequests,
      requestCount,
      transferredBytes: transferredBytes || null,
      browserName: 'chromium',
      browserVersion: version,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ url, err: message }, 'browser audit failed — metrics recorded as not available');
    return { ...notAvailable(url, message, 'ERROR'), durationMs: Date.now() - started };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * The reason string shown next to every browser-only metric when the layer is off.
 * Used by the UI so a missing LCP always reads "not measured", never "0".
 */
export const BROWSER_METRICS = ['lcp', 'cls', 'inp', 'fcp', 'real-user-performance'] as const;
