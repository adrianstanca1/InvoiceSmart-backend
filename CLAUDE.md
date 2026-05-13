# CLAUDE.md — InvoiceSmart-backend

Construction-friendly invoicing API. Powers the InvoiceSmart-iOS Expo app
(`/root/InvoiceSmart-iOS/`) and is reachable from outside the box at
`https://api.invoicesmart.cortexbuildpro.com`.

## Stack

- **Runtime**: Node 22, Express 4, TypeScript (strict)
- **DB**: PostgreSQL 16 in the shared `cortexbuild-postgres` container (host port `:55432`, internal `:5432`). Single database `invoicesmart`. UUIDs everywhere.
- **Auth**: JWT (HS256, 7-day expiry). Bcrypt 12 rounds. JWT secret fails-closed in non-development (`src/middleware.ts:14`).
- **Tests**: Vitest + Supertest. 72 tests across 10 files. Separate DB `invoicesmart_test` on the same Postgres instance.
- **AI**: pluggable provider (Ollama / OpenAI / OpenAI-compatible / OpenRouter). Endpoint host allowlist in `src/services/intelligence.ts` and mirrored in `src/routes/settings.ts` — keep in sync.
- **Optional**: Puppeteer (Chromium installed in the image for PDF rendering — currently a stub returning `https://demo.pdf`).

## How to run

```bash
# from /root/InvoiceSmart-backend
npm install                  # one-off
npm run dev                  # tsx watch — port comes from .env's PORT or 3002
npm test                     # vitest, writes to invoicesmart_test
npm run build                # tsc → dist/ + copy openapi.yaml
npm start                    # production: node dist/index.js
npm run migrate              # tsx src/migrate.ts — creates DB if missing + runs initSchema
```

To run tests fresh (drop+recreate the test DB): `FRESH_TEST_DB=1 npm test`.

## Routes (all under `/api` unless noted)

| Group | Routes | Notes |
|-------|--------|-------|
| `auth/` | `register`, `login`, `me` | bcrypt-12, JWT 7d, single shared `authMiddleware` |
| `invoices/` | CRUD + `/next/number`, `/:id/send`, `/:id/paid`, `/:id/pdf`, `/:id/payments` | Composite UNIQUE `(user_id, invoice_number)` — see Multi-tenant section |
| `clients/` | CRUD | tenant-scoped |
| `transactions/` | CRUD + `/invoice/:invoiceId` | `type` = `expense` \| `payment` |
| `tax-rules/` | CRUD | percent-based rates |
| `audit-logs/` | list-only (max 1000) | schema present, no writes yet |
| `settings/` | get/post/put + `/upload-receipt` (stub) | allowlisted keys + SSRF defence on `aiEndpoint` |
| `reports/` | `dashboard`, `revenue-trend`, `profit-loss`, `top-expenses`, `tax-estimate`, `export`, `revenue-by-client`, `summary` | `export` is CSV with `Content-Disposition: attachment` |
| `ai/` | `config`, `test`, `models`, `chat`, `generate-invoice`, `summarize-pl`, `who-owes-me`, `tax-advice`, `audit-invoice/:id` | All AI routes have deterministic fallbacks except `chat`, `test`, and `models` |
| `health`, `/api/health` | identical | reports DB connectivity + latency + uptime |
| `/api/docs`, `/api/openapi.{json,yaml}` | Swagger UI + raw spec | wires `src/openapi.yaml` (also copied to `dist/`) |

## Live deployment

- **Container**: `invoicesmart-backend` (Docker), port `0.0.0.0:3008` → container 3008, network `cortexbuild` (bridge). Image is built from this source (`docker-compose build` or plain `docker build`).
- **Nginx vhost**: `api.invoicesmart.cortexbuildpro.com` (reuses `field.cortexbuildpro.com`'s TLS cert — cross-domain). Proxies to `:3008`.
- **DB**: `cortexbuild-postgres` Docker container, password is a random 48-char hash; the value lives only in `.env` (chmod 600) and `/proc/<pid>/environ` of the running container.
- **AI**: `OLLAMA_URL=http://127.0.0.1:11434/api/generate` — but **the bridge-network container can't reach the host's Ollama at `127.0.0.1`.** AI fallback paths are exercised (and tested); the `/api/ai/models` endpoint returns 502 in production. Fix is either `network_mode: host` in `docker-compose.yml` or `extra_hosts: ["host.docker.internal:host-gateway"]` + adding `host.docker.internal` to the SSRF allowlist. **Not currently a priority** — the iOS app uses the fallback-protected routes (`summarize-pl`, `who-owes-me`, `tax-advice`, `audit-invoice`), not `/models` or `/chat`.

## Multi-tenant invariants

1. **Every authenticated route filters by `user_id`** — `WHERE id = $1 AND user_id = $2` is the standard pattern (`src/routes/invoices.ts:33`, `clients.ts:19`, etc.). Foreign reads return 404, not 403, so tenant existence isn't leaked.
2. **Invoice numbers are unique per user**, not globally. `UNIQUE (user_id, invoice_number)` (see `src/db.ts` — the migration drops the old global `UNIQUE(invoice_number)` if present). Multi-tenant test in `tests/invoices.test.ts` covers this.
3. **UUID path params are validated before the DB sees them** — `applyUuidValidation(router, ['id'])` in each router. Malformed UUIDs return 400 with `{"error":"Invalid id: must be a UUID"}` instead of a 500 leak.
4. **AI endpoint allowlist** — `aiEndpoint` settings + `/api/ai/config` updates are validated against a hostname set (127.0.0.1, localhost, api.openai.com, openrouter.ai, api.openrouter.ai). SSRF tests in `tests/settings.test.ts` and `tests/ai.test.ts`.
5. **`aiApiKey` is masked on read** as `********`. Tests assert this.

## Money model — easy to get wrong

- All amounts stored as `DECIMAL(12,2)`, returned to clients as strings (`"1500.00"`).
- All rates stored as `DECIMAL(5,2)`, returned as strings. Rates are **percentages** — `20` means 20%, not `0.20`.
- `total_amount = (subtotal - discount) + tax - retention - cis`. Implemented in `src/utils.ts:calculateInvoiceTotals`.
- Client code must `parseFloat` before arithmetic. The iOS app's `types.ts` declares these as `string`.

## Two ways to mark "paid" — load-bearing semantics

- `POST /api/invoices/:id/payments` — atomically inserts a `transactions` row of type `payment`, recalculates `amount_paid/amount_due`, bumps status to `partial` or `paid`. Use this for real payments.
- `PATCH /api/invoices/:id/paid` — force-marks paid (`amount_paid = total_amount`, `amount_due = 0`). Doesn't insert a transaction. Use for cash payments / migrations / corrections.

Calling `/paid` after `/payments` desyncs the recorded transactions vs. `amount_paid`. The iOS app should pick one path per flow.

## Test gotchas

- **bcrypt is the slowest thing in the suite.** Tests register ~50 users; each costs ~300ms. Total suite is ~30s. A future optimization is to lower bcrypt rounds in tests (set `BCRYPT_ROUNDS=4` env override).
- **Vitest forks=1** to avoid parallel writes to the shared `invoicesmart_test` DB. Don't change this unless you also rework the test isolation (e.g. one DB per worker).
- **`globalSetup`** runs in a separate process and doesn't inherit `setupFiles` env, so env is duplicated at the top of `tests/global-setup.ts`. Keep these in sync.

## Known issues

- `docker-compose v1` (1.29.2 on this box) crashes with `KeyError: 'ContainerConfig'` on `up -d --force-recreate` against newer image formats. Workaround: `docker rm -f <name>; docker run ...` directly. See the rebuild step in `scripts/` if/when one is added.
- `.env.example` ships with `DATABASE_URL=...[REDACTED]...` as a literal placeholder. Anyone bootstrapping fresh needs to either replace `[REDACTED]` with a real password OR rely on the individual `DB_*` vars, which the code path prefers.
- The redirected (cross-domain) TLS cert on `api.invoicesmart.cortexbuildpro.com` borrows `field.cortexbuildpro.com`'s SAN — when that cert rotates, this hostname's curl will start failing until certbot re-adds the SAN.

## Adding a new route

1. Write the route in `src/routes/<name>.ts`. Apply `authMiddleware` and `applyUuidValidation` if it has `:id` params.
2. Register it in `src/app.ts`.
3. Add a test file in `tests/<name>.test.ts` covering: happy path, validation error, cross-tenant 404, missing-token 401, malformed-UUID 400 (if applicable).
4. Add OpenAPI entries in `src/openapi.yaml` — paths + any new schemas under `components.schemas`.
5. Run `npm test` and `npm run build`. The CI bar is "all 72+ tests green and `npm run build` exits 0."

## Cross-references

- iOS client: `/root/InvoiceSmart-iOS/` (Expo + RN, talks to `https://api.invoicesmart.cortexbuildpro.com`).
- Workspace overview: `/root/CLAUDE.md` "Subprojects" + "Running services on this box".
- Backup/recovery: the source lives in `adrianstanca1/InvoiceSmart-backend` on GitHub; `/var/log/backup-root-repos.log` covers the workspace-root, not this repo.
