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

# Install system dependencies required by Puppeteer Chromium
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates fonts-liberation libnss3 \
       libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
       libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
       libpango-1.0-0 libxshmfence1 libxss1 libasound2 \
       libxtst6 libxfixes3 xdg-utils wget libu2f-udev \
       libglib2.0-0 libgtk-3-0 libnspr4 libcurl4 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3002
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
