import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider, ProviderDescriptor } from '../types';

/**
 * Google Places API (New) lead source — entirely optional.
 *
 * Used only when GOOGLE_MAPS_API_KEY is configured, through the official REST endpoint
 * and within Google's quotas and terms. When no key exists the registry simply skips this
 * adapter and discovery continues with OpenStreetMap / CSV import.
 */

interface PlacesTextSearchResponse {
  places?: PlaceResult[];
  nextPageToken?: string;
}

interface PlaceResult {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  googleMapsUri?: string;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>;
  editorialSummary?: { text: string };
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.types',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.addressComponents',
  'places.editorialSummary',
  'nextPageToken',
].join(',');

export class GooglePlacesProvider implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'google_places',
    kind: 'LEAD_SOURCE',
    displayName: 'Google Places API',
    description:
      'Official Google Places API (New). Optional — requires a billed Google Cloud API key. Never required for the platform to run.',
    requiredConfig: ['GOOGLE_MAPS_API_KEY'],
    cost: 'PAID',
    docsUrl: 'https://developers.google.com/maps/documentation/places/web-service/text-search',
    defaultRateLimit: { perMinute: 30, perHour: 600, perDay: 2000 },
    priority: 90,
    attribution: 'Business data © Google',
  };

  isConfigured(): boolean {
    return Boolean(loadEnv().GOOGLE_MAPS_API_KEY);
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['GOOGLE_MAPS_API_KEY'];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: 'GOOGLE_MAPS_API_KEY is not set' };
    try {
      const res = await this.textSearch('coffee in Tehran', 1);
      return { ok: true, message: `Places API reachable (${res.places?.length ?? 0} results)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, 'GOOGLE_MAPS_API_KEY is not configured');
    }
    const location = [query.city, query.province].filter(Boolean).join('، ');
    const textQuery = location ? `${query.category} ${location}` : query.category;

    const out: DiscoveredBusiness[] = [];
    let pageToken: string | undefined;

    // The API returns at most 20 places per page; keep paging until the caller's limit.
    while (out.length < query.limit) {
      const remaining = query.limit - out.length;
      const data = await this.textSearch(textQuery, Math.min(20, remaining), pageToken, query);
      for (const place of data.places ?? []) {
        out.push(this.toBusiness(place, query));
        if (out.length >= query.limit) break;
      }
      pageToken = data.nextPageToken;
      if (!pageToken || !(data.places?.length)) break;
    }
    return out;
  }

  private async textSearch(
    textQuery: string,
    maxResultCount: number,
    pageToken?: string,
    query?: DiscoveryQuery,
  ): Promise<PlacesTextSearchResponse> {
    const env = loadEnv();
    const body: Record<string, unknown> = {
      textQuery,
      maxResultCount,
      languageCode: query?.language ?? env.GOOGLE_PLACES_LANGUAGE,
      regionCode: env.GOOGLE_PLACES_REGION.toUpperCase(),
    };
    if (pageToken) body.pageToken = pageToken;
    if (query?.latitude !== undefined && query?.longitude !== undefined && query?.radiusMeters) {
      body.locationBias = {
        circle: {
          center: { latitude: query.latitude, longitude: query.longitude },
          radius: Math.min(query.radiusMeters, 50_000),
        },
      };
    }

    const { data } = await httpJson<PlacesTextSearchResponse>('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      timeoutMs: 20000,
      retries: 1,
      providerKey: this.descriptor.key,
      signal: query?.signal,
    });
    return data;
  }

  private toBusiness(place: PlaceResult, query: DiscoveryQuery): DiscoveredBusiness {
    const components = place.addressComponents ?? [];
    const find = (type: string) => components.find((c) => c.types.includes(type))?.longText;

    return {
      providerKey: this.descriptor.key,
      externalId: place.id,
      sourceUrl: place.googleMapsUri,
      origin: 'PUBLIC_BUSINESS_RESEARCH',
      name: place.displayName?.text ?? 'Unknown',
      category: query.category,
      subcategory: place.primaryTypeDisplayName?.text ?? place.primaryType,
      businessType: place.types?.[0],
      country: find('country') ?? query.country ?? 'IR',
      province: find('administrative_area_level_1') ?? query.province,
      city: find('locality') ?? find('administrative_area_level_2') ?? query.city,
      area: find('sublocality') ?? find('neighborhood'),
      address: place.formattedAddress ?? place.shortFormattedAddress,
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber,
      website: place.websiteUri,
      googleMapsUrl: place.googleMapsUri,
      description: place.editorialSummary?.text,
      reviewCount: place.userRatingCount,
      reviewRating: place.rating,
      openingHours: place.regularOpeningHours?.weekdayDescriptions ?? null,
      raw: place,
    };
  }
}
