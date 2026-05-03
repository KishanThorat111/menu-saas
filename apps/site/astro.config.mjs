import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://kodspot.com',
  output: 'static',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto'
  },
  compressHTML: true,
  integrations: [
    tailwind({ applyBaseStyles: false })
  ],
  vite: {
    build: {
      cssMinify: 'esbuild'
    }
  }
});
