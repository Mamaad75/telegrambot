import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../src/config/env';
import { environmentChecks, productionSecretProblems, redactUrl } from '../src/config/preflight';
import { prisma } from '../src/lib/prisma';
import { disconnectRedis, redis, redisHealthy } from '../src/lib/redis';
import { closeQueues, queueHealth } from '../src/queue/queues';
import { allProviders } from '../src/providers/registry';

/**
 * `npm run production:check`
 *
 * The gate to run on the server before `docker compose up`, and again afterwards.
 *
 * Every check answers a question that has an operational consequence, and each failure
 * says what to do about it. The command is deliberately blunt: it reports FAIL for
 * anything that would bite in production, and its exit code is meant for CI.
 *
 * It never writes anything, never sends anything, and never spends money.
 */

type Result = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

interface Check {
  group: string;
  name: string;
  result: Result;
  detail: string;
  /** What to do about it. Omitted when the check passed. */
  fix?: string;
}

const checks: Check[] = [];
const add = (group: string, name: string, result: Result, detail: string, fix?: string) =>
  checks.push({ group, name, result, detail, fix });

const REPO_ROOT = resolve(__dirname, '../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const isProduction = env.NODE_ENV === 'production';

  /* ---------------------------- Environment ----------------------------- */
  add(
    'Environment',
    'NODE_ENV',
    isProduction ? 'PASS' : 'WARN',
    `NODE_ENV=${env.NODE_ENV}`,
    isProduction ? undefined : 'Set NODE_ENV=production before deploying, or this check cannot verify the production rules.',
  );

  for (const check of environmentChecks(env)) {
    add(
      'Environment',
      check.label,
      check.status === 'CONFIGURED' ? 'PASS' : check.mandatory ? 'FAIL' : 'WARN',
      check.detail,
      check.status === 'CONFIGURED' ? undefined : `Set ${check.variables?.join(', ') ?? 'the required variable'}.`,
    );
  }

  /* ------------------------- Production secrets -------------------------- */
  // In a non-production environment the rules are evaluated anyway, against a simulated
  // production NODE_ENV, so somebody can run this locally and still learn something.
  const secretProblems = productionSecretProblems({ ...env, NODE_ENV: 'production' }, process.env);
  add(
    'Secrets',
    'Production secret hygiene',
    secretProblems.length === 0 ? 'PASS' : 'FAIL',
    secretProblems.length === 0 ? 'no development defaults, placeholders or short secrets' : secretProblems.join(' | '),
    secretProblems.length === 0 ? undefined : 'Generate real values: openssl rand -base64 48',
  );

  add(
    'Secrets',
    'Secrets are not committed',
    existsSync(resolve(REPO_ROOT, '.env')) && gitIgnores('.env') ? 'PASS' : existsSync(resolve(REPO_ROOT, '.env')) ? 'FAIL' : 'WARN',
    existsSync(resolve(REPO_ROOT, '.env'))
      ? gitIgnores('.env')
        ? '.env exists and is git-ignored'
        : '.env exists and is NOT git-ignored'
      : 'no .env file found in the repository root',
    gitIgnores('.env') ? undefined : 'Add .env to .gitignore and rotate anything that was committed.',
  );

  /* ---------------------------- Database --------------------------------- */
  try {
    await prisma.$queryRaw`SELECT 1`;
    add('Database', 'Connection', 'PASS', redactUrl(env.DATABASE_URL));

    // Migrations: the table Prisma keeps, and whether anything is unapplied or failed.
    const migrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 50',
    ).catch(() => null);

    if (!migrations) {
      add('Database', 'Migrations', 'FAIL', 'the _prisma_migrations table is missing', 'Run: npm run db:deploy');
    } else {
      const pending = migrations.filter((m) => m.finished_at === null && m.rolled_back_at === null);
      const failed = migrations.filter((m) => m.rolled_back_at !== null);
      add(
        'Database',
        'Migrations',
        failed.length > 0 ? 'FAIL' : pending.length > 0 ? 'FAIL' : 'PASS',
        failed.length > 0
          ? `${failed.length} rolled back: ${failed.map((m) => m.migration_name).join(', ')}`
          : pending.length > 0
            ? `${pending.length} unfinished: ${pending.map((m) => m.migration_name).join(', ')}`
            : `${migrations.length} applied, newest ${migrations[0]?.migration_name ?? 'none'}`,
        failed.length > 0 || pending.length > 0 ? 'Run: npm run db:deploy' : undefined,
      );
    }

    const [userCount, serviceCount, demoLeads] = await Promise.all([
      prisma.user.count(),
      prisma.service.count({ where: { isActive: true } }),
      prisma.lead.count({ where: { isDemo: true } }),
    ]);

    add(
      'Database',
      'Administrator account',
      userCount > 0 ? 'PASS' : 'WARN',
      `${userCount} user(s)`,
      userCount > 0 ? undefined : 'The first administrator is created on boot from SEED_ADMIN_*.',
    );
    add(
      'Database',
      'Service catalogue',
      serviceCount > 0 ? 'PASS' : 'FAIL',
      `${serviceCount} active service(s)`,
      serviceCount > 0 ? undefined : 'Run: npm run db:seed',
    );
    add(
      'Database',
      'Demo data',
      demoLeads === 0 ? 'PASS' : isProduction && env.DEMO_MODE ? 'FAIL' : 'WARN',
      demoLeads === 0
        ? 'no demo leads present'
        : `${demoLeads} demo lead(s) present — flagged isDemo and excluded from every production number`,
      demoLeads > 0 && env.DEMO_MODE ? 'Set DEMO_MODE=false so demo rows stay out of the sales team’s view.' : undefined,
    );
  } catch (err) {
    add(
      'Database',
      'Connection',
      'FAIL',
      err instanceof Error ? err.message : 'unreachable',
      'Check DATABASE_URL, and that Postgres is running and reachable from this container.',
    );
  }

  /* ------------------------------ Redis ---------------------------------- */
  if (await redisHealthy()) {
    add('Redis', 'Connection', 'PASS', redactUrl(env.REDIS_URL));
    try {
      const info = await redis.info('memory');
      const policy = await redis.config('GET', 'maxmemory-policy').catch(() => null);
      const evictionPolicy = Array.isArray(policy) ? String(policy[1]) : 'unknown';
      add(
        'Redis',
        'Eviction policy',
        evictionPolicy === 'noeviction' ? 'PASS' : 'WARN',
        `maxmemory-policy=${evictionPolicy}`,
        evictionPolicy === 'noeviction'
          ? undefined
          : 'Use noeviction: silently dropping a queued job loses a lead’s whole pipeline run.',
      );
      const used = /used_memory_human:(\S+)/.exec(info)?.[1] ?? 'unknown';
      add('Redis', 'Memory', 'PASS', `in use: ${used}`);
    } catch {
      add('Redis', 'Configuration', 'WARN', 'connected, but INFO/CONFIG are not permitted for this user');
    }

    const queues = await queueHealth();
    const broken = queues.filter((q) => q.waiting < 0);
    const failed = queues.reduce((sum, q) => sum + Math.max(0, q.failed), 0);
    add(
      'Redis',
      'Queues',
      broken.length > 0 ? 'FAIL' : 'PASS',
      broken.length > 0
        ? `unreachable: ${broken.map((q) => q.name).join(', ')}`
        : queues.map((q) => `${q.name}(${q.waiting}w/${q.active}a)`).join(' '),
      broken.length > 0 ? 'Check QUEUE_PREFIX and that the worker uses the same Redis.' : undefined,
    );
    add(
      'Redis',
      'Failed jobs',
      failed === 0 ? 'PASS' : 'WARN',
      `${failed} job(s) in the failed set`,
      failed === 0 ? undefined : 'Inspect them in Settings → Logs before deploying over the top.',
    );
  } else {
    add('Redis', 'Connection', 'FAIL', 'unreachable', 'Check REDIS_URL; queues and rate limiting both depend on it.');
  }

  /* ---------------------------- Providers -------------------------------- */
  const providers = allProviders();
  const configured = providers.filter((p) => p.isConfigured());
  const leadSources = configured.filter((p) => p.descriptor.kind === 'LEAD_SOURCE' && p.descriptor.key !== 'manual');
  add(
    'Providers',
    'Provider registry',
    'PASS',
    `${configured.length} of ${providers.length} configured`,
  );
  add(
    'Providers',
    'At least one lead source',
    leadSources.length > 0 ? 'PASS' : 'WARN',
    leadSources.length > 0
      ? leadSources.map((p) => p.descriptor.displayName).join(', ')
      : 'only manual/CSV import is available',
    leadSources.length > 0 ? undefined : 'Enable OpenStreetMap (free) or add GOOGLE_MAPS_API_KEY — or import leads from CSV.',
  );

  /* --------------------------- Build output ------------------------------ */
  const apiBuild = resolve(REPO_ROOT, 'apps/api/dist/main.js');
  const webBuild = resolve(REPO_ROOT, 'apps/web/.next/BUILD_ID');
  add(
    'Build',
    'Backend build',
    existsSync(apiBuild) ? 'PASS' : 'WARN',
    existsSync(apiBuild) ? 'apps/api/dist/main.js present' : 'not built in this working tree',
    existsSync(apiBuild) ? undefined : 'Run: npm run build (the Docker image builds it during `docker compose build`).',
  );
  add(
    'Build',
    'Frontend build',
    existsSync(webBuild) ? 'PASS' : 'WARN',
    existsSync(webBuild) ? `Next.js build ${readFileSync(webBuild, 'utf8').trim()}` : 'not built in this working tree',
    existsSync(webBuild) ? undefined : 'Run: npm run build',
  );

  /* ------------------------ Production posture ---------------------------- */
  add(
    'Security',
    'Workers separated from the API',
    !isProduction || !env.RUN_WORKERS_IN_API ? 'PASS' : 'WARN',
    env.RUN_WORKERS_IN_API ? 'RUN_WORKERS_IN_API=true — a long crawl shares CPU with request handling' : 'workers run in their own process',
    env.RUN_WORKERS_IN_API && isProduction ? 'Set RUN_WORKERS_IN_API=false and run the worker container.' : undefined,
  );
  add(
    'Security',
    'Proxy headers trusted',
    !isProduction || env.TRUST_PROXY ? 'PASS' : 'WARN',
    env.TRUST_PROXY ? 'TRUST_PROXY=true' : 'TRUST_PROXY=false',
    env.TRUST_PROXY || !isProduction
      ? undefined
      : 'Behind Nginx this must be true, or rate limiting and audit logs record the proxy’s IP for everyone.',
  );
  add(
    'Security',
    'Crawler SSRF guard',
    env.CRAWLER_ALLOW_PRIVATE_HOSTS ? 'FAIL' : 'PASS',
    env.CRAWLER_ALLOW_PRIVATE_HOSTS
      ? 'CRAWLER_ALLOW_PRIVATE_HOSTS=true — the crawler may reach the private network'
      : 'private and loopback addresses are refused',
    env.CRAWLER_ALLOW_PRIVATE_HOSTS ? 'Set CRAWLER_ALLOW_PRIVATE_HOSTS=false. It exists only for local test fixtures.' : undefined,
  );
  add(
    'Security',
    'robots.txt compliance',
    env.CRAWLER_RESPECT_ROBOTS ? 'PASS' : 'WARN',
    env.CRAWLER_RESPECT_ROBOTS ? 'enabled' : 'DISABLED — the crawler ignores site owners’ wishes',
    env.CRAWLER_RESPECT_ROBOTS ? undefined : 'Set CRAWLER_RESPECT_ROBOTS=true.',
  );
  add(
    'Security',
    'CORS origins',
    env.WEB_ORIGIN.startsWith('https://') || !isProduction ? 'PASS' : 'FAIL',
    `WEB_ORIGIN=${env.WEB_ORIGIN}`,
    env.WEB_ORIGIN.startsWith('https://') || !isProduction ? undefined : 'Serve the dashboard over HTTPS.',
  );

  /* ------------------------------ Report ---------------------------------- */
  const line = '─'.repeat(78);
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const colour = (r: Result) =>
    !process.stdout.isTTY ? '' : { PASS: '\x1b[32m', FAIL: '\x1b[31m', WARN: '\x1b[33m', SKIP: '\x1b[90m' }[r];
  const reset = process.stdout.isTTY ? '\x1b[0m' : '';

  out();
  out('  BAIMAR LEAD INTELLIGENCE — production readiness');
  out(line);

  let group = '';
  for (const check of checks) {
    if (check.group !== group) {
      group = check.group;
      out();
      out(`  ${group.toUpperCase()}`);
    }
    out(`    ${colour(check.result)}${check.result.padEnd(6)}${reset} ${check.name.padEnd(32)} ${check.detail}`);
    if (check.fix) out(`           ${' '.repeat(32)} → ${check.fix}`);
  }

  const failures = checks.filter((c) => c.result === 'FAIL');
  const warnings = checks.filter((c) => c.result === 'WARN');

  out();
  out(line);
  out(
    `  ${checks.filter((c) => c.result === 'PASS').length} passed, ${warnings.length} warning(s), ${failures.length} failure(s).`,
  );
  out(failures.length === 0 ? '  READY TO DEPLOY.' : '  NOT READY — fix the failures above first.');
  out();

  process.exitCode = failures.length > 0 ? 1 : 0;
}

/** Is this path covered by .gitignore? Read directly, so the check works without git. */
function gitIgnores(path: string): boolean {
  const ignoreFile = resolve(REPO_ROOT, '.gitignore');
  if (!existsSync(ignoreFile)) return false;
  const patterns = readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return patterns.some((p) => p === path || p === `/${path}` || p === `${path}*` || p === '.env*');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('production check failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // queueHealth() opens one Redis connection per queue. Without closing them the
    // process prints its report and then hangs forever holding the event loop open,
    // which in CI looks exactly like a failing check.
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
  });
