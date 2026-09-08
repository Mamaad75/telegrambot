import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider, ProviderDescriptor } from '../types';

/**
 * Manual / CSV lead source.
 *
 * It has no discovery of its own — it exists so that leads created by hand or imported
 * from a spreadsheet carry a real source reference, and so the campaign builder can list
 * "Manual" alongside the automated adapters.
 */
export class ManualProvider implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'manual',
    kind: 'LEAD_SOURCE',
    displayName: 'Manual / CSV import',
    description: 'Leads entered by hand or imported from a CSV file. Always available.',
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
    return { ok: true, message: 'Always available' };
  }

  async discover(_query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    // Nothing to discover: this source is fed by the import and lead-creation endpoints.
    return [];
  }
}
