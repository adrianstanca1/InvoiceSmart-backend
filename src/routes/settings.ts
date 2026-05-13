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
    rows.forEach((r: any) => { try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; } });
    const defaults = {
      aiProvider: 'ollama', aiModel: 'llama3', aiEndpoint: '',
      invoicePrefix: 'INV-', autoIncrement: true,
      defaultCurrency: 'GBP', defaultTaxRate: 20,
      defaultTerms: 'Payment due within 30 days.',
      defaultPaymentGateway: 'none',
      theme: 'system', notificationsEnabled: true, emailNotifications: false,
    };
    res.json({ ...defaults, ...obj });
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { key, value } = req.body;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    const result = await query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
      [req.user!.id, key, typeof value === 'string' ? value : JSON.stringify(value)]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/settings — bulk update
router.put('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const updates = req.body;
    const client = await query('SELECT 1'); // dummy to ensure pool works
    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
        [req.user!.id, key, typeof value === 'string' ? value : JSON.stringify(value)]
      );
    }
    const result = await query('SELECT * FROM settings WHERE user_id = $1', [req.user!.id]);
    const obj: Record<string, any> = {};
    result.rows.forEach((r: any) => { try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; } });
    res.json(obj);
  } catch (err) { next(err); }
});

// POST /api/settings/upload-receipt
router.post('/upload-receipt', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { image } = req.body;
    if (!image) { res.status(400).json({ error: 'No image provided' }); return; }
    // Store receipt as encoded data in settings for now
    const receiptId = `receipt_${Date.now()}`;
    await query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
      [req.user!.id, receiptId, JSON.stringify({ image: image.slice(0, 200), timestamp: new Date().toISOString() })]
    );
    res.json({ id: receiptId, url: '', rawText: '', error: null });
  } catch (err) { next(err); }
});

export default router;
