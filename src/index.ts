import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { requestLogger, errorHandler } from './middleware';
import { initSchema } from './db';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import invoiceRoutes from './routes/invoices';
import clientRoutes from './routes/clients';
import transactionRoutes from './routes/transactions';
import taxRuleRoutes from './routes/taxRules';
import auditLogRoutes from './routes/auditLogs';
import settingsRoutes from './routes/settings';
import reportRoutes from './routes/reports';
import aiRoutes from './routes/ai';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 400) return originalJson(body);
    if (body && typeof body === 'object' && ('error' in body || 'success' in body)) {
      return originalJson(body);
    }
    return originalJson({ success: true, data: body });
  };
  next();
});

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/tax-rules', taxRuleRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/ai', aiRoutes);

app.get('/', (_req, res) => {
  res.json({ name: 'InvoiceSmart API', version: '1.0.0' });
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (body && typeof body === 'object' && ('error' in body || 'success' in body)) {
      return originalJson(body);
    }
    return originalJson({ success: true, data: body });
  };
  next();
});

app.use(errorHandler);

async function start() {
  try {
    await initSchema();
    console.log('Database schema initialized');
  } catch (err) {
    console.error('Failed to initialize schema, continuing...', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`InvoiceSmart API listening on http://0.0.0.0:${PORT}`);
  });
}

start();
