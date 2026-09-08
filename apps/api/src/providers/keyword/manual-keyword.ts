import type { KeywordInsightProvider, ProviderDescriptor } from '../types';

/**
 * Manual keyword source.
 *
 * Keyword and search-term data imported from a CSV (an export from Keyword Planner, a
 * paid research tool, or a spreadsheet the marketing team maintains). It has no fetch of
 * its own — the import endpoint writes the rows — but it exists as a first-class provider
 * so imported data is attributed and visible in the market dashboard next to API sources.
 */
export class ManualKeywordProvider implements KeywordInsightProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'manual_keywords',
    kind: 'KEYWORD_INSIGHT',
    displayName: 'Manual keyword import',
    description:
      'Keyword and search-term data imported from CSV. Always available; use it when no advertising API is connected.',
    requiredConfig: [],
    cost: 'FREE',
    priority: 10,
  };

  isConfigured(): boolean {
    return true;
  }

  missingConfig(): string[] {
    return [];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Always available (CSV import)' };
  }
}
