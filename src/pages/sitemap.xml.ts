/**
 * Hand-rolled sitemap.
 *
 * The site is small and entirely static, so a single generated file is simpler
 * (and lighter) than pulling in a sitemap integration.
 */
import type { APIRoute } from 'astro';

interface Entry {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
}

const PAGES: Entry[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/room-planner', changefreq: 'weekly', priority: '0.9' },
  { path: '/bedroom-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/small-bedroom-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/living-room-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/home-office-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/furniture-layout-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/room-layout-planner', changefreq: 'monthly', priority: '0.8' },
  { path: '/furniture-fit-calculator', changefreq: 'monthly', priority: '0.7' },
  { path: '/room-size-calculator', changefreq: 'monthly', priority: '0.7' },
  { path: '/about', changefreq: 'yearly', priority: '0.3' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
];

export const GET: APIRoute = ({ site }) => {
  // No fallback domain on purpose: a second hardcoded URL here would silently
  // go stale the moment the real one changes. `site` comes from astro.config.mjs
  // and is the single source of truth, so a missing one is a build error.
  if (!site) {
    throw new Error('`site` must be set in astro.config.mjs so the sitemap can emit absolute URLs.');
  }
  const base = site.toString().replace(/\/$/, '');
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = PAGES.map(
    (page) =>
      `  <url>\n` +
      `    <loc>${base}${page.path === '/' ? '/' : page.path}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${page.changefreq}</changefreq>\n` +
      `    <priority>${page.priority}</priority>\n` +
      `  </url>`,
  ).join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
