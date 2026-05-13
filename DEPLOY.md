# InvoiceSmart — Deployment Guide

## Quick Start (Docker Compose)

```bash
cd /root/InvoiceSmart-backend
bash /root/deploy-invoicesmart.sh
```

This starts PostgreSQL, builds the backend, and wires it to Ollama on the host.

## Manual Start

### 1. Prerequisites
- Node.js >= 20
- PostgreSQL 16+
- Ollama (with `llama3.2` pulled)

### 2. Environment
```bash
cp .env.example .env
# Edit .env with your DB credentials and a fresh JWT_SECRET
```

### 3. Database
```bash
npm run migrate
```

### 4. Ollama
```bash
ollama serve &
ollama pull llama3.2
```

### 5. Start
```bash
npm run build
npm start
```

App available at `http://localhost:3008`

## PM2 (Production)
```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## Nginx (Reverse Proxy)
```bash
sudo cp nginx-invoicesmart.conf /etc/nginx/sites-available/invoicesmart
sudo ln -s /etc/nginx/sites-available/invoicesmart /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## AI Provider Setup
1. Open the app at `http://localhost:3008`
2. Register / log in
3. Go to Settings → AI Provider
4. Choose **Ollama** (local) or enter your OpenAI / OpenRouter key
5. Default Ollama endpoint: `http://127.0.0.1:11434/api/generate`

## Ports
| Service | Port |
|---------|------|
| API + SPA | 3008 |
| PostgreSQL | 5432 |
| Ollama | 11434 |

## Security Notes
- `.env` contains secrets and is `.gitignore`d
- CORS is restricted by `CORS_ORIGINS` in production
- Rate limiting: 120 req/min per IP
