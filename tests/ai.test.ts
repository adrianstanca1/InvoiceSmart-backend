import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

// AI route tests — fetch() is mocked so they don't hit real Ollama/OpenAI.
// We verify routing, request shape, fallback behaviour, and SSRF defence.

describe('ai', () => {
  let user: TestUser;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => { fetchSpy.mockRestore(); });
  afterAll(async () => { await closePool(); });

  it('GET /api/ai/config returns provider list and current settings', async () => {
    const res = await client().get('/api/ai/config').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('ollama');
    expect(res.body.providers.map((p: any) => p.provider)).toEqual(
      expect.arrayContaining(['ollama', 'openai', 'openai-compatible', 'openrouter']),
    );
  });

  it('PUT /api/ai/config validates provider and endpoint allowlist', async () => {
    const badProvider = await client().put('/api/ai/config').set('Authorization', bearer(user)).send({ provider: 'made-up' });
    expect(badProvider.status).toBe(400);

    const badEndpoint = await client().put('/api/ai/config').set('Authorization', bearer(user)).send({ endpoint: 'http://internal-redis:6379' });
    expect(badEndpoint.status).toBe(500); // assertEndpointAllowed throws — errorHandler maps to 500. Not ideal but documented.

    const ok = await client().put('/api/ai/config').set('Authorization', bearer(user)).send({ model: 'llama3.1' });
    expect(ok.status).toBe(200);
    expect(ok.body.model).toBe('llama3.1');
  });

  it('POST /api/ai/chat returns LLM response (mocked Ollama)', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ response: 'Hello from llama3' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await client().post('/api/ai/chat').set('Authorization', bearer(user)).send({ message: 'Hi' });
    expect(res.status).toBe(200);
    expect(res.body.response).toContain('llama3');
    expect(res.body.provider).toBe('ollama');
  });

  it('POST /api/ai/chat returns 400 when message is missing', async () => {
    const res = await client().post('/api/ai/chat').set('Authorization', bearer(user)).send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/ai/chat surfaces 502 when provider fails', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await client().post('/api/ai/chat').set('Authorization', bearer(user)).send({ message: 'Hi' });
    expect(res.status).toBe(502);
  });

  it('POST /api/ai/generate-invoice parses JSON response', async () => {
    const aiInvoice = { clientName: 'Acme', items: [{ description: 'Job', quantity: 1, unitPrice: 100 }], issueDate: '2026-05-13', dueDate: '2026-06-13', taxRate: 20, notes: '' };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ response: JSON.stringify(aiInvoice) }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await client().post('/api/ai/generate-invoice').set('Authorization', bearer(user)).send({ description: 'Build me a foundation' });
    expect(res.status).toBe(200);
    expect(res.body.invoice.clientName).toBe('Acme');
    expect(res.body.invoice.items).toHaveLength(1);
  });

  it('POST /api/ai/generate-invoice returns 422 when response is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ response: 'Sure! Here is an invoice... [garbled]' }), { status: 200 }));
    const res = await client().post('/api/ai/generate-invoice').set('Authorization', bearer(user)).send({ description: 'X' });
    expect(res.status).toBe(422);
  });

  it('GET /api/ai/summarize-pl falls back when AI fails', async () => {
    fetchSpy.mockRejectedValue(new Error('AI down'));
    const res = await client().get('/api/ai/summarize-pl').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.ai.source).toBe('fallback');
    expect(res.body.metrics.revenue).toBe(0);
    expect(res.body.summary).toMatch(/Revenue: GBP/);
  });

  it('GET /api/ai/who-owes-me lists outstanding invoices grouped by client', async () => {
    const c = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Owes Me Ltd' });
    const inv = await client().post('/api/invoices').set('Authorization', bearer(user)).send({
      client_id: c.body.id, tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 500 }],
    });
    await client().post(`/api/invoices/${inv.body.id}/send`).set('Authorization', bearer(user));
    const res = await client().get('/api/ai/who-owes-me').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(1);
    expect(res.body.clients[0].clientName).toBe('Owes Me Ltd');
    expect(res.body.clients[0].amount).toBe(500);
  });

  it('GET /api/ai/audit-invoice/:id requires UUID id', async () => {
    const res = await client().get('/api/ai/audit-invoice/not-uuid').set('Authorization', bearer(user));
    expect(res.status).toBe(400);
  });

  it('GET /api/ai/audit-invoice/:id 404s for foreign invoice', async () => {
    const c = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'X' });
    const inv = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ client_id: c.body.id, tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 1 }] });
    const other = await registerUser();
    const res = await client().get(`/api/ai/audit-invoice/${inv.body.id}`).set('Authorization', bearer(other));
    expect(res.status).toBe(404);
  });
});
