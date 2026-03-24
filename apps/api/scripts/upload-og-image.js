#!/usr/bin/env node
/**
 * One-time script: Compress og-image with Sharp and upload to Cloudflare R2.
 *
 * Usage:
 *   1. Place your raw og-image file at: apps/api/scripts/og-image-raw.png
 *   2. Run: node apps/api/scripts/upload-og-image.js
 *
 * It will:
 *   - Resize to exactly 1200x630
 *   - Convert to WebP at quality 85 (best size/quality ratio for OG images)
 *   - Also generate a PNG fallback (some crawlers prefer PNG)
 *   - Upload both to R2 as og-image.webp and og-image.png
 *   - Print the public URLs to use in meta tags
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const fs = require('fs');

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const inputPath = path.join(__dirname, 'og-image-raw.png');

  if (!fs.existsSync(inputPath)) {
    console.error('ERROR: Place your raw image at: apps/api/scripts/og-image-raw.png');
    process.exit(1);
  }

  const rawSize = fs.statSync(inputPath).size;
  console.log(`Input: ${inputPath} (${(rawSize / 1024).toFixed(0)} KB)`);

  // Generate WebP (primary — smallest size)
  const webpBuffer = await sharp(inputPath)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .webp({ quality: 85 })
    .toBuffer();

  // Generate PNG fallback (some social crawlers don't support WebP)
  const pngBuffer = await sharp(inputPath)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png({ quality: 85, compressionLevel: 9 })
    .toBuffer();

  console.log(`WebP: ${(webpBuffer.length / 1024).toFixed(0)} KB`);
  console.log(`PNG:  ${(pngBuffer.length / 1024).toFixed(0)} KB`);

  // Upload WebP
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'og-image.webp',
    Body: webpBuffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  console.log(`Uploaded: ${PUBLIC_URL}/og-image.webp`);

  // Upload PNG
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'og-image.png',
    Body: pngBuffer,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  console.log(`Uploaded: ${PUBLIC_URL}/og-image.png`);

  console.log('\n=== Done! Use this URL in your meta tags ===');
  console.log(`og:image → ${PUBLIC_URL}/og-image.png`);
  console.log(`(PNG is safest for social crawlers — Facebook/LinkedIn don't always support WebP)\n`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
