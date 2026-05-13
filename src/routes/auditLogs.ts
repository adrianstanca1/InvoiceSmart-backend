import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [req.user!.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
