import { BUSINESS_CATEGORIES, normalizeText } from '@baimar/shared';
import { loadEnv } from '../../config/env';
import { cached } from '../../lib/cache';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import { waitForHostSlot } from '../../lib/rate-limiter';
import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider, ProviderDescriptor } from '../types';

/**
 * OpenStreetMap lead source, via the public Overpass API.
 *
 * This is the default discovery provider precisely because it needs no key: the platform
 * must be fully usable without any Google contract. Data is ODbL licensed, so every lead
 * sourced here keeps a link back to the OSM object and the UI shows the attribution.
 *
 * Politeness: city bounding boxes are geocoded once and cached for 30 days, and both
 * Nominatim and Overpass calls are spaced out by the shared host throttle.
 */

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface NominatimPlace {
  boundingbox: [string, string, string, string];
  lat: string;
  lon: string;
  display_name: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export class OverpassProvider implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'osm_overpass',
    kind: 'LEAD_SOURCE',
    displayName: 'OpenStreetMap (Overpass)',
    description:
      'Public business listings from OpenStreetMap. Free, no API key, no quota contract. Requires ODbL attribution when displayed.',
    requiredConfig: [],
    cost: 'FREE',
    docsUrl: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    defaultRateLimit: { perMinute: 4, perHour: 60, perDay: 500 },
    priority: 50,
    attribution: '© OpenStreetMap contributors (ODbL)',
  };

  isConfigured(): boolean {
    return loadEnv().OVERPASS_ENABLED;
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['OVERPASS_ENABLED'];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await httpJson<OverpassResponse>(loadEnv().OVERPASS_ENDPOINT, {
        method: 'POST',
        body: '[out:json][timeout:10];node["amenity"="cafe"](35.69,51.38,35.70,51.39);out 1;',
        headers: { 'content-type': 'text/plain' },
        timeoutMs: 20000,
        retries: 0,
        providerKey: this.descriptor.key,
      });
      return { ok: true, message: `Overpass reachable (${data.elements?.length ?? 0} sample elements)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const env = loadEnv();
    if (!this.isConfigured()) throw new ProviderError(this.descriptor.key, 'Overpass provider is disabled');

    const bbox = await this.resolveBoundingBox(query);
    if (!bbox) {
      throw new ProviderError(
        this.descriptor.key,
        `Could not resolve a geographic area for "${query.city ?? query.province ?? 'unknown location'}"`,
      );
    }

    const ql = this.buildQuery(query, bbox);
    await waitForHostSlot(new URL(env.OVERPASS_ENDPOINT).host, 2000);

    const { data, response } = await httpJson<OverpassResponse>(env.OVERPASS_ENDPOINT, {
      method: 'POST',
      body: ql,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      timeoutMs: env.OVERPASS_TIMEOUT_MS,
      retries: 1,
      maxBytes: 12_000_000,
      providerKey: this.descriptor.key,
      signal: query.signal,
    });

    if (response.truncated) {
      throw new ProviderError(this.descriptor.key, 'Overpass response exceeded the size limit; narrow the search');
    }

    const out: DiscoveredBusiness[] = [];
    for (const el of data.elements ?? []) {
      const business = this.toBusiness(el, query);
      if (business) out.push(business);
      if (out.length >= query.limit) break;
    }
    return out;
  }

  /* ----------------------------------------------------------------------- */

  private async resolveBoundingBox(query: DiscoveryQuery): Promise<[number, number, number, number] | null> {
    if (
      query.latitude !== undefined &&
      query.longitude !== undefined &&
      query.radiusMeters !== undefined
    ) {
      const dLat = query.radiusMeters / 111_320;
      const dLon = query.radiusMeters / (111_320 * Math.cos((query.latitude * Math.PI) / 180) || 1);
      return [query.latitude - dLat, query.longitude - dLon, query.latitude + dLat, query.longitude + dLon];
    }

    const place = [query.city, query.province, query.country ?? 'Iran'].filter(Boolean).join(', ');
    if (!place) return null;

    return cached(`geocode:${normalizeText(place)}`, 60 * 60 * 24 * 30, async () => {
      await waitForHostSlot('nominatim.openstreetmap.org', 1200);
      const url = `${NOMINATIM_URL}?${new URLSearchParams({
        q: place,
        format: 'json',
        limit: '1',
        countrycodes: (query.country ?? 'ir').toLowerCase() === 'ir' ? 'ir' : '',
      })}`;
      const { data } = await httpJson<NominatimPlace[]>(url, {
        timeoutMs: 20000,
        retries: 1,
        providerKey: this.descriptor.key,
      });
      const first = data?.[0];
      if (!first) return null;
      const [south, north, west, east] = first.boundingbox.map(Number);
      return [south, west, north, east] as [number, number, number, number];
    });
  }

  /**
   * Translate a category into OSM tag filters. Known categories map onto curated tags;
   * anything else falls back to a case-insensitive name match, which is how Persian
   * free-text categories still return results.
   */
  private tagFiltersFor(category: string): string[] {
    const norm = normalizeText(category);
    const known = BUSINESS_CATEGORIES.find(
      (c) => normalizeText(c.fa) === norm || normalizeText(c.en) === norm || c.key === category,
    );
    if (known?.osm?.length) {
      return known.osm.map((tag) => {
        const [k, v] = tag.split('=');
        return `["${k}"="${v}"]`;
      });
    }
    // Unknown category: match the business name, and require it to be a named POI.
    const escaped = category.replace(/["\\]/g, '');
    return [`["name"~"${escaped}",i]`];
  }

  private buildQuery(query: DiscoveryQuery, bbox: [number, number, number, number]): string {
    const env = loadEnv();
    const box = bbox.map((n) => n.toFixed(6)).join(',');
    const filters = this.tagFiltersFor(query.category);
    const parts: string[] = [];
    for (const f of filters) {
      for (const kind of ['node', 'way', 'relation'] as const) {
        parts.push(`  ${kind}${f}["name"](${box});`);
      }
    }
    const timeoutSec = Math.max(25, Math.floor(env.OVERPASS_TIMEOUT_MS / 1000));
    return [
      `[out:json][timeout:${timeoutSec}];`,
      '(',
      ...parts,
      ');',
      `out center tags ${Math.min(query.limit * 2, 1000)};`,
    ].join('\n');
  }

  private toBusiness(el: OverpassElement, query: DiscoveryQuery): DiscoveredBusiness | null {
    const tags = el.tags ?? {};
    const name = tags.name || tags['name:fa'] || tags['name:en'] || tags.brand || tags.operator;
    if (!name) return null;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    const addressParts = [
      tags['addr:street'],
      tags['addr:housenumber'],
      tags['addr:neighbourhood'],
      tags['addr:suburb'],
      tags['addr:city'],
    ].filter(Boolean);

    const phone = tags.phone || tags['contact:phone'] || tags['phone:IR'] || undefined;
    const website = tags.website || tags['contact:website'] || tags.url || undefined;
    const instagram = tags['contact:instagram'] || undefined;
    const telegram = tags['contact:telegram'] || undefined;

    const categoryTag =
      tags.amenity || tags.shop || tags.office || tags.craft || tags.tourism || tags.leisure || tags.healthcare;

    return {
      providerKey: this.descriptor.key,
      externalId: `${el.type}/${el.id}`,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      origin: 'PUBLIC_BUSINESS_RESEARCH',
      name,
      category: query.category,
      subcategory: categoryTag,
      businessType: categoryTag,
      country: query.country ?? 'IR',
      province: query.province ?? tags['addr:province'] ?? undefined,
      city: tags['addr:city'] ?? query.city ?? undefined,
      area: tags['addr:neighbourhood'] ?? tags['addr:suburb'] ?? undefined,
      address: addressParts.length ? addressParts.join('، ') : undefined,
      latitude: lat,
      longitude: lon,
      phone,
      email: tags.email || tags['contact:email'] || undefined,
      website,
      instagramUrl: instagram
        ? instagram.startsWith('http')
          ? instagram
          : `https://instagram.com/${instagram.replace(/^@/, '')}`
        : undefined,
      telegramUrl: telegram
        ? telegram.startsWith('http')
          ? telegram
          : `https://t.me/${telegram.replace(/^@/, '')}`
        : undefined,
      facebookUrl: tags['contact:facebook'] || undefined,
      description: tags.description || undefined,
      openingHours: tags.opening_hours ? { raw: tags.opening_hours } : null,
      // OSM has no review data. Leaving these undefined is deliberate — the UI shows
      // "Unknown" rather than implying the business has zero reviews.
      raw: { type: el.type, id: el.id, tags },
    };
  }
}
