FROM node:20-alpine
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache openssl libc6-compat wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# 1. Install ALL dependencies (including devDependencies so we have Prisma CLI)
RUN npm ci

# 2. Copy application code

COPY prisma ./prisma


COPY . .

# 3. Generate Prisma client
RUN npx prisma generate

# 4. NOW remove devDependencies to keep the image small
RUN npm prune --production && \
    npm cache clean --force

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Start with migration deploy (SAFE for production)
CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]