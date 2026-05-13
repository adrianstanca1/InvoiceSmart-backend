import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const invoices = await query('SELECT COUNT(*)::int as total, SUM(total_amount)::numeric as revenue, SUM(amount_paid)::numeric as paid FROM invoices WHERE user_id = $1', [userId]);
    const clients = await query('SELECT COUNT(*)::int as total FROM clients WHERE user_id = $1', [userId]);
    const expenses = await query('SELECT COALESCE(SUM(amount),0)::numeric as total FROM transactions WHERE user_id = $1 AND type = $2', [userId, 'expense']);
    const overdueResult = await query(
      "SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1 AND status IN ('sent', 'partial', 'draft') AND due_date < CURRENT_DATE",
      [userId]
    );
    const outstanding = await query(
      "SELECT COALESCE(SUM(amount_due),0)::numeric as total FROM invoices WHERE user_id = $1 AND status IN ('sent', 'partial', 'draft')",
      [userId]
    );
    const revenue = parseFloat(invoices.rows[0]?.revenue || '0');
    const paid = parseFloat(invoices.rows[0]?.paid || '0');
    const expenseTotal = parseFloat(expenses.rows[0]?.total || '0');
    res.json({
      totalRevenue: revenue,
      totalPaid: paid,
      totalExpenses: expenseTotal,
      netProfit: revenue - expenseTotal,
      invoiceCount: invoices.rows[0]?.total || 0,
      clientCount: clients.rows[0]?.total || 0,
      overdueCount: overdueResult.rows[0]?.total || 0,
      outstandingAmount: parseFloat(outstanding.rows[0]?.total || '0'),
    });
  } catch (err) { next(err); }
});

router.get('/revenue-trend', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const result = await query(
      `SELECT DATE_TRUNC('month', issue_date)::date as date, COALESCE(SUM(total_amount),0)::numeric as revenue
       FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
       GROUP BY date ORDER BY date`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json(result.rows.map((r: any) => ({ date: r.date, revenue: parseFloat(r.revenue || '0'), expenses: 0 })));
  } catch (err) { next(err); }
});

router.get('/profit-loss', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const s = (req.query.start as string) || '2020-01-01';
    const e = (req.query.end as string) || '2030-12-31';
    const income = await query(`SELECT COALESCE(SUM(total_amount), 0)::numeric as total FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3`, [userId, s, e]);
    const expenses = await query(`SELECT COALESCE(SUM(amount),0)::numeric as total FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3`, [userId, s, e]);
    const expenseCats = await query(`SELECT category, COALESCE(SUM(amount),0)::numeric as total FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3 GROUP BY category`, [userId, s, e]);
    const rev = parseFloat(income.rows[0]?.total || '0');
    const exp = parseFloat(expenses.rows[0]?.total || '0');
    res.json({
      generatedDate: new Date().toISOString(),
      period: `${s} to ${e}`,
      profitAndLoss: {
        revenue: rev,
        costOfSales: 0,
        grossProfit: rev,
        expenses: expenseCats.rows.map((r: any) => ({ category: r.category || 'Uncategorized', amount: parseFloat(r.total || '0') })),
        totalExpenses: exp,
        netProfit: rev - exp,
      },
      insights: [`Net profit for period: £${(rev - exp).toFixed(2)}`],
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
    const s = (req.query.start as string) || '2020-01-01';
    const e = (req.query.end as string) || '2030-12-31';
    const result = await query(`SELECT COALESCE(SUM(tax_amount), 0)::numeric as total FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3`, [userId, s, e]);
    const vatDue = parseFloat(result.rows[0]?.total || '0');
    res.json({ vatDue, corporationTax: 0, effectiveRate: 0, period: `${s} to ${e}` });
  } catch (err) { next(err); }
});

router.get('/export', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end, type } = req.query;
    const s = start || '2020-01-01';
    const e = end || '2030-12-31';
    let csv = '';
    if (type === 'profit-loss' || !type) {
      const income = await query(`SELECT COALESCE(SUM(total_amount),0)::numeric as rev FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3`, [userId, s, e]);
      const exp = await query(`SELECT COALESCE(SUM(amount),0)::numeric as exp FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3`, [userId, s, e]);
      const rev = parseFloat(income.rows[0]?.rev || '0');
      const ex = parseFloat(exp.rows[0]?.exp || '0');
      csv = `Type,Amount\nRevenue,${rev.toFixed(2)}\nExpenses,${ex.toFixed(2)}\nNet Profit,${(rev - ex).toFixed(2)}`;
    } else if (type === 'revenue') {
      const result = await query(`SELECT invoice_number, total_amount, issue_date FROM invoices WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3`, [userId, s, e]);
      csv = 'Invoice,Amount,Date\n' + result.rows.map((r: any) => `${r.invoice_number},${r.total_amount},${r.issue_date}`).join('\n');
    } else if (type === 'expenses') {
      const result = await query(`SELECT description, amount, transaction_date FROM transactions WHERE user_id = $1 AND type = 'expense' AND transaction_date BETWEEN $2 AND $3`, [userId, s, e]);
      csv = 'Description,Amount,Date\n' + result.rows.map((r: any) => `"${(r.description || '').replace(/"/g, '\"')}",${r.amount},${r.transaction_date}`).join('\n');
    } else {
      csv = 'Type,Amount\n';
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

router.get('/revenue-by-client', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;
    const result = await query(
      `SELECT c.name as client_name, COALESCE(SUM(i.total_amount),0)::numeric as revenue
       FROM clients c LEFT JOIN invoices i ON i.client_id = c.id
       WHERE c.user_id = $1 AND (i.issue_date IS NULL OR i.issue_date BETWEEN $2 AND $3)
       GROUP BY c.id, c.name ORDER BY revenue DESC`,
      [userId, start || '2020-01-01', end || '2030-12-31']
    );
    res.json(result.rows.map((r: any) => ({ clientName: r.client_name, revenue: parseFloat(r.revenue || '0') })));
  } catch (err) { next(err); }
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
