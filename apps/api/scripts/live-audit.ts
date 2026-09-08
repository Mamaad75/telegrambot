/**
 * Audit any URL from the command line, without creating a lead.
 *
 *   npm run audit:url -w @baimar/api -- https://example.ir
 *
 * Useful for checking what the audit engine sees on a specific site before a call, and
 * for verifying crawler behaviour after changing the checks. Honours robots.txt exactly
 * as the pipeline does.
 */
import 'dotenv/config';
import { auditWebsite } from '../src/audit/engine';
import { websiteProvider } from '../src/providers/registry';
import { disconnectRedis } from '../src/lib/redis';
import { prisma } from '../src/lib/prisma';

const target = process.argv[2];
const category = process.argv[3] ?? null;

async function main() {
  if (!target) {
    console.error('Usage: npm run audit:url -w @baimar/api -- <url> [business category]');
    process.exitCode = 1;
    return;
  }

  console.log(`Auditing ${target}…\n`);
  const result = await auditWebsite(target, websiteProvider(), { businessCategory: category });

  if (result.blockedByRobots) {
    console.log('This site’s robots.txt asks crawlers not to read it. No audit was performed.');
    return;
  }

  console.log('reachable:      ', result.reachable, `(HTTP ${result.httpStatus ?? '—'})`);
  console.log('final URL:      ', result.finalUrl ?? '—');
  console.log('pages crawled:  ', result.pagesCrawled, `— ${result.totalBytes} bytes, avg ${result.responseMs ?? '—'}ms`);
  console.log('HTTPS / viewport:', result.hasSsl, '/', result.hasViewport);
  console.log('scores:         ', JSON.stringify(result.scores));
  console.log('technologies:   ', result.technologies.map((t) => `${t.name} (${t.confidence})`).join(', ') || '—');
  console.log('legacy signals: ', result.legacySignals.join('; ') || '—');
  console.log('NOT measured:   ', result.unavailableMeasurements.join(', ') || '—');

  console.log('\nfindings:');
  for (const finding of result.findings) {
    console.log(`  [${finding.severity.padEnd(6)}] ${finding.titleEn} — ${finding.evidence}`);
  }
  if (!result.findings.length) console.log('  (none)');

  if (result.error) console.log('\nerror:', result.error);
}

main()
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });
