import { Router } from 'express';
import { query } from '../db';
import { applyUuidValidation, authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);
applyUuidValidation(router, ['id']);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM tax_rules WHERE user_id = $1 ORDER BY name', [req.user!.id]);
    const countRes = await query('SELECT COUNT(*)::int as total FROM tax_rules WHERE user_id = $1', [req.user!.id]);
    const total = countRes.rows[0]?.total || 0;
    res.json({ data: result.rows, pagination: { page: 1, limit: total, total, totalPages: 1 } });
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, rate, type, country, is_default } = req.body;
    if (!name || rate == null) { res.status(400).json({ error: 'Name and rate are required' }); return; }
    const result = await query(
      'INSERT INTO tax_rules (user_id, name, rate, type, country, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user!.id, name, rate, type || 'vat', country || null, is_default || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, rate, type, country, is_default } = req.body;
    const result = await query(
      'UPDATE tax_rules SET name = $1, rate = $2, type = $3, country = $4, is_default = $5, updated_at = NOW() WHERE id = $6 AND user_id = $7 RETURNING *',
      [name, rate, type || 'vat', country || null, is_default || false, req.params.id, req.user!.id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Tax rule not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('DELETE FROM tax_rules WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Tax rule not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
