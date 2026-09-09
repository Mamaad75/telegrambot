import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  campaignPerformance,
  leadAcquisition,
  leadQuality,
  rangeFor,
  salesConversion,
  serviceDemand,
  servicePerformance,
  sourcePerformance,
  MIN_SAMPLE_FOR_RATE,
} from '../services/report-service';

/**
 * Reports.
 *
 * One endpoint per question, plus a combined `/summary` for the reports page, so a
 * dashboard can load everything in one request without the page having to know how many
 * queries that costs.
 *
 * Every rate in these payloads may legitimately be null — that is the "not enough data
 * to say" case, and the UI must render it as such rather than as zero.
 */
export default async function reportRoutes(app: FastifyInstance) {
  const query = z.object({
    days: z.coerce.number().min(1).max(365).default(30),
    includeDemo: z.coerce.boolean().default(false),
  });

  app.get('/acquisition', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    return { points: await leadAcquisition(rangeFor(q.days), q.includeDemo), days: q.days };
  });

  app.get('/quality', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    return leadQuality(rangeFor(q.days), q.includeDemo);
  });

  app.get('/conversion', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    return salesConversion(rangeFor(q.days), q.includeDemo);
  });

  app.get('/sources', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    return { items: await sourcePerformance(rangeFor(q.days), q.includeDemo) };
  });

  app.get('/services', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    return { items: await servicePerformance(rangeFor(q.days), q.includeDemo) };
  });

  app.get('/campaigns', { onRequest: [app.requirePermission('campaign:read')] }, async (req) => {
    const q = query.parse(req.query);
    return { items: await campaignPerformance(rangeFor(q.days)) };
  });

  app.get('/demand', { onRequest: [app.requirePermission('market:read')] }, async (req) => {
    const q = query.parse(req.query);
    return { items: await serviceDemand(q.includeDemo) };
  });

  /** Everything the reports page needs, in one round trip. */
  app.get('/summary', { onRequest: [app.requirePermission('report:read')] }, async (req) => {
    const q = query.parse(req.query);
    const range = rangeFor(q.days);

    const [acquisition, quality, conversion, sources, services, campaigns, demand] = await Promise.all([
      leadAcquisition(range, q.includeDemo),
      leadQuality(range, q.includeDemo),
      salesConversion(range, q.includeDemo),
      sourcePerformance(range, q.includeDemo),
      servicePerformance(range, q.includeDemo),
      campaignPerformance(range),
      serviceDemand(q.includeDemo),
    ]);

    return {
      days: q.days,
      // Sent to the client so the UI can explain *why* a rate is missing rather than
      // silently printing a dash.
      minSampleForRate: MIN_SAMPLE_FOR_RATE,
      acquisition,
      quality,
      conversion,
      sources,
      services,
      campaigns,
      demand,
    };
  });
}
