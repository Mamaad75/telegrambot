import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { seedAdminUser, seedServices } from '../bootstrap';
import { hashPassword } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { disconnectRedis } from '../lib/redis';
import { registerProvider, resetProviderRegistry, syncProviders } from '../providers/registry';
import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider, ProviderDescriptor } from '../providers/types';
import { executeCampaignRun, recordRunProgress } from '../services/campaign-service';
import { recalculateLead } from '../services/scoring-service';
import { analyzeLead } from '../core/ai-analysis';

/**
 * End-to-end acceptance test.
 *
 * Walks the exact journey the product is built around, with NO external provider
 * configured — no Google key, no AI key, no search key. If this passes, the platform is
 * usable on day one with nothing but a database and Redis.
 *
 *   campaign → discovery → dedupe → enrichment → scoring → opportunity → sales brief
 *   → assignment → call → follow-up → won
 */

/** A deterministic lead source, standing in for OpenStreetMap or Google Places. */
class StubLeadSource implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'stub_source',
    kind: 'LEAD_SOURCE',
    displayName: 'Stub source (test)',
    description: 'Deterministic provider used by the end-to-end suite.',
    requiredConfig: [],
    cost: 'FREE',
    priority: 200,
  };

  isConfigured(): boolean {
    return true;
  }
  missingConfig(): string[] {
    return [];
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    return [
      {
        providerKey: this.descriptor.key,
        externalId: 'stub-1',
        sourceUrl: 'https://example.com/stub-1',
        origin: 'PUBLIC_BUSINESS_RESEARCH',
        name: 'کلینیک زیبایی آزمون',
        category: query.category,
        city: query.city ?? 'اراک',
        province: 'مرکزی',
        country: 'IR',
        phone: '۰۹۱۲۳۴۵۶۷۸۹',
        address: 'اراک، خیابان آزمون، پلاک ۱',
        instagramUrl: 'https://instagram.com/e2e_clinic',
        reviewCount: 210,
        reviewRating: 4.6,
        services: ['لیزر', 'مزوتراپی', 'پاکسازی'],
      },
      {
        // Same business, different phone formatting and name spelling: must merge.
        providerKey: this.descriptor.key,
        externalId: 'stub-2',
        origin: 'PUBLIC_BUSINESS_RESEARCH',
        name: 'كلينيك زيبايي ازمون',
        category: query.category,
        city: query.city ?? 'اراک',
        country: 'IR',
        phone: '+98 912 345 6789',
      },
      {
        providerKey: this.descriptor.key,
        externalId: 'stub-3',
        origin: 'PUBLIC_BUSINESS_RESEARCH',
        name: 'رستوران آزمون',
        category: query.category,
        city: query.city ?? 'اراک',
        country: 'IR',
        phone: '08633330001',
        reviewCount: 15,
      },
    ];
  }
}

/** A provider that always fails, to prove one bad vendor cannot break a run. */
class FailingLeadSource implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'failing_source',
    kind: 'LEAD_SOURCE',
    displayName: 'Failing source (test)',
    description: 'Always throws.',
    requiredConfig: [],
    cost: 'FREE',
    priority: 300,
  };
  isConfigured(): boolean {
    return true;
  }
  missingConfig(): string[] {
    return [];
  }
  async discover(): Promise<DiscoveredBusiness[]> {
    throw new Error('simulated provider outage');
  }
}

let app: FastifyInstance;
let adminToken: string;
let salesToken: string;
let salesUserId: string;

async function inject(method: string, url: string, options: { token?: string; payload?: unknown } = {}) {
  return app.inject({
    method: method as 'GET',
    url,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    payload: options.payload as never,
  });
}

beforeAll(async () => {
  // Start from a clean database so assertions about counts are meaningful.
  await prisma.$transaction([
    prisma.leadSourceReference.deleteMany(),
    prisma.salesActivity.deleteMany(),
    prisma.call.deleteMany(),
    prisma.note.deleteMany(),
    prisma.task.deleteMany(),
    prisma.followUp.deleteMany(),
    prisma.opportunity.deleteMany(),
    prisma.businessSignal.deleteMany(),
    prisma.leadScore.deleteMany(),
    prisma.salesBrief.deleteMany(),
    prisma.aIAnalysis.deleteMany(),
    prisma.websiteAudit.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.campaignRun.deleteMany(),
    prisma.campaign.deleteMany(),
    prisma.keywordSignal.deleteMany(),
    prisma.keywordService.deleteMany(),
    prisma.keywordLocation.deleteMany(),
    prisma.keywordTrend.deleteMany(),
    prisma.keyword.deleteMany(),
    prisma.searchTerm.deleteMany(),
    prisma.marketSignal.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.jobLog.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  resetProviderRegistry();
  registerProvider(new StubLeadSource());
  registerProvider(new FailingLeadSource());

  await seedServices();
  await syncProviders();
  await seedAdminUser();

  app = await buildApp();
  await app.ready();

  const login = await inject('POST', '/api/auth/login', {
    payload: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@baimar.local', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!' },
  });
  expect(login.statusCode).toBe(200);
  adminToken = login.json().accessToken;

  const sales = await prisma.user.create({
    data: {
      email: 'sales@baimar.test',
      name: 'کارشناس آزمون',
      role: 'SALESPERSON',
      passwordHash: await hashPassword('SalesPass123'),
    },
  });
  salesUserId = sales.id;
  const salesLogin = await inject('POST', '/api/auth/login', {
    payload: { email: 'sales@baimar.test', password: 'SalesPass123' },
  });
  salesToken = salesLogin.json().accessToken;
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  await disconnectRedis();
});

describe('authentication', () => {
  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await inject('POST', '/api/auth/login', {
      payload: { email: 'admin@baimar.local', password: 'nope' },
    });
    const noSuchUser = await inject('POST', '/api/auth/login', {
      payload: { email: 'ghost@baimar.local', password: 'nope' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(noSuchUser.json().message);
  });

  it('refuses every protected route without a token', async () => {
    for (const url of ['/api/leads', '/api/campaigns', '/api/settings', '/api/users']) {
      expect((await inject('GET', url)).statusCode).toBe(401);
    }
  });

  it('rotates the refresh token and invalidates the used one', async () => {
    const login = await inject('POST', '/api/auth/login', {
      payload: { email: 'sales@baimar.test', password: 'SalesPass123' },
    });
    const { refreshToken } = login.json();

    const first = await inject('POST', '/api/auth/refresh', { payload: { refreshToken } });
    expect(first.statusCode).toBe(200);

    // Re-using the old token must fail: it was revoked on rotation.
    const replay = await inject('POST', '/api/auth/refresh', { payload: { refreshToken } });
    expect(replay.statusCode).toBe(401);
  });
});

describe('authentication does not leak which accounts exist (patch 42)', () => {
  it('answers a deactivated account exactly like a wrong password', async () => {
    const email = 'deactivated@baimar.test';
    await prisma.user.create({
      data: { email, name: 'حساب غیرفعال', role: 'SALESPERSON', passwordHash: await hashPassword('RealPass123'), isActive: false },
    });

    // Wrong password against the deactivated account, and against one that never existed.
    const deactivatedWrongPassword = await inject('POST', '/api/auth/login', {
      payload: { email, password: 'wrong-password' },
    });
    const neverExisted = await inject('POST', '/api/auth/login', {
      payload: { email: 'nobody-here@baimar.test', password: 'wrong-password' },
    });

    expect(deactivatedWrongPassword.statusCode).toBe(neverExisted.statusCode);
    // Identical wording: a caller who does not know the password learns nothing about
    // whether the address is registered.
    expect(deactivatedWrongPassword.json().message).toBe(neverExisted.json().message);

    // With the correct password the account state may be revealed — the caller has
    // already proved they hold the credentials, so there is nothing left to leak.
    const withCorrectPassword = await inject('POST', '/api/auth/login', {
      payload: { email, password: 'RealPass123' },
    });
    expect(withCorrectPassword.statusCode).toBe(401);
    expect(withCorrectPassword.json().message).toContain('deactivated');

    await prisma.user.delete({ where: { email } }).catch(() => undefined);
  });
});

describe('role-based access control', () => {
  it('stops a salesperson from reading settings or managing users', async () => {
    expect((await inject('GET', '/api/settings', { token: salesToken })).statusCode).toBe(403);
    expect((await inject('GET', '/api/users', { token: salesToken })).statusCode).toBe(403);
    expect((await inject('GET', '/api/admin/audit-logs', { token: salesToken })).statusCode).toBe(403);
  });

  it('lets an administrator read them', async () => {
    expect((await inject('GET', '/api/settings', { token: adminToken })).statusCode).toBe(200);
    expect((await inject('GET', '/api/users', { token: adminToken })).statusCode).toBe(200);
  });
});

describe('lead ingestion and deduplication', () => {
  it('normalizes an Iranian phone number on create', async () => {
    const created = await inject('POST', '/api/leads', {
      token: adminToken,
      payload: { businessName: 'آرایشگاه آزمون', phone: '۰۹۳۵ ۱۱۱ ۲۲۳۳', city: 'اراک', category: 'آرایشگاه' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().lead.normalizedPhone).toBe('+989351112233');
    // The original string is preserved exactly.
    expect(created.json().lead.originalPhone).toBe('۰۹۳۵ ۱۱۱ ۲۲۳۳');
  });

  it('merges the same business submitted with a different phone format', async () => {
    const again = await inject('POST', '/api/leads', {
      token: adminToken,
      payload: { businessName: 'آرایشگاه آزمون', phone: '+98 935 111 2233', city: 'اراک' },
    });
    expect(again.json().action).toBe('merged');
    expect(again.json().evidence).toContain('phone');

    const count = await prisma.lead.count({ where: { normalizedPhone: '+989351112233' } });
    expect(count).toBe(1);
  });

  it('imports a CSV, mapping Persian headers and merging duplicates', async () => {
    const csv = [
      'نام کسب و کار,شماره تماس,شهر,دسته,وب سایت',
      'مطب دکتر آزمون,۰۸۶۳۳۳۳۹۹۹۹,اراک,مطب,',
      'آرایشگاه آزمون,09351112233,اراک,آرایشگاه,', // duplicate of the lead above
      ',09120000000,اراک,,', // no name: must be rejected, not silently imported
    ].join('\n');

    const result = await inject('POST', '/api/leads/import', {
      token: adminToken,
      payload: { content: csv, filename: 'test.csv', runPipeline: false },
    });

    expect(result.statusCode).toBe(200);
    const body = result.json();
    expect(body.imported).toBe(1);
    expect(body.merged).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors[0].reason).toContain('No business name');
  });

  it('keeps a source reference for every contributing provider', async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { normalizedPhone: '+989351112233' } });
    const references = await prisma.leadSourceReference.findMany({ where: { leadId: lead.id } });
    expect(references.length).toBeGreaterThan(0);
    expect(references.every((r) => r.fields.length > 0)).toBe(true);
  });
});

describe('campaign execution', () => {
  let campaignId: string;
  let runId: string;

  it('creates a campaign', async () => {
    const created = await inject('POST', '/api/campaigns', {
      token: adminToken,
      payload: {
        name: 'کمپین آزمون اراک',
        city: 'اراک',
        province: 'مرکزی',
        categories: ['کلینیک زیبایی'],
        providers: ['stub_source', 'failing_source'],
        maxResults: 20,
        minLeadScore: 40,
        enableAi: false,
      },
    });
    expect(created.statusCode).toBe(200);
    campaignId = created.json().campaign.id;
  });

  it('runs discovery, survives a failing provider, and deduplicates the results', async () => {
    const run = await prisma.campaignRun.create({ data: { campaignId, status: 'QUEUED' } });
    runId = run.id;

    await executeCampaignRun(campaignId, runId);

    const after = await prisma.campaignRun.findUniqueOrThrow({ where: { id: runId } });
    // Three records collected from the working provider…
    expect(after.collected).toBe(3);
    // …collapsing to two businesses, because two of them are the same clinic.
    expect(after.unique).toBe(2);
    expect(after.merged).toBe(1);
    // The failing provider was recorded as an error but did not stop the run.
    expect(after.errors).toBeGreaterThan(0);

    const log = (after.log ?? []) as Array<{ message: string; level: string }>;
    expect(log.some((entry) => entry.level === 'warn' && entry.message.includes('simulated provider outage'))).toBe(true);
  });

  it('scores the discovered leads and recommends a Baimar service', async () => {
    const clinic = await prisma.lead.findFirstOrThrow({ where: { businessName: 'کلینیک زیبایی آزمون' } });

    // With no website discovered, the lead has the strongest possible sales signal.
    await prisma.lead.update({ where: { id: clinic.id }, data: { websiteStatus: 'NO_WEBSITE' } });
    const result = await recalculateLead(clinic.id);

    expect(result).not.toBeNull();
    expect(result!.score.score).toBeGreaterThan(0);
    expect(result!.primary?.serviceKey).toBe('WEBSITE_DESIGN');
    expect(result!.businessValue.tier).not.toBe('UNKNOWN');

    // Every point is attributable.
    expect(result!.score.contributions.length).toBeGreaterThan(0);
    for (const contribution of result!.score.contributions) {
      expect(contribution.evidence.length).toBeGreaterThan(0);
    }
  });

  it('produces a usable sales brief with no AI provider configured', async () => {
    const clinic = await prisma.lead.findFirstOrThrow({ where: { businessName: 'کلینیک زیبایی آزمون' } });
    const brief = await prisma.salesBrief.findFirstOrThrow({ where: { leadId: clinic.id, isCurrent: true } });
    const content = brief.content as unknown as {
      whyContactFa: string;
      keyProblemsFa: string[];
      openings: Array<{ textFa: string }>;
      questionsFa: string[];
      objections: Array<{ objectionFa: string; responseFa: string }>;
      nextActionFa: string;
    };

    expect(brief.generatedBy).toBe('RULES');
    expect(content.whyContactFa.length).toBeGreaterThan(20);
    expect(content.keyProblemsFa.length).toBeGreaterThan(0);
    expect(content.openings.length).toBeGreaterThan(0);
    expect(content.questionsFa.length).toBeGreaterThan(0);
    expect(content.objections.length).toBeGreaterThan(0);
    expect(content.nextActionFa.length).toBeGreaterThan(0);
  });

  it('skips AI cleanly when no provider is configured, without failing the lead', async () => {
    const clinic = await prisma.lead.findFirstOrThrow({ where: { businessName: 'کلینیک زیبایی آزمون' } });
    const context = await recalculateLead(clinic.id, { regenerateBrief: false });
    const services = await prisma.service.findMany({ where: { isActive: true } });

    const outcome = await analyzeLead({
      lead: context!.lead,
      audit: null,
      signals: context!.signals,
      score: context!.score,
      businessValue: context!.businessValue,
      matches: context!.matches,
      services,
    });

    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toContain('No AI provider');
    }
    // The brief still exists and is still usable.
    expect(await prisma.salesBrief.count({ where: { leadId: clinic.id, isCurrent: true } })).toBe(1);
  });

  it('records run progress and qualification against the campaign filters', async () => {
    const clinic = await prisma.lead.findFirstOrThrow({ where: { businessName: 'کلینیک زیبایی آزمون' } });
    await recordRunProgress(runId, clinic.id);

    const run = await prisma.campaignRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.qualified + run.rejected).toBeGreaterThan(0);
  });
});

describe('sales pipeline', () => {
  let leadId: string;

  it('assigns a lead to a salesperson', async () => {
    const clinic = await prisma.lead.findFirstOrThrow({ where: { businessName: 'کلینیک زیبایی آزمون' } });
    leadId = clinic.id;

    const assigned = await inject('PATCH', `/api/leads/${leadId}`, {
      token: adminToken,
      payload: { assignedToId: salesUserId, contactStatus: 'READY_TO_CALL' },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().lead.assignedToId).toBe(salesUserId);
  });

  it('shows a salesperson only their own leads', async () => {
    const list = await inject('GET', '/api/leads?pageSize=100', { token: salesToken });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ id: string; assignedToId: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.assignedToId === salesUserId)).toBe(true);
  });

  it('refuses a salesperson access to a lead that is not theirs', async () => {
    const other = await prisma.lead.findFirstOrThrow({ where: { assignedToId: null } });
    const denied = await inject('GET', `/api/leads/${other.id}`, { token: salesToken });
    expect(denied.statusCode).toBe(403);
  });

  it('logs a call, advances the stage and schedules the follow-up in one request', async () => {
    const dueAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const call = await inject('POST', `/api/crm/leads/${leadId}/calls`, {
      token: salesToken,
      payload: { outcome: 'CALLBACK_REQUESTED', notes: 'خواست فردا تماس بگیریم', nextActionAt: dueAt, durationSeconds: 90 },
    });
    expect(call.statusCode).toBe(200);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.contactStatus).toBe('CALLBACK');
    expect(lead.lastContactAt).not.toBeNull();
    expect(lead.nextFollowUpAt).not.toBeNull();

    const followUps = await prisma.followUp.findMany({ where: { leadId, completedAt: null } });
    expect(followUps).toHaveLength(1);

    const activities = await prisma.salesActivity.findMany({ where: { leadId, type: 'CALL' } });
    expect(activities).toHaveLength(1);
  });

  it('surfaces the follow-up in the salesperson’s day view', async () => {
    const today = await inject('GET', '/api/dashboard/today', { token: salesToken });
    expect(today.statusCode).toBe(200);
    const followUps = today.json().dueFollowUps as Array<{ lead: { id: string } }>;
    expect(followUps.some((f) => f.lead.id === leadId)).toBe(true);
  });

  it('completes the follow-up and clears the next action', async () => {
    const followUp = await prisma.followUp.findFirstOrThrow({ where: { leadId, completedAt: null } });
    const done = await inject('POST', `/api/crm/follow-ups/${followUp.id}/complete`, { token: salesToken });
    expect(done.statusCode).toBe(200);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.nextFollowUpAt).toBeNull();
  });

  it('closes the deal as won', async () => {
    const won = await inject('PATCH', `/api/leads/${leadId}`, {
      token: salesToken,
      payload: { contactStatus: 'WON' },
    });
    expect(won.statusCode).toBe(200);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.contactStatus).toBe('WON');
    expect(lead.wonAt).not.toBeNull();
  });

  it('reflects the closed deal in the dashboard conversion rate', async () => {
    const dashboard = await inject('GET', '/api/dashboard', { token: adminToken });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().kpis.won).toBeGreaterThanOrEqual(1);
    expect(dashboard.json().kpis.conversionRate).not.toBeNull();
  });
});

describe('exports and observability', () => {
  it('exports leads as CSV with the provenance columns', async () => {
    const csv = await inject('GET', '/api/leads/export', { token: adminToken });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('business_name');
    expect(csv.body).toContain('website_audited');
    expect(csv.body).toContain('source_providers');
    expect(csv.body).toContain('کلینیک زیبایی آزمون');
  });

  it('records the actions that changed data in the audit log', async () => {
    const logs = await inject('GET', '/api/admin/audit-logs?pageSize=100', { token: adminToken });
    const actions = (logs.json().items as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain('lead.created');
    expect(actions).toContain('lead.import');
    expect(actions).toContain('campaign.created');
    expect(actions).toContain('auth.login');
  });

  it('reports provider state without leaking any credential', async () => {
    const providers = await inject('GET', '/api/providers', { token: adminToken });
    expect(providers.statusCode).toBe(200);
    const body = providers.body;

    expect(body).toContain('requiredConfig');
    expect(body).toContain('missingConfig');
    // No secret value, under any name, may cross the boundary.
    expect(body).not.toMatch(/"secrets"|apiKey|api_key|ANTHROPIC_API_KEY"\s*:\s*"[^"]+"/);
  });

  it('keeps the health endpoint honest about each dependency', async () => {
    const health = await inject('GET', '/health');
    expect(health.statusCode).toBe(200);
    expect(health.json().database).toBe('up');
    expect(['up', 'down']).toContain(health.json().redis);
  });
});

describe('market intelligence with no data', () => {
  it('reports insufficient data instead of inventing demand', async () => {
    const overview = await inject('GET', '/api/market/overview', { token: adminToken });
    expect(overview.statusCode).toBe(200);
    const body = overview.json();

    expect(body.hasData).toBe(false);
    expect(body.emptyStateHint).toBeTruthy();
    expect(body.kpis.topService).toBeNull();
    expect(body.kpis.topKeyword).toBeNull();
  });

  it('imports keyword data and only then produces a demand signal', async () => {
    // Three observations for website design (the configured minimum sample size) and
    // deliberately only one for SEO, so both branches of the guard are exercised.
    const csv = [
      'keyword,search volume,impressions,clicks,city',
      'طراحی سایت اراک,720,4210,186,اراک',
      'طراحی سایت شرکتی,590,3180,121,اراک',
      'ساخت سایت برای کسب و کار,430,2100,88,اراک',
      'سئو سایت اراک,260,1450,61,اراک',
    ].join('\n');

    const imported = await inject('POST', '/api/market/import', {
      token: adminToken,
      payload: { content: csv, source: 'MANUAL_IMPORT', city: 'اراک' },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().keywordsStored).toBe(4);

    const { computeMarketSignals } = await import('../core/market');
    const aggregates = await computeMarketSignals({ city: 'اراک' });

    const websiteDesign = aggregates.find((a) => a.serviceKey === 'WEBSITE_DESIGN');
    expect(websiteDesign).toBeDefined();
    expect(websiteDesign!.strength).not.toBe('INSUFFICIENT_DATA');
    // The basis is always stated so a salesperson can judge the number.
    expect(websiteDesign!.basis).toContain('مشاهده');

    // A service with a single observation stays "insufficient data" rather than being
    // scored — one data point is not a market signal.
    const seo = aggregates.find((a) => a.serviceKey === 'SEO');
    expect(seo?.strength).toBe('INSUFFICIENT_DATA');
    expect(seo?.score).toBeNull();
    expect(seo?.basis).toContain('کمتر از حداقل');
  });
});
