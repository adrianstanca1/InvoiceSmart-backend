import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { client } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('auth', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('POST /api/auth/register issues a token for new email', async () => {
    const res = await client()
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'SecretPass1!' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^eyJ/);
    expect(res.body.user.email).toBe('alice@example.com');
    expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects register without email/password', async () => {
    const res = await client().post('/api/auth/register').send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate registration with 409', async () => {
    await client().post('/api/auth/register').send({ email: 'dup@x.com', password: 'p1' });
    const res = await client().post('/api/auth/register').send({ email: 'dup@x.com', password: 'p2' });
    expect(res.status).toBe(409);
  });

  it('POST /api/auth/login succeeds with correct credentials', async () => {
    await client().post('/api/auth/register').send({ email: 'bob@x.com', password: 'rightpw' });
    const res = await client().post('/api/auth/login').send({ email: 'bob@x.com', password: 'rightpw' });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
  });

  it('POST /api/auth/login rejects wrong password with 401', async () => {
    await client().post('/api/auth/register').send({ email: 'carol@x.com', password: 'rightpw' });
    const res = await client().post('/api/auth/login').send({ email: 'carol@x.com', password: 'wrongpw' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login rejects unknown email with 401 (no enumeration leak)', async () => {
    const res = await client().post('/api/auth/login').send({ email: 'nobody@x.com', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('GET /api/auth/me returns profile for valid token', async () => {
    const reg = await client().post('/api/auth/register').send({ email: 'me@x.com', password: 'pw', first_name: 'Me' });
    const res = await client().get('/api/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@x.com');
    expect(res.body.first_name).toBe('Me');
  });

  it('GET /api/auth/me rejects missing token with 401', async () => {
    const res = await client().get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me rejects malformed token with 401', async () => {
    const res = await client().get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });
});
