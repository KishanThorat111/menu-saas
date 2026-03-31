const path = require("path");
const { appendFile, mkdir } = require('fs/promises');
const crypto = require('crypto');

async function logError(err) {
  try {
    const logDir = path.join(__dirname, "../../data/logs");
    await mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, "error.log");
    await appendFile(logPath, `[${new Date().toISOString()}] ${err.stack}\n\n`);
  } catch (e) {
    fastify.log.error('Failed to write to error log:', e);
  }
}

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "ADMIN_KEY",
  "COOKIE_SECRET",
  "PIN_PEPPER"
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const fastify = require('fastify')({
  trustProxy: true,
  genReqId: () => `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  }
});

// Capture raw body for webhook signature verification
fastify.addHook('preParsing', async (request, reply, payload) => {
  if (request.url === '/webhooks/razorpay' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of payload) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    request.rawBody = rawBody.toString('utf8');
    // Return a new readable stream from the raw body for Fastify's parser
    const { Readable } = require('stream');
    const newPayload = new Readable();
    newPayload.push(rawBody);
    newPayload.push(null);
    return newPayload;
  }
  return payload;
});

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');
const QRCode = require('qrcode');
const sharp = require('sharp');

//==================== CONFIGURATION ====================
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const APP_URL = process.env.APP_URL ?? `http://localhost:${process.env.PORT || 3000}`;
const isProduction = process.env.NODE_ENV === 'production';

//==================== PLAN CONFIGURATION ====================
const PLANS = {
  STARTER:  { price: 49900, dailyUniqueVisitors: 150,  label: '\u20b9499/mo \u2014 150 unique visitors/day',  themes: 4,  analyticsDays: 1,  hideBranding: false, upiPay: false },
  STANDARD: { price: 99900, dailyUniqueVisitors: 500,  label: '\u20b9999/mo \u2014 500 unique visitors/day',  themes: 8,  analyticsDays: 7,  hideBranding: false, upiPay: true },
  PRO:      { price: 149900, dailyUniqueVisitors: -1,  label: '\u20b91,499/mo \u2014 Unlimited + All Themes', themes: 15, analyticsDays: 30, hideBranding: true, upiPay: true },
};

const PLAN_TIER = { STARTER: 1, STANDARD: 2, PRO: 3 };

// Theme tiers: which themes each plan unlocks
const ALL_THEMES = [
  'classic', 'warm', 'nature', 'elegant',
  'royal', 'ocean', 'rustic', 'minimal',
  'spice', 'neon', 'cherry', 'midnight', 'sunset', 'forest', 'marble'
];
const THEME_TIERS = {
  STARTER:  ALL_THEMES.slice(0, 4),
  STANDARD: ALL_THEMES.slice(0, 8),
  PRO:      ALL_THEMES
};

// During trial, hotels get STANDARD-level features
function effectivePlan(plan, status) {
  if (status === 'TRIAL') return 'STANDARD';
  return plan || 'STARTER';
}

// QR card theme tiers: which qr themes each plan unlocks
const ALL_QR_THEMES = ['walnut', 'noir', 'sapphire', 'emerald', 'bordeaux', 'marble', 'navy', 'crimson', 'champagne', 'teal'];
const QR_THEME_TIERS = {
  STARTER:  ['walnut'],
  STANDARD: ALL_QR_THEMES.slice(),
  PRO:      ALL_QR_THEMES.slice()
};

//==================== RAZORPAY CLIENT ====================
let razorpayClient = null;
function getRazorpay() {
  if (razorpayClient) return razorpayClient;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayClient;
}

//==================== SECURITY CONSTANTS ====================
const BCRYPT_COST = 12;
const PIN_PEPPER = process.env.PIN_PEPPER; // Server-side pepper — DB breach alone cannot crack PINs

// Pepper a PIN before bcrypt hashing/comparing (HMAC with server secret)
function pepperPin(pin) {
  return crypto.createHmac('sha256', PIN_PEPPER).update(pin).digest('hex');
}

// Weak PIN detection — shared across all PIN creation/reset paths
const WEAK_PIN_BLACKLIST = new Set([
  '12345678', '87654321', '00000000', '11111111', '22222222',
  '33333333', '44444444', '55555555', '66666666', '77777777',
  '88888888', '99999999', '12341234', '11223344', '00000001',
  '11112222', '12121212', '13131313', '98765432', '01234567',
  '76543210', '01011990', '01012000', '01011980', '11111112',
  '10000000', '20000000'
]);

function isWeakPin(pin) {
  // Blacklist check
  if (WEAK_PIN_BLACKLIST.has(pin)) return true;
  // All same digit: 11111111, 22222222, etc.
  if (/^(.)\1{7}$/.test(pin)) return true;
  // Ascending sequence: 01234567, 12345678, 23456789, 34567890
  const digits = pin.split('').map(Number);
  let asc = true, desc = true;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== (digits[i - 1] + 1) % 10) asc = false;
    if (digits[i] !== (digits[i - 1] - 1 + 10) % 10) desc = false;
  }
  if (asc || desc) return true;
  // Repeating 4-char pattern: 12341234, 56785678
  if (pin.length === 8 && pin.slice(0, 4) === pin.slice(4)) return true;
  // Repeating 2-char pattern: 12121212, 34343434
  if (pin.length === 8 && pin.slice(0, 2) === pin.slice(2, 4) && pin.slice(0, 2) === pin.slice(4, 6) && pin.slice(0, 2) === pin.slice(6)) return true;
  return false;
}

const COOKIE_CONFIG = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'strict' : 'lax',
  maxAge: 86400000,
  path: '/'
};

if (isProduction && process.env.COOKIE_DOMAIN) {
  COOKIE_CONFIG.domain = process.env.COOKIE_DOMAIN;
}

//==================== RATE LIMIT CONFIGURATION ====================
const strictRateLimit = {
  max: parseInt(process.env.ADMIN_RATE_LIMIT_MAX) || 5,
  timeWindow: parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW) || 900000,
  keyGenerator: (req) => req.ip
};

// [6-DIGIT PIN CHANGE] NEW: Strict rate limit for PIN reset (3 attempts per 15min per hotel)
const pinResetRateLimit = {
  max: 3,
  timeWindow: 900000, // 15 minutes
  keyGenerator: (req) => `${req.ip}:${req.params.id}`
};

// Per-code rate limit for login: max 20 attempts per hour per code (blocks parallel proxy attacks)
const loginSlugRateLimit = {
  max: 20,
  timeWindow: 3600000, // 1 hour
  keyGenerator: (req) => {
    try {
      const body = req.body;
      const code = (body?.code || body?.slug || '').toUpperCase().trim();
      return `login-code:${code}`;
    } catch {
      return `login-code:${req.ip}`;
    }
  }
};

// Forgot PIN: OTP request rate limit (3 per 15 min per IP)
const forgotPinRequestRateLimit = {
  max: 3,
  timeWindow: 900000,
  keyGenerator: (req) => `forgot-req:${req.ip}`
};

// Forgot PIN: OTP verify rate limit (10 per hour per IP)
const forgotPinVerifyRateLimit = {
  max: 10,
  timeWindow: 3600000,
  keyGenerator: (req) => `forgot-verify:${req.ip}`
};

// Forgot PIN: PIN reset rate limit (5 per hour per IP)
const forgotPinResetRateLimit = {
  max: 5,
  timeWindow: 3600000,
  keyGenerator: (req) => `forgot-reset:${req.ip}`
};

//==================== PRISMA WITH RETRY LOGIC ====================
const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['query', 'info', 'warn', 'error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function connectWithRetry(retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$connect();
      fastify.log.info('✅ Database connected successfully');
      return;
    } catch (err) {
      fastify.log.error(`Database connection attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

//==================== R2 CLIENT ====================
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  maxAttempts: 3,
});

//==================== EMAIL (SES SMTP) ====================
let sesTransporter = null;

function getSesTransporter() {
  if (sesTransporter) return sesTransporter;
  const host = process.env.SES_SMTP_HOST;
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASS;
  if (!host || !user || !pass) return null;

  sesTransporter = nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100
  });
  return sesTransporter;
}

const SES_FROM = process.env.SES_FROM_EMAIL || 'noreply@kodspot.com';
const OTP_EXPIRY_MINUTES = 10;
const RESET_TOKEN_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_DAILY_LIMIT = 10;
const OTP_COOLDOWN_MS = 60000; // 60 seconds between OTP requests

function escapeEmailHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildOtpEmailHtml(hotelName, otp, expiryMinutes) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#c68b52,#b07440);padding:32px 32px 24px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;margin-bottom:12px;">KodSpot</div>
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;opacity:0.95;">PIN Reset Code</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#374151;font-size:15px;">Hello,</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;">A PIN reset was requested for <strong>${escapeEmailHtml(hotelName)}</strong>. Use the code below:</p>
          <div style="background:#fdf8f0;border:2px dashed #c68b52;border-radius:10px;padding:20px;text-align:center;margin:0 0 24px;">
            <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:800;letter-spacing:0.3em;color:#1f2937;">${otp}</div>
          </div>
          <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">&#x23F1; This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">&#x1F512; Do not share this code with anyone.</p>
          <div style="border-top:1px solid #e5e7eb;padding-top:20px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">If you did not request this, you can safely ignore this email. Your PIN will not change.</p>
          </div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:11px;"><a href="https://kodspot.com" style="color:#b07440;text-decoration:none;font-weight:600;">KodSpot</a> &mdash; Digital Menu Management</p>
          <p style="margin:0;color:#c0c5cc;font-size:10px;">This is an automated message. Please do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildOtpEmailText(hotelName, otp, expiryMinutes) {
  return `KodSpot — PIN Reset Code\n\nHello,\n\nA PIN reset was requested for ${hotelName}.\n\nYour reset code: ${otp}\n\nThis code expires in ${expiryMinutes} minutes.\nDo not share this code with anyone.\n\nIf you did not request this, you can safely ignore this email. Your PIN will not change.\n\n--\nKodSpot — Digital Menu Management\nhttps://kodspot.com\nThis is an automated message. Please do not reply.`;
}

//==================== HELPERS ====================
// Semaphore to limit concurrent sharp() image processing (prevents OOM)
let _sharpActive = 0;
const _sharpQueue = [];
const SHARP_MAX_CONCURRENT = 2;
function acquireSharp() {
  if (_sharpActive < SHARP_MAX_CONCURRENT) { _sharpActive++; return Promise.resolve(); }
  return new Promise(resolve => _sharpQueue.push(resolve));
}
function releaseSharp() {
  if (_sharpQueue.length > 0) { _sharpQueue.shift()(); }
  else { _sharpActive--; }
}

async function uploadToR2(buffer, mimetype, hotelId) {
  // Compress and convert to WebP for optimal delivery
  await acquireSharp();
  try {
    buffer = await sharp(buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    mimetype = 'image/webp';
  } catch (e) {
    // If sharp fails (corrupt image edge case), upload original
    fastify.log.warn('sharp compression failed, uploading original:', e.message);
  } finally {
    releaseSharp();
  }

  const ext = mimetype === 'image/png' ? '.png' :
    mimetype === 'image/webp' ? '.webp' : '.jpg';
  const key = `hotels/${hotelId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await r2Client.send(command);
  return `${PUBLIC_URL}/${key}`;
}

//==================== MENU CACHE (in-memory with TTL) ====================
const menuCache = new Map(); // slug → { data, hotelId, plan, expiresAt }
const MENU_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedMenu(slug) {
  const entry = menuCache.get(slug);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    menuCache.delete(slug);
    return null;
  }
  return entry;
}

function setCachedMenu(slug, data, hotelId, plan) {
  menuCache.set(slug, { data, hotelId, plan, expiresAt: Date.now() + MENU_CACHE_TTL });
  // Prevent unbounded memory growth: evict oldest entry if over 10,000
  if (menuCache.size > 10000) {
    const oldest = menuCache.keys().next().value;
    menuCache.delete(oldest);
  }
}

function invalidateMenuCache(slug) {
  if (slug) menuCache.delete(slug.toUpperCase());
}

// Optional: Purge CDN cache (Cloudflare) for a hotel's menu URLs
async function purgeMenuCacheForHotel(hotelId, attempts = 3) {
  // Always look up slug for in-memory cache invalidation (regardless of Cloudflare config)
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { slug: true } });
  if (!hotel || !hotel.slug) return;

  // Always invalidate in-memory menu cache
  invalidateMenuCache(hotel.slug);

  // Optional: Cloudflare CDN cache purge (only if configured)
  const cfToken = process.env.CF_API_TOKEN;
  const cfZone = process.env.CF_ZONE_ID;
  if (!cfToken || !cfZone) return;

  const base = APP_URL.replace(/\/$/, '');
  const urls = [
    `${base}/api/menu/${hotel.slug}`,
    `${base}/m/${hotel.slug}`,
    `${base}/menu.html?h=${hotel.slug}`,
    `${base}/m/${hotel.slug}/` // trailing slash variant
  ];

  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZone}/purge_cache`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files: urls })
      });

      const data = await resp.json().catch(() => null);
      if (resp.ok && data && data.success) {
        fastify.log.info('Cloudflare purge requested', { urls });
        return;
      }

      fastify.log.warn('Cloudflare purge attempt failed', { attempt: i + 1, status: resp.status, data });
    } catch (err) {
      fastify.log.warn('Cloudflare purge error', { attempt: i + 1, error: err.message || err });
    }

    // Exponential backoff before retry
    await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, i)));
  }

  fastify.log.warn('Cloudflare purge did not succeed after retries');
}

async function deleteFromR2(imageUrl) {
  if (!imageUrl || !imageUrl.includes(PUBLIC_URL)) return;
  const key = imageUrl.replace(`${PUBLIC_URL}/`, '');
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  await r2Client.send(command);
}

// Base32 slug generation (A-Z, 2-7) — RFC 4648 alphabet
// QR codes encode these in Alphanumeric mode (5.5 bits/char) for smallest/fastest scans
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SLUG_LENGTH = 6; // 32^6 = 1,073,741,824 possible codes
const SLUG_REGEX = /^[A-Z2-7]{6}$/;

async function generateSlug(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const bytes = crypto.randomBytes(4); // 32 bits of entropy
    let slug = '';
    let bits = 0;
    let value = 0;
    let byteIndex = 0;

    while (slug.length < SLUG_LENGTH) {
      if (bits < 5) {
        value = (value << 8) | (bytes[byteIndex++] || crypto.randomBytes(1)[0]);
        bits += 8;
      }
      bits -= 5;
      slug += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }

    // Check for collision
    const existing = await prisma.hotel.findUnique({ where: { slug } });
    if (!existing) return slug;

    fastify.log.warn(`Slug collision on attempt ${attempt + 1}: ${slug}`);
  }
  throw new Error('Failed to generate unique slug after maximum attempts');
}

//==================== SECURITY PLUGINS ====================
async function registerSecurityPlugins() {
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(url => url.trim())
    : [APP_URL];

  await fastify.register(require('@fastify/cors'), {
    origin: isProduction ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  });

  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'", "https://lumberjack-cx.razorpay.com", "https://api.razorpay.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        frameSrc: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: isProduction ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });

  await fastify.register(require('@fastify/rate-limit'), {
    max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${context.after}`,
      retryAfter: context.after
    })
  });

  await fastify.register(require('@fastify/cookie'), {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
    parseOptions: COOKIE_CONFIG
  });
}

//==================== MULTIPART & STATIC ====================
async function registerContentPlugins() {
  await fastify.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: 2 * 1024 * 1024,
      files: 1,
      fields: 10
    }
  });

  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public'),
    prefix: '/',
    decorateReply: true  // Enable reply.sendFile() for /m/:code short URLs
  });
}

//==================== AUTH MIDDLEWARE ====================
async function authenticate(request, reply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('No token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'hotel_owner') throw new Error('Invalid token type');
    request.hotelId = decoded.hotelId;
    request.tenantId = decoded.tenantId;

    const hotel = await prisma.hotel.findUnique({
      where: { id: decoded.hotelId },
      select: { status: true, pinChangedAt: true, paidUntil: true, pendingPlan: true, pendingPlanPaid: true }
    });

    if (hotel?.status === 'SUSPENDED') {
      return reply.code(403).send({ error: 'Account suspended' });
    }
    if (hotel?.status === 'DELETED') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Login-time fallback: catch status transitions the cron hasn't processed yet
    const now = new Date();
    if (hotel?.status === 'ACTIVE' && hotel.paidUntil && hotel.paidUntil <= now) {
      if (hotel.pendingPlan) {
        const updateData = { plan: hotel.pendingPlan, pendingPlan: null, pendingPlanPaid: false };
        if (hotel.pendingPlanPaid) {
          // Paid upgrade/change: extend 30 days from paidUntil
          updateData.paidUntil = new Date(hotel.paidUntil.getTime() + 30 * 24 * 60 * 60 * 1000);
          updateData.status = 'ACTIVE';
        } else {
          // Free downgrade: switch plan, enter GRACE (no new period)
          updateData.status = 'GRACE';
        }
        await prisma.hotel.update({ where: { id: decoded.hotelId }, data: updateData }).catch(() => {});
      } else {
        // No pending plan: ACTIVE → GRACE
        await prisma.hotel.update({ where: { id: decoded.hotelId }, data: { status: 'GRACE' } }).catch(() => {});
      }
    }

    // Invalidate token if PIN was changed after this token was issued
    if (decoded.pinChangedAt && hotel?.pinChangedAt) {
      if (decoded.pinChangedAt !== hotel.pinChangedAt.toISOString()) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Hash the admin key for secure cookie comparison
function hashAdminKey(key) {
  return crypto.createHmac('sha256', process.env.COOKIE_SECRET).update(key).digest('hex');
}

async function authenticateSuperAdmin(request, reply) {
  const cookieToken = request.cookies?.superadmin_token;
  if (!cookieToken || !process.env.ADMIN_KEY) {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  const expectedToken = hashAdminKey(process.env.ADMIN_KEY);
  try {
    const a = Buffer.from(cookieToken, 'hex');
    const b = Buffer.from(expectedToken, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  const xRequested = request.headers['x-requested-with'];
  if (!xRequested || xRequested !== 'XMLHttpRequest') {
    return reply.code(403).send({ error: 'CSRF check failed' });
  }
  request.isSuperAdmin = true;
}

//==================== IDEMPOTENT PAYMENT ACTIVATION ====================
async function activatePayment(razorpayOrderId, razorpayPaymentId, razorpaySignature, method) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
      include: { hotel: { select: { id: true, plan: true, paidUntil: true, status: true, pendingPlan: true } } }
    });

    if (!payment) return { success: false, error: 'Payment not found' };

    // Idempotent: if already captured, just return success
    if (payment.status === 'CAPTURED') {
      return { success: true, alreadyActivated: true, paidUntil: payment.periodEnd };
    }

    const hotel = payment.hotel;
    const now = new Date();
    const isActive = hotel.status === 'ACTIVE' && hotel.paidUntil && hotel.paidUntil > now;
    const isSamePlan = payment.plan === hotel.plan;

    // If hotel is currently active AND this is a different plan → schedule it
    if (isActive && !isSamePlan) {
      // Schedule plan change: activates when current period ends
      const periodStart = hotel.paidUntil;
      const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        prisma.payment.update({
          where: { razorpayOrderId },
          data: {
            status: 'CAPTURED',
            razorpayPaymentId: razorpayPaymentId || payment.razorpayPaymentId,
            razorpaySignature: razorpaySignature || payment.razorpaySignature,
            paidAt: now,
            periodStart,
            periodEnd,
            method: method || payment.method
          }
        }),
        prisma.hotel.update({
          where: { id: hotel.id },
          data: {
            pendingPlan: payment.plan,
            pendingPlanPaid: true
          }
        }),
        prisma.auditLog.create({
          data: {
            hotelId: hotel.id,
            actorType: 'system',
            action: 'plan_change_scheduled',
            entityType: 'Payment',
            entityId: razorpayOrderId,
            newValue: {
              razorpayPaymentId,
              amount: payment.amount,
              currentPlan: hotel.plan,
              pendingPlan: payment.plan,
              activatesOn: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString()
            }
          }
        })
      ]);

      fastify.log.info(`Plan change scheduled: hotel=${hotel.id} ${hotel.plan}->${payment.plan} activates=${periodStart.toISOString()}`);
      return { success: true, scheduled: true, activatesOn: periodStart, paidUntil: periodEnd };
    }

    // Same plan renewal OR expired/trial/grace → activate immediately
    const periodStart = (hotel.paidUntil && hotel.paidUntil > now) ? hotel.paidUntil : now;
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

    // Atomic transaction: update payment + activate hotel
    await prisma.$transaction([
      prisma.payment.update({
        where: { razorpayOrderId },
        data: {
          status: 'CAPTURED',
          razorpayPaymentId: razorpayPaymentId || payment.razorpayPaymentId,
          razorpaySignature: razorpaySignature || payment.razorpaySignature,
          paidAt: now,
          periodStart,
          periodEnd,
          method: method || payment.method
        }
      }),
      prisma.hotel.update({
        where: { id: hotel.id },
        data: {
          status: 'ACTIVE',
          plan: payment.plan,
          paidUntil: periodEnd,
          pendingPlan: null,
          pendingPlanPaid: false,
          paymentMode: 'RAZORPAY',
          lastPaymentDate: now,
          lastPaymentAmount: payment.amount,
          lastPaymentNote: `Razorpay: ${razorpayPaymentId || 'N/A'}`
        }
      }),
      prisma.auditLog.create({
        data: {
          hotelId: hotel.id,
          actorType: 'system',
          action: 'payment_captured',
          entityType: 'Payment',
          entityId: razorpayOrderId,
          newValue: {
            razorpayPaymentId,
            amount: payment.amount,
            plan: payment.plan,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString()
          }
        }
      })
    ]);

    fastify.log.info(`Payment activated: hotel=${hotel.id} order=${razorpayOrderId} plan=${payment.plan} until=${periodEnd.toISOString()}`);
    return { success: true, paidUntil: periodEnd };
  } catch (err) {
    fastify.log.error(`activatePayment failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

//==================== ROUTES ====================
function registerRoutes() {
  // Health - Exempt from rate limiting
  fastify.get('/health', { config: { rateLimit: false } }, async () => {
    let dbStatus = 'unknown';
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch (e) {
      dbStatus = 'disconnected';
    }
    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database: dbStatus,
      version: process.env.npm_package_version || '1.0.0'
    };
  });

  // ==================== RAZORPAY WEBHOOK (public, signature-verified) ====================
  fastify.post('/webhooks/razorpay', {
    config: {
      rateLimit: { max: 100, timeWindow: '1 minute' },
      rawBody: true
    }
  }, async (request, reply) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      fastify.log.error('RAZORPAY_WEBHOOK_SECRET not configured');
      return reply.code(500).send({ error: 'Webhook not configured' });
    }

    // Verify webhook signature
    const receivedSig = request.headers['x-razorpay-signature'];
    if (!receivedSig) {
      return reply.code(400).send({ error: 'Missing signature' });
    }

    // Use rawBody if available (set by preParsing hook), else serialize from parsed body
    const rawBody = request.rawBody || JSON.stringify(request.body);
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    let sigValid = false;
    try {
      sigValid = expectedSig.length === receivedSig.length &&
        crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig));
    } catch { sigValid = false; }

    if (!sigValid) {
      fastify.log.warn('Razorpay webhook signature mismatch');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const event = request.body;
    const eventType = event.event;

    if (eventType === 'payment.captured') {
      const paymentEntity = event.payload?.payment?.entity;
      if (!paymentEntity) {
        fastify.log.warn('Webhook payment.captured missing payment entity');
        return reply.code(200).send({ status: 'ignored' });
      }

      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const method = paymentEntity.method || null;

      const result = await activatePayment(orderId, paymentId, null, method);
      if (result.success) {
        fastify.log.info(`Webhook: payment.captured processed for order ${orderId}`);
      } else {
        fastify.log.warn(`Webhook: payment.captured failed for order ${orderId}: ${result.error}`);
      }

      return reply.code(200).send({ status: 'ok' });
    }

    if (eventType === 'payment.failed') {
      const paymentEntity = event.payload?.payment?.entity;
      if (paymentEntity?.order_id) {
        await prisma.payment.updateMany({
          where: { razorpayOrderId: paymentEntity.order_id, status: 'CREATED' },
          data: {
            status: 'FAILED',
            razorpayPaymentId: paymentEntity.id,
            method: paymentEntity.method || null,
            metadata: { error: paymentEntity.error_description || 'Payment failed' }
          }
        }).catch(err => fastify.log.error(`Webhook: payment.failed update error: ${err.message}`));

        fastify.log.info(`Webhook: payment.failed for order ${paymentEntity.order_id}`);
      }
      return reply.code(200).send({ status: 'ok' });
    }

    // Handle refund events (issued from Razorpay dashboard)
    if (eventType === 'refund.created' || eventType === 'refund.processed') {
      const refundEntity = event.payload?.refund?.entity;
      const paymentEntity = event.payload?.payment?.entity;
      if (!refundEntity) {
        fastify.log.warn(`Webhook ${eventType}: missing refund entity`);
        return reply.code(200).send({ status: 'ignored' });
      }

      // Look up by razorpayPaymentId first, fall back to order_id
      const paymentId = refundEntity.payment_id || paymentEntity?.id;
      const orderId = paymentEntity?.order_id;

      try {
        let updated = 0;
        if (paymentId) {
          const result = await prisma.payment.updateMany({
            where: { razorpayPaymentId: paymentId, status: 'CAPTURED' },
            data: {
              status: 'REFUNDED',
              metadata: {
                refundId: refundEntity.id,
                refundAmount: refundEntity.amount,
                refundedAt: new Date().toISOString()
              }
            }
          });
          updated = result.count;
        } else if (orderId) {
          const result = await prisma.payment.updateMany({
            where: { razorpayOrderId: orderId, status: 'CAPTURED' },
            data: {
              status: 'REFUNDED',
              metadata: {
                refundId: refundEntity.id,
                refundAmount: refundEntity.amount,
                refundedAt: new Date().toISOString()
              }
            }
          });
          updated = result.count;
        }

        if (updated > 0) {
          fastify.log.info(`Webhook ${eventType}: payment marked REFUNDED (paymentId=${paymentId}, orderId=${orderId})`);
        } else {
          fastify.log.warn(`Webhook ${eventType}: no matching CAPTURED payment found (paymentId=${paymentId}, orderId=${orderId})`);
        }
      } catch (err) {
        fastify.log.error(`Webhook ${eventType} error: ${err.message}`);
      }

      return reply.code(200).send({ status: 'ok' });
    }

    // Unhandled event — acknowledge to prevent retries
    fastify.log.info(`Webhook: unhandled event type ${eventType}`);
    return reply.code(200).send({ status: 'ignored' });
  });

  // Public Menu API — base32 code lookup
  // Fire-and-forget helper: increment views + daily scan log + unique visitors
  const VISITOR_SALT = crypto.createHash('sha256').update('visitor-salt:' + process.env.JWT_SECRET).digest('hex');

  function incrementMenuViews(hotelId, clientIp, plan) {
    const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayDate = new Date(todayIST.getFullYear(), todayIST.getMonth(), todayIST.getDate());

    const ops = [
      prisma.hotel.update({
        where: { id: hotelId },
        data: { views: { increment: 1 }, lastViewAt: new Date() }
      }),
      prisma.dailyScanLog.upsert({
        where: { hotelId_date: { hotelId: hotelId, date: todayDate } },
        update: { count: { increment: 1 } },
        create: { hotelId: hotelId, date: todayDate, count: 1 }
      })
    ];

    // Unique visitor tracking via hashed IP (privacy-safe, no raw IP stored)
    // Soft-cap: stop counting new unique visitors once plan limit is reached (menu still loads)
    if (clientIp) {
      const planConfig = PLANS[plan] || PLANS.STARTER;
      const limit = planConfig.dailyUniqueVisitors;

      const trackVisitor = async () => {
        // Check current unique count if plan has a limit
        if (limit > 0) {
          const log = await prisma.dailyScanLog.findUnique({
            where: { hotelId_date: { hotelId, date: todayDate } },
            select: { uniqueCount: true }
          });
          if ((log?.uniqueCount || 0) >= limit) return; // Soft-cap reached
        }

        const visitorHash = crypto.createHash('sha256')
          .update(clientIp + todayDate.toISOString() + hotelId + VISITOR_SALT)
          .digest('hex');

        const inserted = await prisma.$executeRaw`
          INSERT INTO "DailyScanVisitor" ("id", "hotelId", "date", "visitorHash")
          VALUES (gen_random_uuid(), ${hotelId}, ${todayDate}, ${visitorHash})
          ON CONFLICT ("hotelId", "date", "visitorHash") DO NOTHING
        `;
        if (inserted > 0) {
          await prisma.dailyScanLog.upsert({
            where: { hotelId_date: { hotelId, date: todayDate } },
            update: { uniqueCount: { increment: 1 } },
            create: { hotelId, date: todayDate, count: 0, uniqueCount: 1 }
          });
        }
      };

      ops.push(trackVisitor());
    }

    Promise.all(ops).catch((err) => { fastify.log.error(`View/scan increment failed for hotel ${hotelId}: ${err.message}`); });
  }

  fastify.get('/api/menu/:code', {
    config: {
      rateLimit: {
        max: 500,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const code = (request.params.code || '').toUpperCase().trim();
    if (!SLUG_REGEX.test(code)) {
      return reply.code(400).send({ error: 'Invalid menu code format' });
    }

    // Check in-memory cache first
    const cached = getCachedMenu(code);
    if (cached) {
      incrementMenuViews(cached.hotelId, request.ip, cached.plan);
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      reply.header('X-Cache', 'HIT');
      return cached.data;
    }

    // Cache miss: query database
    const hotel = await prisma.hotel.findUnique({
      where: { slug: code },
      include: {
        categories: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            items: {
              where: { isAvailable: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true, name: true, description: true, price: true,
                imageUrl: true, isVeg: true, isPopular: true
              }
            }
          }
        }
      }
    });

    if (!hotel || hotel.status === 'SUSPENDED' || hotel.status === 'DELETED') {
      return reply.code(404).send({ error: 'Menu not found' });
    }

    const menuData = {
      name: hotel.name,
      city: hotel.city,
      theme: hotel.theme,
      logoUrl: hotel.logoUrl || null,
      plan: effectivePlan(hotel.plan, hotel.status),
      categories: hotel.categories
    };

    // Include UPI pay data only for STANDARD+ plans with feature enabled and UPI ID set
    const ePlan = effectivePlan(hotel.plan, hotel.status);
    const planCfg = PLANS[ePlan] || PLANS.STARTER;
    if (planCfg.upiPay && hotel.upiPayEnabled && hotel.upiId) {
      menuData.upiId = hotel.upiId;
    }

    // Cache the result
    setCachedMenu(code, menuData, hotel.id, effectivePlan(hotel.plan, hotel.status));

    // Fire-and-forget: increment views + daily scan log
    incrementMenuViews(hotel.id, request.ip, effectivePlan(hotel.plan, hotel.status));

    // Force revalidation so clients see updates immediately after writes
    reply.header('Cache-Control', 'no-cache, must-revalidate');
    reply.header('X-Cache', 'MISS');

    return menuData;
  });

  // Short URL: /m/:code — serves menu.html directly (QR code target)
  fastify.get('/m/:code', {
    config: {
      rateLimit: {
        max: 500,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const code = (request.params.code || '').toUpperCase().trim();
    if (!SLUG_REGEX.test(code)) {
      return reply.code(400).send({ error: 'Invalid menu code' });
    }
    return reply.sendFile('menu.html');
  });

  // ==================== QR CODE GENERATION (SVG) ====================
  // Returns optimized SVG QR code for a hotel's menu URL
  // Uses uppercase URL for QR Alphanumeric mode (5.5 bits/char vs 8 bits/char = smaller QR)
  fastify.get('/api/qr/:code', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const code = (request.params.code || '').toUpperCase().trim();
    if (!SLUG_REGEX.test(code)) {
      return reply.code(400).send({ error: 'Invalid menu code format' });
    }

    // Verify hotel exists and is accessible
    const hotel = await prisma.hotel.findUnique({
      where: { slug: code },
      select: { id: true, name: true, status: true }
    });

    if (!hotel || hotel.status === 'DELETED') {
      return reply.code(404).send({ error: 'Menu not found' });
    }

    // Use lowercase path /m/ since URL paths are case-sensitive
    const menuUrl = `https://kodspot.com/m/${code}`;
    const svg = await QRCode.toString(menuUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H', // 30% error correction — survives scratches, smudges on printed cards
      margin: 2,
      width: 512,
      color: {
        dark: '#1e293b',  // Slate-800, matches brand
        light: '#ffffff'
      }
    });

    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'public, max-age=86400'); // Cache 24h — slug doesn't change
    reply.header('Content-Disposition', `inline; filename="${code}-qr.svg"`);
    return svg;
  });

  // ==================== REVIEW QR CODE (SVG) ==========================
  // Generates QR SVG for a hotel's review URL (Google, Zomato, etc.)
  // Used by admin & superadmin panels for the back-side card generation.
  fastify.get('/api/qr/review/:hotelId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { hotelId } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hotelId)) {
      return reply.code(400).send({ error: 'Invalid hotel ID' });
    }

    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { reviewUrl: true, status: true }
    });

    if (!hotel || !hotel.reviewUrl || hotel.status === 'DELETED') {
      return reply.code(404).send({ error: 'No review URL configured' });
    }

    const svg = await QRCode.toString(hotel.reviewUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 512,
      color: {
        dark: '#92400e',  // Amber-800 — differentiates from menu QR
        light: '#ffffff'
      }
    });

    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Content-Disposition', `inline; filename="review-qr.svg"`);
    return svg;
  });

  // ==================== UPI QR CODE (SVG) ==========================
  // Generates QR SVG encoding a upi:// deeplink for the hotel's UPI ID.
  // Used by admin & superadmin for the QR card, and by menu.js for desktop fallback.
  fastify.get('/api/qr/upi/:hotelId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { hotelId } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hotelId)) {
      return reply.code(400).send({ error: 'Invalid hotel ID' });
    }

    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { name: true, upiId: true, upiPayEnabled: true, plan: true, status: true }
    });

    if (!hotel || !hotel.upiId || !hotel.upiPayEnabled || hotel.status === 'DELETED') {
      return reply.code(404).send({ error: 'UPI Pay not configured' });
    }

    // Plan-gate: only STANDARD+ can have UPI QR
    const ePlan = effectivePlan(hotel.plan, hotel.status);
    const planCfg = PLANS[ePlan] || PLANS.STARTER;
    if (!planCfg.upiPay) {
      return reply.code(403).send({ error: 'UPI Pay requires Standard or Pro plan' });
    }

    const upiUri = `upi://pay?pa=${encodeURIComponent(hotel.upiId)}&pn=${encodeURIComponent(hotel.name)}&cu=INR`;

    const svg = await QRCode.toString(upiUri, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 512,
      color: {
        dark: '#059669',  // Emerald-600 — differentiates from menu (slate) and review (amber) QR
        light: '#ffffff'
      }
    });

    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Content-Disposition', `inline; filename="upi-qr.svg"`);
    return svg;
  });

  // ==================== LOGO PROXY (same-origin for Canvas) ====================
  // Proxies logo image from R2 through the app origin so Canvas drawImage()
  // works without crossOrigin / CORS headers (R2 pub-*.r2.dev doesn't send them).
  // Public endpoint — logo images are already publicly accessible via R2 URLs.
  fastify.get('/api/logo/:hotelId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { hotelId } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hotelId)) {
      return reply.code(400).send({ error: 'Invalid hotel ID' });
    }

    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { logoUrl: true, status: true }
    });

    if (!hotel || hotel.status === 'DELETED' || hotel.status === 'SUSPENDED') {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!hotel.logoUrl) {
      return reply.code(404).send({ error: 'No logo' });
    }

    try {
      const r2Res = await fetch(hotel.logoUrl);
      if (!r2Res.ok) return reply.code(502).send({ error: 'Upstream error' });

      const buffer = Buffer.from(await r2Res.arrayBuffer());
      const ct = r2Res.headers.get('content-type') || 'image/jpeg';

      reply.header('Content-Type', ct);
      reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      return reply.send(buffer);
    } catch (err) {
      request.log.error(`Logo proxy error for hotel ${hotelId}: ${err.message}`);
      return reply.code(502).send({ error: 'Upstream error' });
    }
  });

  // Professional URL: /admin — serves admin.html (hotel owner panel)
  fastify.get('/admin', async (request, reply) => {
    return reply.sendFile('admin.html');
  });

  // Professional URL: /superadmin — serves superadmin.html
  fastify.get('/superadmin', async (request, reply) => {
    return reply.sendFile('superadmin.html');
  });

  // Legacy redirect: /admin.html → /admin (permanent 301)
  fastify.get('/admin.html', async (request, reply) => {
    return reply.redirect(301, '/admin');
  });

  // Legacy redirect: /superadmin.html → /superadmin (permanent 301)
  fastify.get('/superadmin.html', async (request, reply) => {
    return reply.redirect(301, '/superadmin');
  });

  // Legacy redirect: /menu.html?h=CODE → /m/CODE (permanent 301)
  fastify.get('/menu.html', async (request, reply) => {
    const code = (request.query.h || '').toUpperCase().trim();
    if (code && SLUG_REGEX.test(code)) {
      return reply.redirect(301, `/m/${code}`);
    }
    // If no valid code, serve the file normally (fallback)
    return reply.sendFile('menu.html');
  });

  // ==================== TRIAL REQUEST (PUBLIC) ====================
  fastify.post('/auth/request-trial', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 3600000,
        keyGenerator: (req) => `trial-req:${req.ip}`
      }
    }
  }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200).transform(v => v.trim()),
      city: z.string().min(1).max(100).transform(v => v.trim()),
      phone: z.string().min(10).max(15).regex(/^\d{10,15}$/, 'Invalid phone number'),
      email: z.string().email().max(200).optional().or(z.literal(''))
    });

    const data = schema.parse(request.body);

    // Deduplicate: reject if same phone already has a pending request
    const existing = await prisma.trialRequest.findFirst({
      where: { phone: data.phone, status: 'pending' }
    });
    if (existing) {
      return { success: true, message: 'Your request is already being processed. We will contact you shortly via WhatsApp.' };
    }

    await prisma.trialRequest.create({
      data: {
        name: data.name,
        city: data.city,
        phone: data.phone,
        email: data.email || null
      }
    });

    // Best-effort email notification to admin
    try {
      const transporter = getSesTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: `KodSpot <${SES_FROM}>`,
          to: process.env.ADMIN_NOTIFICATION_EMAIL || SES_FROM,
          subject: `New Trial Request — ${data.name} (${data.city})`,
          text: `New trial request:\n\nRestaurant: ${data.name}\nCity: ${data.city}\nPhone: ${data.phone}\nEmail: ${data.email || 'Not provided'}\n\nLogin to superadmin to review.`
        });
      }
    } catch (emailErr) {
      fastify.log.error(`Trial request notification email failed: ${emailErr.message}`);
    }

    return {
      success: true,
      message: 'Thank you! We will set up your account and contact you via WhatsApp within a few hours.'
    };
  });

  // Hotel Owner Login — 6-char base32 code + 8-digit PIN
  fastify.post('/auth/login', {
    config: { rateLimit: loginSlugRateLimit }
  }, async (request, reply) => {
    const schema = z.object({
      code: z.string().length(6).regex(/^[A-Z2-7]{6}$/, 'Must be a 6-character menu code'),
      pin: z.string().length(8).regex(/^\d{8}$/)
    });

    const { code, pin } = schema.parse(request.body);
    const normalizedCode = code.toUpperCase().trim();

    const hotel = await prisma.hotel.findUnique({
      where: { slug: normalizedCode },
      select: { id: true, tenantId: true, slug: true, name: true, status: true, pinHash: true, pinChangedAt: true }
    });

    if (!hotel) return reply.code(401).send({ error: 'Invalid credentials' });

    if (hotel.status === 'SUSPENDED') return reply.code(403).send({ error: 'Account suspended' });
    if (hotel.status === 'DELETED') return reply.code(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(pepperPin(pin), hotel.pinHash);
    if (!valid) {
      fastify.log.warn(`Failed login attempt for hotel: ${normalizedCode} from IP: ${request.ip}`);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        hotelId: hotel.id,
        tenantId: hotel.tenantId,
        slug: hotel.slug,
        type: 'hotel_owner',
        pinChangedAt: hotel.pinChangedAt.toISOString()
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return {
      token,
      hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotel.status }
    };
  });

  //==================== FORGOT PIN (SELF-SERVICE EMAIL OTP) ====================
  fastify.register(async function (app) {

    // Step 1: Request OTP — sends 6-digit code to registered email
    app.post('/auth/forgot-pin/request', {
      config: { rateLimit: forgotPinRequestRateLimit }
    }, async (request, reply) => {
      const schema = z.object({
        code: z.string().length(6).regex(/^[A-Z2-7]{6}$/, 'Invalid menu code'),
        email: z.string().email().max(200),
        fingerprint: z.string().max(500).optional()
      });

      const { code, email, fingerprint } = schema.parse(request.body);
      const normalizedCode = code.toUpperCase().trim();
      const normalizedEmail = email.toLowerCase().trim();

      // Generic response to prevent email/account enumeration
      const genericResponse = {
        success: true,
        message: 'If a matching account exists, a reset code has been sent to the registered email.'
      };

      const transporter = getSesTransporter();
      if (!transporter) {
        fastify.log.error('SES not configured — forgot-pin request cannot send email');
        return genericResponse;
      }

      // Lookup hotel by slug
      const hotel = await prisma.hotel.findUnique({
        where: { slug: normalizedCode },
        select: { id: true, name: true, email: true, status: true }
      });

      // Bail silently if no match — constant-time delay prevents timing oracle
      if (!hotel || !hotel.email || hotel.status === 'SUSPENDED' || hotel.status === 'DELETED') {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        return genericResponse;
      }

      if (hotel.email.toLowerCase().trim() !== normalizedEmail) {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        return genericResponse;
      }

      // Daily OTP cap per hotel
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyCount = await prisma.pinResetOtp.count({
        where: { hotelId: hotel.id, createdAt: { gte: dayAgo } }
      });

      if (dailyCount >= OTP_DAILY_LIMIT) {
        fastify.log.warn(`Daily OTP limit reached for hotel ${hotel.id}`);
        return reply.code(429).send({ error: 'Too many reset requests today. Please try again tomorrow or contact support.' });
      }

      // Cooldown: 60s between OTP requests for same hotel
      const lastOtp = await prisma.pinResetOtp.findFirst({
        where: { hotelId: hotel.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      });

      if (lastOtp && (Date.now() - lastOtp.createdAt.getTime()) < OTP_COOLDOWN_MS) {
        return reply.code(429).send({ error: 'Please wait before requesting another code.' });
      }

      // Invalidate all previous unused OTPs for this hotel (replay protection)
      await prisma.pinResetOtp.updateMany({
        where: { hotelId: hotel.id, used: false },
        data: { used: true, usedAt: new Date() }
      });

      // Generate 6-digit OTP
      const plainOtp = crypto.randomInt(100000, 999999).toString();
      const otpHash = await bcrypt.hash(plainOtp, BCRYPT_COST);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      // Store hashed OTP with metadata
      await prisma.pinResetOtp.create({
        data: {
          hotelId: hotel.id,
          otpHash,
          expiresAt,
          attempts: 0,
          maxAttempts: OTP_MAX_ATTEMPTS,
          ipAddress: request.ip || 'unknown',
          userAgent: (request.headers['user-agent'] || '').substring(0, 500),
          fingerprint: (fingerprint || '').substring(0, 500)
        }
      });

      // Send email via SES
      try {
        await transporter.sendMail({
          from: `KodSpot <${SES_FROM}>`,
          to: hotel.email,
          subject: 'Your PIN Reset Code - KodSpot',
          html: buildOtpEmailHtml(hotel.name, plainOtp, OTP_EXPIRY_MINUTES),
          text: buildOtpEmailText(hotel.name, plainOtp, OTP_EXPIRY_MINUTES)
        });
        fastify.log.info(`OTP email sent for hotel ${hotel.id} to ${hotel.email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
      } catch (err) {
        fastify.log.error(`Failed to send OTP email for hotel ${hotel.id}: ${err.message}`);
        // Don't reveal email delivery failure to client
      }

      // Audit log
      await prisma.auditLog.create({
        data: {
          hotelId: hotel.id,
          actorType: 'system',
          action: 'pin_reset_otp_requested',
          entityType: 'Hotel',
          entityId: hotel.id,
          newValue: { ip: request.ip, dailyCount: dailyCount + 1 }
        }
      });

      return genericResponse;
    });

    // Step 2: Verify OTP — returns a short-lived reset token
    app.post('/auth/forgot-pin/verify', {
      config: { rateLimit: forgotPinVerifyRateLimit }
    }, async (request, reply) => {
      const schema = z.object({
        code: z.string().length(6).regex(/^[A-Z2-7]{6}$/),
        otp: z.string().length(6).regex(/^\d{6}$/),
        fingerprint: z.string().max(500).optional()
      });

      const { code, otp, fingerprint } = schema.parse(request.body);
      const normalizedCode = code.toUpperCase().trim();

      const hotel = await prisma.hotel.findUnique({
        where: { slug: normalizedCode },
        select: { id: true, status: true }
      });

      if (!hotel || hotel.status === 'SUSPENDED' || hotel.status === 'DELETED') {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        return reply.code(400).send({ error: 'Invalid or expired code' });
      }

      // Find latest active OTP for this hotel
      const otpRecord = await prisma.pinResetOtp.findFirst({
        where: {
          hotelId: hotel.id,
          used: false,
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!otpRecord) {
        return reply.code(400).send({ error: 'Invalid or expired code. Please request a new one.' });
      }

      // Check attempt limit (brute force protection)
      if (otpRecord.attempts >= otpRecord.maxAttempts) {
        await prisma.pinResetOtp.update({
          where: { id: otpRecord.id },
          data: { used: true, usedAt: new Date() }
        });

        await prisma.auditLog.create({
          data: {
            hotelId: hotel.id,
            actorType: 'system',
            action: 'pin_reset_otp_max_attempts',
            entityType: 'Hotel',
            entityId: hotel.id,
            newValue: { ip: request.ip, attempts: otpRecord.attempts }
          }
        });

        return reply.code(400).send({ error: 'Too many incorrect attempts. Please request a new code.' });
      }

      // Increment attempt count BEFORE comparison (race condition protection)
      await prisma.pinResetOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } }
      });

      // Verify OTP via bcrypt compare
      const valid = await bcrypt.compare(otp, otpRecord.otpHash);

      if (!valid) {
        const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);

        await prisma.auditLog.create({
          data: {
            hotelId: hotel.id,
            actorType: 'system',
            action: 'pin_reset_otp_failed',
            entityType: 'Hotel',
            entityId: hotel.id,
            newValue: { ip: request.ip, attemptsUsed: otpRecord.attempts + 1, remaining: remainingAttempts }
          }
        });

        return reply.code(400).send({ error: 'Invalid code', remainingAttempts });
      }

      // OTP valid — generate short-lived reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

      // Mark OTP used + store reset token hash
      await prisma.pinResetOtp.update({
        where: { id: otpRecord.id },
        data: {
          used: true,
          usedAt: new Date(),
          resetTokenHash,
          resetExpiresAt,
          resetUsed: false
        }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: hotel.id,
          actorType: 'system',
          action: 'pin_reset_otp_verified',
          entityType: 'Hotel',
          entityId: hotel.id,
          newValue: { ip: request.ip }
        }
      });

      fastify.log.info(`OTP verified for hotel ${hotel.id}, reset token issued`);

      return {
        success: true,
        resetToken,
        expiresIn: RESET_TOKEN_EXPIRY_MINUTES * 60
      };
    });

    // Step 3: Reset PIN — validates reset token + sets new PIN
    app.post('/auth/forgot-pin/reset', {
      config: { rateLimit: forgotPinResetRateLimit }
    }, async (request, reply) => {
      const schema = z.object({
        code: z.string().length(6).regex(/^[A-Z2-7]{6}$/),
        resetToken: z.string().length(64).regex(/^[a-f0-9]{64}$/),
        newPin: z.string().length(8).regex(/^\d{8}$/),
        fingerprint: z.string().max(500).optional()
      });

      const { code, resetToken, newPin, fingerprint } = schema.parse(request.body);
      const normalizedCode = code.toUpperCase().trim();

      // Reject weak PINs
      if (isWeakPin(newPin)) {
        return reply.code(400).send({ error: 'PIN is too simple. Choose a stronger PIN.' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { slug: normalizedCode },
        select: { id: true, name: true, status: true }
      });

      if (!hotel || hotel.status === 'SUSPENDED' || hotel.status === 'DELETED') {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      // Find the verified OTP record with an unused reset token
      const otpRecord = await prisma.pinResetOtp.findFirst({
        where: {
          hotelId: hotel.id,
          used: true,
          resetUsed: false,
          resetExpiresAt: { gt: new Date() },
          resetTokenHash: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!otpRecord || !otpRecord.resetTokenHash) {
        return reply.code(400).send({ error: 'Invalid or expired reset session. Please start over.' });
      }

      // Timing-safe reset token comparison
      const submittedHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      try {
        const a = Buffer.from(submittedHash, 'hex');
        const b = Buffer.from(otpRecord.resetTokenHash, 'hex');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          await prisma.auditLog.create({
            data: {
              hotelId: hotel.id,
              actorType: 'system',
              action: 'pin_reset_token_invalid',
              entityType: 'Hotel',
              entityId: hotel.id,
              newValue: { ip: request.ip }
            }
          });
          return reply.code(400).send({ error: 'Invalid or expired reset session. Please start over.' });
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      // Token valid — hash peppered PIN and update atomically
      const pinHash = await bcrypt.hash(pepperPin(newPin), BCRYPT_COST);
      const now = new Date();

      await prisma.$transaction([
        prisma.hotel.update({
          where: { id: hotel.id },
          data: {
            pinHash,
            pinChangedAt: now,
            pinResetCount: { increment: 1 },
            lastPinResetAt: now,
            lastPinResetBy: 'self_service'
          }
        }),
        prisma.pinResetOtp.update({
          where: { id: otpRecord.id },
          data: { resetUsed: true }
        }),
        // Invalidate any other pending reset tokens for this hotel
        prisma.pinResetOtp.updateMany({
          where: {
            hotelId: hotel.id,
            id: { not: otpRecord.id },
            resetUsed: false
          },
          data: { resetUsed: true }
        })
      ]);

      // Audit log
      await prisma.auditLog.create({
        data: {
          hotelId: hotel.id,
          actorType: 'system',
          action: 'pin_reset_self_service',
          entityType: 'Hotel',
          entityId: hotel.id,
          newValue: { ip: request.ip, method: 'email_otp', pinResetBy: 'self_service' }
        }
      });

      fastify.log.info(`PIN reset via self-service for hotel ${hotel.id} (${hotel.name})`);

      return {
        success: true,
        message: 'PIN has been reset successfully. You can now log in with your new PIN.'
      };
    });

  });

  //==================== PROTECTED HOTEL OWNER ROUTES ====================
  fastify.register(async function (app) {
    app.addHook('preHandler', authenticate);

    app.get('/me', async (request) => {
      return prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: {
          id: true, name: true, slug: true, city: true, phone: true,
          plan: true, status: true, theme: true, qrTheme: true, logoUrl: true, reviewUrl: true, views: true,
          upiId: true, upiPayEnabled: true,
          trialEnds: true, paidUntil: true, createdAt: true, updatedAt: true,
          categories: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            include: {
              items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }
            }
          }
        }
      });
    });

    // ==================== BILLING: Get plan info + payment history ====================
    app.get('/me/billing', async (request) => {
      const hotel = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { id: true, plan: true, status: true, paidUntil: true, trialEnds: true, pendingPlan: true, pendingPlanPaid: true }
      });
      if (!hotel) return { error: 'Not found' };

      // Only return completed transactions (CAPTURED/REFUNDED) to hotel owners.
      // CREATED = abandoned checkout, FAILED = payment attempt failed — both are noise.
      const payments = await prisma.payment.findMany({
        where: { hotelId: request.hotelId, status: { in: ['CAPTURED', 'REFUNDED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, amount: true, plan: true, status: true, method: true,
          paidAt: true, periodStart: true, periodEnd: true, createdAt: true
        }
      });

      // Today's scan count
      const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const todayDate = new Date(todayIST.getFullYear(), todayIST.getMonth(), todayIST.getDate());
      const scanLog = await prisma.dailyScanLog.findUnique({
        where: { hotelId_date: { hotelId: request.hotelId, date: todayDate } }
      });

      const ePlan = effectivePlan(hotel.plan, hotel.status);
      const planConfig = PLANS[ePlan] || PLANS.STARTER;

      return {
        plan: hotel.plan,
        status: hotel.status,
        paidUntil: hotel.paidUntil,
        trialEnds: hotel.trialEnds,
        pendingPlan: hotel.pendingPlan,
        pendingPlanPaid: hotel.pendingPlanPaid,
        pendingActivatesOn: (hotel.pendingPlan && hotel.paidUntil) ? hotel.paidUntil : null,
        planLabel: planConfig.label,
        planPrice: planConfig.price,
        dailyUniqueLimit: planConfig.dailyUniqueVisitors,
        todayScans: scanLog?.count || 0,
        todayUnique: scanLog?.uniqueCount || 0,
        allowedThemes: THEME_TIERS[ePlan] || THEME_TIERS.STARTER,
        analyticsDays: planConfig.analyticsDays,
        hideBranding: planConfig.hideBranding,
        payments
      };
    });

    // ==================== ANALYTICS: Unique visitors + scan breakdown ====================
    app.get('/me/analytics', async (request) => {
      const hotelId = request.hotelId;
      const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const todayDate = new Date(todayIST.getFullYear(), todayIST.getMonth(), todayIST.getDate());

      // Determine analytics depth from plan
      const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { plan: true, status: true } });
      const ePlan = effectivePlan(hotel?.plan, hotel?.status);
      const planConfig = PLANS[ePlan] || PLANS.STARTER;
      const days = planConfig.analyticsDays; // 1, 7, or 30

      const startDate = new Date(todayDate);
      startDate.setDate(startDate.getDate() - (days - 1));

      const logs = await prisma.dailyScanLog.findMany({
        where: { hotelId, date: { gte: startDate, lte: todayDate } },
        orderBy: { date: 'asc' },
        select: { date: true, count: true, uniqueCount: true }
      });

      // Build day-by-day array (fill gaps with zeros)
      const daily = [];
      const logMap = {};
      for (const l of logs) {
        const key = l.date.toISOString().slice(0, 10);
        logMap[key] = { scans: l.count, unique: l.uniqueCount };
      }
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        daily.push({
          date: key,
          scans: logMap[key]?.scans || 0,
          unique: logMap[key]?.unique || 0
        });
      }

      // Aggregates
      const today = daily[daily.length - 1] || { scans: 0, unique: 0 };
      const last7 = daily.slice(-Math.min(7, days));
      const week = { scans: 0, unique: 0 };
      for (const d of last7) { week.scans += d.scans; week.unique += d.unique; }
      const month = { scans: 0, unique: 0 };
      for (const d of daily) { month.scans += d.scans; month.unique += d.unique; }

      return {
        today: { scans: today.scans, unique: today.unique },
        week,
        month,
        daily,
        analyticsDays: days
      };
    });

    // ==================== BILLING: Create Razorpay Order ====================
    app.post('/payments/create-order', async (request, reply) => {
      const rz = getRazorpay();
      if (!rz) return reply.code(503).send({ error: 'Payment system not configured' });

      const schema = z.object({
        plan: z.enum(['STARTER', 'STANDARD', 'PRO']).optional()
      });
      const { plan: requestedPlan } = schema.parse(request.body || {});

      const hotel = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { id: true, name: true, email: true, phone: true, plan: true, status: true, paidUntil: true, pendingPlan: true, pendingPlanPaid: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      // Use requested plan or current plan
      const plan = requestedPlan || hotel.plan;
      const planConfig = PLANS[plan];
      if (!planConfig) return reply.code(400).send({ error: 'Invalid plan' });

      // Block if a paid plan change is already pending
      if (hotel.pendingPlan && hotel.pendingPlanPaid) {
        return reply.code(409).send({ error: `You already have a paid plan change to ${hotel.pendingPlan} scheduled. It will activate when your current period ends.` });
      }

      // Reject downgrades — must use the free downgrade endpoint
      const isActive = hotel.status === 'ACTIVE' && hotel.paidUntil && hotel.paidUntil > new Date();
      if (isActive && PLAN_TIER[plan] < PLAN_TIER[hotel.plan]) {
        return reply.code(400).send({ error: 'To switch to a lower plan, use the downgrade option instead. Downgrades are free and take effect after your current period.' });
      }

      // Block same-plan renewal when subscription has >7 days remaining
      if (isActive && plan === hotel.plan) {
        const daysLeft = Math.ceil((hotel.paidUntil - new Date()) / (24 * 60 * 60 * 1000));
        if (daysLeft > 7) {
          return reply.code(409).send({
            error: `Your ${plan} plan is active until ${hotel.paidUntil.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. You can renew within 7 days of expiry.`,
            daysLeft
          });
        }
      }

      // Expire any stale CREATED orders for this hotel (prevents duplicate checkouts)
      await prisma.payment.updateMany({
        where: { hotelId: hotel.id, status: 'CREATED' },
        data: { status: 'FAILED', metadata: { note: 'Superseded by new order' } }
      });

      let order;
      try {
        order = await rz.orders.create({
          amount: planConfig.price,
          currency: 'INR',
          receipt: `rcpt_${hotel.id.slice(-8)}_${Date.now()}`,
          notes: {
            hotelId: hotel.id,
            plan: plan,
            hotelName: hotel.name
          }
        });
      } catch (rzErr) {
        request.log.error({ err: rzErr, hotelId: hotel.id, plan }, 'Razorpay order creation failed');
        return reply.code(502).send({ error: 'Payment gateway error. Please try again.' });
      }

      // Store order in Payment table
      await prisma.payment.create({
        data: {
          hotelId: hotel.id,
          razorpayOrderId: order.id,
          amount: planConfig.price,
          plan: plan,
          status: 'CREATED'
        }
      });

      return {
        orderId: order.id,
        amount: planConfig.price,
        currency: 'INR',
        plan: plan,
        planLabel: planConfig.label,
        keyId: process.env.RAZORPAY_KEY_ID,
        hotelName: hotel.name,
        email: hotel.email || '',
        phone: hotel.phone || ''
      };
    });

    // ==================== BILLING: Verify Payment (client callback) ====================
    app.post('/payments/verify', async (request, reply) => {
      const schema = z.object({
        razorpay_order_id: z.string().min(1),
        razorpay_payment_id: z.string().min(1),
        razorpay_signature: z.string().min(1)
      });

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = schema.parse(request.body);

      // Verify signature (uses key_secret, not webhook_secret)
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const expectedSig = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      const sigValid = expectedSig.length === razorpay_signature.length &&
        crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(razorpay_signature));

      if (!sigValid) {
        return reply.code(400).send({ error: 'Invalid payment signature' });
      }

      // Activate payment (idempotent)
      const result = await activatePayment(razorpay_order_id, razorpay_payment_id, razorpay_signature, null);
      if (!result.success) {
        return reply.code(400).send({ error: result.error || 'Payment activation failed' });
      }

      return { success: true, message: 'Payment verified and activated', paidUntil: result.paidUntil, scheduled: result.scheduled || false };
    });

    // ==================== BILLING: Schedule Downgrade (free, no payment) ====================
    app.post('/me/downgrade', async (request, reply) => {
      const schema = z.object({
        plan: z.enum(['STARTER', 'STANDARD', 'PRO'])
      });
      const { plan: targetPlan } = schema.parse(request.body);

      const hotel = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { id: true, plan: true, status: true, paidUntil: true, pendingPlan: true, pendingPlanPaid: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      // Only active subscribers can schedule downgrades
      const isActive = hotel.status === 'ACTIVE' && hotel.paidUntil && hotel.paidUntil > new Date();
      if (!isActive) {
        return reply.code(400).send({ error: 'Downgrades are only available for active subscriptions. Choose a plan to subscribe.' });
      }

      // Must be a lower plan
      if (PLAN_TIER[targetPlan] >= PLAN_TIER[hotel.plan]) {
        return reply.code(400).send({ error: 'Target plan must be lower than your current plan.' });
      }

      // Block if a paid plan change is already pending
      if (hotel.pendingPlan && hotel.pendingPlanPaid) {
        return reply.code(409).send({ error: `You already have a paid upgrade to ${hotel.pendingPlan} scheduled.` });
      }

      await prisma.$transaction([
        prisma.hotel.update({
          where: { id: hotel.id },
          data: { pendingPlan: targetPlan, pendingPlanPaid: false }
        }),
        prisma.auditLog.create({
          data: {
            hotelId: hotel.id,
            actorType: 'owner',
            action: 'downgrade_scheduled',
            entityType: 'Hotel',
            entityId: hotel.id,
            newValue: { currentPlan: hotel.plan, pendingPlan: targetPlan }
          }
        })
      ]);

      return { success: true, message: `Switch to ${targetPlan} scheduled. Your current plan stays active until the end of your billing period, then switches automatically.` };
    });

    // ==================== BILLING: Cancel Pending Plan Change ====================
    app.delete('/me/pending-plan', async (request, reply) => {
      const hotel = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { id: true, pendingPlan: true, pendingPlanPaid: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      if (!hotel.pendingPlan) {
        return reply.code(400).send({ error: 'No pending plan change to cancel.' });
      }

      // Only allow cancelling unpaid (downgrade) pending changes
      if (hotel.pendingPlanPaid) {
        return reply.code(400).send({ error: 'Paid plan changes cannot be cancelled. Contact support for a refund.' });
      }

      await prisma.$transaction([
        prisma.hotel.update({
          where: { id: hotel.id },
          data: { pendingPlan: null, pendingPlanPaid: false }
        }),
        prisma.auditLog.create({
          data: {
            hotelId: hotel.id,
            actorType: 'owner',
            action: 'pending_plan_cancelled',
            entityType: 'Hotel',
            entityId: hotel.id,
            newValue: { cancelledPlan: hotel.pendingPlan }
          }
        })
      ]);

      return { success: true, message: 'Pending plan change cancelled.' };
    });

    app.patch('/settings/theme', async (request, reply) => {
      const schema = z.object({
        theme: z.enum(ALL_THEMES)
      });
      const { theme } = schema.parse(request.body);

      // Check if hotel's plan allows this theme
      const hotel = await prisma.hotel.findUnique({ where: { id: request.hotelId }, select: { plan: true, status: true } });
      const ePlan = effectivePlan(hotel?.plan, hotel?.status);
      const allowed = THEME_TIERS[ePlan] || THEME_TIERS.STARTER;
      if (!allowed.includes(theme)) {
        return reply.code(403).send({ error: 'Theme not available on your current plan. Please upgrade.' });
      }

      const updated = await prisma.hotel.update({
        where: { id: request.hotelId },
        data: { theme }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'theme_changed',
          entityType: 'Hotel',
          entityId: request.hotelId,
          newValue: { theme }
        }
      });

      // Invalidate menu cache so theme change reflects immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, theme: updated.theme };
    });

    // ==================== QR CARD THEME (HOTEL OWNER) ====================
    app.patch('/settings/qr-theme', async (request, reply) => {
      const schema = z.object({
        qrTheme: z.enum(ALL_QR_THEMES)
      });
      const { qrTheme } = schema.parse(request.body);

      const hotel = await prisma.hotel.findUnique({ where: { id: request.hotelId }, select: { plan: true, status: true } });
      const ePlan = effectivePlan(hotel?.plan, hotel?.status);
      const allowed = QR_THEME_TIERS[ePlan] || QR_THEME_TIERS.STARTER;
      if (!allowed.includes(qrTheme)) {
        return reply.code(403).send({ error: 'QR theme not available on your current plan. Please upgrade.' });
      }

      const updated = await prisma.hotel.update({
        where: { id: request.hotelId },
        data: { qrTheme }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'qr_theme_changed',
          entityType: 'Hotel',
          entityId: request.hotelId,
          newValue: { qrTheme }
        }
      });

      return { success: true, qrTheme: updated.qrTheme };
    });

    // ==================== REVIEW URL (HOTEL OWNER) ====================
    app.patch('/settings/review-url', async (request, reply) => {
      const schema = z.object({
        reviewUrl: z.string().url().max(500).or(z.literal(''))
      });
      let data;
      try {
        data = schema.parse(request.body);
      } catch (err) {
        if (err.name === 'ZodError') return reply.code(400).send({ error: 'Please enter a valid URL (e.g. https://g.page/r/...)' });
        throw err;
      }

      const updated = await prisma.hotel.update({
        where: { id: request.hotelId },
        data: { reviewUrl: data.reviewUrl || null }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'review_url_changed',
          entityType: 'Hotel',
          entityId: request.hotelId,
          newValue: { reviewUrl: data.reviewUrl || null }
        }
      });

      return { success: true, reviewUrl: updated.reviewUrl || '' };
    });

    // ==================== UPI PAY SETTINGS (HOTEL OWNER) ====================
    const UPI_ID_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z][a-zA-Z0-9]*$/;

    app.patch('/settings/upi', async (request, reply) => {
      // Plan-gate: only STANDARD and PRO
      const hotel = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { plan: true, status: true, upiId: true, upiPayEnabled: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      const ePlan = effectivePlan(hotel.plan, hotel.status);
      const planCfg = PLANS[ePlan] || PLANS.STARTER;
      if (!planCfg.upiPay) {
        return reply.code(403).send({ error: 'UPI Pay is available on Standard and Pro plans. Please upgrade.' });
      }

      const schema = z.object({
        upiId: z.string().max(100).regex(UPI_ID_REGEX, 'Invalid UPI ID format (e.g. name@upi)').or(z.literal('')).optional(),
        upiPayEnabled: z.boolean().optional()
      });
      let data;
      try {
        data = schema.parse(request.body);
      } catch (err) {
        if (err.name === 'ZodError') {
          const msg = err.errors?.[0]?.message || 'Invalid UPI ID format. Example: yourname@ybl';
          return reply.code(400).send({ error: msg });
        }
        throw err;
      }

      const updateData = {};
      if (data.upiId !== undefined) {
        updateData.upiId = data.upiId || null;
        // If UPI ID is being cleared, also disable the feature
        if (!data.upiId) updateData.upiPayEnabled = false;
      }
      if (data.upiPayEnabled !== undefined) {
        // Can only enable if a UPI ID exists (either being set now or already saved)
        const willHaveUpiId = data.upiId !== undefined ? !!data.upiId : !!hotel.upiId;
        updateData.upiPayEnabled = data.upiPayEnabled && willHaveUpiId;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.code(400).send({ error: 'No changes provided' });
      }

      const updated = await prisma.hotel.update({
        where: { id: request.hotelId },
        data: updateData,
        select: { upiId: true, upiPayEnabled: true }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'upi_settings_changed',
          entityType: 'Hotel',
          entityId: request.hotelId,
          oldValue: { upiId: hotel.upiId || null, upiPayEnabled: hotel.upiPayEnabled },
          newValue: { upiId: updated.upiId || null, upiPayEnabled: updated.upiPayEnabled }
        }
      });

      // Invalidate menu cache so public menu reflects change immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, upiId: updated.upiId || '', upiPayEnabled: updated.upiPayEnabled };
    });

    // ==================== LOGO UPLOAD (HOTEL OWNER) ====================
    app.post('/me/logo', async (request, reply) => {
      try {
        const fileData = request.body.image;
        if (!fileData) return reply.code(400).send({ error: 'No file uploaded' });

        const file = Array.isArray(fileData) ? fileData[0] : fileData;
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedTypes.includes(file.mimetype)) {
          return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
        }

        const buffer = await file.toBuffer();
        if (buffer.length > 2 * 1024 * 1024) return reply.code(400).send({ error: 'File too large. Max 2MB.' });

        const isValidImage = validateImageBuffer(buffer, file.mimetype);
        if (!isValidImage) return reply.code(400).send({ error: 'Invalid image file' });

        // Delete old logo if it exists
        const existing = await prisma.hotel.findUnique({
          where: { id: request.hotelId },
          select: { logoUrl: true }
        });
        if (existing?.logoUrl) {
          await deleteFromR2(existing.logoUrl).catch((err) => {
            fastify.log.error(`Failed to delete old logo from R2 for hotel ${request.hotelId}: ${err.message}`);
          });
        }

        const logoUrl = await uploadToR2(buffer, file.mimetype, request.hotelId);
        await prisma.hotel.update({
          where: { id: request.hotelId },
          data: { logoUrl }
        });

        await prisma.auditLog.create({
          data: {
            hotelId: request.hotelId,
            actorType: 'owner',
            action: 'logo_uploaded',
            entityType: 'Hotel',
            entityId: request.hotelId,
            oldValue: existing?.logoUrl ? { logoUrl: existing.logoUrl } : null,
            newValue: { logoUrl }
          }
        });

        // Purge CDN cache so updated logo appears immediately on public menu
        try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

        return { success: true, logoUrl };
      } catch (err) {
        request.log.error(err);
        return reply.code(400).send({ error: 'Logo upload failed' });
      }
    });

    app.delete('/me/logo', async (request, reply) => {
      const existing = await prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: { logoUrl: true }
      });

      if (!existing?.logoUrl) {
        return reply.code(404).send({ error: 'No logo to delete' });
      }

      await deleteFromR2(existing.logoUrl).catch((err) => {
        fastify.log.error(`Failed to delete logo from R2 for hotel ${request.hotelId}: ${err.message}`);
      });

      await prisma.hotel.update({
        where: { id: request.hotelId },
        data: { logoUrl: null }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'logo_deleted',
          entityType: 'Hotel',
          entityId: request.hotelId,
          oldValue: { logoUrl: existing.logoUrl },
          newValue: { logoUrl: null }
        }
      });

      // Purge CDN cache so logo removal reflects immediately on public menu
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, message: 'Logo removed' };
    });

    app.post('/categories', async (request, reply) => {
      const { name, sortOrder } = z.object({
        name: z.string().min(1).max(100).trim(),
        sortOrder: z.number().default(0)
      }).parse(request.body);

      const existing = await prisma.category.findFirst({
        where: { hotelId: request.hotelId, name: { equals: name, mode: 'insensitive' } }
      });

      if (existing) return reply.code(409).send({ error: 'Category with this name already exists' });

      const category = await prisma.category.create({
        data: { hotelId: request.hotelId, name, sortOrder }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'category_created',
          entityType: 'Category',
          entityId: category.id,
          newValue: { name }
        }
      });

      // Invalidate menu cache so new category appears immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return category;
    });

    app.patch('/categories/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid category ID format' });
      }

      const { name } = z.object({
        name: z.string().min(1).max(100).trim()
      }).parse(request.body);

      const category = await prisma.category.findFirst({
        where: { id, hotelId: request.hotelId }
      });
      if (!category) return reply.code(404).send({ error: 'Category not found' });

      const duplicate = await prisma.category.findFirst({
        where: { hotelId: request.hotelId, name: { equals: name, mode: 'insensitive' }, id: { not: id } }
      });
      if (duplicate) return reply.code(409).send({ error: 'Category with this name already exists' });

      const updated = await prisma.category.update({ where: { id }, data: { name } });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'category_renamed',
          entityType: 'Category',
          entityId: id,
          oldValue: { name: category.name },
          newValue: { name }
        }
      });

      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return updated;
    });

    app.post('/items', async (request, reply) => {
      let imageUrl = null;
      try {
        let data = {};
        let imageFile = null;

        if (request.isMultipart()) {
          // Accept both fastify-multipart attached field shape ({ value })
          // and plain string values depending on client FormData handling.
          const fieldValue = (f) => {
            if (f == null) return undefined;
            if (typeof f === 'object' && 'value' in f) return f.value;
            return f;
          };

          const rawCategory = fieldValue(request.body.categoryId);
          const rawName = fieldValue(request.body.name);
          const rawPrice = fieldValue(request.body.price);
          const rawDesc = fieldValue(request.body.description);
          const rawIsVeg = fieldValue(request.body.isVeg);
          const rawIsPopular = fieldValue(request.body.isPopular);

          data = {
            categoryId: rawCategory,
            name: rawName?.trim(),
            price: parseInt(rawPrice),
            description: rawDesc?.trim() || null,
            isVeg: String(rawIsVeg) === 'true' || rawIsVeg === true,
            isPopular: String(rawIsPopular) === 'true' || rawIsPopular === true,
            sortOrder: 0
          };
          imageFile = request.body.image;

          if (!data.categoryId || !data.name || isNaN(data.price) || data.price <= 0) {
            return reply.code(400).send({ error: 'Missing required fields or invalid price' });
          }
        } else {
          const itemSchema = z.object({
            categoryId: z.string().uuid(),
            name: z.string().min(1).max(200).trim(),
            price: z.number().int().positive(),
            description: z.string().max(500).optional().nullable(),
            isVeg: z.boolean().default(false),
            isPopular: z.boolean().default(false),
            sortOrder: z.number().default(0)
          });
          data = itemSchema.parse(request.body);
        }

        const category = await prisma.category.findFirst({
          where: { id: data.categoryId, hotelId: request.hotelId }
        });

        if (!category) return reply.code(403).send({ error: 'Invalid category' });

        if (imageFile) {
          const fileData = Array.isArray(imageFile) ? imageFile[0] : imageFile;
          const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

          if (!allowedTypes.includes(fileData.mimetype)) {
            return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
          }

          const buffer = await fileData.toBuffer();
          if (buffer.length > 2 * 1024 * 1024) {
            return reply.code(400).send({ error: 'File too large. Max 2MB.' });
          }

          const isValidImage = validateImageBuffer(buffer, fileData.mimetype);
          if (!isValidImage) return reply.code(400).send({ error: 'Invalid image file' });

          imageUrl = await uploadToR2(buffer, fileData.mimetype, request.hotelId);
          data.imageUrl = imageUrl;
        }

        const item = await prisma.item.create({ data });

        await prisma.auditLog.create({
          data: {
            hotelId: request.hotelId,
            actorType: 'owner',
            action: 'item_created',
            entityType: 'Item',
            entityId: item.id,
            newValue: data
          }
        });

        // Purge CDN cache so new item appears immediately
        try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

        return item;
      } catch (err) {
        if (imageUrl) {
          await deleteFromR2(imageUrl).catch((delErr) => {
            fastify.log.error(`Failed to rollback R2 image upload: ${imageUrl} — ${delErr.message}`);
          });
        }
        request.log.error(err);
        if (err.name === 'ZodError') return reply.code(400).send({ error: "Validation failed", details: err.errors });
        return reply.code(500).send({ error: "Something went wrong" });
      }
    });

    app.post('/items/:id/image', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

      try {
        const fileData = request.body.image;
        if (!fileData) return reply.code(400).send({ error: 'No file uploaded' });

        const file = Array.isArray(fileData) ? fileData[0] : fileData;
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedTypes.includes(file.mimetype)) {
          return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
        }

        const buffer = await file.toBuffer();
        if (buffer.length > 2 * 1024 * 1024) return reply.code(400).send({ error: 'File too large. Max 2MB.' });

        const isValidImage = validateImageBuffer(buffer, file.mimetype);
        if (!isValidImage) return reply.code(400).send({ error: 'Invalid image file' });

        if (item.imageUrl) {
          await deleteFromR2(item.imageUrl).catch((err) => {
            fastify.log.error(`Failed to delete old image from R2 for item ${id}: ${item.imageUrl} — ${err.message}`);
          });
        }

        const imageUrl = await uploadToR2(buffer, file.mimetype, request.hotelId);
        const updated = await prisma.item.update({ where: { id }, data: { imageUrl } });

        await prisma.auditLog.create({
          data: {
            hotelId: request.hotelId,
            actorType: 'owner',
            action: 'item_image_uploaded',
            entityType: 'Item',
            entityId: id,
            oldValue: item.imageUrl ? { imageUrl: item.imageUrl } : null,
            newValue: { imageUrl }
          }
        });

        // Purge CDN cache so updated image appears immediately
        try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

        return { success: true, imageUrl, item: updated };
      } catch (err) {
        request.log.error(err);
        return reply.code(400).send({ error: "Image upload failed" });
      }
    });

    app.delete('/items/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

      const updated = await prisma.item.update({ where: { id }, data: { isAvailable: false } });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'item_soft_deleted',
          entityType: 'Item',
          entityId: id,
          oldValue: item,
          newValue: { isAvailable: false }
        }
      });

      // Try to purge CDN cache for this hotel's menu (best-effort)
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, message: 'Item removed from menu', item: updated };
    });

    app.patch('/items/:id/restore', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

      const updated = await prisma.item.update({ where: { id }, data: { isAvailable: true } });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'item_restored',
          entityType: 'Item',
          entityId: id,
          newValue: { isAvailable: true }
        }
      });

      // Purge CDN cache for this hotel's menu so restored item appears immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, message: 'Item restored', item: updated };
    });

    app.delete('/items/:id/permanent', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

      if (item.imageUrl) {
        await deleteFromR2(item.imageUrl).catch((err) => {
          fastify.log.error(`Failed to delete R2 image on permanent delete for item ${id}: ${item.imageUrl} — ${err.message}`);
        });
      }
      await prisma.item.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'item_deleted_permanent',
          entityType: 'Item',
          entityId: id,
          oldValue: item
        }
      });

      // Purge CDN cache so deletion is reflected immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return { success: true, message: 'Item permanently deleted' };
    });

    app.patch('/items/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const schema = z.object({
        name: z.string().min(1).max(200).trim().optional(),
        description: z.string().max(500).optional(),
        price: z.number().int().positive().optional(),
        isVeg: z.boolean().optional(),
        isAvailable: z.boolean().optional(),
        isPopular: z.boolean().optional(),
        sortOrder: z.number().optional(),
        categoryId: z.string().uuid().optional()
      });

      const data = schema.parse(request.body);
      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

      if (data.categoryId && data.categoryId !== item.categoryId) {
        const targetCat = await prisma.category.findFirst({
          where: { id: data.categoryId, hotelId: request.hotelId }
        });
        if (!targetCat) return reply.code(400).send({ error: 'Target category not found' });
      }

      const updated = await prisma.item.update({ where: { id }, data });

      await prisma.auditLog.create({
        data: {
          hotelId: request.hotelId,
          actorType: 'owner',
          action: 'item_updated',
          entityType: 'Item',
          entityId: id,
          oldValue: item,
          newValue: updated
        }
      });

      // Purge CDN cache so updates reflect immediately
      try { await purgeMenuCacheForHotel(request.hotelId); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      return updated;
    });
  });

  //==================== SUPERADMIN ROUTES ====================

  // Public Admin Login Route
  fastify.register(async function (app) {
    app.post('/auth/admin/login', {
      config: { rateLimit: strictRateLimit }
    }, async (request, reply) => {
      const { adminKey } = z.object({ adminKey: z.string().min(1) }).parse(request.body);

      if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        return reply.code(403).send({ error: 'Invalid admin key' });
      }

      const token = hashAdminKey(adminKey);
      reply.setCookie('superadmin_token', token, COOKIE_CONFIG);

      return { success: true, message: 'Authenticated' };
    });
  });

  // Protected Superadmin Routes
  fastify.register(async function (app) {
    app.addHook('preHandler', authenticateSuperAdmin);

    app.post('/auth/admin/logout', async (request, reply) => {
      reply.clearCookie('superadmin_token', COOKIE_CONFIG);
      return { success: true, message: 'Logged out' };
    });

    app.get('/auth/admin/me', async (request, reply) => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      return { authenticated: true, session: { expiresAt } };
    });

    // PATCH: Edit hotel core details (name, city, phone, email, plan)
    app.patch('/admin/hotels/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }
      const schema = z.object({
        name: z.string().min(1).max(100),
        city: z.string().min(1).max(100),
        phone: z.string().min(10).max(15),
        email: z.string().email().max(100).optional().or(z.literal('')),
        plan: z.enum(['FREE', 'BASIC', 'PREMIUM', 'STARTER', 'STANDARD', 'PRO']).optional() // accepted but ignored — plan changes only via payments
      });
      let data;
      try {
        data = schema.parse(request.body);
      } catch (err) {
        if (err.name === 'ZodError') return reply.code(400).send({ error: 'Validation failed', details: err.errors });
        throw err;
      }
      // Get old values for audit
      const existing = await prisma.hotel.findUnique({
        where: { id },
        select: { name: true, city: true, phone: true, email: true, plan: true }
      });
      if (!existing) return reply.code(404).send({ error: 'Hotel not found' });
      // Update — plan is NOT updated here (only via record-payment / Razorpay)
      const updated = await prisma.hotel.update({
        where: { id },
        data: {
          name: data.name,
          city: data.city,
          phone: data.phone,
          email: data.email || null
        },
        select: { id: true, name: true, city: true, phone: true, email: true, plan: true, slug: true }
      });
      // Audit log
      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'details_edited',
          entityType: 'Hotel',
          entityId: id,
          oldValue: existing,
          newValue: updated
        }
      });
      // Invalidate menu cache so name/city changes reflect immediately
      try { await purgeMenuCacheForHotel(id); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      fastify.log.info(`Hotel ${id} details edited by admin`);
      return updated;
    });

    // ==================== SUPERADMIN: SET REVIEW URL FOR ANY HOTEL ====================
    app.patch('/admin/hotels/:id/review-url', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }
      const schema = z.object({
        reviewUrl: z.string().url().max(500).or(z.literal(''))
      });
      let data;
      try {
        data = schema.parse(request.body);
      } catch (err) {
        if (err.name === 'ZodError') return reply.code(400).send({ error: 'Please enter a valid URL' });
        throw err;
      }

      const hotel = await prisma.hotel.findUnique({ where: { id }, select: { id: true, reviewUrl: true } });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      const updated = await prisma.hotel.update({
        where: { id },
        data: { reviewUrl: data.reviewUrl || null }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'review_url_changed',
          entityType: 'Hotel',
          entityId: id,
          oldValue: { reviewUrl: hotel.reviewUrl || null },
          newValue: { reviewUrl: data.reviewUrl || null }
        }
      });

      return { success: true, reviewUrl: updated.reviewUrl || '' };
    });

    // ==================== SUPERADMIN: LOGO UPLOAD FOR ANY HOTEL ====================
    app.post('/admin/hotels/:id/logo', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      try {
        const fileData = request.body.image;
        if (!fileData) return reply.code(400).send({ error: 'No file uploaded' });

        const file = Array.isArray(fileData) ? fileData[0] : fileData;
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedTypes.includes(file.mimetype)) {
          return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
        }

        const buffer = await file.toBuffer();
        if (buffer.length > 2 * 1024 * 1024) return reply.code(400).send({ error: 'File too large. Max 2MB.' });

        const isValidImage = validateImageBuffer(buffer, file.mimetype);
        if (!isValidImage) return reply.code(400).send({ error: 'Invalid image file' });

        const existing = await prisma.hotel.findUnique({
          where: { id },
          select: { logoUrl: true }
        });
        if (!existing) return reply.code(404).send({ error: 'Hotel not found' });

        if (existing.logoUrl) {
          await deleteFromR2(existing.logoUrl).catch((err) => {
            fastify.log.error(`Failed to delete old logo from R2 for hotel ${id}: ${err.message}`);
          });
        }

        const logoUrl = await uploadToR2(buffer, file.mimetype, id);
        await prisma.hotel.update({ where: { id }, data: { logoUrl } });

        await prisma.auditLog.create({
          data: {
            hotelId: id,
            actorType: 'admin',
            action: 'logo_uploaded',
            entityType: 'Hotel',
            entityId: id,
            oldValue: existing.logoUrl ? { logoUrl: existing.logoUrl } : null,
            newValue: { logoUrl }
          }
        });

        // Purge CDN cache so updated logo appears immediately on public menu
        try { await purgeMenuCacheForHotel(id); } catch (e) { fastify.log.warn('purge error', e.message || e); }

        fastify.log.info(`Logo uploaded for hotel ${id} by admin`);
        return { success: true, logoUrl };
      } catch (err) {
        request.log.error(err);
        return reply.code(400).send({ error: 'Logo upload failed' });
      }
    });

    app.delete('/admin/hotels/:id/logo', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const existing = await prisma.hotel.findUnique({
        where: { id },
        select: { logoUrl: true }
      });

      if (!existing) return reply.code(404).send({ error: 'Hotel not found' });
      if (!existing.logoUrl) return reply.code(404).send({ error: 'No logo to delete' });

      await deleteFromR2(existing.logoUrl).catch((err) => {
        fastify.log.error(`Failed to delete logo from R2 for hotel ${id}: ${err.message}`);
      });

      await prisma.hotel.update({ where: { id }, data: { logoUrl: null } });

      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'logo_deleted',
          entityType: 'Hotel',
          entityId: id,
          oldValue: { logoUrl: existing.logoUrl },
          newValue: { logoUrl: null }
        }
      });

      // Purge CDN cache so logo removal reflects immediately on public menu
      try { await purgeMenuCacheForHotel(id); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      fastify.log.info(`Logo deleted for hotel ${id} by admin`);
      return { success: true, message: 'Logo removed' };
    });

    // Hotel creation — auto-generates 6-char base32 slug, no manual slug input
    app.post('/admin/hotels', async (request, reply) => {
      const schema = z.object({
        name: z.string().min(1).max(200).trim(),
        city: z.string().min(1).max(100).trim(),
        phone: z.string().min(10).max(15).trim(),
        email: z.string().email().max(200).trim().optional(),
        pin: z.string().length(8).regex(/^\d{8}$/), // 8-digit PIN for brute-force resistance
        plan: z.enum(['STARTER', 'STANDARD', 'PRO']).default('STARTER')
      });

      const { name, city, phone, email, pin, plan } = schema.parse(request.body);

      // Reject weak PINs
      if (isWeakPin(pin)) {
        return reply.code(400).send({ error: 'PIN is too simple. Choose a stronger PIN.' });
      }

      // Auto-generate collision-free base32 slug
      const slug = await generateSlug();
      const pinHash = await bcrypt.hash(pepperPin(pin), BCRYPT_COST);

      const hotel = await prisma.hotel.create({
        data: {
          name, city, phone, slug, pinHash, plan,
          email: email || null,
          consentedAt: new Date(),
          consentVersion: '1.0',
          status: 'TRIAL',
          trialEnds: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          pinResetCount: 0
        }
      });

      return {
        id: hotel.id,
        slug: hotel.slug,
        pin: pin, // Return plain PIN once
        trialEnds: hotel.trialEnds,
        menuUrl: `${APP_URL}/m/${hotel.slug}`,
        adminUrl: `${APP_URL}/admin`
      };
    });

    // ==================== SUPERADMIN: Platform Analytics ====================
    app.get('/admin/stats', async (request, reply) => {
      const [
        hotelCounts,
        totalViews,
        paymentAgg,
        revenueByPlan,
        paymentMethods,
        todayScans
      ] = await Promise.all([
        // 1. Hotel counts by status (excludes DELETED)
        prisma.$queryRaw`
          SELECT status, COUNT(*)::int AS count
          FROM "Hotel"
          WHERE "deletedAt" IS NULL
          GROUP BY status`,

        // 2. Total menu views
        prisma.hotel.aggregate({
          where: { deletedAt: null },
          _sum: { views: true }
        }),

        // 3. Payment aggregates by status
        prisma.$queryRaw`
          SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::bigint AS total
          FROM "Payment"
          GROUP BY status`,

        // 4. Revenue breakdown by plan (CAPTURED only)
        prisma.$queryRaw`
          SELECT plan, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::bigint AS total
          FROM "Payment"
          WHERE status = 'CAPTURED'
          GROUP BY plan`,

        // 5. Payment methods breakdown (CAPTURED only)
        prisma.$queryRaw`
          SELECT COALESCE(method, 'unknown') AS method, COUNT(*)::int AS count
          FROM "Payment"
          WHERE status = 'CAPTURED'
          GROUP BY method`,

        // 6. Today's total scans (IST)
        (() => {
          const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
          const todayDate = new Date(todayIST.getFullYear(), todayIST.getMonth(), todayIST.getDate());
          return prisma.dailyScanLog.aggregate({
            where: { date: todayDate },
            _sum: { count: true }
          });
        })()
      ]);

      // Build hotel status summary
      const hotels = { total: 0, trial: 0, active: 0, grace: 0, expired: 0, suspended: 0 };
      for (const row of hotelCounts) {
        const key = row.status.toLowerCase();
        if (hotels[key] !== undefined) hotels[key] = row.count;
        hotels.total += row.count;
      }

      // Build payment status summary
      const payments = { captured: { count: 0, total: 0 }, refunded: { count: 0, total: 0 }, failed: { count: 0, total: 0 }, created: { count: 0, total: 0 } };
      for (const row of paymentAgg) {
        const key = row.status.toLowerCase();
        if (payments[key]) {
          payments[key] = { count: row.count, total: Number(row.total) };
        }
      }

      // Net revenue = captured - refunded
      const netRevenue = payments.captured.total - payments.refunded.total;

      // MRR estimate: count of currently active paid hotels × their plan price
      // More accurate than dividing total revenue by months
      const activePaidHotels = await prisma.hotel.groupBy({
        by: ['plan'],
        where: { status: 'ACTIVE', deletedAt: null },
        _count: true
      });
      const PLAN_PRICES = { STARTER: 49900, STANDARD: 99900, PRO: 149900 };
      let mrr = 0;
      const planBreakdown = {};
      for (const row of activePaidHotels) {
        const price = PLAN_PRICES[row.plan] || 0;
        mrr += row._count * price;
        planBreakdown[row.plan] = row._count;
      }

      // Revenue by plan
      const revByPlan = {};
      for (const row of revenueByPlan) {
        revByPlan[row.plan] = { count: row.count, total: Number(row.total) };
      }

      // Payment methods
      const methods = {};
      for (const row of paymentMethods) {
        methods[row.method] = row.count;
      }

      return {
        hotels,
        views: totalViews._sum.views || 0,
        todayScans: todayScans._sum.count || 0,
        payments,
        netRevenue,
        mrr,
        planBreakdown,
        revenueByPlan: revByPlan,
        paymentMethods: methods
      };
    });

    // ==================== SUPERADMIN: Trial Requests ====================
    app.get('/admin/trial-requests', async (request, reply) => {
      const { status } = z.object({
        status: z.enum(['pending', 'approved', 'rejected']).optional()
      }).parse(request.query);

      const where = {};
      if (status) where.status = status;

      const requests = await prisma.trialRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      return { requests };
    });

    app.patch('/admin/trial-requests/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const schema = z.object({
        status: z.enum(['approved', 'rejected']),
        notes: z.string().max(500).optional(),
        hotelId: z.string().uuid().optional()
      });
      const data = schema.parse(request.body);

      const existing = await prisma.trialRequest.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Trial request not found' });

      const updated = await prisma.trialRequest.update({
        where: { id },
        data: {
          status: data.status,
          notes: data.notes || null,
          hotelId: data.hotelId || null
        }
      });
      return updated;
    });

    // [6-DIGIT PIN CHANGE] UPDATED: Include pinResetCount in select
    app.get('/admin/hotels', async (request, reply) => {
      const { status, search, page = 1, limit = 50 } = z.object({
        status: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'DELETED']).optional(),
        search: z.string().optional(),
        page: z.string().or(z.number()).transform(v => parseInt(v) || 1).optional(),
        limit: z.string().or(z.number()).transform(v => Math.min(parseInt(v) || 50, 100)).optional()
      }).parse(request.query);

      const where = {};
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [hotels, total] = await Promise.all([
        prisma.hotel.findMany({
          where,
          select: {
            id: true, name: true, slug: true, city: true, phone: true,
            status: true, plan: true, trialEnds: true, paidUntil: true,
            views: true, createdAt: true, theme: true, qrTheme: true, logoUrl: true, reviewUrl: true,
            upiId: true, upiPayEnabled: true,
            pinResetCount: true, // [6-DIGIT PIN CHANGE] ADDED: Include reset count
            lastPinResetAt: true,  // [6-DIGIT PIN CHANGE] ADDED: Include last reset
            deletedAt: true, purgeAfter: true // Soft delete fields
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.hotel.count({ where })
      ]);

      return { hotels, total, page, limit, totalPages: Math.ceil(total / limit) };
    });

    app.patch('/admin/hotels/:id/status', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const schema = z.object({
        status: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'DELETED']),
        paidUntil: z.string().datetime().optional().nullable(),
        note: z.string().max(500).optional()
      });

      const { status, paidUntil, note } = schema.parse(request.body);
      
      // Build update data
      const updateData = { status };
      if (paidUntil !== undefined) updateData.paidUntil = paidUntil ? new Date(paidUntil) : null;
      if (note) updateData.lastPaymentNote = note;

      // Check existence first to get old values for audit
      const existing = await prisma.hotel.findUnique({ 
        where: { id },
        select: {
          status: true,
          paidUntil: true,
          lastPaymentNote: true
        }
      });
      
      if (!existing) {
        return reply.code(404).send({ error: 'Hotel not found' });
      }

      // Prevent reverting a DELETED hotel (PII already anonymized)
      if (existing.status === 'DELETED' && status !== 'DELETED') {
        return reply.code(400).send({ error: 'Cannot revert a deleted hotel. PII has been anonymized. Use purge to permanently remove.' });
      }

      // Perform update
      const updated = await prisma.hotel.update({ 
        where: { id }, 
        data: updateData,
        select: {
          id: true, name: true, slug: true, city: true, phone: true,
          plan: true, status: true, theme: true, views: true,
          trialEnds: true, paidUntil: true, lastPaymentNote: true,
          paymentMode: true, lastPaymentDate: true, lastPaymentAmount: true,
          createdAt: true, updatedAt: true
        }
      });

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'status_changed',
          entityType: 'Hotel',
          entityId: id,
          oldValue: { 
            status: existing.status, 
            paidUntil: existing.paidUntil,
            lastPaymentNote: existing.lastPaymentNote 
          },
          newValue: { status, paidUntil, note }
        }
      });

      // Invalidate menu cache so status change (e.g. SUSPENDED) reflects immediately
      try { await purgeMenuCacheForHotel(id); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      fastify.log.info(`Hotel ${id} status changed to ${status} by admin`);
      return updated;
    });

    // [6-DIGIT PIN CHANGE] UPDATED: Include PIN reset fields in detail view
    app.get('/admin/hotels/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: {
          id: true, name: true, slug: true, city: true, phone: true,
          plan: true, status: true, theme: true, logoUrl: true, reviewUrl: true, views: true,
          upiId: true, upiPayEnabled: true,
          trialEnds: true, paidUntil: true, createdAt: true, updatedAt: true,
          paymentMode: true, lastPaymentDate: true, lastPaymentAmount: true,
          pinResetCount: true, lastPinResetAt: true, lastPinResetBy: true,
          deletedAt: true, deletedBy: true, purgeAfter: true,
          email: true,
          categories: {
            include: { items: true }
          },
          auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 }
        }
      });

      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });
      // Always return email as string (empty if null)
      hotel.email = hotel.email || '';
      return hotel;
    });

    // [6-DIGIT PIN CHANGE] NEW ENDPOINT: POST /admin/hotels/:id/reset-pin
    // Strict rate limiting: 3 attempts per 15 minutes per hotel
    app.post('/admin/hotels/:id/reset-pin', {
      config: { rateLimit: pinResetRateLimit }
    }, async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      // Fetch current hotel data for audit log
      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          pinResetCount: true,
          lastPinResetAt: true
        }
      });

      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      // Generate secure 8-digit PIN using crypto (reject weak, regenerate if needed)
      let plainPin;
      do {
        plainPin = crypto.randomInt(10000000, 100000000).toString();
      } while (isWeakPin(plainPin));
      const pinHash = await bcrypt.hash(pepperPin(plainPin), BCRYPT_COST);
      const now = new Date();

      // Update hotel with new PIN and tracking fields
      const updated = await prisma.hotel.update({
        where: { id },
        data: {
          pinHash,
          pinChangedAt: now,
          pinResetCount: { increment: 1 },
          lastPinResetAt: now,
          lastPinResetBy: 'super_admin'
        }
      });

      // Create audit log entry (security: don't store old/new PIN hashes)
      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'pin_reset',
          entityType: 'Hotel',
          entityId: id,
          oldValue: { lastPinResetAt: hotel.lastPinResetAt }, // Only timestamp, no hash
          newValue: {
            pinResetCount: hotel.pinResetCount + 1,
            lastPinResetBy: 'super_admin'
          }
        }
      });

      fastify.log.info(`PIN reset for hotel ${id} (${hotel.name}) by super admin`);

      // Return plain PIN once - display in toast, then gone forever
      return {
        success: true,
        pin: plainPin,
        message: 'PIN reset successful. Share this PIN with the hotel owner securely.',
        hotel: {
          id: updated.id,
          name: updated.name,
          pinResetCount: updated.pinResetCount,
          lastPinResetAt: updated.lastPinResetAt
        }
      };
    });

    // ==================== HOTEL SOFT DELETE (DPDPA COMPLIANT) ====================
    // Soft-delete: anonymize PII, set status=DELETED, schedule purge after 180 days
    app.delete('/admin/hotels/:id', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: { id: true, name: true, status: true, phone: true, email: true }
      });

      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });
      if (hotel.status === 'DELETED') return reply.code(409).send({ error: 'Hotel already deleted' });

      const now = new Date();
      const purgeAfter = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 180 days

      // Anonymize PII + set DELETED status
      const updated = await prisma.hotel.update({
        where: { id },
        data: {
          status: 'DELETED',
          name: 'Deleted Hotel',
          phone: '0000000000',
          email: null,
          pinHash: 'INVALIDATED',
          deletedAt: now,
          deletedBy: 'super_admin',
          purgeAfter: purgeAfter
        }
      });

      // Anonymize audit logs: replace owner actor references
      await prisma.auditLog.updateMany({
        where: { hotelId: id, actorType: 'owner' },
        data: { actorType: 'deleted_user', actorId: null }
      });

      // Create deletion audit log
      await prisma.auditLog.create({
        data: {
          hotelId: id,
          actorType: 'admin',
          action: 'hotel_deleted',
          entityType: 'Hotel',
          entityId: id,
          oldValue: { name: hotel.name, phone: hotel.phone, email: hotel.email, status: hotel.status },
          newValue: { status: 'DELETED', deletedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString() }
        }
      });

      // Invalidate menu cache so deleted hotel is no longer served
      try { await purgeMenuCacheForHotel(id); } catch (e) { fastify.log.warn('purge error', e.message || e); }

      fastify.log.info(`Hotel ${id} soft-deleted by super admin. PII anonymized. Purge scheduled: ${purgeAfter.toISOString()}`);

      return {
        success: true,
        message: 'Hotel deleted. PII anonymized. Data will be purged after 180 days.',
        hotel: {
          id: updated.id,
          status: updated.status,
          deletedAt: updated.deletedAt,
          purgeAfter: updated.purgeAfter
        }
      };
    });

    // ==================== HOTEL HARD PURGE ====================
    // Permanently remove hotel + all related data + R2 images after retention period
    app.delete('/admin/hotels/:id/purge', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: {
          id: true, status: true, deletedAt: true, purgeAfter: true, slug: true, logoUrl: true,
          categories: {
            include: { items: { select: { id: true, imageUrl: true } } }
          }
        }
      });

      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });
      if (hotel.status !== 'DELETED') {
        return reply.code(400).send({ error: 'Hotel must be in DELETED status before purging. Soft-delete it first.' });
      }

      // Collect all R2 image URLs before deleting DB records
      const imageUrls = [];
      if (hotel.logoUrl) imageUrls.push(hotel.logoUrl);
      for (const cat of hotel.categories) {
        for (const item of cat.items) {
          if (item.imageUrl) imageUrls.push(item.imageUrl);
        }
      }

      // Delete all R2 images
      const imageResults = { deleted: 0, failed: 0 };
      for (const url of imageUrls) {
        try {
          await deleteFromR2(url);
          imageResults.deleted++;
        } catch (err) {
          imageResults.failed++;
          fastify.log.error(`Failed to delete R2 image ${url}: ${err.message}`);
        }
      }

      // Invalidate menu cache before hard delete
      invalidateMenuCache(hotel.slug);

      // Hard delete hotel (cascade removes categories, items, audit logs)
      await prisma.hotel.delete({ where: { id } });

      fastify.log.info(`Hotel ${id} (slug: ${hotel.slug}) permanently purged. Images: ${imageResults.deleted} deleted, ${imageResults.failed} failed.`);

      return {
        success: true,
        message: 'Hotel permanently purged from database and storage.',
        purged: {
          hotelId: id,
          slug: hotel.slug,
          imagesDeleted: imageResults.deleted,
          imagesFailed: imageResults.failed
        }
      };
    });

    // [6-DIGIT PIN CHANGE] NEW ENDPOINT: GET /admin/hotels/:id/pin-reset-count
    app.get('/admin/hotels/:id/pin-reset-count', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: {
          pinResetCount: true,
          lastPinResetAt: true,
          lastPinResetBy: true
        }
      });

      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      return {
        pinResetCount: hotel.pinResetCount,
        lastPinResetAt: hotel.lastPinResetAt,
        lastPinResetBy: hotel.lastPinResetBy
      };
    });

    // ==================== SUPERADMIN: Payment History for a Hotel ====================
    app.get('/admin/hotels/:id/payments', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: { id: true, name: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      const payments = await prisma.payment.findMany({
        where: { hotelId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, razorpayOrderId: true, amount: true, plan: true,
          status: true, method: true, paidAt: true, periodStart: true,
          periodEnd: true, createdAt: true, metadata: true
        }
      });

      return { hotelName: hotel.name, payments };
    });

    // ==================== SUPERADMIN: Record Manual Payment ====================
    app.post('/admin/hotels/:id/record-payment', async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'Invalid hotel ID format' });
      }

      const schema = z.object({
        plan: z.enum(['STARTER', 'STANDARD', 'PRO']),
        mode: z.enum(['CASH', 'MANUAL']).default('MANUAL'),
        note: z.string().max(500).optional()
      });

      const { plan, mode, note } = schema.parse(request.body);

      const hotel = await prisma.hotel.findUnique({
        where: { id },
        select: { id: true, name: true, plan: true, status: true, paidUntil: true, pendingPlan: true, pendingPlanPaid: true }
      });
      if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });

      const planConfig = PLANS[plan];
      if (!planConfig) return reply.code(400).send({ error: 'Invalid plan' });

      // Block if a paid plan change is already pending
      if (hotel.pendingPlan && hotel.pendingPlanPaid) {
        return reply.code(409).send({ error: `Hotel already has a paid plan change to ${hotel.pendingPlan} scheduled.` });
      }

      const now = new Date();
      const isActive = hotel.status === 'ACTIVE' && hotel.paidUntil && hotel.paidUntil > now;
      const isSamePlan = plan === hotel.plan;

      // Block same-plan renewal when subscription has >7 days remaining
      if (isActive && isSamePlan) {
        const daysLeft = Math.ceil((hotel.paidUntil - now) / (24 * 60 * 60 * 1000));
        if (daysLeft > 7) {
          return reply.code(409).send({
            error: `Hotel's ${plan} plan is active until ${hotel.paidUntil.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Can renew within 7 days of expiry. (${daysLeft} days left)`
          });
        }
      }

      // If hotel is currently active AND this is a different plan → schedule it
      if (isActive && !isSamePlan) {
        const periodStart = hotel.paidUntil;
        const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
        const manualOrderId = `manual_${id}_${Date.now()}`;

        await prisma.$transaction([
          prisma.payment.create({
            data: {
              hotelId: id,
              razorpayOrderId: manualOrderId,
              razorpayPaymentId: manualOrderId,
              amount: planConfig.price,
              plan: plan,
              status: 'CAPTURED',
              paidAt: now,
              periodStart,
              periodEnd,
              method: mode.toLowerCase(),
              metadata: note ? { note } : null
            }
          }),
          prisma.hotel.update({
            where: { id },
            data: {
              pendingPlan: plan,
              pendingPlanPaid: true
            }
          }),
          prisma.auditLog.create({
            data: {
              hotelId: id,
              actorType: 'admin',
              action: 'manual_plan_change_scheduled',
              entityType: 'Payment',
              entityId: manualOrderId,
              newValue: {
                currentPlan: hotel.plan, pendingPlan: plan,
                amount: planConfig.price, mode, note,
                activatesOn: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString()
              }
            }
          })
        ]);

        fastify.log.info(`Manual plan change scheduled: hotel=${id} ${hotel.plan}->${plan} activates=${periodStart.toISOString()}`);
        return {
          success: true,
          message: `Plan change to ${plan} scheduled. Activates on ${periodStart.toLocaleDateString('en-IN')}.`,
          scheduled: true,
          activatesOn: periodStart,
          paidUntil: periodEnd,
          plan
        };
      }

      // Same plan renewal OR expired/trial/grace → activate immediately
      const periodStart = (hotel.paidUntil && hotel.paidUntil > now) ? hotel.paidUntil : now;
      const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Create payment record with a manual order ID
      const manualOrderId = `manual_${id}_${Date.now()}`;

      await prisma.$transaction([
        prisma.payment.create({
          data: {
            hotelId: id,
            razorpayOrderId: manualOrderId,
            razorpayPaymentId: manualOrderId,
            amount: planConfig.price,
            plan: plan,
            status: 'CAPTURED',
            paidAt: now,
            periodStart,
            periodEnd,
            method: mode.toLowerCase(),
            metadata: note ? { note } : null
          }
        }),
        prisma.hotel.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            plan: plan,
            paidUntil: periodEnd,
            pendingPlan: null,
            pendingPlanPaid: false,
            paymentMode: mode,
            lastPaymentDate: now,
            lastPaymentAmount: planConfig.price,
            lastPaymentNote: note || `Manual ${mode} payment recorded`
          }
        }),
        prisma.auditLog.create({
          data: {
            hotelId: id,
            actorType: 'admin',
            action: 'manual_payment_recorded',
            entityType: 'Payment',
            entityId: manualOrderId,
            newValue: {
              plan,
              amount: planConfig.price,
              mode,
              note,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString()
            }
          }
        })
      ]);

      fastify.log.info(`Manual payment recorded: hotel=${id} plan=${plan} mode=${mode} until=${periodEnd.toISOString()}`);

      return {
        success: true,
        message: `Payment recorded. Hotel activated until ${periodEnd.toLocaleDateString('en-IN')}.`,
        paidUntil: periodEnd,
        plan
      };
    });
  });
}

//==================== IMAGE VALIDATION ====================
function validateImageBuffer(buffer, mimetype) {
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46]
  };

  const sig = signatures[mimetype];
  if (!sig) return false;
  return sig.every((byte, i) => buffer[i] === byte);
}

//==================== ERROR HANDLING ====================
function registerErrorHandlers() {
  fastify.setErrorHandler(async (error, request, reply) => {
    fastify.log.error(error);
    await logError(error);

    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: 'Too many requests',
        retryAfter: error.after,
        message: `Rate limit exceeded. Retry after ${error.after}`
      });
    }

    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      });
    }

    if (error.code === 'P2002') {
      return reply.status(409).send({
        error: 'Duplicate entry',
        message: 'A record with this value already exists'
      });
    }

    if (error.code?.startsWith('P')) {
      return reply.status(500).send({
        error: 'Database error',
        message: isProduction ? 'Internal server error' : error.message
      });
    }

    reply.status(error.statusCode || 500).send({
      error: 'Internal server error',
      message: isProduction ? 'Something went wrong' : error.message
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: 'Not found', message: `Route ${request.method} ${request.url} not found` });
  });
}

//==================== LIFECYCLE ====================
fastify.addHook('onClose', async () => {
  await prisma.$disconnect();
  fastify.log.info('Server shutting down, database disconnected');
});

//==================== STARTUP ====================
async function start() {
  try {
    await connectWithRetry();
    await registerSecurityPlugins();
    await registerContentPlugins();
    registerErrorHandlers();
    registerRoutes();

    await fastify.listen({
      port: parseInt(process.env.PORT) || 3000,
      host: '0.0.0.0'
    });

    fastify.log.info(`🚀 Server listening at ${APP_URL}`);

    // ==================== BILLING LIFECYCLE CRON (hourly) ====================
    setInterval(async () => {
      try {
        const now = new Date();
        const gracePeriodMs = 3 * 24 * 60 * 60 * 1000; // 3 days

        // Job 1: Activate pending paid plan changes (paidUntil has passed)
        const pendingActivated = await prisma.$executeRaw`
          UPDATE "Hotel"
          SET "plan" = "pendingPlan",
              "paidUntil" = "paidUntil" + INTERVAL '30 days',
              "status" = 'ACTIVE'::"HotelStatus",
              "pendingPlan" = NULL,
              "pendingPlanPaid" = false,
              "updatedAt" = NOW()
          WHERE "pendingPlan" IS NOT NULL
            AND "pendingPlanPaid" = true
            AND "paidUntil" <= ${now}
            AND "status" = 'ACTIVE'::"HotelStatus"
        `;
        if (pendingActivated > 0) fastify.log.info(`Cron: activated ${pendingActivated} pending paid plan changes`);

        // Job 2: Apply pending free downgrades (paidUntil has passed)
        const pendingDowngraded = await prisma.$executeRaw`
          UPDATE "Hotel"
          SET "plan" = "pendingPlan",
              "status" = 'GRACE'::"HotelStatus",
              "pendingPlan" = NULL,
              "pendingPlanPaid" = false,
              "updatedAt" = NOW()
          WHERE "pendingPlan" IS NOT NULL
            AND "pendingPlanPaid" = false
            AND "paidUntil" <= ${now}
            AND "status" = 'ACTIVE'::"HotelStatus"
        `;
        if (pendingDowngraded > 0) fastify.log.info(`Cron: applied ${pendingDowngraded} pending downgrades`);

        // Job 3: ACTIVE → GRACE (paidUntil passed, no pending plan)
        const graced = await prisma.$executeRaw`
          UPDATE "Hotel"
          SET "status" = 'GRACE'::"HotelStatus",
              "updatedAt" = NOW()
          WHERE "status" = 'ACTIVE'::"HotelStatus"
            AND "paidUntil" <= ${now}
            AND "pendingPlan" IS NULL
        `;
        if (graced > 0) fastify.log.info(`Cron: moved ${graced} hotels to GRACE`);

        // Job 4: GRACE → EXPIRED (3 days after paidUntil)
        const graceDeadline = new Date(now.getTime() - gracePeriodMs);
        const expired = await prisma.$executeRaw`
          UPDATE "Hotel"
          SET "status" = 'EXPIRED'::"HotelStatus",
              "updatedAt" = NOW()
          WHERE "status" = 'GRACE'::"HotelStatus"
            AND "paidUntil" <= ${graceDeadline}
        `;
        if (expired > 0) fastify.log.info(`Cron: moved ${expired} hotels to EXPIRED`);

        // Job 5: TRIAL → EXPIRED (trialEnds passed)
        const trialExpired = await prisma.$executeRaw`
          UPDATE "Hotel"
          SET "status" = 'EXPIRED'::"HotelStatus",
              "updatedAt" = NOW()
          WHERE "status" = 'TRIAL'::"HotelStatus"
            AND "trialEnds" <= ${now}
        `;
        if (trialExpired > 0) fastify.log.info(`Cron: expired ${trialExpired} trials`);

        // Job 6: Cleanup old DailyScanVisitor rows (>90 days) to save storage
        const cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const purgedVisitors = await prisma.$executeRaw`
          DELETE FROM "DailyScanVisitor" WHERE "date" < ${cutoffDate}
        `;
        if (purgedVisitors > 0) fastify.log.info(`Cron: purged ${purgedVisitors} old visitor hash rows`);

      } catch (err) {
        fastify.log.error(`Billing cron error: ${err.message}`);
      }
    }, 60 * 60 * 1000); // Run every hour
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  fastify.log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logError(reason instanceof Error ? reason : new Error(String(reason)));
});

start();

//==================== GRACEFUL SHUTDOWN ====================
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}, starting graceful shutdown...`);
    try {
      await fastify.close();
      fastify.log.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      fastify.log.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});