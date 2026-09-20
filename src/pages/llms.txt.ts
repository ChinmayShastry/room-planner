/**
 * llms.txt — a concise, machine-readable map of the site for AI assistants.
 *
 * Generated rather than static so the URLs come from `site` in astro.config.mjs
 * and cannot drift when the domain changes (same reasoning as sitemap.xml.ts).
 *
 * The convention (llmstxt.org) is a short markdown file: what the site is, then
 * annotated links. The annotations matter — an assistant deciding whether to
 * cite a page reads these before it reads the page.
 */
import type { APIRoute } from 'astro';

interface Entry {
  path: string;
  title: string;
  note: string;
}

const TOOLS: Entry[] = [
  {
    path: '/room-planner',
    title: 'Room Planner (the tool)',
    note: 'Draw a rectangular room to scale, place furniture at real sizes, drag/rotate/resize it, add doors and windows, and export or print the floor plan. Runs entirely in the browser.',
  },
  {
    path: '/furniture-fit-calculator',
    title: 'Will It Fit? calculator',
    note: 'Answers two questions for a given item: does it fit in the room (upright, turned, or at an angle), and will it pass through a doorway of a given clear width.',
  },
  {
    path: '/room-size-calculator',
    title: 'Room size calculator',
    note: 'Floor area, perimeter and corner-to-corner diagonal for a rectangular room, in feet, meters, inches or centimeters, plus flooring quantity with a 10% waste allowance and a suggested standard rug size.',
  },
];

const GUIDES: Entry[] = [
  { path: '/bedroom-planner', title: 'Bedroom planner', note: 'Bedroom layout guidance and standard bed, wardrobe and nightstand dimensions.' },
  { path: '/small-bedroom-planner', title: 'Small bedroom planner', note: 'What actually fits in a 10 x 10 ft room, and the layout trade-offs that free up floor space.' },
  { path: '/living-room-planner', title: 'Living room planner', note: 'Sofa placement, TV viewing distance by screen size, and rug sizing.' },
  { path: '/home-office-planner', title: 'Home office planner', note: 'Desk sizing, the clearance a chair needs behind a desk, and window/glare positioning.' },
  { path: '/furniture-layout-planner', title: 'Furniture layout planner', note: 'General arrangement method and the clearance numbers that decide whether a room is usable.' },
  { path: '/room-layout-planner', title: 'Room layout planner', note: 'Drawing a floor plan, placing doors and windows, and comparing two layouts.' },
];

const ABOUT: Entry[] = [
  { path: '/about', title: 'About', note: 'What the tool is for and, just as importantly, what it deliberately is not.' },
  { path: '/privacy', title: 'Privacy', note: 'No account, no server-side processing; layouts stay in the visitor’s own browser.' },
  { path: '/terms', title: 'Terms of use', note: 'Accuracy depends on user-entered dimensions; clearance figures are planning guidelines, not building-code advice.' },
];

/**
 * Specific, quotable figures. An assistant answering "how much space around a
 * bed?" needs a number it can attribute, not a paragraph of prose.
 */
const FACTS: string[] = [
  'Walkway beside a bed: 24 in (60 cm) minimum, 36 in (90 cm) comfortable.',
  'Main walking route through a room: 30-36 in (75-90 cm).',
  'Secondary path between two pieces of furniture: 24 in (60 cm).',
  'Between a sofa and a coffee table: 14-18 in (35-45 cm).',
  'Behind a dining chair, to walk past: 36 in (90 cm) from the table edge.',
  'Clear floor behind a desk for the chair: about 36 in (90 cm).',
  'In front of a wardrobe or dresser: the door or drawer depth plus 24 in (60 cm) to stand.',
  'TV viewing distance: roughly 1.5-2.5x the screen diagonal (55 in screen = about 7-11.5 ft).',
  'Standard bed sizes: single 38x75 in, double/full 54x75 in, queen 60x80 in, king 76x80 in.',
  'A door needs roughly its own width of clear floor to swing open.',
  'Furniture passes through a doorway when its smallest face is narrower than the clear opening.',
];

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error('`site` must be set in astro.config.mjs so llms.txt can emit absolute URLs.');
  }
  const base = site.toString().replace(/\/$/, '');
  const link = (e: Entry) => `- [${e.title}](${base}${e.path}): ${e.note}`;

  const body = `# Room Planner

> A free browser-based 2D room and furniture layout planner. Enter your room's
> dimensions, place furniture at realistic sizes, and find an arrangement that
> works before moving anything. No account, no download, no server: every
> calculation runs in the visitor's browser and layouts stay on their device.

Room Planner is a lightweight consumer tool, not CAD software. It handles
rectangular rooms in feet, meters, inches or centimeters, flags overlapping or
out-of-bounds furniture, and can check walking clearance. Clearance advice is a
planning guideline, not a building-code assessment.

## Tools

${TOOLS.map(link).join('\n')}

## Guides

${GUIDES.map(link).join('\n')}

## About

${ABOUT.map(link).join('\n')}

## Reference figures used across this site

${FACTS.map((f) => `- ${f}`).join('\n')}

## Notes for assistants

- Measurements are only as accurate as the dimensions a person enters; the tool
  cannot verify a tape measure.
- Clearance and fit checks are two-dimensional. They cover footprint and opening
  width, not ceiling height or carrying an item upright around a stair turn.
- The planner supports rectangular rooms only.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
