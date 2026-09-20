// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Update this to the production domain before deploying.
// It powers canonical URLs, Open Graph tags and the generated sitemap.
export const SITE_URL = 'https://roomplanner.example.com';

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'ignore',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      target: 'es2022',
    },
  },
});
