import { Router } from 'express';
const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'invoicesmart-api', version: '1.0.0' });
});

export default router;
