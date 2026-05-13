import { Router } from 'express';
import { query } from '../db';
import { applyUuidValidation, authMiddleware, AuthenticatedRequest } from '../middleware';
import { writeAudit } from '../lib/audit';

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
    const rule = result.rows[0];
    await writeAudit({
      userId: req.user!.id,
      entityType: 'tax_rule',
      entityId: rule.id,
      action: 'create',
      newValues: rule,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, rate, type, country, is_default } = req.body;
    const existing = await query('SELECT * FROM tax_rules WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    if (existing.rowCount === 0) { res.status(404).json({ error: 'Tax rule not found' }); return; }
    const result = await query(
      'UPDATE tax_rules SET name = $1, rate = $2, type = $3, country = $4, is_default = $5, updated_at = NOW() WHERE id = $6 AND user_id = $7 RETURNING *',
      [name, rate, type || 'vat', country || null, is_default || false, req.params.id, req.user!.id]
    );
    const rule = result.rows[0];
    await writeAudit({
      userId: req.user!.id,
      entityType: 'tax_rule',
      entityId: rule.id,
      action: 'update',
      oldValues: existing.rows[0],
      newValues: rule,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.json(rule);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('DELETE FROM tax_rules WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Tax rule not found' }); return; }
    await writeAudit({
      userId: req.user!.id,
      entityType: 'tax_rule',
      entityId: req.params.id,
      action: 'delete',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
