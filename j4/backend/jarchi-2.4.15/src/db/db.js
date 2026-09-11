import pg from "pg";
import "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX || 30),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // Keeps a hung backend from pinning a request for the whole request timeout.
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 10000),
  maxLifetimeSeconds: Number(process.env.DATABASE_MAX_LIFETIME_SECONDS || 0),
});

// A pool-level error (idle client killed by the server, network blip) must not
// take the process down.
pool.on("error", (error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    service: "jarchi",
    message: "postgres pool error",
    error: { message: error.message },
  }));
});

export const query = (sql, params = []) => pool.query(sql, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Liveness-safe connectivity probe used by /health/ready. */
export async function pingDatabase(timeoutMs = 2000) {
  const started = Date.now();
  const client = await Promise.race([
    pool.connect(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("database connect timeout")), timeoutMs)),
  ]);
  try {
    await client.query("SELECT 1");
    return { ok: true, latency_ms: Date.now() - started };
  } finally {
    client.release();
  }
}

export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max ?? null };
}
