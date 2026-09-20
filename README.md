# Room Planner

**Plan your room before you move a thing.**

A free, browser-based 2D room and furniture layout planner. Draw a rectangular room to scale, drop in
furniture at realistic sizes, drag it around, and find out whether the layout actually works — before
anything gets delivered.

No backend. No database. No account. Everything runs in the browser and stays on the visitor's device.

---

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:4321.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check (`astro check`) then build to `dist/` |
| `npm run build:only` | Build without the type-check |
| `npm run preview` | Serve the production build |
| `npm run check` | TypeScript + Astro diagnostics |
| `npm test` | Run the unit tests once |
| `npm run test:watch` | Tests in watch mode |

## Deployment

Live at **https://plan-my-room.netlify.app**, hosted on Netlify from this repository.

Pushing to `main` deploys automatically. Netlify runs `npm run build` — which type-checks before it
builds, so a type error fails the deploy rather than shipping — and publishes `dist/`. Build command,
publish directory, Node version, cache headers and the CSP all come from
[`netlify.toml`](netlify.toml), so the deploy is reproducible and reviewable rather than living in
dashboard settings.

Pull requests get their own preview URL. To roll back, publish an earlier deploy from the
[deploys page](https://app.netlify.com/projects/plan-my-room/deploys) — every build is kept.

### If you ever make this repository private again

A private repo on Netlify's free plan turns on **strict contributor verification**, which matches the
commit author's email against verified members of the Netlify team and blocks anything it cannot
place:

> Build blocked: This commit is from an unrecognized Git contributor.

GitHub's privacy address (`<id>+<user>@users.noreply.github.com`) does not match the email on the
Netlify account, so every build is rejected — pushes *and* manual uploads, since an uploaded deploy
carries no commit to verify at all. The repository is public, so none of this currently applies, and
commits use the privacy address to keep personal email out of a public history.

Going private again means either putting the Netlify account email in commits (which a public history
would then expose) or moving off the free plan.

### Moving to a custom domain

Two files carry the domain. Change both, then redeploy:

```js
// astro.config.mjs
export const SITE_URL = 'https://your-domain.example';
```

```
# public/robots.txt
Sitemap: https://your-domain.example/sitemap.xml
```

`SITE_URL` drives canonical URLs, Open Graph tags and `/sitemap.xml`. The sitemap endpoint reads it
from `Astro.site` and throws at build time if it is missing, so there is no second copy to go stale.

After switching, add the new domain in Netlify, re-verify the property in Google Search Console and
resubmit the sitemap.

---

## Architecture

The rule the codebase follows: **calculation and rendering never touch the DOM, and the DOM layer never
does geometry.** That split is what makes the planner testable without a browser, and it lets the same
renderer draw the live canvas, the homepage demo, the PNG export and the printed page.

```
src/
├── lib/planner/          Pure logic — no DOM, fully unit-tested
│   ├── types.ts          Data model + hard limits
│   ├── units.ts          Unit conversion and display formatting
│   ├── geometry.ts       Rotation, bounds, fit checks
│   ├── collision.ts      Overlap, boundary and clearance analysis
│   ├── snapping.ts       Grid and wall snapping
│   ├── history.ts        Bounded snapshot undo/redo
│   ├── catalog.ts        Furniture library with real-world sizes
│   ├── templates.ts      Ready-made furnished rooms
│   ├── state.ts          Construction, validation, sanitising
│   ├── storage.ts        localStorage + JSON import/export
│   ├── render.ts         SVG scene builder (string output)
│   ├── export.ts         PNG / SVG / JSON / print / share
│   └── analytics.ts      trackEvent seam (no provider wired up)
│
├── scripts/
│   ├── planner-core.ts   The engine: state, viewport, pointer + keyboard
│   ├── planner-ui.ts     DOM wiring for toolbar, panels and persistence
│   └── calculators.ts    The two standalone calculators
│
├── components/           Astro components (see planner/ for the editor)
├── layouts/BaseLayout    <head>, SEO, JSON-LD, site chrome
├── pages/                One file per route
└── styles/               Design tokens + planner shell layout
```

### Units

Everything is stored internally in **inches** and converted only for display. Conversions derive from
the exact `1 in = 2.54 cm` definition, so switching feet → metres → centimetres → feet returns the
original number exactly. There is a test for this.

### Coordinates

`(0, 0)` is the inside top-left corner of the room. A furniture item's `x`/`y` is its **centre**, which
makes rotation trivial (rotate about the centre; the position never changes). Doors and windows are
positioned by their centre offset along a wall, measured clockwise from that wall's start corner.

### Rendering

The scene is built as SVG strings in inch coordinates, and a single parent transform maps inches to
screen pixels. Strokes use `vector-effect="non-scaling-stroke"` and text sizes are divided by the scale,
so lines and labels stay crisp and legible at any zoom. Layers are diffed by markup string, so a render
that changes nothing costs nothing.

---

## What it does

- Rectangular rooms in feet, metres, inches or centimetres
- 50+ furniture items across 8 categories, all resizable and recolourable
- Doors (single, double, sliding, open) with swing arcs, and three window types
- Drag, rotate, resize and duplicate with mouse, touch or stylus
- Grid snapping with flush-to-wall snapping, or free placement with <kbd>Alt</kbd>
- Overlap and out-of-room warnings that advise without ever moving your furniture
- Optional walking-space check with a clear "planning guideline, not a building code" caveat
- Measure tool, room dimensions, per-item dimensions
- Undo/redo, autosave, named local layouts, JSON import/export
- PNG and SVG export, and a clean printed floor plan
- Eight furnished templates

### Keyboard

| Key | Action |
| --- | --- |
| Arrow keys | Move the selected item by one grid step |
| <kbd>Shift</kbd> + arrows | Move by 1 inch |
| <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd> | Rotate 90° right / left |
| <kbd>Ctrl/Cmd</kbd>+<kbd>D</kbd> | Duplicate |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Redo |
| <kbd>Esc</kbd> | Deselect / exit the measure tool |
| <kbd>Space</kbd> + drag | Pan |

Shortcuts never fire while focus is in a text field.

### Accessibility

Dragging is never the only way to do anything. Every object is reachable by keyboard, listed in the
Selected panel, and fully editable through plain numeric inputs for width, depth, X, Y and rotation.
All colour pairs meet WCAG AA for their text size, including the labels drawn on furniture, which pick
their ink by measuring contrast against the fill rather than guessing from brightness.

---

## Monetisation and analytics

Both are scaffolded but inert.

- [`AdSlot.astro`](src/components/AdSlot.astro) reserves correctly sized space so enabling AdSense later
  causes no layout shift. Ads are never placed over the canvas or beside the editing controls.
- [`analytics.ts`](src/lib/planner/analytics.ts) exposes `trackEvent()`, which forwards to `gtag` or
  `dataLayer` if either exists and otherwise does nothing. Event payloads are scrubbed of anything
  free-text or identifying.

If you enable either, update [`/privacy`](src/pages/privacy.astro) to say so.

---

## Testing

113 unit tests cover unit conversion round-tripping, rotated-rectangle geometry, separating-axis
collision, clearance analysis, grid and wall snapping, bounded undo/redo with coalescing, room
validation and error handling, import sanitising of hostile JSON, every shipped template (including
that none of them contain overlapping or out-of-bounds furniture), and SVG export escaping.

```bash
npm test
```

## Known limitations

- **Rectangular rooms only.** The data model and renderer are structured so irregular rooms can be added
  later, but v1 does not draw them.
- **2D only.** Ceiling height and item height are not modelled, so the fit checks speak to footprint and
  opening width, not to getting something upright round a stair turn.
- **Local storage only.** Layouts live in one browser on one device. Export a layout file to move it.
