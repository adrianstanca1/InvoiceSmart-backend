import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('tax-rules', () => {
  let user: TestUser;
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
  });
  afterAll(async () => { await closePool(); });

  it('POST /api/tax-rules creates a rule', async () => {
    const res = await client().post('/api/tax-rules').set('Authorization', bearer(user)).send({
      name: 'UK VAT Standard', rate: 20, type: 'vat', country: 'GB', is_default: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('UK VAT Standard');
    expect(parseFloat(res.body.rate)).toBe(20);
    expect(res.body.is_default).toBe(true);
  });

  it('rejects POST without name or rate', async () => {
    const a = await client().post('/api/tax-rules').set('Authorization', bearer(user)).send({ name: 'x' });
    expect(a.status).toBe(400);
    const b = await client().post('/api/tax-rules').set('Authorization', bearer(user)).send({ rate: 10 });
    expect(b.status).toBe(400);
  });

  it('PUT updates rule, returns 404 for foreign rule', async () => {
    const created = await client().post('/api/tax-rules').set('Authorization', bearer(user)).send({ name: 'A', rate: 5 });
    const upd = await client().put(`/api/tax-rules/${created.body.id}`).set('Authorization', bearer(user)).send({ name: 'A', rate: 7.5 });
    expect(upd.status).toBe(200);
    expect(parseFloat(upd.body.rate)).toBe(7.5);

    const other = await registerUser();
    const denied = await client().put(`/api/tax-rules/${created.body.id}`).set('Authorization', bearer(other)).send({ name: 'A', rate: 9 });
    expect(denied.status).toBe(404);
  });

  it('DELETE removes own rule (204) but not foreign (404)', async () => {
    const created = await client().post('/api/tax-rules').set('Authorization', bearer(user)).send({ name: 'X', rate: 0 });
    const other = await registerUser();
    const denied = await client().delete(`/api/tax-rules/${created.body.id}`).set('Authorization', bearer(other));
    expect(denied.status).toBe(404);
    const ok = await client().delete(`/api/tax-rules/${created.body.id}`).set('Authorization', bearer(user));
    expect(ok.status).toBe(204);
  });
});
