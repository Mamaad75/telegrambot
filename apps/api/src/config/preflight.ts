import { loadEnv, type Env } from './env';

/**
 * Configuration preflight.
 *
 * One vocabulary for "is this integration usable?", shared by
 *   * start-up validation (main.ts / worker.ts),
 *   * `npm run providers:check`,
 *   * `npm run production:check`,
 *   * the admin UI.
 *
 * The distinction that matters operationally:
 *   MANDATORY  — the process cannot serve traffic without it; a failure aborts start-up.
 *   OPTIONAL   — a capability degrades; the app boots and reports the gap.
 */

export type ConfigStatus = 'CONFIGURED' | 'NOT_CONFIGURED' | 'INVALID_CONFIGURATION' | 'ERROR';

export interface ConfigCheck {
  key: string;
  label: string;
  mandatory: boolean;
  status: ConfigStatus;
  /** Human-readable detail; never contains a secret value. */
  detail: string;
  /** Environment variables involved, for the "how do I fix this" hint. */
  variables?: string[];
}

/* -------------------------------------------------------------------------- */
/*  Unsafe production defaults                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Values that are convenient in development and dangerous in production.
 *
 * These are the literal defaults shipped in `.env.example` and the development
 * compose file. Under NODE_ENV=production the app refuses to start while any of
 * them is still in place — a weak secret that "works" is worse than a boot failure,
 * because nobody notices it.
 */
export const UNSAFE_PRODUCTION_VALUES: Record<string, string[]> = {
  JWT_SECRET: ['change-me', 'changeme', 'secret', 'dev-secret', 'baimar-dev-jwt-secret-change-me'],
  APP_ENCRYPTION_KEY: ['change-me', 'changeme', 'baimar-dev-encryption-key-change-me'],
  SEED_ADMIN_PASSWORD: ['ChangeMe123!', 'admin', 'password', '12345678'],
  POSTGRES_PASSWORD: ['baimar', 'postgres', 'password', 'changeme'],
};

/** Minimum secret length accepted in production (development allows 16). */
const PRODUCTION_SECRET_MIN_LENGTH = 32;

function looksLikePlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v.includes('change') ||
    v.includes('replace') ||
    v.includes('example') ||
    v.includes('your-') ||
    v.includes('<') ||
    v === ''
  );
}

/**
 * Production-only secret validation.
 *
 * Returns one message per problem. An empty array means the deployment is safe to
 * boot; the caller decides whether to warn (checklist command) or abort (start-up).
 */
export function productionSecretProblems(e: Env, raw: NodeJS.ProcessEnv = process.env): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  const secrets: Array<[string, string | undefined]> = [
    ['JWT_SECRET', e.JWT_SECRET],
    ['APP_ENCRYPTION_KEY', e.APP_ENCRYPTION_KEY],
    ['SEED_ADMIN_PASSWORD', e.SEED_ADMIN_PASSWORD],
    ['POSTGRES_PASSWORD', raw.POSTGRES_PASSWORD],
  ];

  for (const [name, value] of secrets) {
    if (value === undefined) continue; // POSTGRES_PASSWORD is absent when Postgres is external
    const banned = UNSAFE_PRODUCTION_VALUES[name] ?? [];
    if (banned.some((b) => b.toLowerCase() === value.trim().toLowerCase())) {
      problems.push(`${name} still holds a development default. Generate a unique value before deploying.`);
      continue;
    }
    if (looksLikePlaceholder(value)) {
      problems.push(`${name} looks like a placeholder ("change me" / "your-…"). Set a real value.`);
      continue;
    }
    if ((name === 'JWT_SECRET' || name === 'APP_ENCRYPTION_KEY') && value.length < PRODUCTION_SECRET_MIN_LENGTH) {
      problems.push(
        `${name} is ${value.length} characters; production requires at least ${PRODUCTION_SECRET_MIN_LENGTH}. Use: openssl rand -base64 48`,
      );
    }
  }

  if (e.JWT_SECRET === e.APP_ENCRYPTION_KEY) {
    problems.push('JWT_SECRET and APP_ENCRYPTION_KEY are identical. They protect different things and must differ.');
  }

  // A database reachable with the development credentials is a live risk, not a style issue.
  if (/:\/\/baimar:baimar@/.test(e.DATABASE_URL)) {
    problems.push('DATABASE_URL still uses the development credentials baimar:baimar.');
  }

  if (e.WEB_ORIGIN.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(e.WEB_ORIGIN)) {
    problems.push(`WEB_ORIGIN (${e.WEB_ORIGIN}) is plain HTTP. Cookies and tokens must travel over HTTPS in production.`);
  }

  if ((e.CORS_EXTRA_ORIGINS ?? '').split(',').some((o) => o.trim() === '*')) {
    problems.push('CORS_EXTRA_ORIGINS contains "*". Wildcard CORS is refused in production because the API uses credentials.');
  }

  if (e.DEMO_MODE) {
    problems.push('DEMO_MODE is on. Demo leads would be visible to the sales team as if they were real.');
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Mandatory infrastructure                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Static checks — everything that can be judged from the environment alone,
 * without opening a socket. Live connectivity is checked separately
 * (see `infrastructureChecks` in scripts/production-check.ts).
 */
export function environmentChecks(e: Env = loadEnv(), raw: NodeJS.ProcessEnv = process.env): ConfigCheck[] {
  const checks: ConfigCheck[] = [];

  const secretLengthStatus = (value: string, min: number): ConfigStatus =>
    value.length >= min ? 'CONFIGURED' : 'INVALID_CONFIGURATION';

  checks.push({
    key: 'database',
    label: 'PostgreSQL',
    mandatory: true,
    status: e.DATABASE_URL.startsWith('postgres') ? 'CONFIGURED' : 'INVALID_CONFIGURATION',
    detail: e.DATABASE_URL.startsWith('postgres')
      ? `configured (${redactUrl(e.DATABASE_URL)})`
      : 'DATABASE_URL must be a postgresql:// connection string',
    variables: ['DATABASE_URL'],
  });

  checks.push({
    key: 'redis',
    label: 'Redis',
    mandatory: true,
    status: /^rediss?:\/\//.test(e.REDIS_URL) ? 'CONFIGURED' : 'INVALID_CONFIGURATION',
    detail: /^rediss?:\/\//.test(e.REDIS_URL)
      ? `configured (${redactUrl(e.REDIS_URL)})`
      : 'REDIS_URL must be a redis:// or rediss:// connection string',
    variables: ['REDIS_URL'],
  });

  const minSecret = e.NODE_ENV === 'production' ? PRODUCTION_SECRET_MIN_LENGTH : 16;
  checks.push({
    key: 'jwt_secret',
    label: 'JWT secret',
    mandatory: true,
    status: secretLengthStatus(e.JWT_SECRET, minSecret),
    detail: e.JWT_SECRET.length >= minSecret ? `${e.JWT_SECRET.length} characters` : `too short (minimum ${minSecret})`,
    variables: ['JWT_SECRET'],
  });

  checks.push({
    key: 'encryption_key',
    label: 'Encryption key',
    mandatory: true,
    status: secretLengthStatus(e.APP_ENCRYPTION_KEY, minSecret),
    detail:
      e.APP_ENCRYPTION_KEY.length >= minSecret
        ? `${e.APP_ENCRYPTION_KEY.length} characters`
        : `too short (minimum ${minSecret})`,
    variables: ['APP_ENCRYPTION_KEY'],
  });

  const secretProblems = productionSecretProblems(e, raw);
  if (e.NODE_ENV === 'production') {
    checks.push({
      key: 'production_secrets',
      label: 'Production secret hygiene',
      mandatory: true,
      status: secretProblems.length === 0 ? 'CONFIGURED' : 'INVALID_CONFIGURATION',
      detail: secretProblems.length === 0 ? 'no development defaults in place' : secretProblems.join(' | '),
    });
  }

  return checks;
}

/** Strip credentials out of a connection string before it reaches a log or an API response. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username.slice(0, 2) + '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

/* -------------------------------------------------------------------------- */
/*  AI configuration                                                           */
/* -------------------------------------------------------------------------- */

/**
 * AI is optional, and the model name is deliberately *not* validated against a
 * hard-coded list: vendors add and retire model identifiers on their own schedule, and a
 * list baked into this repository would start rejecting valid models the day after it
 * shipped. What we do enforce is that a model was named at all — the failure mode we can
 * actually prevent is a silent call against an empty or forgotten model string.
 */
export function aiConfigCheck(e: Env = loadEnv()): ConfigCheck {
  const provider = e.AI_PROVIDER;
  if (provider === 'none') {
    return {
      key: 'ai',
      label: 'AI provider',
      mandatory: false,
      status: 'NOT_CONFIGURED',
      detail: 'AI_PROVIDER=none — sales briefs are generated from the deterministic rules engine.',
      variables: ['AI_PROVIDER'],
    };
  }

  const byProvider: Record<string, { key?: string; model?: string; base?: string; vars: string[]; keyRequired: boolean }> = {
    anthropic: { key: e.ANTHROPIC_API_KEY, model: e.AI_MODEL ?? e.ANTHROPIC_MODEL, vars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'], keyRequired: true },
    openai: { key: e.OPENAI_API_KEY, model: e.AI_MODEL ?? e.OPENAI_MODEL, vars: ['OPENAI_API_KEY', 'OPENAI_MODEL'], keyRequired: true },
    compatible: {
      key: e.COMPATIBLE_AI_API_KEY,
      model: e.AI_MODEL ?? e.COMPATIBLE_AI_MODEL,
      base: e.COMPATIBLE_AI_BASE_URL,
      vars: ['COMPATIBLE_AI_BASE_URL', 'COMPATIBLE_AI_MODEL', 'COMPATIBLE_AI_API_KEY'],
      keyRequired: true,
    },
    local: {
      model: e.AI_MODEL ?? e.LOCAL_AI_MODEL,
      base: e.LOCAL_AI_BASE_URL,
      vars: ['LOCAL_AI_BASE_URL', 'LOCAL_AI_MODEL'],
      keyRequired: false,
    },
  };

  const cfg = byProvider[provider];
  if (!cfg) {
    return {
      key: 'ai',
      label: 'AI provider',
      mandatory: false,
      status: 'INVALID_CONFIGURATION',
      detail: `unknown AI_PROVIDER "${provider}"`,
      variables: ['AI_PROVIDER'],
    };
  }

  const missing: string[] = [];
  if (cfg.keyRequired && !cfg.key) missing.push(cfg.vars.find((v) => v.endsWith('API_KEY')) ?? 'API key');
  if (!cfg.model) missing.push('model name');
  if ((provider === 'compatible' || provider === 'local') && !cfg.base) missing.push('base URL');

  if (missing.length > 0) {
    return {
      key: 'ai',
      label: `AI provider (${provider})`,
      mandatory: false,
      status: 'NOT_CONFIGURED',
      detail: `missing: ${missing.join(', ')} — falling back to the rules-based sales brief`,
      variables: cfg.vars,
    };
  }

  return {
    key: 'ai',
    label: `AI provider (${provider})`,
    mandatory: false,
    status: 'CONFIGURED',
    detail: `model "${cfg.model}", monthly budget $${e.AI_MONTHLY_BUDGET_USD}, minimum lead score ${e.AI_MIN_LEAD_SCORE}`,
    variables: cfg.vars,
  };
}

/* -------------------------------------------------------------------------- */
/*  Start-up validation                                                        */
/* -------------------------------------------------------------------------- */

export interface PreflightResult {
  ok: boolean;
  checks: ConfigCheck[];
  fatal: string[];
  warnings: string[];
}

/**
 * Validate configuration at boot.
 *
 * Fatal only for mandatory infrastructure and, in production, unsafe secrets. A missing
 * optional provider is a warning — the whole platform is designed to run without any of
 * them.
 */
export function preflight(e: Env = loadEnv(), raw: NodeJS.ProcessEnv = process.env): PreflightResult {
  const checks = [...environmentChecks(e, raw), aiConfigCheck(e)];
  const fatal: string[] = [];
  const warnings: string[] = [];

  for (const c of checks) {
    if (c.status === 'CONFIGURED') continue;
    const line = `${c.label}: ${c.detail}`;
    if (c.mandatory) fatal.push(line);
    else warnings.push(line);
  }

  return { ok: fatal.length === 0, checks, fatal, warnings };
}
