import { Request, Response, NextFunction, Router } from 'express';
import * as jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Reject non-UUID values in named path params (e.g. /:id, /:invoiceId).
// Without this, a malformed UUID reaches Postgres and surfaces as a
// generic 500 "invalid input syntax for type uuid" — which both
// leaks DB shape and is the wrong status for a client error.
export function applyUuidValidation(router: Router, paramNames: string[]): void {
  for (const name of paramNames) {
    router.param(name, (req, res, next, value) => {
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        res.status(400).json({ error: `Invalid ${name}: must be a UUID` });
        return;
      }
      next();
    });
  }
}

// JWT_SECRET fail-closed: in any non-development environment, refuse to start
// without an explicit secret. The dev fallback is only available when
// NODE_ENV is 'development' (or unset on a developer's laptop).
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
if (!process.env.JWT_SECRET && !isDev) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET is not set in environment (NODE_ENV=' + process.env.NODE_ENV + '). Refusing to start with a known dev secret.');
  process.exit(1);
}
export const JWT_SECRET = process.env.JWT_SECRET || 'invoicesmart-dev-secret-change-in-production';

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
    };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err.stack || err.message);

  const statusCode = (err as any).statusCode || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms - ${req.ip || req.socket.remoteAddress}`
    );
  });

  next();
}
