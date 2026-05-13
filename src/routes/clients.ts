import { Router } from 'express';
import { query } from '../db';
import { applyUuidValidation, authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
router.use(authMiddleware);
applyUuidValidation(router, ['id']);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM clients WHERE user_id = $1 ORDER BY name', [req.user!.id]);
    const countRes = await query('SELECT COUNT(*)::int as total FROM clients WHERE user_id = $1', [req.user!.id]);
    const total = countRes.rows[0]?.total || 0;
    res.json({ data: result.rows, pagination: { page: 1, limit: total, total, totalPages: 1 } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM clients WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, email, company_name, vat_number, address, phone } = req.body;
    if (!name) { res.status(400).json({ error: 'Name is required' }); return; }
    const result = await query(
      'INSERT INTO clients (user_id, name, email, company_name, vat_number, address, phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user!.id, name, email || null, company_name || null, vat_number || null, address ? JSON.stringify(address) : null, phone || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, email, company_name, vat_number, address, phone } = req.body;
    const result = await query(
      'UPDATE clients SET name = $1, email = $2, company_name = $3, vat_number = $4, address = $5, phone = $6, updated_at = NOW() WHERE id = $7 AND user_id = $8 RETURNING *',
      [name, email || null, company_name || null, vat_number || null, address ? JSON.stringify(address) : null, phone || null, req.params.id, req.user!.id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('DELETE FROM clients WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
