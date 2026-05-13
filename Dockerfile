# syntax=docker/dockerfile:1
# Multi-stage build for InvoiceSmart backend

# ── Stage 1: builder ──
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: production ──
FROM node:22-slim AS production
WORKDIR /app

# Install curl for Docker HEALTHCHECK (wget may not be available)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user and group
RUN groupadd -r nodejs && useradd -r -g nodejs node

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Switch to non-root user
USER node

EXPOSE 3008
ENV NODE_ENV=production
ENV PORT=3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3008/health || exit 1

CMD ["node", "dist/index.js"]
