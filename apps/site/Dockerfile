# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /build

# Install deps with cached layer
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build static output
COPY . .
RUN npm run build

# ---- Runtime stage: tiny Caddy file server ----
FROM caddy:2-alpine

# Copy built site
COPY --from=builder /build/dist /srv

# Copy site-internal Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

# Healthcheck — Caddy serves /health.txt for liveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/health.txt || exit 1
