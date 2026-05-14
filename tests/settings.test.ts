import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('settings', () => {
  let user: TestUser;
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
  });
  afterAll(async () => { await closePool(); });

  it('GET returns the default settings for a new user', async () => {
    const res = await client().get('/api/settings').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.invoicePrefix).toBe('INV-');
    expect(res.body.defaultCurrency).toBe('GBP');
    expect(res.body.defaultTaxRate).toBe(20);
  });

  it('POST writes and GET reads back a single setting', async () => {
    const w = await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'invoicePrefix', value: 'BILL' });
    expect(w.status).toBe(200);
    const r = await client().get('/api/settings').set('Authorization', bearer(user));
    expect(r.body.invoicePrefix).toBe('BILL');
  });

  it('PUT (bulk) writes multiple settings atomically', async () => {
    const res = await client().put('/api/settings').set('Authorization', bearer(user)).send({
      invoicePrefix: 'X-', defaultCurrency: 'EUR', defaultTaxRate: 19,
    });
    expect(res.status).toBe(200);
    expect(res.body.settings.invoicePrefix).toBe('X-');
    expect(res.body.settings.defaultCurrency).toBe('EUR');
    expect(res.body.settings.defaultTaxRate).toBe(19);
  });

  it('rejects unknown setting keys (allowlist defence)', async () => {
    const res = await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'arbitrary_key', value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown settings key/);
  });

  it('accepts receipt_* keys (used internally)', async () => {
    const res = await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'receipt_xyz', value: 'data:image/png;base64,iVBOR' });
    expect(res.status).toBe(200);
  });

  it('aiEndpoint SSRF defence — internal hosts rejected', async () => {
    for (const host of ['http://internal-redis:6379', 'http://cortexbuild-postgres:5432', 'http://supabase-kong:54321']) {
      const res = await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'aiEndpoint', value: host });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/host not allowed/);
    }
  });

  it('aiEndpoint SSRF allowlist — known hosts accepted', async () => {
    for (const host of ['http://127.0.0.1:11434/api/generate', 'https://api.openai.com/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions']) {
      const res = await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'aiEndpoint', value: host });
      expect(res.status).toBe(200);
    }
  });

  it('aiApiKey is masked on readback', async () => {
    await client().post('/api/settings').set('Authorization', bearer(user)).send({ key: 'aiApiKey', value: 'sk-supersecret-1234' });
    const r = await client().get('/api/settings').set('Authorization', bearer(user));
    expect(r.body.aiApiKey).toBe('********');
  });

  it('PUT rejects bulk update with one bad key without writing any', async () => {
    await client().put('/api/settings').set('Authorization', bearer(user)).send({ defaultCurrency: 'USD', evilKey: 'oh-no' })
      .then((res) => expect(res.status).toBe(400));
    const r = await client().get('/api/settings').set('Authorization', bearer(user));
    // defaultCurrency should still be GBP (default) — not partially-applied.
    expect(r.body.defaultCurrency).toBe('GBP');
  });
});
