import { afterAll, describe, expect, it } from 'vitest';
import { client } from './helpers/api';
import { closePool } from './helpers/db';

describe('openapi docs', () => {
  afterAll(async () => { await closePool(); });

  it('GET /api/docs serves Swagger UI HTML', async () => {
    const res = await client().get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/swagger/i);
  });

  it('GET /api/openapi.json serves a valid OpenAPI 3 spec', async () => {
    const res = await client().get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('InvoiceSmart API');
    // Spot-check that key paths are documented
    expect(res.body.paths['/api/invoices']).toBeDefined();
    expect(res.body.paths['/api/invoices/{id}/payments']).toBeDefined();
    expect(res.body.paths['/api/ai/generate-invoice']).toBeDefined();
    expect(res.body.components.schemas.Invoice).toBeDefined();
  });

  it('GET /api/openapi.yaml serves the raw yaml', async () => {
    const res = await client().get('/api/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    expect(res.text).toMatch(/openapi: 3\./);
  });
});
