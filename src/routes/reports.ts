import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

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
