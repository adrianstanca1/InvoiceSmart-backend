import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const invoices = await query('SELECT COUNT(*)::int as total, SUM(total_amount)::numeric as revenue FROM invoices WHERE user_id = $1', [userId]);
    const clients = await query('SELECT COUNT(*)::int as total FROM clients WHERE user_id = $1', [userId]);
    const paid = await query('SELECT SUM(amount_paid)::numeric as total FROM invoices WHERE user_id = $1 AND status = $2', [userId, 'paid']);
    const pending = await query('SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1 AND status = $2', [userId, 'sent']);
    const overdueResult = await query(
      'SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1 AND status IN ($2, $3) AND due_date < CURRENT_DATE',
      [userId, 'sent', 'draft']
    );
    res.json({
      totalInvoices: invoices.rows[0]?.total || 0,
      totalRevenue: parseFloat(paid.rows[0]?.total || '0'),
      totalClients: clients.rows[0]?.total || 0,
      pendingInvoices: pending.rows[0]?.total || 0,
      overdueInvoices: overdueResult.rows[0]?.total || 0,
    });
  } catch (err) { next(err); }
});

router.get('/revenue-trend', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const result = await query(
      `SELECT DATE_TRUNC('month', issue_date) as month, SUM(total_amount)::numeric as revenue
       FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
       GROUP BY month ORDER BY month`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json(result.rows.map((r: any) => ({ month: r.month, revenue: parseFloat(r.revenue || '0') })));
  } catch (err) { next(err); }
});

router.get('/profit-loss', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const income = await query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric as total FROM invoices WHERE user_id = $1 AND status = 'paid' AND issue_date BETWEEN $2 AND $3`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0)::numeric as total FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json({
      revenue: parseFloat(income.rows[0]?.total || '0'),
      expenses: parseFloat(expenses.rows[0]?.total || '0'),
      profit: parseFloat(income.rows[0]?.total || '0') - parseFloat(expenses.rows[0]?.total || '0'),
    });
  } catch (err) { next(err); }
});

router.get('/top-expenses', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const result = await query(
      `SELECT category, COALESCE(SUM(amount), 0)::numeric as total FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3 GROUP BY category ORDER BY total DESC LIMIT 10`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json(result.rows.map((r: any) => ({ category: r.category, amount: parseFloat(r.total || '0') })));
  } catch (err) { next(err); }
});

router.get('/tax-estimate', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const result = await query(
      `SELECT COALESCE(SUM(tax_amount), 0)::numeric as total FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json({ taxEstimate: parseFloat(result.rows[0]?.total || '0') });
  } catch (err) { next(err); }
});

router.get('/export', async (_req: AuthenticatedRequest, res) => {
  res.json({ message: 'Report export stub — implement CSV/PDF generation here' });
});

router.get('/summary', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const invoices = await query('SELECT COUNT(*)::int as total, SUM(total_amount)::numeric as revenue FROM invoices WHERE user_id = $1', [userId]);
    const clients = await query('SELECT COUNT(*)::int as total FROM clients WHERE user_id = $1', [userId]);
    const paid = await query('SELECT SUM(amount_paid)::numeric as total FROM invoices WHERE user_id = $1 AND status = $2', [userId, 'paid']);
    res.json({
      invoices: invoices.rows[0],
      clients: clients.rows[0],
      totalPaid: paid.rows[0]?.total || 0,
    });
  } catch (err) { next(err); }
});

export default router;
