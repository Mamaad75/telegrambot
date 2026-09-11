#!/usr/bin/env node
/**
 * Jarchi 500-user smoke/load harness.
 *
 * Usage:
 *   BACKEND_URL=https://bot.example.com node tools/load-test-500.mjs
 *   BACKEND_URL=https://bot.example.com HEALTH_PATH=/health node tools/load-test-500.mjs
 *
 * This measures the HTTP edge only unless a protected endpoint is configured.
 * It deliberately does not manufacture customer auth tokens or site secrets.
 */
const base = String(process.env.BACKEND_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const path = process.env.HEALTH_PATH || '/health';
const users = Number(process.env.USERS || 500);
const rounds = Number(process.env.ROUNDS || 4);
const concurrency = Math.max(1, Math.min(users, Number(process.env.CONCURRENCY || 100)));
const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 10000);

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function one(i) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal, headers: { 'X-Load-Test-User': String(i) } });
    const ms = performance.now() - start;
    return { ok: res.ok, status: res.status, ms };
  } catch (error) {
    return { ok: false, status: 0, ms: performance.now() - start, error: error.name };
  } finally { clearTimeout(timer); }
}

async function runRound(round) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, users) }, async () => {
    while (true) {
      const i = next++;
      if (i >= users) return;
      results.push(await one(i + round * users));
    }
  });
  await Promise.all(workers);
  return results;
}

const all = [];
const started = Date.now();
for (let round = 0; round < rounds; round += 1) {
  const result = await runRound(round);
  all.push(...result);
  console.log(JSON.stringify({ round: round + 1, users, ok: result.filter(r => r.ok).length, errors: result.filter(r => !r.ok).length, p50_ms: Math.round(percentile(result.map(r => r.ms), 50)), p95_ms: Math.round(percentile(result.map(r => r.ms), 95)), p99_ms: Math.round(percentile(result.map(r => r.ms), 99)) }));
}
const failures = all.filter(r => !r.ok).length;
const p95 = percentile(all.map(r => r.ms), 95);
const pass = failures === 0 && p95 < Number(process.env.P95_BUDGET_MS || 1000);
console.log(JSON.stringify({ summary: true, total_requests: all.length, failures, p95_ms: Math.round(p95), duration_s: ((Date.now() - started) / 1000).toFixed(2), pass }));
process.exitCode = pass ? 0 : 1;
