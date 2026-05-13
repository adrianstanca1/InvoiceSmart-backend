// Vitest globalSetup — runs once before all suites in a separate process.
// Ensures invoicesmart_test DB exists and schema is up to date.
// globalSetup runs in its own process and does NOT inherit setupFiles env,
// so we replicate the env-setup logic here.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST_TEST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT_TEST || '55432';
process.env.DB_NAME = 'invoicesmart_test';

import { ensureTestDb, closePool } from './helpers/db';

export async function setup(): Promise<void> {
  await ensureTestDb();
  await closePool();
}

export async function teardown(): Promise<void> {
  // Each worker closes its own pool in afterAll().
}
