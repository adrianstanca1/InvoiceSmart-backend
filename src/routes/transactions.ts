import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { type, startDate, endDate } = req.query;
    let sql = 'SELECT * FROM transactions WHERE user_id = $1';
    const params: any[] = [req.user!.id];
    let paramIndex = 1;
    if (type) { paramIndex++; sql += ` AND type = $${paramIndex}`; params.push(type); }
    if (startDate) { paramIndex++; sql += ` AND transaction_date >= $${paramIndex}`; params.push(startDate); }
    if (endDate) { paramIndex++; sql += ` AND transaction_date <= $${paramIndex}`; params.push(endDate); }
    sql += ' ORDER BY transaction_date DESC';
    const result = await query(sql, params);
    const countRes = await query('SELECT COUNT(*)::int as total FROM transactions WHERE user_id = $1', [req.user!.id]);
    const total = countRes.rows[0]?.total || 0;
    res.json({ data: result.rows, pagination: { page: 1, limit: total, total, totalPages: 1 } });
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { invoice_id, type: txnType, amount, transaction_date, category, description, reference } = req.body;
    const result = await query(
      'INSERT INTO transactions (user_id, invoice_id, type, amount, transaction_date, category, description, reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user!.id, invoice_id || null, txnType, amount, transaction_date || new Date().toISOString().slice(0, 10), category || null, description || null, reference || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/invoice/:invoiceId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const invoiceRes = await query('SELECT id FROM invoices WHERE id = $1 AND user_id = $2', [req.params.invoiceId, req.user!.id]);
    if (invoiceRes.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const result = await query('SELECT * FROM transactions WHERE invoice_id = $1 ORDER BY created_at DESC', [req.params.invoiceId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const txnRes = await query('SELECT t.*, i.user_id FROM transactions t JOIN invoices i ON t.invoice_id = i.id WHERE t.id = $1', [req.params.id]);
    if (txnRes.rowCount === 0) { res.status(404).json({ error: 'Transaction not found' }); return; }
    if (txnRes.rows[0].user_id !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
    await query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
