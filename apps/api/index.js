const path = require('path');
const fastify = require('fastify')({ logger: true });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const prisma = new PrismaClient();

// Configuration
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

// Initialize R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Helper: Upload to R2
async function uploadToR2(buffer, mimetype, hotelId) {
  const ext = mimetype === 'image/png' ? '.png' : 
               mimetype === 'image/webp' ? '.webp' : '.jpg';
  const key = `hotels/${hotelId}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
  
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

// Helper: Delete from R2
async function deleteFromR2(imageUrl) {
  if (!imageUrl || !imageUrl.includes(PUBLIC_URL)) return;
  const key = imageUrl.replace(`${PUBLIC_URL}/`, '');
  
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  await r2Client.send(command);
}

// Plugins Registration
fastify.register(require('@fastify/multipart'), {
  attachFieldsToBody: true, 
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

fastify.addHook('onClose', async () => {
  await prisma.$disconnect();
});

// Auth middleware
async function authenticate(request, reply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('No token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    request.hotelId = decoded.hotelId;
    request.tenantId = decoded.tenantId;
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', time: new Date().toISOString(), url: APP_URL };
});

// Public menu - Namespaced to /api/menu to avoid HTML collision
fastify.get('/api/menu/:slug', async (request, reply) => {
  const { slug } = request.params;
  const hotel = await prisma.hotel.findUnique({
    where: { slug },
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
  
  if (!hotel || hotel.status === 'SUSPENDED') {
    return reply.code(404).send({ error: 'Menu not found' });
  }
  
  prisma.hotel.update({
    where: { id: hotel.id },
    data: { views: { increment: 1 }, lastViewAt: new Date() }
  }).catch(() => {});
  
  return {
    name: hotel.name, city: hotel.city, theme: hotel.theme, categories: hotel.categories
  };
});

// Login
fastify.post('/auth/login', async (request, reply) => {
  const schema = z.object({
    slug: z.string(),
    pin: z.string().length(4)
  });
  
  const { slug, pin } = schema.parse(request.body);
  const hotel = await prisma.hotel.findUnique({ where: { slug } });
  
  if (!hotel) return reply.code(404).send({ error: 'Hotel not found' });
  
  const valid = await bcrypt.compare(pin, hotel.pinHash);
  if (!valid) return reply.code(401).send({ error: 'Invalid PIN' });
  
  const token = jwt.sign(
    { hotelId: hotel.id, tenantId: hotel.tenantId, slug: hotel.slug },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  return {
    token, hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotel.status }
  };
});

// Protected routes
fastify.register(async function(app) {
  app.addHook('preHandler', authenticate);
  
  app.get('/me', async (request) => {
    return prisma.hotel.findUnique({
      where: { id: request.hotelId },
      include: {
        categories: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }
        }
      }
    });
  });
  
  app.post('/categories', async (request) => {
    const { name, sortOrder } = z.object({
      name: z.string().min(1).max(100), 
      sortOrder: z.number().default(0)
    }).parse(request.body);
    
    const category = await prisma.category.create({
      data: { hotelId: request.hotelId, name, sortOrder }
    });

    await prisma.auditLog.create({
      data: { hotelId: request.hotelId, actorType: 'owner', action: 'category_created', entityType: 'Category', entityId: category.id, newValue: { name } }
    });

    return category;
  });
  
  // SUPPORT FOR BOTH SINGLE-STEP (Multipart) AND TWO-STEP (JSON) UPLOADS
  app.post('/items', async (request, reply) => {
    try {
      let data = {};
      let imageFile = null;

      if (request.isMultipart()) {
        data = {
          categoryId: request.body.categoryId?.value,
          name: request.body.name?.value,
          price: parseInt(request.body.price?.value),
          description: request.body.description?.value || null,
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
          categoryId: z.string(),
          name: z.string().min(1).max(200),
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

      let imageUrl = null;

      if (imageFile) {
         const fileData = Array.isArray(imageFile) ? imageFile[0] : imageFile;
         const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
         
         if (!allowedTypes.includes(fileData.mimetype)) {
           return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
         }
         
         const buffer = await fileData.toBuffer();
         if (buffer.length > 2 * 1024 * 1024) {
           return reply.code(400).send({ error: 'File too large. Max 2MB. Please compress before upload.' });
         }

         imageUrl = await uploadToR2(buffer, fileData.mimetype, request.hotelId);
         data.imageUrl = imageUrl;
      }

      const item = await prisma.item.create({ data });

      await prisma.auditLog.create({
        data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_created', entityType: 'Item', entityId: item.id, newValue: data }
      });

      return item;
    } catch (err) {
      request.log.error(err);
      return reply.code(400).send({ error: err.message });
    }
  });
  
  app.post('/items/:id/image', async (request, reply) => {
    const { id } = request.params;
    const item = await prisma.item.findFirst({
      where: { id, category: { hotelId: request.hotelId } }
    });
    
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    
    try {
      const fileData = request.body.image;
      if (!fileData) return reply.code(400).send({ error: 'No file uploaded' });

      const file = Array.isArray(fileData) ? fileData[0] : fileData;
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      
      if (!allowedTypes.includes(file.mimetype)) {
        return reply.code(400).send({ error: 'Invalid file type. Only JPG, PNG, WebP allowed.' });
      }
      
      const buffer = await file.toBuffer();
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.code(400).send({ error: 'File too large. Max 2MB.' });
      }
      
      if (item.imageUrl) await deleteFromR2(item.imageUrl).catch(() => {});
      
      const imageUrl = await uploadToR2(buffer, file.mimetype, request.hotelId);
      const updated = await prisma.item.update({
        where: { id }, data: { imageUrl }
      });

      await prisma.auditLog.create({
        data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_image_uploaded', entityType: 'Item', entityId: id, newValue: { imageUrl } }
      });
      
      return { success: true, imageUrl, item: updated };
    } catch (err) {
      request.log.error(err);
      return reply.code(400).send({ error: err.message });
    }
  });
  
  app.delete('/items/:id', async (request, reply) => {
    const { id } = request.params;
    const item = await prisma.item.findFirst({
      where: { id, category: { hotelId: request.hotelId } }
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    const updated = await prisma.item.update({ where: { id }, data: { isAvailable: false } });

    await prisma.auditLog.create({
      data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_soft_deleted', entityType: 'Item', entityId: id, oldValue: item, newValue: { isAvailable: false } }
    });

    return { success: true, message: 'Item removed from menu', item: updated };
  });

  app.patch('/items/:id/restore', async (request, reply) => {
    const { id } = request.params;
    const item = await prisma.item.findFirst({
      where: { id, category: { hotelId: request.hotelId } }
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    const updated = await prisma.item.update({ where: { id }, data: { isAvailable: true } });

    await prisma.auditLog.create({
      data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_restored', entityType: 'Item', entityId: id, newValue: { isAvailable: true } }
    });

    return { success: true, message: 'Item restored', item: updated };
  });

  app.delete('/items/:id/permanent', async (request, reply) => {
    const { id } = request.params;
    const item = await prisma.item.findFirst({
      where: { id, category: { hotelId: request.hotelId } }
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    if (item.imageUrl) await deleteFromR2(item.imageUrl).catch(() => {});
    await prisma.item.delete({ where: { id } });

    await prisma.auditLog.create({
      data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_deleted_permanent', entityType: 'Item', entityId: id, oldValue: item }
    });

    return { success: true, message: 'Item permanently deleted' };
  });

  app.patch('/items/:id', async (request, reply) => {
    const { id } = request.params;
    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
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
      data: { hotelId: request.hotelId, actorType: 'owner', action: 'item_updated', entityType: 'Item', entityId: id, oldValue: item, newValue: updated }
    });

    return updated;
  });
});

// Admin routes
fastify.register(async function(app) {
  app.addHook('preHandler', async (request, reply) => {
    if (!process.env.ADMIN_KEY || request.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
  
  app.post('/admin/hotels', async (request) => {
    const schema = z.object({
      name: z.string(), city: z.string(), phone: z.string(),
      slug: z.string(), pin: z.string().length(4),
      plan: z.enum(['STARTER', 'STANDARD', 'PRO']).default('STARTER')
    });
    
    const { name, city, phone, slug, pin, plan } = schema.parse(request.body);
    const pinHash = await bcrypt.hash(pin, 10);
    
    const hotel = await prisma.hotel.create({
      data: {
        name, city, phone, slug, pinHash, plan,
        status: 'TRIAL',
        trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    
    return {
      id: hotel.id, slug: hotel.slug, pin: pin, trialEnds: hotel.trialEnds,
      menuUrl: `${APP_URL}/menu.html?h=${hotel.slug}`,
      adminUrl: `${APP_URL}/admin.html`
    };
  });
  
  app.get('/admin/hotels', async () => {
    return prisma.hotel.findMany({
      select: {
        id: true, name: true, slug: true, city: true, phone: true,
        status: true, plan: true, trialEnds: true, paidUntil: true,
        views: true, createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
  });

  // RESTORED: Admin update status route
  app.patch('/admin/hotels/:id/status', async (request) => {
    const { id } = request.params;
    const schema = z.object({
      status: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED']),
      paidUntil: z.string().datetime().optional(),
      note: z.string().optional()
    });
    
    const { status, paidUntil, note } = schema.parse(request.body);
    
    return await prisma.hotel.update({
      where: { id },
      data: {
        status,
        ...(paidUntil && { paidUntil: new Date(paidUntil) }),
        ...(note && { lastPaymentNote: note })
      }
    });
  });
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server listening at ${APP_URL}`);
});
