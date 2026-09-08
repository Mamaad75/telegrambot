import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { AICompletionRequest, AICompletionResult, AIProvider, ProviderDescriptor } from '../types';
import { estimateCostUsd, type ModelPrice } from './pricing';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

export interface OpenAiCompatibleOptions {
  key: string;
  displayName: string;
  description: string;
  requiredConfig: string[];
  cost: 'FREE' | 'PAID' | 'FREEMIUM';
  docsUrl?: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  /** Some gateways (Ollama) accept requests without an Authorization header. */
  apiKeyOptional?: boolean;
  priority?: number;
  pricing?: Record<string, ModelPrice>;
}

/**
 * Adapter for every OpenAI-compatible chat-completions endpoint: OpenAI itself,
 * OpenRouter/Together-style gateways, and local servers such as Ollama.
 *
 * Keeping one implementation for all three is what makes swapping AI vendors a
 * configuration change rather than a code change.
 */
export class OpenAiCompatibleProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.descriptor = {
      key: opts.key,
      kind: 'AI',
      displayName: opts.displayName,
      description: opts.description,
      requiredConfig: opts.requiredConfig,
      cost: opts.cost,
      docsUrl: opts.docsUrl,
      defaultRateLimit: { perMinute: 20, perHour: 300, perDay: 2000 },
      priority: opts.priority ?? 50,
    };
  }

  get model(): string {
    return this.opts.model ?? 'unknown';
  }

  isConfigured(): boolean {
    if (!this.opts.baseUrl || !this.opts.model) return false;
    return this.opts.apiKeyOptional ? true : Boolean(this.opts.apiKey);
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.opts.baseUrl) missing.push(this.opts.requiredConfig.find((c) => c.includes('BASE_URL')) ?? 'BASE_URL');
    if (!this.opts.model) missing.push(this.opts.requiredConfig.find((c) => c.includes('MODEL')) ?? 'MODEL');
    if (!this.opts.apiKeyOptional && !this.opts.apiKey) {
      missing.push(this.opts.requiredConfig.find((c) => c.includes('API_KEY')) ?? 'API_KEY');
    }
    return missing;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Missing: ${this.missingConfig().join(', ')}` };
    try {
      const result = await this.complete({
        system: 'You are a health check. Reply with the single word OK.',
        user: 'ping',
        maxTokens: 8,
        temperature: 0,
      });
      return { ok: true, message: `Model ${result.model} responded in ${result.latencyMs}ms` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, `Missing configuration: ${this.missingConfig().join(', ')}`);
    }
    const started = Date.now();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2000,
    };
    if (req.jsonSchemaName) body.response_format = { type: 'json_object' };

    const { data } = await httpJson<ChatCompletionResponse>(`${this.opts.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeoutMs: 120_000,
      retries: 1,
      maxBytes: 5_000_000,
      providerKey: this.descriptor.key,
      signal: req.signal,
    });

    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new ProviderError(this.descriptor.key, 'Model returned an empty response', { retryable: true });

    const model = data.model ?? this.model;
    return {
      text,
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      estimatedCostUsd: estimateCostUsd(model, data.usage?.prompt_tokens, data.usage?.completion_tokens, this.opts.pricing) ?? undefined,
      latencyMs: Date.now() - started,
      raw: data,
    };
  }
}
