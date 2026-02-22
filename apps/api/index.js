    // ...existing code...
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
  "COOKIE_SECRET"
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

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

//==================== CONFIGURATION ====================
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const APP_URL = process.env.APP_URL ?? `http://localhost:${process.env.PORT || 3000}`;
const isProduction = process.env.NODE_ENV === 'production';

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

//==================== HELPERS ====================
async function uploadToR2(buffer, mimetype, hotelId) {
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
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
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
      select: { status: true }
    });

    if (hotel?.status === 'SUSPENDED') {
      return reply.code(403).send({ error: 'Account suspended' });
    }
    if (hotel?.status === 'DELETED') {
      return reply.code(401).send({ error: 'Unauthorized' });
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

  // Public Menu API — base32 code lookup
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

    prisma.hotel.update({
      where: { id: hotel.id },
      data: { views: { increment: 1 }, lastViewAt: new Date() }
    }).catch((err) => { fastify.log.error(`View increment failed for hotel ${hotel.id}: ${err.message}`); });

    reply.header('Cache-Control', 'public, max-age=60');

    return {
      name: hotel.name,
      city: hotel.city,
      theme: hotel.theme,
      categories: hotel.categories
    };
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

  // Professional URL: /dashboard — serves admin.html (hotel owner panel)
  fastify.get('/dashboard', async (request, reply) => {
    return reply.sendFile('admin.html');
  });

  // Professional URL: /superadmin — serves superadmin.html
  fastify.get('/superadmin', async (request, reply) => {
    return reply.sendFile('superadmin.html');
  });

  // Legacy redirect: /admin.html → /dashboard (permanent 301)
  fastify.get('/admin.html', async (request, reply) => {
    return reply.redirect(301, '/dashboard');
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
      select: { id: true, tenantId: true, slug: true, name: true, status: true, pinHash: true }
    });

    if (!hotel) return reply.code(401).send({ error: 'Invalid credentials' });

    if (hotel.status === 'SUSPENDED') return reply.code(403).send({ error: 'Account suspended' });
    if (hotel.status === 'DELETED') return reply.code(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(pin, hotel.pinHash);
    if (!valid) {
      fastify.log.warn(`Failed login attempt for hotel: ${normalizedCode} from IP: ${request.ip}`);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { hotelId: hotel.id, tenantId: hotel.tenantId, slug: hotel.slug, type: 'hotel_owner' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return {
      token,
      hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotel.status }
    };
  });

  //==================== PROTECTED HOTEL OWNER ROUTES ====================
  fastify.register(async function (app) {
    app.addHook('preHandler', authenticate);

    app.get('/me', async (request) => {
      return prisma.hotel.findUnique({
        where: { id: request.hotelId },
        select: {
          id: true, name: true, slug: true, city: true, phone: true,
          plan: true, status: true, theme: true, views: true,
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

    app.patch('/settings/theme', async (request, reply) => {
      const schema = z.object({
        theme: z.enum(['classic', 'warm', 'nature', 'elegant'])
      });
      const { theme } = schema.parse(request.body);

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

      return { success: true, theme: updated.theme };
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

      return category;
    });

    app.post('/items', async (request, reply) => {
      let imageUrl = null;
      try {
        let data = {};
        let imageFile = null;

        if (request.isMultipart()) {
          data = {
            categoryId: request.body.categoryId?.value,
            name: request.body.name?.value?.trim(),
            price: parseInt(request.body.price?.value),
            description: request.body.description?.value?.trim() || null,
            isVeg: request.body.isVeg?.value === 'true',
            isPopular: request.body.isPopular?.value === 'true',
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
        sortOrder: z.number().optional()
      });

      const data = schema.parse(request.body);
      const item = await prisma.item.findFirst({
        where: { id, category: { hotelId: request.hotelId } }
      });

      if (!item) return reply.code(404).send({ error: 'Item not found' });

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
        plan: z.enum(['FREE', 'BASIC', 'PREMIUM', 'STARTER', 'STANDARD', 'PRO'])
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
      // Update
      const updated = await prisma.hotel.update({
        where: { id },
        data: {
          name: data.name,
          city: data.city,
          phone: data.phone,
          email: data.email || null,
          plan: data.plan
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
      fastify.log.info(`Hotel ${id} details edited by admin`);
      return updated;
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

      // Auto-generate collision-free base32 slug
      const slug = await generateSlug();
      const pinHash = await bcrypt.hash(pin, 10);

      const hotel = await prisma.hotel.create({
        data: {
          name, city, phone, slug, pinHash, plan,
          email: email || null,
          consentedAt: new Date(),
          consentVersion: '1.0',
          status: 'TRIAL',
          trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          pinResetCount: 0
        }
      });

      return {
        id: hotel.id,
        slug: hotel.slug,
        pin: pin, // Return plain PIN once
        trialEnds: hotel.trialEnds,
        menuUrl: `${APP_URL}/m/${hotel.slug}`,
        adminUrl: `${APP_URL}/dashboard`
      };
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
            views: true, createdAt: true, theme: true,
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
          plan: true, status: true, theme: true, views: true,
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

      // Generate secure 8-digit PIN using crypto
      const plainPin = crypto.randomInt(10000000, 100000000).toString();
      const pinHash = await bcrypt.hash(plainPin, 10);
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
          id: true, status: true, deletedAt: true, purgeAfter: true, slug: true,
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