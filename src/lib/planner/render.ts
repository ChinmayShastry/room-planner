/**
 * SVG scene construction.
 *
 * The renderer is a pure string builder: it takes a state plus a viewport and
 * returns markup for each layer. Keeping it free of DOM queries means the same
 * code draws the live canvas, the homepage demo and the PNG/SVG export.
 *
 * Coordinates inside the scene are INCHES. A single parent transform
 * (`translate(tx ty) scale(s)`) maps them to screen pixels, so strokes use
 * `vector-effect="non-scaling-stroke"` and text sizes are divided by the scale
 * to stay legible at any zoom.
 */

import { RECOMMENDED_CLEARANCE } from './collision';
import { degToRad, itemBounds, normalizeAngle, pointOnWall, wallSegment } from './geometry';
import { effectiveGridStep, GRID_INCHES } from './snapping';
import { formatLength, formatLengthFriendly } from './units';
import type {
  Door,
  FloorColor,
  FurnitureItem,
  MeasureLine,
  PlannerState,
  Room,
  Unit,
  Wall,
  WindowItem,
} from './types';

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export type SelectionKind = 'furniture' | 'door' | 'window';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export interface RenderInput {
  state: PlannerState;
  viewport: Viewport;
  selection: Selection | null;
  overlaps: Set<string>;
  outside: Set<string>;
  measure: MeasureLine | null;
  measureDraft: MeasureLine | null;
  /** Export/print mode drops the grid, handles and interaction affordances. */
  presentation?: boolean;
  /** Ids to draw with a clearance warning ring. */
  clearanceIds?: Set<string>;
}

export const FLOOR_FILL: Record<FloorColor, string> = {
  light: '#FAF7F2',
  warm: '#F6EEE2',
  gray: '#F0F0EF',
};

const WALL_FILL = '#2F2B27';
const WALL_STROKE = '#211E1B';
const GRID_MINOR = '#E2DACE';
const GRID_MAJOR = '#D2C7B6';
const DIM_COLOR = '#6E675E';
const ACCENT = '#AD6425';
const WARN = '#B14E2B';

// --------------------------------------------------------------- utilities

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Round to 2dp — keeps generated markup small and diff-friendly. */
function n(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const int = Number.parseInt(value.slice(0, 6), 16);
  if (!Number.isFinite(int)) return { r: 200, g: 187, b: 166 };
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Mix a colour toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (target - c) * t);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

const INK_DARK = '#2A2724';
const INK_LIGHT = '#FFFFFF';

/** WCAG relative luminance. */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick readable label text for a given fill.
 * Measures both candidates rather than using a brightness cutoff, because the
 * mid-tone wood and green fills sit right where a fixed threshold guesses wrong.
 */
export function contrastInk(hex: string): string {
  return contrastRatio(INK_DARK, hex) >= contrastRatio(INK_LIGHT, hex) ? INK_DARK : INK_LIGHT;
}

// ------------------------------------------------------------ item shapes

interface ShapeCtx {
  w: number;
  h: number;
  fill: string;
  line: string;
  soft: string;
}

/**
 * Top-down icon for an item, drawn in local coordinates centred on (0,0).
 * Shapes are deliberately simple line art: readable at small sizes, no assets.
 */
function shapeMarkup(item: FurnitureItem, ctx: ShapeCtx): string {
  const { w, h, fill, line, soft } = ctx;
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(3, w / 8, h / 8);
  const body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>`;

  switch (item.shape) {
    case 'bed':
    case 'bunk-bed': {
      const pillowH = Math.min(h * 0.2, 16);
      const inset = Math.min(w * 0.06, 3);
      const pillowW = w > 45 ? (w - inset * 3) / 2 : w - inset * 2;
      const pillows =
        w > 45
          ? `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(pillowW)}" height="${n(pillowH)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>` +
            `<rect x="${n(x + inset * 2 + pillowW)}" y="${n(y + inset)}" width="${n(pillowW)}" height="${n(pillowH)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`
          : `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(pillowW)}" height="${n(pillowH)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`;
      const blanketY = y + pillowH + inset * 2;
      const blanket = `<line x1="${n(x)}" y1="${n(blanketY)}" x2="${n(x + w)}" y2="${n(blanketY)}" stroke="${line}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      const ladder =
        item.shape === 'bunk-bed'
          ? `<rect x="${n(x + w * 0.12)}" y="${n(y + h - 8)}" width="${n(w * 0.76)}" height="6" fill="none" stroke="${line}" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`
          : '';
      return body + pillows + blanket + ladder;
    }

    case 'sofa': {
      const back = Math.min(h * 0.28, 10);
      const arm = Math.min(w * 0.1, 8);
      const seatX = x + arm;
      const seatY = y + back;
      const seatW = w - arm * 2;
      const seatH = h - back;
      const seats = Math.max(1, Math.round(seatW / 28));
      let cushions = '';
      for (let i = 1; i < seats; i += 1) {
        const cx = seatX + (seatW / seats) * i;
        cushions += `<line x1="${n(cx)}" y1="${n(seatY)}" x2="${n(cx)}" y2="${n(y + h)}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`;
      }
      return (
        body +
        `<rect x="${n(seatX)}" y="${n(seatY)}" width="${n(seatW)}" height="${n(seatH)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        cushions
      );
    }

    case 'sofa-l': {
      const arm = 10;
      const back = 10;
      const legW = w * 0.55;
      const legH = h * 0.45;
      const path = `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + legH)} H ${n(x + legW)} V ${n(y + h)} H ${n(x)} Z`;
      return (
        `<path d="${path}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<rect x="${n(x + arm)}" y="${n(y + back)}" width="${n(w - arm * 2)}" height="${n(legH - back - 4)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        `<rect x="${n(x + arm)}" y="${n(y + legH)}" width="${n(legW - arm - 4)}" height="${n(h - legH - arm)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'armchair': {
      const back = Math.min(h * 0.26, 9);
      const arm = Math.min(w * 0.16, 8);
      return (
        body +
        `<rect x="${n(x + arm)}" y="${n(y + back)}" width="${n(w - arm * 2)}" height="${n(h - back - 3)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'table':
    case 'counter': {
      const inset = Math.min(w, h) * 0.14;
      return (
        body +
        `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(w - inset * 2)}" height="${n(h - inset * 2)}" rx="1.5" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'round-table': {
      const rx = w / 2;
      const ry = h / 2;
      return (
        `<ellipse cx="0" cy="0" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<ellipse cx="0" cy="0" rx="${n(rx * 0.68)}" ry="${n(ry * 0.68)}" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'chair': {
      const back = Math.min(h * 0.22, 5);
      return (
        body +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(back)}" rx="1.5" fill="${shade(fill, -0.18)}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'desk': {
      const drawer = Math.min(w * 0.3, 18);
      return (
        body +
        `<rect x="${n(x + w - drawer - 2)}" y="${n(y + 2)}" width="${n(drawer)}" height="${n(h - 4)}" rx="1.5" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${n(x + w - drawer - 2)}" y1="0" x2="${n(x + w - 2)}" y2="0" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'wardrobe': {
      return (
        body +
        `<line x1="0" y1="${n(y)}" x2="0" y2="${n(y + h)}" stroke="${line}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${n(-2.5)}" cy="0" r="1.1" fill="${line}"/>` +
        `<circle cx="${n(2.5)}" cy="0" r="1.1" fill="${line}"/>`
      );
    }

    case 'storage': {
      const handleY = y + h * 0.5;
      return (
        body +
        `<line x1="${n(x + w * 0.2)}" y1="${n(handleY)}" x2="${n(x + w * 0.8)}" y2="${n(handleY)}" stroke="${line}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'shelf': {
      let lines = '';
      const rows = Math.max(2, Math.round(w / 14));
      for (let i = 1; i < rows; i += 1) {
        const lx = x + (w / rows) * i;
        lines += `<line x1="${n(lx)}" y1="${n(y)}" x2="${n(lx)}" y2="${n(y + h)}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`;
      }
      return body + lines;
    }

    case 'tv': {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${n(x + w * 0.35)}" y1="${n(y + h)}" x2="${n(x + w * 0.65)}" y2="${n(y + h)}" stroke="${line}" stroke-width="2" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'appliance': {
      return (
        body +
        `<line x1="${n(x)}" y1="${n(y + h * 0.42)}" x2="${n(x + w)}" y2="${n(y + h * 0.42)}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${n(x + w * 0.5)}" cy="${n(y + h * 0.72)}" r="${n(Math.min(w, h) * 0.12)}" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'sink': {
      const inset = Math.min(w, h) * 0.16;
      return (
        body +
        `<rect x="${n(x + inset)}" y="${n(y + inset * 1.6)}" width="${n(w - inset * 2)}" height="${n(h - inset * 2.4)}" rx="2" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="0" cy="${n(y + inset * 0.8)}" r="1.6" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'toilet': {
      const tankH = h * 0.3;
      return (
        `<rect x="${n(x + w * 0.05)}" y="${n(y)}" width="${n(w * 0.9)}" height="${n(tankH)}" rx="1.5" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<ellipse cx="0" cy="${n(y + tankH + (h - tankH) * 0.5)}" rx="${n(w * 0.4)}" ry="${n((h - tankH) * 0.5)}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'bathtub': {
      const inset = Math.min(w, h) * 0.12;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.18)}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(w - inset * 2)}" height="${n(h - inset * 2)}" rx="${n(Math.min(w, h) * 0.14)}" fill="${soft}" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${n(x + w - inset * 2.2)}" cy="0" r="1.6" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'shower': {
      return (
        body +
        `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + w)}" y2="${n(y + h)}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${n(x + w)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y + h)}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="0" cy="0" r="${n(Math.min(w, h) * 0.1)}" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'rug': {
      const inset = Math.min(w, h) * 0.08;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}" fill-opacity="0.55" stroke="${line}" stroke-width="1" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>` +
        `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(w - inset * 2)}" height="${n(h - inset * 2)}" rx="1.5" fill="none" stroke="${line}" stroke-width="0.8" stroke-opacity="0.7" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'plant': {
      const rad = Math.min(w, h) / 2;
      return (
        `<circle cx="0" cy="0" r="${n(rad)}" fill="${fill}" fill-opacity="0.85" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="0" cy="0" r="${n(rad * 0.45)}" fill="${shade(fill, -0.25)}" stroke="none"/>`
      );
    }

    case 'lamp': {
      const rad = Math.min(w, h) / 2;
      return (
        `<circle cx="0" cy="0" r="${n(rad)}" fill="${fill}" stroke="${line}" stroke-width="1.25" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="0" cy="0" r="${n(rad * 0.4)}" fill="none" stroke="${line}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'mirror': {
      return (
        body +
        `<line x1="${n(x + 2)}" y1="${n(y)}" x2="${n(x + w - 2)}" y2="${n(y + h)}" stroke="${line}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`
      );
    }

    case 'box':
    default:
      return body;
  }
}

// ------------------------------------------------------------------ layers

export function renderFloor(room: Room): string {
  return `<rect x="0" y="0" width="${n(room.width)}" height="${n(room.height)}" fill="${FLOOR_FILL[room.floorColor]}"/>`;
}

export function renderGrid(room: Room, grid: PlannerState['settings']['grid'], scale: number): string {
  if (grid === 'off') return '';
  const step = effectiveGridStep(grid, scale);
  if (step <= 0) return '';
  const major = Math.max(step, 12);
  let out = '';
  for (let x = step; x < room.width - 0.001; x += step) {
    const isMajor = Math.abs(x % major) < 0.001;
    out += `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(room.height)}" stroke="${isMajor ? GRID_MAJOR : GRID_MINOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  for (let y = step; y < room.height - 0.001; y += step) {
    const isMajor = Math.abs(y % major) < 0.001;
    out += `<line x1="0" y1="${n(y)}" x2="${n(room.width)}" y2="${n(y)}" stroke="${isMajor ? GRID_MAJOR : GRID_MINOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  return `<g opacity="0.9">${out}</g>`;
}

/** Walls are drawn as a thick frame outside the interior rectangle. */
export function renderWalls(room: Room): string {
  const t = room.wallThickness;
  const outer = `M ${n(-t)} ${n(-t)} H ${n(room.width + t)} V ${n(room.height + t)} H ${n(-t)} Z`;
  const inner = `M 0 0 V ${n(room.height)} H ${n(room.width)} V 0 Z`;
  return `<path d="${outer} ${inner}" fill="${WALL_FILL}" fill-rule="evenodd" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
}

function openingGeometry(room: Room, wall: Wall, offset: number, width: number) {
  const centre = pointOnWall(room, wall, offset);
  const t = room.wallThickness;
  const half = width / 2;
  const horizontal = wall === 'top' || wall === 'bottom';
  const rect = horizontal
    ? { x: centre.x - half, y: centre.y - t, width, height: t * 2 }
    : { x: centre.x - t, y: centre.y - half, width: t * 2, height: width };
  return { centre, rect, horizontal, t, half };
}

export function renderWindows(room: Room, windows: WindowItem[], selectedId: string | null): string {
  let out = '';
  for (const win of windows) {
    const g = openingGeometry(room, win.wall, win.offset, win.width);
    const selected = selectedId === win.id;
    const panes = win.type === 'sliding' ? 2 : win.type === 'large' ? 3 : 1;
    let divisions = '';
    for (let i = 1; i < panes; i += 1) {
      const p = i / panes;
      if (g.horizontal) {
        const px = g.rect.x + g.rect.width * p;
        divisions += `<line x1="${n(px)}" y1="${n(g.rect.y)}" x2="${n(px)}" y2="${n(g.rect.y + g.rect.height)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      } else {
        const py = g.rect.y + g.rect.height * p;
        divisions += `<line x1="${n(g.rect.x)}" y1="${n(py)}" x2="${n(g.rect.x + g.rect.width)}" y2="${n(py)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      }
    }
    const centreLine = g.horizontal
      ? `<line x1="${n(g.rect.x)}" y1="${n(g.centre.y)}" x2="${n(g.rect.x + g.rect.width)}" y2="${n(g.centre.y)}" stroke="${WALL_STROKE}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`
      : `<line x1="${n(g.centre.x)}" y1="${n(g.rect.y)}" x2="${n(g.centre.x)}" y2="${n(g.rect.y + g.rect.height)}" stroke="${WALL_STROKE}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;

    out +=
      `<g class="rp-window${selected ? ' is-selected' : ''}" data-kind="window" data-id="${escapeXml(win.id)}">` +
      `<rect x="${n(g.rect.x)}" y="${n(g.rect.y)}" width="${n(g.rect.width)}" height="${n(g.rect.height)}" fill="#EAF2F7" stroke="${WALL_STROKE}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>` +
      centreLine +
      divisions +
      (selected
        ? `<rect x="${n(g.rect.x)}" y="${n(g.rect.y)}" width="${n(g.rect.width)}" height="${n(g.rect.height)}" fill="none" stroke="${ACCENT}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`
        : '') +
      `</g>`;
  }
  return out;
}

export function renderDoors(room: Room, doors: Door[], selectedId: string | null): string {
  let out = '';
  for (const door of doors) {
    const g = openingGeometry(room, door.wall, door.offset, door.width);
    const selected = selectedId === door.id;

    // The opening itself: a clean break in the wall.
    let markup = `<rect x="${n(g.rect.x)}" y="${n(g.rect.y)}" width="${n(g.rect.width)}" height="${n(g.rect.height)}" fill="${FLOOR_FILL[room.floorColor]}" stroke="none"/>`;

    if (door.type === 'sliding') {
      const inset = g.t * 0.6;
      markup += g.horizontal
        ? `<rect x="${n(g.rect.x)}" y="${n(g.centre.y - inset)}" width="${n(g.rect.width * 0.52)}" height="${n(inset)}" fill="${shade(WALL_FILL, 0.55)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
          `<rect x="${n(g.rect.x + g.rect.width * 0.48)}" y="${n(g.centre.y)}" width="${n(g.rect.width * 0.52)}" height="${n(inset)}" fill="${shade(WALL_FILL, 0.7)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
        : `<rect x="${n(g.centre.x - inset)}" y="${n(g.rect.y)}" width="${n(inset)}" height="${n(g.rect.height * 0.52)}" fill="${shade(WALL_FILL, 0.55)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
          `<rect x="${n(g.centre.x)}" y="${n(g.rect.y + g.rect.height * 0.48)}" width="${n(inset)}" height="${n(g.rect.height * 0.52)}" fill="${shade(WALL_FILL, 0.7)}" stroke="${WALL_STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    } else if (door.type !== 'opening') {
      markup += doorSwing(door, g);
    }

    if (selected) {
      markup += `<rect x="${n(g.rect.x)}" y="${n(g.rect.y)}" width="${n(g.rect.width)}" height="${n(g.rect.height)}" fill="none" stroke="${ACCENT}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
    }

    out += `<g class="rp-door${selected ? ' is-selected' : ''}" data-kind="door" data-id="${escapeXml(door.id)}">${markup}</g>`;
  }
  return out;
}

/** Leaf plus quarter-circle arc, the standard floor-plan convention. */
function doorSwing(door: Door, g: ReturnType<typeof openingGeometry>): string {
  const inward = door.swing === 'in-left' || door.swing === 'in-right';
  const leftHinge = door.swing === 'in-left' || door.swing === 'out-left';
  const leaves = door.type === 'double' ? 2 : 1;
  const leafWidth = door.width / leaves;

  // Unit vectors: `along` runs down the wall, `into` points at the swing side.
  const along =
    door.wall === 'top'
      ? { x: 1, y: 0 }
      : door.wall === 'bottom'
        ? { x: -1, y: 0 }
        : door.wall === 'right'
          ? { x: 0, y: 1 }
          : { x: 0, y: -1 };
  const outward =
    door.wall === 'top'
      ? { x: 0, y: -1 }
      : door.wall === 'bottom'
        ? { x: 0, y: 1 }
        : door.wall === 'right'
          ? { x: 1, y: 0 }
          : { x: -1, y: 0 };
  const into = inward ? { x: -outward.x, y: -outward.y } : outward;

  let out = '';
  for (let i = 0; i < leaves; i += 1) {
    // Hinge sits at the outer end of each leaf.
    const sign = leaves === 2 ? (i === 0 ? -1 : 1) : leftHinge ? -1 : 1;
    const hingeDistance = leaves === 2 ? (i === 0 ? -door.width / 2 : door.width / 2) : sign * (door.width / 2);
    const hinge = {
      x: g.centre.x + along.x * hingeDistance,
      y: g.centre.y + along.y * hingeDistance,
    };
    const openDir = { x: -along.x * sign, y: -along.y * sign };
    const tip = { x: hinge.x + into.x * leafWidth, y: hinge.y + into.y * leafWidth };
    const closed = { x: hinge.x + openDir.x * leafWidth, y: hinge.y + openDir.y * leafWidth };
    const sweep = openDir.x * into.y - openDir.y * into.x > 0 ? 1 : 0;

    out +=
      `<path d="M ${n(closed.x)} ${n(closed.y)} A ${n(leafWidth)} ${n(leafWidth)} 0 0 ${sweep} ${n(tip.x)} ${n(tip.y)}" fill="none" stroke="${DIM_COLOR}" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` +
      `<line x1="${n(hinge.x)}" y1="${n(hinge.y)}" x2="${n(tip.x)}" y2="${n(tip.y)}" stroke="${WALL_STROKE}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  return out;
}

export interface FurnitureLayerOptions {
  showLabels: boolean;
  selection: Selection | null;
  overlaps: Set<string>;
  outside: Set<string>;
  clearanceIds: Set<string>;
  scale: number;
  unit: Unit;
  presentation: boolean;
  showItemDimensions: boolean;
}

/**
 * The widest horizontal and tallest vertical line that fit through the centre
 * of a rotated rectangle. Labels are counter-rotated so they stay level on
 * screen, which means the space they have is measured in screen axes, not in
 * the item's own frame.
 */
function centreChords(width: number, height: number, rotation: number): { across: number; down: number } {
  const rad = degToRad(normalizeAngle(rotation));
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const across = Math.min(c > 1e-6 ? width / c : Infinity, s > 1e-6 ? height / s : Infinity);
  const down = Math.min(c > 1e-6 ? height / c : Infinity, s > 1e-6 ? width / s : Infinity);
  return { across, down };
}

/** Rough advance width for the UI font: good enough to decide what fits. */
function textWidth(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.58 : 0.54);
}

interface LabelOptions {
  ink: string;
  scale: number;
  unit: Unit;
  showDimensions: boolean;
}

/**
 * Draw an item's name (and optionally its size) inside the item.
 *
 * The type shrinks to fit down to a readable floor, and is dropped entirely
 * rather than spilling over the edges — a clipped "ightstan" reads as a bug,
 * and the object list already names everything for anyone who needs it.
 */
function itemLabel(item: FurnitureItem, opts: LabelOptions): string {
  const MAX_PX = 13;
  const MIN_PX = 8.5;
  const { across, down } = centreChords(item.width, item.height, item.rotation);
  const padding = Math.min(4, across * 0.08);
  const available = across - padding * 2;
  if (available <= 0) return '';

  // Largest size (in screen px) at which the name still fits.
  const wanted = MAX_PX / opts.scale;
  const namePx = Math.min(
    MAX_PX,
    (available / textWidth(item.name, 1, true)) * opts.scale,
  );
  if (namePx < MIN_PX) return '';
  const nameSize = Math.min(wanted, namePx / opts.scale);

  const dimText = `${formatLength(item.width, opts.unit, false)} × ${formatLength(item.height, opts.unit)}`;
  const dimPx = Math.min(
    MAX_PX - 2.5,
    (available / textWidth(dimText, 1)) * opts.scale,
  );
  const twoLines = opts.showDimensions && dimPx >= MIN_PX - 1 && down >= (nameSize + dimPx / opts.scale) * 1.45;
  const dimSize = dimPx / opts.scale;

  const dims = twoLines
    ? `<text x="0" y="${n(nameSize * 0.92 + dimSize * 0.1)}" text-anchor="middle" font-size="${n(dimSize)}" fill="${opts.ink}" fill-opacity="0.75" class="rp-label">${escapeXml(dimText)}</text>`
    : '';
  const nameY = twoLines ? -nameSize * 0.12 : nameSize * 0.35;

  return (
    `<g transform="rotate(${n(-item.rotation)})" class="rp-item-label" pointer-events="none">` +
    `<text x="0" y="${n(nameY)}" text-anchor="middle" font-size="${n(nameSize)}" font-weight="600" fill="${opts.ink}" class="rp-label">${escapeXml(item.name)}</text>` +
    dims +
    `</g>`
  );
}

export function renderFurniture(items: FurnitureItem[], opts: FurnitureLayerOptions): string {
  const ordered = [...items].sort((a, b) => a.z - b.z);
  let out = '';

  for (const item of ordered) {
    const selected = opts.selection?.kind === 'furniture' && opts.selection.id === item.id;
    const overlapping = opts.overlaps.has(item.id);
    const isOutside = opts.outside.has(item.id);
    const tight = opts.clearanceIds.has(item.id);

    const fill = item.color;
    const line = shade(fill, -0.45);
    const soft = shade(fill, 0.35);
    const shape = shapeMarkup(item, { w: item.width, h: item.height, fill, line, soft });

    const classes = ['rp-item'];
    if (selected) classes.push('is-selected');
    if (overlapping) classes.push('is-overlapping');
    if (isOutside) classes.push('is-outside');
    if (tight) classes.push('is-tight');

    // Warning ring follows the item's own frame so it reads as "this object".
    const warnRing =
      (overlapping || isOutside) && !opts.presentation
        ? `<rect x="${n(-item.width / 2 - 1.5)}" y="${n(-item.height / 2 - 1.5)}" width="${n(item.width + 3)}" height="${n(item.height + 3)}" rx="3" fill="none" stroke="${WARN}" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`
        : '';

    const ink = contrastInk(fill);
    const label =
      opts.showLabels && item.labelVisible
        ? itemLabel(item, {
            ink,
            scale: opts.scale,
            unit: opts.unit,
            showDimensions: opts.showItemDimensions,
          })
        : '';

    // Keyboard users tab straight to objects on the canvas; the property panel
    // then drives every edit with plain numeric inputs.
    const a11y = opts.presentation
      ? ''
      : ` tabindex="0" role="button" aria-pressed="${selected}" aria-label="${escapeXml(
          `${item.name}, ${formatLength(item.width, opts.unit, false)} by ${formatLength(item.height, opts.unit)}${
            overlapping ? ', overlapping another item' : ''
          }${isOutside ? ', outside the room' : ''}`,
        )}"`;

    out +=
      `<g class="${classes.join(' ')}" data-kind="furniture" data-id="${escapeXml(item.id)}"${a11y} ` +
      `transform="translate(${n(item.x)} ${n(item.y)}) rotate(${n(item.rotation)})">` +
      shape +
      warnRing +
      label +
      `</g>`;
  }
  return out;
}

// ------------------------------------------------------------- dimensions

function dimensionLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  scale: number,
  vertical: boolean,
): string {
  const tick = 5 / scale;
  const fontSize = 13 / scale;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const textOffset = vertical ? -6 / scale : -7 / scale;
  const rotate = vertical ? ` transform="rotate(-90 ${n(mx)} ${n(my)})"` : '';

  return (
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${DIM_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    (vertical
      ? `<line x1="${n(x1 - tick)}" y1="${n(y1)}" x2="${n(x1 + tick)}" y2="${n(y1)}" stroke="${DIM_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${n(x2 - tick)}" y1="${n(y2)}" x2="${n(x2 + tick)}" y2="${n(y2)}" stroke="${DIM_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      : `<line x1="${n(x1)}" y1="${n(y1 - tick)}" x2="${n(x1)}" y2="${n(y1 + tick)}" stroke="${DIM_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${n(x2)}" y1="${n(y2 - tick)}" x2="${n(x2)}" y2="${n(y2 + tick)}" stroke="${DIM_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke"/>`) +
    `<text x="${n(mx)}" y="${n(my + textOffset)}" text-anchor="middle" font-size="${n(fontSize)}" fill="${DIM_COLOR}" font-weight="600" class="rp-label"${rotate}>${escapeXml(label)}</text>`
  );
}

export function renderDimensions(room: Room, scale: number): string {
  const gap = Math.max(room.wallThickness + 14 / scale, 12);
  const width = dimensionLine(
    0,
    -gap,
    room.width,
    -gap,
    formatLength(room.width, room.unit),
    scale,
    false,
  );
  const height = dimensionLine(
    -gap,
    0,
    -gap,
    room.height,
    formatLength(room.height, room.unit),
    scale,
    true,
  );
  return `<g class="rp-dimensions" pointer-events="none">${width}${height}</g>`;
}

// ---------------------------------------------------------------- overlay

export interface OverlayOptions {
  scale: number;
  unit: Unit;
  selection: Selection | null;
  state: PlannerState;
  measure: MeasureLine | null;
  measureDraft: MeasureLine | null;
  presentation: boolean;
  showClearance: boolean;
}

/** Handle ids match the resize logic in the controller. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLES)[number];

export function renderOverlay(opts: OverlayOptions): string {
  if (opts.presentation) return renderMeasure(opts.measure, opts.scale, opts.unit);

  let out = '';

  if (opts.showClearance) out += renderClearanceRings(opts.state, opts.scale);

  const sel = opts.selection;
  if (sel?.kind === 'furniture') {
    const item = opts.state.furniture.find((f) => f.id === sel.id);
    if (item) out += renderSelectionFrame(item, opts.scale, opts.unit, opts.state.room);
  }

  out += renderMeasure(opts.measure, opts.scale, opts.unit);
  out += renderMeasure(opts.measureDraft, opts.scale, opts.unit, true);
  return out;
}

function renderSelectionFrame(item: FurnitureItem, scale: number, unit: Unit, room: Room): string {
  const hw = item.width / 2;
  const hh = item.height / 2;
  const size = 9 / scale;
  const half = size / 2;
  const pad = 2 / scale;

  const positions: Record<HandleId, { x: number; y: number }> = {
    nw: { x: -hw, y: -hh },
    n: { x: 0, y: -hh },
    ne: { x: hw, y: -hh },
    e: { x: hw, y: 0 },
    se: { x: hw, y: hh },
    s: { x: 0, y: hh },
    sw: { x: -hw, y: hh },
    w: { x: -hw, y: 0 },
  };

  let handles = '';
  for (const id of HANDLES) {
    const p = positions[id]!;
    handles += `<rect class="rp-handle" data-handle="${id}" x="${n(p.x - half)}" y="${n(p.y - half)}" width="${n(size)}" height="${n(size)}" rx="${n(half * 0.4)}"/>`;
  }

  const rotateDistance = hh + 26 / scale;
  const rotateR = 6 / scale;
  const rotate =
    `<line x1="0" y1="${n(-hh)}" x2="0" y2="${n(-rotateDistance)}" stroke="${ACCENT}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` +
    `<circle class="rp-handle rp-handle-rotate" data-handle="rotate" cx="0" cy="${n(-rotateDistance)}" r="${n(rotateR)}"/>`;

  // Live distances to the nearest walls, the number people actually want.
  const bounds = itemBounds(item);
  const gaps = [
    { v: bounds.y, x: item.x, y: bounds.y / 2, vertical: false },
    { v: room.height - (bounds.y + bounds.height), x: item.x, y: bounds.y + bounds.height + (room.height - bounds.y - bounds.height) / 2, vertical: false },
    { v: bounds.x, x: bounds.x / 2, y: item.y, vertical: true },
    { v: room.width - (bounds.x + bounds.width), x: bounds.x + bounds.width + (room.width - bounds.x - bounds.width) / 2, y: item.y, vertical: true },
  ];
  const fontSize = 11 / scale;
  let gapLabels = '';
  for (const gap of gaps) {
    if (gap.v < 3 || gap.v > Math.max(room.width, room.height)) continue;
    gapLabels += `<text x="${n(gap.x)}" y="${n(gap.y + fontSize * 0.35)}" text-anchor="middle" font-size="${n(fontSize)}" class="rp-label rp-gap-label">${escapeXml(formatLengthFriendly(gap.v, unit))}</text>`;
  }

  return (
    `<g class="rp-selection" pointer-events="none">${gapLabels}</g>` +
    `<g class="rp-selection-frame" transform="translate(${n(item.x)} ${n(item.y)}) rotate(${n(item.rotation)})">` +
    `<rect x="${n(-hw - pad)}" y="${n(-hh - pad)}" width="${n(item.width + pad * 2)}" height="${n(item.height + pad * 2)}" fill="none" stroke="${ACCENT}" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
    rotate +
    handles +
    `</g>`
  );
}

function renderClearanceRings(state: PlannerState, scale: number): string {
  const ring = RECOMMENDED_CLEARANCE;
  let out = '';
  for (const item of state.furniture) {
    if (item.decorative) continue;
    out += `<rect x="${n(item.x - item.width / 2 - ring)}" y="${n(item.y - item.height / 2 - ring)}" width="${n(item.width + ring * 2)}" height="${n(item.height + ring * 2)}" rx="${n(ring)}" transform="rotate(${n(item.rotation)} ${n(item.x)} ${n(item.y)})" fill="none" stroke="${ACCENT}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>`;
  }
  void scale;
  return `<g class="rp-clearance" pointer-events="none">${out}</g>`;
}

function renderMeasure(line: MeasureLine | null, scale: number, unit: Unit, draft = false): string {
  if (!line) return '';
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy);
  const mx = (line.a.x + line.b.x) / 2;
  const my = (line.a.y + line.b.y) / 2;
  const dot = 4 / scale;
  const fontSize = 13 / scale;
  const padX = 6 / scale;
  const padY = 4 / scale;
  const text = formatLengthFriendly(length, unit);
  const boxWidth = (text.length * 7.2 + 12) / scale;
  const boxHeight = fontSize + padY * 2;

  return (
    `<g class="rp-measure${draft ? ' is-draft' : ''}" pointer-events="none">` +
    `<line x1="${n(line.a.x)}" y1="${n(line.a.y)}" x2="${n(line.b.x)}" y2="${n(line.b.y)}" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="${draft ? '6 4' : '0'}" vector-effect="non-scaling-stroke"/>` +
    `<circle cx="${n(line.a.x)}" cy="${n(line.a.y)}" r="${n(dot)}" fill="${ACCENT}"/>` +
    `<circle cx="${n(line.b.x)}" cy="${n(line.b.y)}" r="${n(dot)}" fill="${ACCENT}"/>` +
    `<rect x="${n(mx - boxWidth / 2)}" y="${n(my - boxHeight / 2)}" width="${n(boxWidth)}" height="${n(boxHeight)}" rx="${n(3 / scale)}" fill="#FFFFFF" stroke="${ACCENT}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    `<text x="${n(mx)}" y="${n(my + fontSize * 0.35)}" text-anchor="middle" font-size="${n(fontSize)}" font-weight="600" fill="${shade(ACCENT, -0.25)}" class="rp-label">${escapeXml(text)}</text>` +
    `</g>` +
    (padX ? '' : '')
  );
}

// ------------------------------------------------------------ whole scene

export interface SceneLayers {
  floor: string;
  grid: string;
  walls: string;
  openings: string;
  furniture: string;
  dimensions: string;
  overlay: string;
}

export function renderScene(input: RenderInput): SceneLayers {
  const { state, viewport } = input;
  const presentation = input.presentation ?? false;
  const selectedOpeningId =
    input.selection && input.selection.kind !== 'furniture' ? input.selection.id : null;

  return {
    floor: renderFloor(state.room),
    grid: presentation ? '' : renderGrid(state.room, state.settings.grid, viewport.scale),
    walls: renderWalls(state.room),
    openings:
      renderWindows(state.room, state.windows, selectedOpeningId) +
      renderDoors(state.room, state.doors, selectedOpeningId),
    furniture: renderFurniture(state.furniture, {
      showLabels: state.settings.showLabels,
      selection: input.selection,
      overlaps: input.overlaps,
      outside: input.outside,
      clearanceIds: input.clearanceIds ?? new Set(),
      scale: viewport.scale,
      unit: state.room.unit,
      presentation,
      showItemDimensions: state.settings.showDimensions,
    }),
    dimensions: state.settings.showDimensions ? renderDimensions(state.room, viewport.scale) : '',
    overlay: renderOverlay({
      scale: viewport.scale,
      unit: state.room.unit,
      selection: input.selection,
      state,
      measure: input.measure,
      measureDraft: input.measureDraft,
      presentation,
      showClearance: state.settings.showClearance,
    }),
  };
}

/**
 * A standalone, self-contained SVG document for export and print.
 * Uses explicit fonts and no CSS classes so it renders identically anywhere.
 */
export function buildStandaloneSvg(
  state: PlannerState,
  options: { width?: number; showLabels?: boolean; title?: string } = {},
): string {
  const room = state.room;
  const margin = Math.max(56, Math.max(room.width, room.height) * 0.14);
  const legendHeight = 54;
  const contentWidth = room.width + margin * 2;
  const contentHeight = room.height + margin * 2 + legendHeight;

  const pixelWidth = options.width ?? 1600;
  const scale = pixelWidth / contentWidth;
  const pixelHeight = Math.round(contentHeight * scale);

  const showLabels = options.showLabels ?? state.settings.showLabels;
  const exportState: PlannerState = {
    ...state,
    settings: { ...state.settings, showLabels, grid: 'off', showClearance: false },
  };

  const layers = renderScene({
    state: exportState,
    viewport: { scale, tx: 0, ty: 0 },
    selection: null,
    overlaps: new Set(),
    outside: new Set(),
    measure: null,
    measureDraft: null,
    presentation: true,
  });

  const title = options.title ?? room.name;
  const subtitle = `${formatLength(room.width, room.unit)} × ${formatLength(room.height, room.unit)}`;
  const legendY = room.height + margin * 0.75;
  const fontSize = 15 / scale;
  const smallSize = 12 / scale;

  const legend =
    `<text x="0" y="${n(legendY + fontSize)}" font-size="${n(fontSize * 1.25)}" font-weight="700" fill="#2F2B27">${escapeXml(title)}</text>` +
    `<text x="0" y="${n(legendY + fontSize * 2.6)}" font-size="${n(smallSize)}" fill="#6B635A">${escapeXml(subtitle)} · ${escapeXml(
      `${state.furniture.length} items`,
    )} · Made with Room Planner</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${n(contentWidth)} ${n(contentHeight)}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">` +
    `<rect x="0" y="0" width="${n(contentWidth)}" height="${n(contentHeight)}" fill="#FFFFFF"/>` +
    `<g transform="translate(${n(margin)} ${n(margin)})">` +
    layers.floor +
    layers.walls +
    layers.openings +
    layers.furniture +
    layers.dimensions +
    legend +
    `</g>` +
    `</svg>`
  );
}

/** Zoom that makes the whole room (plus dimension margin) fit a viewport. */
export function fitViewport(room: Room, viewWidth: number, viewHeight: number, padding = 56): Viewport {
  const contentWidth = room.width + room.wallThickness * 2;
  const contentHeight = room.height + room.wallThickness * 2;
  const available = {
    w: Math.max(40, viewWidth - padding * 2),
    h: Math.max(40, viewHeight - padding * 2),
  };
  const scale = Math.min(available.w / contentWidth, available.h / contentHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    scale: safeScale,
    tx: viewWidth / 2 - (room.width / 2) * safeScale,
    ty: viewHeight / 2 - (room.height / 2) * safeScale,
  };
}

export { GRID_INCHES, wallSegment };
