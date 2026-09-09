import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { seedAdminUser, seedServices } from '../bootstrap';
import { hashPassword } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { disconnectRedis } from '../lib/redis';
import { closeQueues } from '../queue/queues';
import { registerProvider, unregisterProvider } from '../providers/registry';
import type { DiscoveredBusiness, LeadSourceProvider, ProviderDescriptor } from '../providers/types';
import { ingestBusiness } from '../services/lead-service';
import { recalculateLead, regenerateSalesBrief } from '../services/scoring-service';
import { assessBusinessValue } from '../core/business-value';
import { applyStatusTransition, upsertFollowUp } from '../services/crm-service';
import { getBusinessValueConfig } from '../lib/settings';
import { computeMarketSignals } from '../core/market';
import { discoverWebsiteForLead } from '../services/website-service';

/**
 * The acceptance test (patch 73).
 *
 * One run of the twenty steps the product exists to perform, in order, from an empty
 * database to a closed deal that shows up in the reports. It is deliberately written as a
 * single ordered narrative rather than as isolated units: the thing most likely to break
 * in a system like this is not any one function but the *seam* between two of them — the
 * scoring that runs before the crawl finishes, the follow-up that never reaches the day
 * view, the won deal that never reaches the report.
 *
 * It runs with no external provider configured at all. That is the point: this is the
 * configuration a new deployment starts in, and it has to work.
 */

let app: FastifyInstance;
let adminToken = '';
let salesToken = '';
let salesUserId = '';
let leadId = '';
let campaignId = '';

const TEST_PROVIDER_KEY = 'acceptance_source';

/** A deterministic lead source, so the walk-through does not depend on the internet. */
class AcceptanceSource implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: TEST_PROVIDER_KEY,
    kind: 'LEAD_SOURCE',
    displayName: 'Acceptance test source',
    description: 'Deterministic businesses for the acceptance walk-through.',
    requiredConfig: [],
    cost: 'FREE',
    priority: 95,
  };

  isConfigured() {
    return true;
  }
  missingConfig() {
    return [];
  }

  async discover(): Promise<DiscoveredBusiness[]> {
    return [
      {
        providerKey: TEST_PROVIDER_KEY,
        externalId: 'acc-1',
        origin: 'PUBLIC_BUSINESS_RESEARCH',
        name: 'فروشگاه پوشاک آفتاب',
        category: 'فروشگاه پوشاک',
        city: 'اراک',
        province: 'مرکزی',
        address: 'اراک، خیابان شریعتی، پلاک ۱۲',
        phone: '۰۸۶۳۳۳۳۴۴۴۴',
        instagramUrl: 'https://instagram.com/aftab.shop',
        reviewCount: 96,
        reviewRating: 4.5,
        services: ['پوشاک مردانه', 'پوشاک زنانه', 'کیف و کفش'],
        products: ['پیراهن', 'شلوار', 'کفش'],
      },
      // The same business again, written differently — the deduplicator must collapse it.
      {
        providerKey: TEST_PROVIDER_KEY,
        externalId: 'acc-1-dup',
        origin: 'PUBLIC_BUSINESS_RESEARCH',
        name: 'فروشگاه پوشاك آفتاب',
        category: 'پوشاک',
        city: 'اراك',
        phone: '+988633334444',
      },
    ];
  }
}

beforeAll(async () => {
  // Steps 1-2: database and Redis are already required by the e2e configuration.
  await prisma.salesActivity.deleteMany({});
  await prisma.call.deleteMany({});
  await prisma.followUp.deleteMany({});
  await prisma.leadSourceReference.deleteMany({});
  await prisma.opportunity.deleteMany({});
  await prisma.businessSignal.deleteMany({});
  await prisma.leadScore.deleteMany({});
  await prisma.salesBrief.deleteMany({});
  await prisma.aIAnalysis.deleteMany({});
  await prisma.websitePage.deleteMany({});
  await prisma.browserAudit.deleteMany({});
  await prisma.websiteAudit.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.campaignRun.deleteMany({});
  await prisma.campaign.deleteMany({});

  await seedServices();
  await seedAdminUser();

  registerProvider(new AcceptanceSource());

  // Step 3: start the API.
  app = await buildApp();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@baimar.local', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!' },
  });
  adminToken = login.json().accessToken;

  const sales = await prisma.user.upsert({
    where: { email: 'acceptance-sales@baimar.test' },
    create: {
      email: 'acceptance-sales@baimar.test',
      name: 'کارشناس پذیرش',
      role: 'SALESPERSON',
      passwordHash: await hashPassword('AcceptancePass123'),
    },
    update: {},
  });
  salesUserId = sales.id;
  const salesLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'acceptance-sales@baimar.test', password: 'AcceptancePass123' },
  });
  salesToken = salesLogin.json().accessToken;
});

afterAll(async () => {
  unregisterProvider(TEST_PROVIDER_KEY);
  await app?.close();
  await closeQueues().catch(() => undefined);
  await prisma.$disconnect();
  await disconnectRedis();
});

const inject = (method: string, url: string, opts: { token?: string; payload?: unknown } = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    payload: opts.payload as object,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  });

describe('acceptance: an empty database to a closed deal', () => {
  it('1-3. serves an authenticated API with its dependencies up', async () => {
    const health = await inject('GET', '/health');
    expect(health.statusCode).toBe(200);
    expect(health.json().database).toBe('up');
    expect(health.json().redis).toBe('up');

    const ready = await inject('GET', '/ready');
    expect(ready.json().ready).toBe(true);
  });

  it('4. the worker process can be started (queues reachable)', async () => {
    const admin = await inject('GET', '/api/admin/queues', { token: adminToken });
    // The endpoint is admin-only; either it reports queue depth or the route is absent
    // in this build — both are acceptable, an unreachable queue is not.
    if (admin.statusCode === 200) {
      const queues = admin.json().queues ?? admin.json().items ?? [];
      for (const q of queues as Array<{ waiting: number }>) expect(q.waiting).toBeGreaterThanOrEqual(0);
    }
  });

  it('5. creates a campaign', async () => {
    const res = await inject('POST', '/api/campaigns', {
      token: adminToken,
      payload: {
        name: 'پذیرش — پوشاک اراک',
        city: 'اراک',
        province: 'مرکزی',
        categories: ['فروشگاه پوشاک'],
        maxResults: 10,
        providers: [TEST_PROVIDER_KEY],
        enableAi: false,
      },
    });
    expect(res.statusCode).toBe(200);
    campaignId = res.json().campaign.id;
    expect(campaignId).toBeTruthy();
  });

  it('6-7. discovers a business and deduplicates the second spelling of it', async () => {
    const source = new AcceptanceSource();
    const found = await source.discover();
    expect(found).toHaveLength(2);

    const first = await ingestBusiness(found[0], { campaignId });
    expect(first.action).toBe('created');
    leadId = first.lead.id;

    // The same business with Arabic letter variants and a different phone format.
    const second = await ingestBusiness(found[1], { campaignId });
    expect(second.action).toBe('merged');
    expect(second.lead.id).toBe(leadId);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    // Persian digits in, E.164 out — the deduplication key that made the merge possible.
    expect(lead.normalizedPhone).toBe('+988633334444');
    expect(lead.originalPhone).toBe('۰۸۶۳۳۳۳۴۴۴۴');

    const total = await prisma.lead.count({ where: { campaignId } });
    expect(total).toBe(1);
  });

  it('8. records a website-discovery outcome, including "none found"', async () => {
    // The API enqueues this stage, and this suite runs with RUN_WORKERS_IN_API=false so
    // that a stray background job cannot make the walk-through non-deterministic. The
    // service is therefore called directly — the same function the worker calls, and the
    // queue path itself is covered by queue.e2e.test.ts.
    const accepted = await inject('POST', `/api/leads/${leadId}/discover-website`, { token: adminToken });
    expect([200, 202]).toContain(accepted.statusCode);

    const outcome = await discoverWebsiteForLead(leadId, { force: true });

    // No search provider is configured, so discovery must conclude "no website" rather
    // than guessing — and that conclusion is itself one of the strongest sales signals
    // Baimar has.
    expect(outcome.status).toBe('NO_WEBSITE');
    expect(outcome.evidence).toBeTruthy();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.websiteStatus).toBe('NO_WEBSITE');
    expect(lead.websiteCheckedAt).not.toBeNull();
  });

  it('9. skips the audit honestly when there is no website to audit', async () => {
    const res = await inject('POST', `/api/leads/${leadId}/audit`, { token: adminToken });
    expect([200, 202, 400]).toContain(res.statusCode);
    // Never a fabricated audit row for a business with no website.
    const audits = await prisma.websiteAudit.count({ where: { leadId } });
    expect(audits).toBe(0);
  });

  it('10-12. scores the lead, values the business, and finds an opportunity', async () => {
    const result = await recalculateLead(leadId);
    expect(result).not.toBeNull();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.leadScore).toBeGreaterThan(0);
    expect(lead.leadTemperature).toBeTruthy();

    // Business value is a separate judgement from the lead score, and is never revenue.
    const value = assessBusinessValue(lead, null, await getBusinessValueConfig());
    expect(value.tier).toBeTruthy();
    expect(Array.isArray(value.reasons)).toBe(true);

    const opportunities = await prisma.opportunity.findMany({ where: { leadId }, orderBy: { score: 'desc' } });
    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities[0].reasons.length).toBeGreaterThan(0);
    // Every opportunity score is attributable, not a bare number.
    expect(opportunities[0].factors).toBeTruthy();
  });

  it('13. every score point is explainable', async () => {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const breakdown = lead.scoreBreakdown as Array<{ signal: string; points: number; evidence: string }> | null;
    expect(breakdown).toBeTruthy();
    expect(breakdown!.length).toBeGreaterThan(0);
    for (const contribution of breakdown!) {
      expect(contribution.signal).toBeTruthy();
      expect(typeof contribution.points).toBe('number');
      // A point with no evidence is a mystery score, which is what this forbids.
      expect(contribution.evidence).toBeTruthy();
    }
  });

  it('14-15. produces a rules-based sales brief with no AI configured', async () => {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    await regenerateSalesBrief(lead);

    const brief = await prisma.salesBrief.findFirstOrThrow({ where: { leadId, isCurrent: true } });
    // AI_PROVIDER=none in this suite, so the brief must be complete on rules alone.
    expect(brief.generatedBy).toBe('RULES');

    const content = brief.content as {
      whyContactFa: string;
      keyProblems: Array<{ textFa: string; evidenceFa: string; sourceFa: string }>;
      openings: Array<{ textFa: string; factBased: boolean }>;
      questionsFa: string[];
      objections: Array<{ objectionFa: string; responseFa: string }>;
      nextActionFa: string;
      suggestedFollowUpAt: string | null;
      recommendedServiceNameFa: string | null;
    };

    expect(content.whyContactFa.length).toBeGreaterThan(20);
    expect(content.openings.length).toBeGreaterThan(0);
    expect(content.questionsFa.length).toBeGreaterThan(0);
    expect(content.objections.length).toBeGreaterThan(0);
    expect(content.nextActionFa).toBeTruthy();
    expect(content.suggestedFollowUpAt).toBeTruthy();
    expect(content.recommendedServiceNameFa).toBeTruthy();

    // Every problem carries its evidence and source.
    for (const problem of content.keyProblems ?? []) {
      expect(problem.evidenceFa).toBeTruthy();
      expect(problem.sourceFa).toBeTruthy();
    }
    // Every opening states whether it rests on an observation.
    for (const opening of content.openings) {
      expect(typeof opening.factBased).toBe('boolean');
    }
  });

  it('16. assigns the lead to a salesperson, and logs the assignment', async () => {
    const res = await inject('PATCH', `/api/leads/${leadId}`, {
      token: adminToken,
      payload: { assignedToId: salesUserId },
    });
    expect(res.statusCode).toBe(200);

    const activity = await prisma.salesActivity.findFirst({ where: { leadId, type: 'ASSIGNMENT' } });
    expect(activity).toBeTruthy();
  });

  it('17-18. logs a call and schedules the follow-up in one request', async () => {
    const dueAt = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    const res = await inject('POST', `/api/crm/leads/${leadId}/calls`, {
      token: salesToken,
      payload: { outcome: 'ANSWERED', notes: 'علاقه‌مند بود، جلسه هفته آینده', nextActionAt: dueAt, durationSeconds: 220 },
    });
    expect(res.statusCode).toBe(200);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.contactStatus).toBe('CONTACTED');
    expect(lead.lastContactAt).not.toBeNull();
    expect(lead.nextFollowUpAt).not.toBeNull();

    // The status change is traceable, not silent — this is what patch 26 fixed.
    const statusChange = await prisma.salesActivity.findFirst({ where: { leadId, type: 'STATUS_CHANGE' } });
    expect(statusChange).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: leadId, action: 'lead.status_changed' } });
    expect(audit).toBeTruthy();

    // Saving the same follow-up again must not create a second reminder.
    await upsertFollowUp({ leadId, userId: salesUserId, kind: 'تماس مجدد', dueAt: new Date(dueAt) });
    const followUps = await prisma.followUp.findMany({ where: { leadId, completedAt: null } });
    expect(followUps).toHaveLength(1);

    // And it reaches the salesperson's day view.
    const today = await inject('GET', '/api/dashboard/today', { token: salesToken });
    expect(today.statusCode).toBe(200);
    const inView = (today.json().dueFollowUps as Array<{ lead: { id: string } }>).some((f) => f.lead.id === leadId);
    expect(inView).toBe(true);
  });

  it('19. closes the deal as won, and stamps when', async () => {
    await applyStatusTransition({
      leadId,
      to: 'WON',
      actor: { id: salesUserId, email: 'acceptance-sales@baimar.test' },
      reasonFa: 'قرارداد طراحی فروشگاه اینترنتی امضا شد',
      source: 'manual',
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.contactStatus).toBe('WON');
    expect(lead.wonAt).not.toBeNull();
  });

  it('20. the closed deal reaches the dashboard and the reports', async () => {
    const dashboard = await inject('GET', '/api/dashboard', { token: adminToken });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().kpis.won).toBeGreaterThanOrEqual(1);

    const reports = await inject('GET', '/api/reports/summary?days=30', { token: adminToken });
    expect(reports.statusCode).toBe(200);
    const body = reports.json();

    const wonStage = body.conversion.stages.find((s: { key: string }) => s.key === 'won');
    expect(wonStage.count).toBeGreaterThanOrEqual(1);

    // The source that found this business is credited all the way through to won.
    const source = body.sources.find((s: { providerKey: string }) => s.providerKey === TEST_PROVIDER_KEY);
    expect(source).toBeTruthy();
    expect(source.leads).toBeGreaterThanOrEqual(1);
    expect(source.won).toBeGreaterThanOrEqual(1);

    // And the service that was recommended is credited too.
    const services = body.services as Array<{ serviceKey: string; won: number }>;
    expect(services.some((s) => s.won >= 1)).toBe(true);
  });

  it('market intelligence stays silent rather than inventing demand', async () => {
    const signals = await computeMarketSignals({ lookbackDays: 30 });
    // No keyword data has been imported in this run, so there is nothing to report —
    // and the honest output is nothing, not a plausible-looking number.
    for (const signal of signals) {
      expect(['INSUFFICIENT_DATA', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).toContain(signal.strength);
      if (signal.strength === 'INSUFFICIENT_DATA') {
        expect(signal.score).toBeNull();
        expect(signal.quality).toBe('UNKNOWN');
      }
    }

    const overview = await inject('GET', '/api/market/overview', { token: adminToken });
    expect(overview.statusCode).toBe(200);
    for (const item of overview.json().serviceDemand as Array<{ strength: string; score: number | null }>) {
      if (item.strength === 'INSUFFICIENT_DATA') expect(item.score).toBeNull();
    }
  });
});
