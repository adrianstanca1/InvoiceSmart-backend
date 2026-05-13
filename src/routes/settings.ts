import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM settings WHERE user_id = $1', [req.user!.id]);
    const rows = result.rows;
    const obj: Record<string, any> = {};
    rows.forEach((r: any) => { obj[r.key] = r.value; });
    res.json(obj);
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { key, value } = req.body;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    const result = await query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
      [req.user!.id, key, JSON.stringify(value)]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

export default router;
