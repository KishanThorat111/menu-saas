# KodSpot (menu-saas)

Production-grade multi-tenant QR Menu SaaS for restaurants, cafes, and hotels.

KodSpot helps hospitality businesses publish and operate digital menus through short URLs and QR codes, with owner dashboards, superadmin controls, billing, analytics, and compliance-focused data handling.

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Product Surfaces](#product-surfaces)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Data Model](#data-model)
- [Plan and Entitlement Model](#plan-and-entitlement-model)
- [API Surface (High-Level)](#api-surface-high-level)
- [Security and Compliance Posture](#security-and-compliance-posture)
- [Prerequisites](#prerequisites)
- [Quick Start (Docker, Recommended)](#quick-start-docker-recommended)
- [Quick Start (Node.js Direct)](#quick-start-nodejs-direct)
- [Environment Variables](#environment-variables)
- [Database Operations](#database-operations)
- [Backups and Restore](#backups-and-restore)
- [Deployment Pipeline](#deployment-pipeline)
- [Operations Runbook](#operations-runbook)
- [Performance and Caching Notes](#performance-and-caching-notes)
- [Known Product Decisions](#known-product-decisions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

KodSpot is a SaaS platform that combines:

- Public customer menu experience (scan QR, browse menu instantly)
- Hotel-owner admin dashboard (menu, branding, billing, analytics, QR assets)
- Superadmin platform console (tenant lifecycle, payments, operations)
- Backend automation for billing transitions, retention, and cleanups

Business model highlights:

- Multi-tenant hotels with per-tenant plan controls
- Monthly subscriptions (Razorpay + manual payment workflows)
- Trial flow via request/approval onboarding
- Plan-gated features (themes, analytics depth, UPI Pay, branding)

## Core Capabilities

- Digital menu by short base32 code (6 chars) and QR URL routing
- Rich owner CRUD for categories, items, photos, availability, sorting
- Theme system for menu and QR card assets with entitlement gating
- QR generation for menu, review, and UPI flows
- Optional direct UPI payment handoff for customers
- Razorpay order/verify/webhook integration for subscription payments
- Superadmin controls for hotel status, reset PIN, record payments, purge
- Privacy-safe analytics with daily scans and unique visitor tracking
- Audit logging across owner/admin/system actions
- DPDPA-aligned soft delete and purge workflows

## Product Surfaces

### 1) Public Website and Menu

- Landing page with pricing and trial request flow
- Customer-facing menu page with search/filter/navigation UX
- Live menu rendering by short code: `/m/:code`

### 2) Hotel Owner Admin

- Login using `code + 8-digit PIN`
- Forgot PIN OTP recovery flow
- Menu management, logo/theme controls, QR asset downloads
- Billing status, payment history, and analytics cards/charts

### 3) Superadmin Console

- Secure admin-key-based login
- Hotel list/search/status and lifecycle operations
- Trial queue review and conversion
- Revenue/plan/payment overview
- Manual payment recording and payment history inspection

## Architecture

High-level architecture:

- `Fastify` API serves both JSON APIs and static frontend assets
- `PostgreSQL` as primary transactional data store (via Prisma)
- `Cloudflare R2` for image storage (logo/item assets)
- `Razorpay` for payment processing and webhook events
- `AWS SES SMTP` for email notifications and OTP delivery
- `Caddy` for TLS termination, reverse proxy, and security headers
- `Docker Compose` orchestration for db/api/caddy/backup services

Deployment topology:

- Public internet traffic enters Caddy on 80/443
- Caddy proxies internally to API container on port 3000
- API talks to Postgres over private Docker network
- Postgres host exposure restricted to localhost in compose

## Tech Stack

- Runtime: Node.js 20
- API: Fastify 4
- ORM: Prisma 5
- DB: PostgreSQL 15
- Validation: Zod
- Auth/Crypto: JWT, bcrypt, HMAC-SHA256
- Payments: Razorpay SDK
- Storage: AWS S3-compatible SDK (Cloudflare R2)
- Imaging: sharp
- QR generation: qrcode
- Reverse proxy: Caddy 2
- Containerization: Docker / Docker Compose

## Repository Structure

```text
.
|-- apps/
|   `-- api/
|       |-- index.js                # Fastify server (routes + business logic)
|       |-- package.json
|       |-- Dockerfile
|       |-- prisma/
|       |   |-- schema.prisma
|       |   `-- migrations/
|       `-- public/                # Static frontend surfaces (landing, admin, menu, superadmin)
|-- infrastructure/
|   |-- Caddyfile
|   |-- backup.sh
|   `-- restore.sh
|-- data/                          # Runtime mounts (postgres, caddy, logs, backups)
|-- docker-compose.yml
|-- package.json
`-- .github/workflows/deploy.yml
```

## Data Model

Primary entities:

- `Hotel`: tenant identity, status, plan, branding, billing state
- `Category`: hotel-owned category container
- `Item`: category-owned menu item, pricing, flags, media URL
- `Payment`: Razorpay/manual billing records and subscription periods
- `DailyScanLog`: per-day scan counts and unique counts
- `DailyScanVisitor`: privacy-safe visitor hash dedupe table
- `TrialRequest`: inbound onboarding requests
- `PinResetOtp`: OTP and reset token flow state
- `AuditLog`: immutable actor/action trail

Core enums:

- `PlanType`: STARTER, STANDARD, PRO
- `HotelStatus`: TRIAL, ACTIVE, GRACE, EXPIRED, SUSPENDED, DELETED
- `PaymentMode`: MANUAL, RAZORPAY, CASH
- `PaymentStatus`: CREATED, CAPTURED, FAILED, REFUNDED

## Plan and Entitlement Model

Current plan config (in code):

- STARTER: INR 499/mo, 150 unique/day, 4 themes, analytics 1 day, no UPI Pay
- STANDARD: INR 999/mo, 500 unique/day, 8 themes, analytics 7 days, UPI Pay
- PRO: INR 1499/mo, unlimited unique/day, all themes, analytics 30 days, UPI Pay, hide branding

Trial behavior:

- Trial tenants are treated with STANDARD-level feature access while in TRIAL status.

Lifecycle transitions (automated hourly):

- Pending paid plan activations
- Pending downgrades
- ACTIVE -> GRACE after paid period end
- GRACE -> EXPIRED after grace window
- TRIAL -> EXPIRED after trial end

## API Surface (High-Level)

Public:

- `GET /health`
- `GET /api/menu/:code`
- `GET /m/:code`
- `GET /api/qr/:code`
- `GET /api/qr/review/:hotelId`
- `GET /api/qr/upi/:hotelId`
- `GET /api/logo/:hotelId`
- `POST /auth/request-trial`
- `POST /webhooks/razorpay`

Owner auth and recovery:

- `POST /auth/login`
- `POST /auth/forgot-pin/request`
- `POST /auth/forgot-pin/verify`
- `POST /auth/forgot-pin/reset`

Owner protected:

- `GET /me`
- `GET /me/billing`
- `GET /me/analytics`
- `POST /payments/create-order`
- `POST /payments/verify`
- `POST /me/downgrade`
- `DELETE /me/pending-plan`
- `PATCH /settings/theme`
- `PATCH /settings/qr-theme`
- `PATCH /settings/review-url`
- `PATCH /settings/upi`
- `POST /me/logo`
- `DELETE /me/logo`
- Category and item CRUD endpoints

Superadmin:

- `POST /auth/admin/login`
- `POST /auth/admin/logout`
- `GET /auth/admin/me`
- `GET /admin/stats`
- `GET/PATCH /admin/trial-requests`
- `POST /admin/hotels`
- `GET /admin/hotels`
- `GET/PATCH /admin/hotels/:id`
- `PATCH /admin/hotels/:id/status`
- `POST /admin/hotels/:id/reset-pin`
- `GET /admin/hotels/:id/payments`
- `POST /admin/hotels/:id/record-payment`
- `DELETE /admin/hotels/:id` (soft delete)
- `DELETE /admin/hotels/:id/purge` (hard purge)

## Security and Compliance Posture

Security controls present in this repository:

- Required environment variable enforcement on startup
- PIN security: peppered hash + bcrypt cost factor
- Weak PIN rejection logic
- Per-route rate limiting tiers
- Timing-safe comparisons for sensitive token checks
- Razorpay signature verification and raw-body capture
- Admin auth via signed/hashed cookie path
- CSP/HSTS and strict headers at Caddy layer
- API container hardening: non-root, read-only FS, no-new-privileges
- MIME + magic-byte image validation and file size limits

Data protection practices:

- Soft delete anonymizes hotel PII and marks DELETED
- Hard purge permanently removes tenant graph and scrubs residual data fields
- OTP records cleaned on retention policy
- Visitor hash data retention cleanup job

## Prerequisites

Minimum local prerequisites:

- Docker 24+ and Docker Compose v2
- Node.js 20+ (only needed for non-Docker direct run)
- npm 10+

Optional but useful:

- psql client tools
- OpenSSL/GPG for backup/restore workflows

## Quick Start (Docker, Recommended)

1. Clone repository.
2. Create `.env` at repo root (see [Environment Variables](#environment-variables)).
3. Build and start stack:

```bash
docker compose up -d --build
```

4. Verify API health:

```bash
docker compose exec -T api wget -qO- http://127.0.0.1:3000/health
```

5. Open the app:

- Public landing: `https://kodspot.com` (or your configured domain)
- Owner admin: `/admin`
- Superadmin: `/superadmin`

## Quick Start (Node.js Direct)

From API app folder:

```bash
cd apps/api
npm ci
npm run db:generate
npm run db:deploy
npm start
```

Notes:

- Ensure `DATABASE_URL` points to a reachable Postgres instance.
- Ensure all required env vars are set before startup.

## Environment Variables

### Required by API startup

- `DATABASE_URL`
- `JWT_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `ADMIN_KEY`
- `COOKIE_SECRET`
- `PIN_PEPPER`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

### Common operational variables

- `NODE_ENV` (production/development)
- `PORT`
- `APP_URL`
- `COOKIE_DOMAIN`
- `CORS_ORIGINS`

### Email / notifications

- `SES_SMTP_HOST`
- `SES_SMTP_USER`
- `SES_SMTP_PASS`
- `SES_FROM_EMAIL`
- `ADMIN_NOTIFICATION_EMAIL`

### Database container (compose)

- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

### Rate limit tuning

- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW`
- `ADMIN_RATE_LIMIT_MAX`
- `ADMIN_RATE_LIMIT_WINDOW`

### Backup encryption

- `BACKUP_ENCRYPTION_KEY`

## Database Operations

From `apps/api`:

```bash
npm run db:generate   # Prisma client generation
npm run db:migrate    # Dev migration flow
npm run db:deploy     # Production-safe migration deployment
npm run db:studio     # Prisma Studio
```

Production container startup executes:

```bash
npx prisma migrate deploy && node index.js
```

## Backups and Restore

Backup behavior:

- Backup service runs encrypted pg_dump output (`AES256` via gpg)
- Retention policy in script defaults to 7 days
- First backup runs at container start, then every 24h

Restore script supports:

- Verification mode (`--verify`) without restore
- Full restore mode (destructive, replaces target DB data)

Examples:

```bash
# Verify backup integrity
./infrastructure/restore.sh --verify /backups/kodspot_YYYYMMDD_HHMMSS.sql.gz.gpg

# Restore backup (ensure env vars are exported)
./infrastructure/restore.sh /backups/kodspot_YYYYMMDD_HHMMSS.sql.gz.gpg
```

## Deployment Pipeline

CI/CD is GitHub Actions based (`push` to `main`):

1. SSH into production GCP VM
2. Pull latest `main`
3. Materialize `.env` from GitHub secrets
4. Rebuild and restart compose stack
5. Run in-container API health check

Workflow file:

- `.github/workflows/deploy.yml`

## Operations Runbook

### Health checks

```bash
docker compose ps
docker compose logs --tail 100 api
docker compose exec -T api wget -qO- http://127.0.0.1:3000/health
```

### Restart sequence

```bash
docker compose down
docker compose up -d --build
```

### Inspect DB connectivity

```bash
docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME"
```

### Inspect migration status

```bash
docker compose exec -T api npx prisma migrate status
```

## Performance and Caching Notes

- In-memory menu cache with TTL and bounded map size
- Cache invalidation hooks wired to owner/admin mutating operations
- Optional Cloudflare zone purge support when configured
- Static asset cache headers tuned at Caddy route level

## Known Product Decisions

- Backend is intentionally centralized in a single Fastify app file for now
- Frontend surfaces are static vanilla JS pages, not SPA frameworks
- Trial onboarding is assisted via request + superadmin approval flow
- Public menu remains available even when daily unique cap is reached (soft cap analytics)

## Troubleshooting

### API exits immediately with missing env error

Cause:

- One of required env vars is unset.

Fix:

- Validate `.env` against [Environment Variables](#environment-variables).

### Razorpay payments fail verification

Cause:

- Key mismatch or webhook signature secret mismatch.

Fix:

- Recheck `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.

### Menu updates not visible immediately

Cause:

- Cache still hot or CDN edge not yet purged.

Fix:

- Confirm mutation endpoint succeeded; verify purge configuration and retry.

### OTP emails not delivered

Cause:

- SES SMTP not configured or failing auth.

Fix:

- Validate SMTP host/user/pass/from settings and service-level sender permissions.

## Contributing

Internal repository conventions:

- Keep migrations explicit and reviewed
- Avoid breaking API contracts used by public/admin/superadmin clients
- Ensure rate limits and audit logging remain intact for sensitive routes
- Re-run migration and health validation before production deployment

Suggested PR checklist:

- [ ] Schema changes include migration
- [ ] Sensitive endpoints include validation + auth + rate limit
- [ ] Cache invalidation considered for public menu-facing mutations
- [ ] Logs and error handling do not leak secrets
- [ ] Manual verification performed for owner and superadmin flows

## License

No explicit license file is currently present in this repository.

Unless otherwise stated by the owner, treat this codebase as proprietary.
