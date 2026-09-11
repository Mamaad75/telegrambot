/**
 * Jarchi migration runner.
 *
 * - ordered by filename, applied exactly once, recorded in schema_migrations
 * - each migration runs inside its own transaction (DDL in PostgreSQL is
 *   transactional, so a failed migration leaves no half-applied schema)
 * - a session advisory lock keeps two deploys from racing each other
 * - checksums detect a migration file that changed after it was applied
 *
 * Usage:
 *   node src/db/migrate.js            apply pending migrations
 *   node src/db/migrate.js --status   list applied/pending, change nothing
 *   node src/db/migrate.js --dry-run  validate SQL in a rolled-back transaction
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);
const LOCK_KEY = 8_374_221; // arbitrary, stable across deploys

const args = new Set(process.argv.slice(2));
const statusOnly = args.has("--status");
const dryRun = args.has("--dry-run");

const checksum = (sql) => crypto.createHash("sha256").update(sql).digest("hex");

async function ensureBookkeeping() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
  await query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS duration_ms INTEGER");
}

async function readMigrations() {
  const names = (await fs.readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return Promise.all(names.map(async (name) => {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    return { name, sql, checksum: checksum(sql) };
  }));
}

async function appliedMigrations() {
  const rows = (await query("SELECT name,checksum,applied_at FROM schema_migrations")).rows;
  return new Map(rows.map((row) => [row.name, row]));
}

async function run() {
  await ensureBookkeeping();

  const migrations = await readMigrations();
  const applied = await appliedMigrations();

  if (statusOnly) {
    for (const migration of migrations) {
      const record = applied.get(migration.name);
      if (!record) console.log(`pending  ${migration.name}`);
      else if (record.checksum && record.checksum !== migration.checksum) {
        console.log(`CHANGED  ${migration.name} (applied ${record.applied_at.toISOString()})`);
      } else {
        console.log(`applied  ${migration.name}`);
      }
    }
    return;
  }

  const drifted = migrations.filter((migration) => {
    const record = applied.get(migration.name);
    return record?.checksum && record.checksum !== migration.checksum;
  });
  if (drifted.length) {
    throw new Error(
      `Migration files changed after being applied: ${drifted.map((m) => m.name).join(", ")}. ` +
      "Add a new migration instead of editing an applied one.",
    );
  }

  const client = await pool.connect();
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
    if (!lock.rows[0].locked) throw new Error("Another migration run holds the lock");

    const pending = migrations.filter((migration) => !applied.has(migration.name));

    /*
     * Dry run: apply the whole pending batch inside one transaction and roll it
     * back. Validating each file in its own rolled-back transaction would fail
     * as soon as one migration depended on the previous one.
     */
    if (dryRun) {
      if (!pending.length) {
        console.log("nothing pending");
      } else {
        try {
          await client.query("BEGIN");
          for (const migration of pending) {
            await client.query(migration.sql);
            console.log(`validated ${migration.name}`);
          }
          console.log(`${pending.length} migration(s) validated; rolling back`);
        } finally {
          await client.query("ROLLBACK").catch(() => {});
        }
      }
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      return;
    }

    for (const migration of pending) {
      const started = Date.now();
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES($1,$2,$3)",
          [migration.name, migration.checksum, Date.now() - started],
        );
        await client.query("COMMIT");
        console.log(`applied  ${migration.name} (${Date.now() - started}ms)`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${migration.name} failed: ${error.message}`);
      }
    }
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  } finally {
    client.release();
  }
}

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
