/**
 * Audit any URL from the command line, without creating a lead.
 *
 *   npm run audit:url -- https://example.ir
 *   npm run audit:url -- https://example.ir --category "کلینیک زیبایی"
 *   npm run audit:url -- https://example.ir --browser     # add the real-browser layer
 *   npm run audit:url -- https://example.ir --json        # machine-readable
 *
 * Two uses: checking what the audit engine sees on a specific site before a call, and
 * verifying crawler behaviour after changing the checks. It honours robots.txt exactly as
 * the pipeline does, applies the same SSRF rules, and writes nothing to the database.
 */
import 'dotenv/config';
import { auditWebsite, AUDIT_ENGINE_VERSION } from '../src/audit/engine';
import { browserAuditAvailability, runBrowserAudit } from '../src/audit/browser';
import { websiteProvider } from '../src/providers/registry';
import { disconnectRedis } from '../src/lib/redis';
import { closeHttpAgent } from '../src/lib/http';
import { prisma } from '../src/lib/prisma';
import { guardUrl, normalizeUrl } from '../src/lib/url-guard';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

const target = positional[0];
const categoryIndex = argv.indexOf('--category');
const category = categoryIndex >= 0 ? argv[categoryIndex + 1] ?? null : positional[1] ?? null;
const JSON_OUTPUT = flags.has('--json');
const WITH_BROWSER = flags.has('--browser');

const log = (...args: unknown[]) => {
  if (!JSON_OUTPUT) console.log(...args);
};

async function main() {
  if (!target || flags.has('--help')) {
    console.error(
      [
        'Usage: npm run audit:url -- <url> [options]',
        '',
        '  --category <text>   business category, used by the capability checks',
        '  --browser           also run the real-browser layer (needs Playwright)',
        '  --json              machine-readable output',
      ].join('\n'),
    );
    process.exitCode = target ? 0 : 1;
    return;
  }

  /* --- 1. Validate before fetching anything ------------------------------ */
  const normalized = normalizeUrl(target);
  if (!normalized) {
    console.error(`"${target}" is not a usable http(s) URL.`);
    process.exitCode = 1;
    return;
  }

  const guard = await guardUrl(normalized.href);
  if (!guard.allowed) {
    // Refusing here is the same decision the crawler makes inside the pipeline; showing
    // it explicitly is half the point of having this command.
    console.error(`Refused: ${guard.reason}`);
    console.error(`(code: ${guard.code})`);
    process.exitCode = 1;
    return;
  }

  log(`Auditing ${normalized.href}`);
  log(`  resolved to: ${guard.addresses?.join(', ') ?? 'literal address'}`);
  log(`  engine version: ${AUDIT_ENGINE_VERSION}`);
  log('');

  /* --- 2. HTTP audit ------------------------------------------------------ */
  const result = await auditWebsite(normalized.href, websiteProvider(), { businessCategory: category });

  if (result.blockedByRobots) {
    log('This site’s robots.txt asks crawlers not to read it. No audit was performed.');
    if (JSON_OUTPUT) console.log(JSON.stringify({ url: normalized.href, blockedByRobots: true }, null, 2));
    return;
  }

  /* --- 3. Optional browser audit ------------------------------------------ */
  const availability = await browserAuditAvailability();
  const browser = WITH_BROWSER && availability.available ? await runBrowserAudit(normalized.href) : null;

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          url: normalized.href,
          engineVersion: AUDIT_ENGINE_VERSION,
          addresses: guard.addresses,
          http: result,
          browser: browser ?? { status: 'NOT_AVAILABLE', reason: availability.reason },
        },
        null,
        2,
      ),
    );
    return;
  }

  log('reachable:       ', result.reachable, `(HTTP ${result.httpStatus ?? '—'})`);
  log('final URL:       ', result.finalUrl ?? '—');
  log('pages crawled:   ', result.pagesCrawled, `— ${result.totalBytes} bytes, avg ${result.responseMs ?? '—'}ms`);
  log('HTTPS / viewport:', result.hasSsl, '/', result.hasViewport);
  log('scores:          ', JSON.stringify(result.scores));
  log('technologies:    ', result.technologies.map((t) => `${t.name} (${t.confidence})`).join(', ') || '—');
  log('legacy signals:  ', result.legacySignals.join('; ') || '—');

  if (result.unavailableMeasurements.length) {
    log('');
    log('NOT MEASURED (excluded from the scores, never counted as zero):');
    for (const key of result.unavailableMeasurements) log(`  - ${key}`);
  }

  const high = result.findings.filter((f) => f.severity === 'HIGH');
  if (high.length) {
    log('');
    log(`HIGH-SEVERITY FINDINGS (${high.length}):`);
    for (const finding of high) log(`  - ${finding.titleFa}\n      ${finding.evidence}`);
  }

  log('');
  log('BROWSER LAYER');
  if (!WITH_BROWSER) {
    log('  not requested — pass --browser to measure LCP, CLS and mobile rendering');
  } else if (!availability.available) {
    log(`  NOT_AVAILABLE — ${availability.reason}`);
  } else if (browser?.status !== 'OK') {
    log(`  ${browser?.status ?? 'NOT_AVAILABLE'} — ${browser?.unavailableReason ?? 'no measurement'}`);
  } else {
    const show = (label: string, value: number | null, unit = 'ms') =>
      log(`  ${label.padEnd(22)} ${value === null ? 'not measured' : `${value}${unit}`}`);
    show('LCP', browser.lcpMs);
    show('CLS', browser.cls, '');
    show('INP', browser.inpMs);
    show('FCP', browser.fcpMs);
    show('TTFB', browser.ttfbMs);
    log(
      `  ${'fits mobile viewport'.padEnd(22)} ${
        browser.fitsMobileViewport === null
          ? 'not measured'
          : browser.fitsMobileViewport
            ? 'yes'
            : `no — ${browser.horizontalOverflowPx}px of horizontal overflow`
      }`,
    );
    show('smallest font', browser.smallestFontPx, 'px');
    show('small tap targets', browser.smallTapTargets, '');
    log(`  ${'console errors'.padEnd(22)} ${browser.consoleErrors.length}`);
    log(`  ${'failed requests'.padEnd(22)} ${browser.failedRequests.length}`);
  }
  log('');
}

main()
  .catch((err) => {
    console.error('audit failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeHttpAgent().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
  });
