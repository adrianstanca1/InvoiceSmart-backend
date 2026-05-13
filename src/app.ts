import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { existsSync } from 'fs';
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

  // Restrict CORS to known origins in production.
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

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

  // ── Static SPA ────────────────────────────────────────────────────────────
  // Serve the bundled web frontend (public/index.html) at the root and for
  // all non-API paths so client-side routing works.
  app.use(express.static('public'));

  app.use('/api/health', healthRoutes);
  app.use('/health', healthRoutes);

  // Swagger UI + raw spec.
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

  // API root — JSON metadata.
  app.get('/', (_req, res) => {
    res.json({ name: 'InvoiceSmart API', version: '1.0.0' });
  });

  // Catch-all: serve the SPA for any non-API, non-static route.
  // This must come AFTER all API routes so /api/* never hits it.
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve('public', 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

function locateOpenApiSpec(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'src', 'openapi.yaml'),
    path.join(__dirname, '..', 'dist', 'openapi.yaml'),
    path.join(__dirname, 'openapi.yaml'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}
