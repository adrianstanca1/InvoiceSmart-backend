import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('transactions', () => {
  let user: TestUser;
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
  });
  afterAll(async () => { await closePool(); });

  it('POST /api/transactions creates a standalone expense', async () => {
    const res = await client()
      .post('/api/transactions')
      .set('Authorization', bearer(user))
      .send({ type: 'expense', amount: 250.50, transaction_date: '2026-05-13', category: 'fuel', description: 'Diesel for site truck' });
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.amount)).toBe(250.5);
    expect(res.body.category).toBe('fuel');
  });

  it('rejects POST referencing another user\'s invoice with 404', async () => {
    const otherUser = await registerUser();
    const oc = await client().post('/api/clients').set('Authorization', bearer(otherUser)).send({ name: 'X' });
    const oi = await client().post('/api/invoices').set('Authorization', bearer(otherUser)).send({ client_id: oc.body.id, tax_rate: 0, line_items: [{ description: 'X', quantity: 1, unit_price: 100 }] });
    const res = await client().post('/api/transactions').set('Authorization', bearer(user)).send({ invoice_id: oi.body.id, type: 'payment', amount: 50, transaction_date: '2026-05-13' });
    expect(res.status).toBe(404);
  });

  it('GET /api/transactions filters by type and date range', async () => {
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'expense', amount: 100, transaction_date: '2026-01-15' });
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'expense', amount: 200, transaction_date: '2026-03-15' });
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'payment', amount: 500, transaction_date: '2026-03-15' });

    const expensesAll = await client().get('/api/transactions?type=expense').set('Authorization', bearer(user));
    expect(expensesAll.body.data).toHaveLength(2);

    const q1 = await client().get('/api/transactions?startDate=2026-01-01&endDate=2026-02-01').set('Authorization', bearer(user));
    expect(q1.body.data).toHaveLength(1);
  });

  it('GET /api/transactions/invoice/:invoiceId requires UUID', async () => {
    const res = await client().get('/api/transactions/invoice/not-uuid').set('Authorization', bearer(user));
    expect(res.status).toBe(400);
  });

  it('DELETE /api/transactions/:id removes only own transaction', async () => {
    const created = await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'expense', amount: 10, transaction_date: '2026-05-13' });
    const other = await registerUser();
    const denied = await client().delete(`/api/transactions/${created.body.id}`).set('Authorization', bearer(other));
    expect(denied.status).toBe(404);

    const ok = await client().delete(`/api/transactions/${created.body.id}`).set('Authorization', bearer(user));
    expect(ok.status).toBe(204);
  });
});
