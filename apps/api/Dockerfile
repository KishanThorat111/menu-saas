FROM node:20-alpine
WORKDIR /app

# 1. Install system dependencies needed for Prisma on Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy only package files first
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy rest of the app
COPY . .

# 2. Generate Prisma client (This creates the binary engine)
RUN npx prisma generate

EXPOSE 3000

# 3. Use the shell form to run migration before starting
CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]
