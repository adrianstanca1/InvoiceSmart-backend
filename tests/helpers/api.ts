import request, { SuperAgentTest } from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../../src/app';

let _app: Express | null = null;

export function app(): Express {
  if (!_app) _app = buildApp({ enableRateLimit: false });
  return _app;
}

export function client(): request.SuperTest<request.Test> {
  return request(app());
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

let userCounter = 0;

// Registers a fresh user and returns their {id, email, token}. The
// caller is responsible for cleanup (TRUNCATE in beforeEach typically
// handles this).
export async function registerUser(extra: Record<string, unknown> = {}): Promise<TestUser> {
  userCounter += 1;
  const email = `test-${Date.now()}-${userCounter}@invoicesmart.test`;
  const res = await client()
    .post('/api/auth/register')
    .send({ email, password: 'TestPassword123!', ...extra });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.user.id, email: res.body.user.email, token: res.body.token };
}

export function bearer(user: TestUser): string {
  return `Bearer ${user.token}`;
}
