import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

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
