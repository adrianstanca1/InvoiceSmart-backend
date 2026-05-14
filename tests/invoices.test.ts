import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('invoices', () => {
  let user: TestUser;
  let clientId: string;

  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
    const c = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Acme' });
    clientId = c.body.id;
  });
  afterAll(async () => { await closePool(); });

  it('POST /api/invoices creates invoice INV-0001 with correct totals', async () => {
    const res = await client()
      .post('/api/invoices')
      .set('Authorization', bearer(user))
      .send({
        client_id: clientId,
        issue_date: '2026-05-13',
        due_date: '2026-06-13',
        tax_rate: 20,
        line_items: [
          { description: 'Site survey', quantity: 1, unit_price: 1500 },
          { description: 'Foundation', quantity: 40, unit_price: 75 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBe('INV-0001');
    expect(parseFloat(res.body.subtotal)).toBe(4500);
    expect(parseFloat(res.body.tax_amount)).toBe(900);
    expect(parseFloat(res.body.total_amount)).toBe(5400);
    expect(res.body.status).toBe('draft');
  });

  it('numbers per-user (two users both get INV-0001) — multi-tenant safety', async () => {
    const a = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    expect(a.body.invoice_number).toBe('INV-0001');

    const otherUser = await registerUser();
    const otherClient = await client().post('/api/clients').set('Authorization', bearer(otherUser)).send({ name: 'Other Acme' });
    const b = await client().post('/api/invoices').set('Authorization', bearer(otherUser)).send({ client_id: otherClient.body.id, tax_rate: 0, line_items: [{ description: 'Y', quantity: 1, unit_price: 50 }] });
    expect(b.status).toBe(201);
    expect(b.body.invoice_number).toBe('INV-0001');
  });

  it('GET /api/invoices/:id includes line_items and transactions', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({
      client_id: clientId, tax_rate: 0,
      line_items: [{ description: 'X', quantity: 2, unit_price: 100 }],
    });
    const res = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.line_items).toHaveLength(1);
    expect(parseFloat(res.body.line_items[0].amount)).toBe(200);
    expect(res.body.transactions).toHaveLength(0);
  });

  it('POST /api/invoices/:id/send marks invoice as sent', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const send = await client().post(`/api/invoices/${created.body.id}/send`).set('Authorization', bearer(user));
    expect(send.status).toBe(200);
    expect(send.body.status).toBe('sent');
    const get = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(get.body.status).toBe('sent');
    expect(get.body.sent_at).toBeTruthy();
  });

  it('POST /api/invoices/:id/payments records partial and full payments', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 1000 }] });
    const partial = await client().post(`/api/invoices/${created.body.id}/payments`).set('Authorization', bearer(user)).send({ amount: 400 });
    expect(partial.status).toBe(201);

    const after1 = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(after1.body.status).toBe('partial');
    expect(parseFloat(after1.body.amount_paid)).toBe(400);
    expect(parseFloat(after1.body.amount_due)).toBe(600);

    const final = await client().post(`/api/invoices/${created.body.id}/payments`).set('Authorization', bearer(user)).send({ amount: 600 });
    expect(final.status).toBe(201);

    const after2 = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(after2.body.status).toBe('paid');
    expect(parseFloat(after2.body.amount_paid)).toBe(1000);
    expect(parseFloat(after2.body.amount_due)).toBe(0);
    expect(after2.body.transactions).toHaveLength(2);
  });

  it('POST /api/invoices/:id/payments rejects zero/negative amount', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const zero = await client().post(`/api/invoices/${created.body.id}/payments`).set('Authorization', bearer(user)).send({ amount: 0 });
    expect(zero.status).toBe(400);
    const neg = await client().post(`/api/invoices/${created.body.id}/payments`).set('Authorization', bearer(user)).send({ amount: -10 });
    expect(neg.status).toBe(400);
  });

  it('PATCH /api/invoices/:id/paid force-marks paid', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 200 }] });
    const res = await client().patch(`/api/invoices/${created.body.id}/paid`).set('Authorization', bearer(user)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(parseFloat(res.body.amount_paid)).toBe(200);
  });

  it('GET /api/invoices/:id/pdf returns 200 with HTML invoice', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const res = await client().get(`/api/invoices/${created.body.id}/pdf`).set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<html/);
  });

  it('DELETE /api/invoices/:id removes (204)', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const res = await client().delete(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(res.status).toBe(204);
    const after = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(user));
    expect(after.status).toBe(404);
  });

  it('cross-tenant: cannot read another user\'s invoice', async () => {
    const created = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const other = await registerUser();
    const res = await client().get(`/api/invoices/${created.body.id}`).set('Authorization', bearer(other));
    expect(res.status).toBe(404);
  });

  it('non-UUID id is rejected with 400', async () => {
    const res = await client().get('/api/invoices/not-uuid/pdf').set('Authorization', bearer(user));
    expect(res.status).toBe(400);
  });

  it('GET /api/invoices/next/number returns next sequential number', async () => {
    await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const res = await client().get('/api/invoices/next/number').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toBe('INV-0002');
  });

  it('GET /api/invoices filters by status', async () => {
    const a = await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    await client().post(`/api/invoices/${a.body.id}/send`).set('Authorization', bearer(user));
    await client().post('/api/invoices').set('Authorization', bearer(user)).send({ tax_rate: 0, line_items: [{ description: 'Y', quantity: 1, unit_price: 50 }] });

    const sent = await client().get('/api/invoices?status=sent').set('Authorization', bearer(user));
    expect(sent.body.data).toHaveLength(1);
    const draft = await client().get('/api/invoices?status=draft').set('Authorization', bearer(user));
    expect(draft.body.data).toHaveLength(1);
  });

  it('invoice totals: discount + tax + CIS combination', async () => {
    const res = await client()
      .post('/api/invoices')
      .set('Authorization', bearer(user))
      .send({
        client_id: clientId,
        tax_rate: 20,
        discount_rate: 10,
        cis_rate: 20,
        line_items: [{ description: 'Labour', quantity: 1, unit_price: 1000 }],
      });
    // subtotal=1000, discount=100, taxable=900, tax=180, cis=180
    // total = 900 + 180 - 180 = 900
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.subtotal)).toBe(1000);
    expect(parseFloat(res.body.discount_amount)).toBe(100);
    expect(parseFloat(res.body.tax_amount)).toBe(180);
    expect(parseFloat(res.body.cis_amount)).toBe(180);
    expect(parseFloat(res.body.total_amount)).toBe(900);
  });
});
