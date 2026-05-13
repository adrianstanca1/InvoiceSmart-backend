import { afterAll, describe, expect, it } from 'vitest';
import { client } from './helpers/api';
import { closePool } from './helpers/db';

describe('health', () => {
  afterAll(async () => { await closePool(); });

  it('GET /api/health returns ok with DB metrics', async () => {
    const res = await client().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('invoicesmart-api');
    expect(res.body.db.connected).toBe(true);
    expect(res.body.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('GET /health (top-level alias) matches /api/health', async () => {
    const res = await client().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
