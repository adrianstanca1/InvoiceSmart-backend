import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { requestLogger, errorHandler } from './middleware';

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

export interface BuildAppOptions {
  enableRateLimit?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);

  // Rate limit is disabled in tests so 100+ requests/min don't trip 429.
  if (opts.enableRateLimit !== false) {
    const limiter = rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use(limiter);
  }

  app.use('/api/health', healthRoutes);
  app.use('/health', healthRoutes);

  // Swagger UI + raw spec. The yaml lives at src/openapi.yaml and is
  // copied to dist/ at build time (see tsconfig.json's "include"+copy
  // pattern — TS won't move yaml on its own, so the runtime loader
  // checks both candidate paths).
  const specPath = locateOpenApiSpec();
  if (specPath) {
    const spec = YAML.load(specPath);
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'InvoiceSmart API' }));
    app.get('/api/openapi.yaml', (_req, res) => {
      res.type('application/yaml').sendFile(specPath);
    });
    app.get('/api/openapi.json', (_req, res) => {
      res.json(spec);
    });
  }
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

  app.use(errorHandler);
  return app;
}

import { existsSync } from 'fs';

function locateOpenApiSpec(): string | null {
  // src/openapi.yaml when running from tsx; dist/openapi.yaml when running
  // from compiled output. We resolve relative to __dirname so it works
  // in both. fs.existsSync is fine here — startup-only, not request path.
  const candidates = [
    path.join(__dirname, 'openapi.yaml'),
    path.join(__dirname, '..', 'src', 'openapi.yaml'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
