import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('clients', () => {
  let user: TestUser;
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
  });
  afterAll(async () => { await closePool(); });

  it('POST /api/clients creates a client (201)', async () => {
    const res = await client()
      .post('/api/clients')
      .set('Authorization', bearer(user))
      .send({ name: 'Acme', email: 'billing@acme.test', company_name: 'Acme Construction Ltd' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.user_id).toBe(user.id);
    expect(res.body.name).toBe('Acme');
  });

  it('rejects POST without name (400)', async () => {
    const res = await client().post('/api/clients').set('Authorization', bearer(user)).send({ email: 'x@x' });
    expect(res.status).toBe(400);
  });

  it('rejects POST without token (401)', async () => {
    const res = await client().post('/api/clients').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('GET /api/clients lists clients for the current user only', async () => {
    await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'A' });
    await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'B' });
    // Another user — should be invisible.
    const other = await registerUser();
    await client().post('/api/clients').set('Authorization', bearer(other)).send({ name: 'Other' });

    const res = await client().get('/api/clients').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((c: any) => c.name).sort()).toEqual(['A', 'B']);
  });

  it('GET /api/clients/:id returns 404 for another user\'s client', async () => {
    const created = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Mine' });
    const other = await registerUser();
    const res = await client().get(`/api/clients/${created.body.id}`).set('Authorization', bearer(other));
    expect(res.status).toBe(404);
  });

  it('GET /api/clients/:id returns 400 for non-UUID id', async () => {
    const res = await client().get('/api/clients/not-a-uuid').set('Authorization', bearer(user));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UUID/);
  });

  it('PUT /api/clients/:id updates client', async () => {
    const created = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Old' });
    const res = await client()
      .put(`/api/clients/${created.body.id}`)
      .set('Authorization', bearer(user))
      .send({ name: 'New', email: 'new@x.com' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.email).toBe('new@x.com');
  });

  it('DELETE /api/clients/:id removes client (204)', async () => {
    const created = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Doomed' });
    const res = await client().delete(`/api/clients/${created.body.id}`).set('Authorization', bearer(user));
    expect(res.status).toBe(204);
    const after = await client().get(`/api/clients/${created.body.id}`).set('Authorization', bearer(user));
    expect(after.status).toBe(404);
  });
});
