// Per-worker test setup. Runs before every test file in this worker.
//
// We deliberately load the production .env first to grab DB_USER and
// DB_PASSWORD (they're the only way to authenticate against the docker
// cortexbuild-postgres instance — random 48-char hash). Then we override
// the host-facing fields (DB_HOST, DB_PORT) and target a separate DB
// name (invoicesmart_test) so we never write into the prod-shaped DB.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-vitest';

// Host-facing pg address: when running tests from the host (outside
// docker), the cortexbuild-postgres container is reachable at
// 127.0.0.1:55432. DB_HOST in the live container is the docker-internal
// hostname `cortexbuild-postgres` which won't resolve from the host.
process.env.DB_HOST = process.env.DB_HOST_TEST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT_TEST || '55432';
// DB_USER + DB_PASSWORD come from .env via dotenv/config — leave them.
process.env.DB_NAME = 'invoicesmart_test';

// Tests must not call real AI providers. Each AI test file spies on
// globalThis.fetch to control responses.
process.env.AI_PROVIDER = 'ollama';
process.env.OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
