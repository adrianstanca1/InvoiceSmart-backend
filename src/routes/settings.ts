import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';
import { defaultSettings } from '../services/settings';

const router = Router();
router.use(authMiddleware);

// Allowlist of keys that PUT/POST /api/settings may write.
// Matches the AppSettings interface in services/settings.ts plus
// the receipt_* and aiApiKey keys used internally. Reject anything
// else to prevent unbounded per-user row growth and unknown-key
// injection into downstream services (e.g. aiEndpoint SSRF).
const SETTINGS_KEY_ALLOWLIST = new Set([
  'aiProvider', 'aiModel', 'aiEndpoint', 'aiApiKey',
  'invoicePrefix', 'autoIncrement',
  'defaultCurrency', 'defaultTaxRate', 'defaultTerms', 'defaultPaymentGateway',
  'theme', 'notificationsEnabled', 'emailNotifications',
]);

// Hostname allowlist for aiEndpoint — prevents SSRF where a malicious
// or compromised user account points the AI completion endpoint at
// internal services (Redis :6379, Supabase Studio :54323, etc.).
const AI_ENDPOINT_HOST_ALLOWLIST = new Set([
  '127.0.0.1', 'localhost',                 // local ollama / LM Studio
  'api.openai.com',
  'openrouter.ai',
  'api.openrouter.ai',
]);

// Returns error message string, or null if valid.
function validateSettingKey(key: string): string | null {
  if (!SETTINGS_KEY_ALLOWLIST.has(key) && !key.startsWith('receipt_')) {
    return `Unknown settings key: ${key}`;
  }
  return null;
}

function validateSettingValue(key: string, value: unknown): string | null {
  if (key === 'aiEndpoint' && typeof value === 'string' && value.length > 0) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return 'aiEndpoint must be a valid URL';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'aiEndpoint must be http(s)';
    }
    if (!AI_ENDPOINT_HOST_ALLOWLIST.has(parsed.hostname)) {
      return `AI endpoint host not allowed: ${parsed.hostname}`;
    }
  }
  if (key === 'aiApiKey' && typeof value === 'string' && value.length > 0) {
    if (value.length < 8) return 'aiApiKey too short';
  }
  return null;
}

router.put('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const entries = req.body;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      res.status(400).json({ error: 'Expected object of key-value pairs' });
      return;
    }

    const keys = Object.keys(entries);
    for (const key of keys) {
      const keyErr = validateSettingKey(key);
      if (keyErr) { res.status(400).json({ error: keyErr }); return; }
      const valErr = validateSettingValue(key, entries[key]);
      if (valErr) { res.status(400).json({ error: valErr }); return; }
    }

    const updated: Record<string, any> = {};
    for (const key of keys) {
      const value = JSON.stringify(entries[key]);
      const result = await query(
        `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
        [req.user!.id, key, value]
      );
      updated[key] = result.rows[0];
    }
    res.json(updated);
  } catch (err) { next(err); }
});

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM settings WHERE user_id = $1', [req.user!.id]);
    const obj: Record<string, any> = {};
    result.rows.forEach((r: any) => { try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; } });
    res.json(maskSensitiveSettings({ ...defaultSettings, ...obj }));
  } catch (err) { next(err); }
});

// POST /api/settings/upload-receipt
router.post('/upload-receipt', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { image } = req.body;
    if (!image) { res.status(400).json({ error: 'No image provided' }); return; }
    if (typeof image !== 'string') { res.status(400).json({ error: 'Image must be a base64 string' }); return; }
    // Limit receipt size to ~2MB base64 to prevent abuse
    if (image.length > 3_000_000) { res.status(413).json({ error: 'Image too large (max ~2MB)' }); return; }
    const receiptId = `receipt_${Date.now()}`;
    await query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() RETURNING *`,
      [req.user!.id, receiptId, JSON.stringify({ image, timestamp: new Date().toISOString() })]
    );
    res.json({ id: receiptId, url: '', rawText: '', error: null });
  } catch (err) { next(err); }
});

export default router;

function maskSensitiveSettings(settings: Record<string, any>): Record<string, any> {
  if (!settings.aiApiKey) return settings;
  return { ...settings, aiApiKey: '********' };
}

function maskSensitiveSettingRow(row: any): any {
  if (row?.key !== 'aiApiKey') return row;
  return { ...row, value: '********' };
}
