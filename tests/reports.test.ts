import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, client, registerUser, TestUser } from './helpers/api';
import { closePool, truncateAll } from './helpers/db';

describe('reports', () => {
  let user: TestUser;
  let clientId: string;
  let invoiceId: string;

  beforeEach(async () => {
    await truncateAll();
    user = await registerUser();
    const c = await client().post('/api/clients').set('Authorization', bearer(user)).send({ name: 'Acme' });
    clientId = c.body.id;
    const inv = await client().post('/api/invoices').set('Authorization', bearer(user)).send({
      client_id: clientId,
      issue_date: '2026-05-13',
      due_date: '2026-06-13',
      tax_rate: 20,
      line_items: [{ description: 'Job', quantity: 1, unit_price: 1000 }],
    });
    invoiceId = inv.body.id;
    await client().patch(`/api/invoices/${invoiceId}/paid`).set('Authorization', bearer(user)).send({});
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({
      type: 'expense', amount: 250, transaction_date: '2026-05-13', category: 'materials', description: 'concrete',
    });
  });
  afterAll(async () => { await closePool(); });

  it('GET /api/reports/dashboard aggregates revenue, expenses, profit', async () => {
    const res = await client().get('/api/reports/dashboard').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.totalInvoiced).toBe(1200);    // 1000 + 20% VAT
    expect(res.body.totalPaid).toBe(1200);
    expect(res.body.totalExpenses).toBe(250);
    expect(res.body.netProfit).toBe(950);
    expect(res.body.invoiceCount).toBe(1);
    expect(res.body.clientCount).toBe(1);
  });

  it('GET /api/reports/profit-loss returns rev/exp/categories', async () => {
    const res = await client().get('/api/reports/profit-loss').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.profitAndLoss.revenue).toBe(1200);
    expect(res.body.profitAndLoss.totalExpenses).toBe(250);
    expect(res.body.profitAndLoss.netProfit).toBe(950);
    const cats = res.body.profitAndLoss.expenses.map((e: any) => e.category);
    expect(cats).toContain('materials');
  });

  it('GET /api/reports/top-expenses returns expenses sorted by amount', async () => {
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'expense', amount: 100, transaction_date: '2026-05-13', category: 'fuel' });
    await client().post('/api/transactions').set('Authorization', bearer(user)).send({ type: 'expense', amount: 500, transaction_date: '2026-05-13', category: 'labour' });
    const res = await client().get('/api/reports/top-expenses').set('Authorization', bearer(user));
    expect(res.body[0].category).toBe('labour');
    expect(res.body[0].amount).toBe(500);
  });

  it('GET /api/reports/tax-estimate returns sum of invoice tax', async () => {
    const res = await client().get('/api/reports/tax-estimate').set('Authorization', bearer(user));
    expect(res.body.vatDue).toBe(200);  // 1000 * 0.20
  });

  it('GET /api/reports/export returns CSV with attachment header', async () => {
    const res = await client().get('/api/reports/export?type=profit-loss').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.text).toContain('Revenue,1200.00');
  });

  it('GET /api/reports/revenue-by-client groups by client', async () => {
    const res = await client().get('/api/reports/revenue-by-client').set('Authorization', bearer(user));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].clientName).toBe('Acme');
    expect(res.body[0].revenue).toBe(1200);
  });

  it('GET /api/reports/summary returns invoice and client counts', async () => {
    const res = await client().get('/api/reports/summary').set('Authorization', bearer(user));
    expect(res.body.invoices.total).toBe(1);
    expect(res.body.clients.total).toBe(1);
    expect(parseFloat(res.body.totalPaid)).toBe(1200);
  });
});
