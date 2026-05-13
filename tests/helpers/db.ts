// Helpers to bootstrap the invoicesmart_test database before the
// vitest suite runs. The pattern: a separate DB called invoicesmart_test
// on the same Postgres instance as production, recreated fresh whenever
// the developer asks via FRESH_TEST_DB=1, or reused across runs.
import { Pool } from 'pg';

async function adminPool(): Promise<Pool> {
  return new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });
}

export async function ensureTestDb(): Promise<void> {
  const dbName = process.env.DB_NAME!;
  const admin = await adminPool();
  try {
    const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } else if (process.env.FRESH_TEST_DB === '1') {
      // Drop and recreate — useful when the schema migration changed.
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
      await admin.query(`DROP DATABASE "${dbName}"`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  // initSchema() reads its config from the pg pool exported by src/db.ts,
  // which we've already pointed at invoicesmart_test via setup.ts. Dynamic
  // import after env is set.
  const { initSchema } = await import('../../src/db');
  await initSchema();
}

export async function truncateAll(): Promise<void> {
  const { query } = await import('../../src/db');
  // Order matters: child tables first (FKs cascade off users anyway, but
  // explicit truncate is faster than DROP/CREATE per-test).
  await query(`TRUNCATE TABLE invoice_line_items, transactions, audit_logs, settings, tax_rules, invoices, clients, users CASCADE`);
}

export async function closePool(): Promise<void> {
  const { pool } = await import('../../src/db');
  await pool.end();
}
