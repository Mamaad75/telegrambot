import 'dotenv/config';
import { aiConfigCheck, environmentChecks } from '../src/config/preflight';
import { loadEnv } from '../src/config/env';
import { disconnectRedis } from '../src/lib/redis';
import { prisma } from '../src/lib/prisma';
import { allProviders } from '../src/providers/registry';
import { browserAuditAvailability } from '../src/audit/browser';
import type { BaseProvider } from '../src/providers/types';

/**
 * `npm run providers:check`
 *
 * Answers one question for an operator: **what is actually working right now?**
 *
 * It runs with nothing configured — that is the point. A deployment with no paid API
 * keys at all is a supported configuration, and this command should print a page of
 * NOT_CONFIGURED lines without a single error. Nothing here requires a paid service, and
 * `--live` (which makes real calls) is opt-in precisely because a health check that
 * silently spends money would be a bad surprise.
 */

const ARGS = new Set(process.argv.slice(2));
const LIVE = ARGS.has('--live');
const JSON_OUTPUT = ARGS.has('--json');

type Status = 'HEALTHY' | 'CONFIGURED' | 'NOT_CONFIGURED' | 'DISABLED' | 'ERROR';

interface Row {
  key: string;
  kind: string;
  displayName: string;
  cost: string;
  status: Status;
  detail: string;
  missing: string[];
}

const COLOURS: Record<Status, string> = {
  HEALTHY: '\x1b[32m',
  CONFIGURED: '\x1b[36m',
  NOT_CONFIGURED: '\x1b[90m',
  DISABLED: '\x1b[90m',
  ERROR: '\x1b[31m',
};
const RESET = '\x1b[0m';

function paint(status: Status, text: string): string {
  if (JSON_OUTPUT || !process.stdout.isTTY) return text;
  return `${COLOURS[status]}${text}${RESET}`;
}

async function checkProvider(provider: BaseProvider, enabled: boolean): Promise<Row> {
  const d = provider.descriptor;
  const configured = provider.isConfigured();
  const missing = provider.missingConfig();

  const base: Row = {
    key: d.key,
    kind: d.kind,
    displayName: d.displayName,
    cost: d.cost,
    // Missing configuration outranks the enabled flag in the display. An operator
    // reading "DISABLED" next to Google Places would go looking for a switch to flip,
    // when the actual answer is that no API key has been entered.
    status: !configured ? 'NOT_CONFIGURED' : !enabled ? 'DISABLED' : 'CONFIGURED',
    detail: !configured
      ? `missing: ${missing.join(', ') || 'configuration'}`
      : enabled
        ? 'credentials present'
        : 'credentials present, switched off in Settings → Integrations',
    missing,
  };

  // A live probe costs a real request, and for a paid provider that is real money.
  // Only on request.
  if (!LIVE || !configured || !enabled || !provider.healthCheck) return base;

  try {
    const result = await provider.healthCheck();
    return { ...base, status: result.ok ? 'HEALTHY' : 'ERROR', detail: result.message };
  } catch (err) {
    return { ...base, status: 'ERROR', detail: err instanceof Error ? err.message : 'health check threw' };
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  // Database state is optional here: the command must work before the first migration,
  // when somebody is checking their .env for the first time.
  let enabledByKey = new Map<string, boolean>();
  let databaseReachable = true;
  try {
    const rows = await prisma.provider.findMany({ select: { key: true, enabled: true } });
    enabledByKey = new Map(rows.map((r) => [r.key, r.enabled]));
  } catch {
    databaseReachable = false;
  }

  const providers = allProviders();
  const rows: Row[] = [];
  for (const provider of providers) {
    const enabled = enabledByKey.get(provider.descriptor.key) ?? true;
    rows.push(await checkProvider(provider, enabled));
  }

  const infrastructure = environmentChecks(env);
  const ai = aiConfigCheck(env);
  const browser = await browserAuditAvailability();

  if (JSON_OUTPUT) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ infrastructure, ai, browser, providers: rows, live: LIVE }, null, 2));
    return;
  }

  const line = '─'.repeat(78);
  const out = (s = '') => process.stdout.write(`${s}\n`);

  out();
  out('  BAIMAR LEAD INTELLIGENCE — provider check');
  out(`  mode: ${LIVE ? 'live (real requests are being made)' : 'configuration only (no requests made)'}`);
  out(line);

  out();
  out('  INFRASTRUCTURE');
  for (const check of infrastructure) {
    const status: Status = check.status === 'CONFIGURED' ? 'CONFIGURED' : 'ERROR';
    out(`    ${paint(status, check.status.padEnd(16))} ${check.label.padEnd(34)} ${check.detail}`);
  }
  if (!databaseReachable) {
    out(`    ${paint('ERROR', 'UNREACHABLE'.padEnd(16))} ${'Database connection'.padEnd(34)} could not read the Provider table`);
  }

  const byKind = new Map<string, Row[]>();
  for (const row of rows) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, []);
    byKind.get(row.kind)!.push(row);
  }

  for (const [kind, group] of byKind) {
    out();
    out(`  ${kind.replace(/_/g, ' ')}`);
    for (const row of group.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      out(
        `    ${paint(row.status, row.status.padEnd(16))} ${row.displayName.padEnd(34)} ${row.cost.padEnd(9)} ${row.detail}`,
      );
    }
  }

  out();
  out('  OPTIONAL LAYERS');
  out(`    ${paint(ai.status === 'CONFIGURED' ? 'CONFIGURED' : 'NOT_CONFIGURED', ai.status.padEnd(16))} ${ai.label.padEnd(34)} ${ai.detail}`);
  out(
    `    ${paint(browser.available ? 'CONFIGURED' : 'NOT_CONFIGURED', (browser.available ? 'AVAILABLE' : 'NOT_AVAILABLE').padEnd(16))} ${'Browser audit'.padEnd(34)} ${browser.reason}`,
  );

  const configured = rows.filter((r) => r.status === 'CONFIGURED' || r.status === 'HEALTHY').length;
  const errored = rows.filter((r) => r.status === 'ERROR');

  out();
  out(line);
  out(`  ${configured} of ${rows.length} providers configured; ${errored.length} reporting an error.`);
  if (!LIVE) out('  Add --live to make one real request per configured provider.');

  // Not configured is not a failure. The platform is designed to run on OpenStreetMap,
  // CSV import and its own crawler, with no paid key at all — so the exit code is only
  // non-zero when something that IS configured is broken, or infrastructure is missing.
  const infrastructureBroken = infrastructure.some((c) => c.mandatory && c.status !== 'CONFIGURED');
  if (infrastructureBroken) {
    out();
    out('  Mandatory infrastructure is not usable. Fix DATABASE_URL / REDIS_URL / secrets first.');
  }
  if (errored.length > 0) {
    out();
    out('  Providers reporting an error:');
    for (const row of errored) out(`    - ${row.displayName}: ${row.detail}`);
  }
  out();

  process.exitCode = infrastructureBroken || errored.length > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('provider check failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
  });
