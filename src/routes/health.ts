import { Router } from 'express';
import { query } from '../db';

const router = Router();

// /api/health returns 200 with status="ok" only when the DB is reachable.
// L7 health checks (nginx upstream_check, Docker HEALTHCHECK, uptime
// monitors) need to detect DB outages — a static 200 hides them.
router.get('/', async (_req, res) => {
  const start = Date.now();
  try {
    await query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'invoicesmart-api',
      version: '1.0.0',
      db: { connected: true, latencyMs: Date.now() - start },
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'degraded',
      service: 'invoicesmart-api',
      version: '1.0.0',
      db: { connected: false, error: err.message || 'DB query failed' },
      uptimeSec: Math.round(process.uptime()),
    });
  }
});

export default router;
