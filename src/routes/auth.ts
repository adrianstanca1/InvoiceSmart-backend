import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest, JWT_SECRET } from '../middleware';

const router = Router();

function signToken(userId: string, email: string) {
  return jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '7d' });
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, company_name, vat_number, address, phone } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, company_name, vat_number, address, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, email`,
      [email, hash, first_name || null, last_name || null, company_name || null, vat_number || null, address ? JSON.stringify(address) : null, phone || null]
    );
    const user = result.rows[0];
    const token = signToken(user.id, user.email);
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const result = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    if (result.rowCount === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) { next(err); }
});

router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, first_name, last_name, company_name, vat_number, address, phone FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

export default router;
