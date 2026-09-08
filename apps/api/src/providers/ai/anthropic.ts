import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { AICompletionRequest, AICompletionResult, AIProvider, ProviderDescriptor } from '../types';
import { estimateCostUsd, type ModelPrice } from './pricing';

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

/** Anthropic Messages API adapter. Optional, like every AI provider. */
export class AnthropicProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'anthropic',
    kind: 'AI',
    displayName: 'Anthropic',
    description: 'Anthropic Messages API. Used for lead analysis and sales brief generation.',
    requiredConfig: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    cost: 'PAID',
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    defaultRateLimit: { perMinute: 20, perHour: 300, perDay: 2000 },
    priority: 90,
  };

  constructor(
    private readonly apiKey: string | undefined,
    private readonly modelName: string,
    private readonly baseUrl: string,
    private readonly pricing?: Record<string, ModelPrice>,
  ) {}

  get model(): string {
    return this.modelName;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.modelName);
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.apiKey) missing.push('ANTHROPIC_API_KEY');
    if (!this.modelName) missing.push('ANTHROPIC_MODEL');
    return missing;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Missing: ${this.missingConfig().join(', ')}` };
    try {
      const r = await this.complete({ system: 'Reply with OK.', user: 'ping', maxTokens: 8, temperature: 0 });
      return { ok: true, message: `Model ${r.model} responded in ${r.latencyMs}ms` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, `Missing configuration: ${this.missingConfig().join(', ')}`);
    }
    const started = Date.now();
    const { data } = await httpJson<AnthropicResponse>(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: req.maxTokens ?? 2000,
        temperature: req.temperature ?? 0.2,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
      timeoutMs: 120_000,
      retries: 1,
      maxBytes: 5_000_000,
      providerKey: this.descriptor.key,
      signal: req.signal,
    });

    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    if (!text) throw new ProviderError(this.descriptor.key, 'Model returned an empty response', { retryable: true });

    const model = data.model ?? this.modelName;
    const promptTokens = data.usage?.input_tokens;
    const completionTokens = data.usage?.output_tokens;

    return {
      text,
      model,
      promptTokens,
      completionTokens,
      totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0) || undefined,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens, this.pricing) ?? undefined,
      latencyMs: Date.now() - started,
      raw: data,
    };
  }
}
