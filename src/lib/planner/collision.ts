/**
 * Overlap, boundary and walking-clearance analysis.
 *
 * Nothing here ever moves an object. The planner deliberately lets people
 * overlap things on purpose (a rug under a table, a chair tucked into a desk);
 * these functions only produce advisory warnings for the UI.
 */

import { itemBounds, itemCorners, normalizeAngle, pointOnWall, roomRect } from './geometry';
import type { Door, FurnitureItem, Rect, Room, Vec2, Wall } from './types';

/** Recommended walking clearance in inches. A planning guideline, not a code. */
export const RECOMMENDED_CLEARANCE = 36;
/** Below this a gap is treated as "not a walkway" rather than a tight walkway. */
export const MIN_PASSAGE_DEPTH = 12;

function project(corners: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const dot = c.x * axis.x + c.y * axis.y;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return { min, max };
}

function edgeAxes(corners: Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < 2; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    axes.push({ x: -ey / len, y: ex / len });
  }
  return axes;
}

type Placed = Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/**
 * Separating-axis test for two rotated rectangles.
 * `tolerance` in inches lets items touch without being flagged.
 */
export function itemsOverlap(a: Placed, b: Placed, tolerance = 0.5): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;

  // Cheap rejection first - most pairs are nowhere near each other.
  const ba = itemBounds(a);
  const bb = itemBounds(b);
  if (
    ba.x + ba.width <= bb.x + tolerance ||
    bb.x + bb.width <= ba.x + tolerance ||
    ba.y + ba.height <= bb.y + tolerance ||
    bb.y + bb.height <= ba.y + tolerance
  ) {
    return false;
  }

  // Axis-aligned pairs are fully settled by the bounds test above.
  if (normalizeAngle(a.rotation) % 90 === 0 && normalizeAngle(b.rotation) % 90 === 0) return true;

  const ca = itemCorners(a);
  const cb = itemCorners(b);
  const axes = [...edgeAxes(ca), ...edgeAxes(cb)];
  for (const axis of axes) {
    const pa = project(ca, axis);
    const pb = project(cb, axis);
    if (pa.max <= pb.min + tolerance || pb.max <= pa.min + tolerance) return false;
  }
  return true;
}

export interface OverlapReport {
  /** Ids of every item involved in at least one overlap. */
  ids: Set<string>;
  pairs: Array<[string, string]>;
}

/** Decorative items (rugs, plants) are expected to sit under things, so they are skipped. */
export function findOverlaps(items: FurnitureItem[]): OverlapReport {
  const ids = new Set<string>();
  const pairs: Array<[string, string]> = [];
  const solid = items.filter((i) => !i.decorative);
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i]!;
      const b = solid[j]!;
      if (itemsOverlap(a, b)) {
        ids.add(a.id);
        ids.add(b.id);
        pairs.push([a.id, b.id]);
      }
    }
  }
  return { ids, pairs };
}

export type BoundaryState = 'inside' | 'partial' | 'outside';

export function boundaryState(item: Placed, room: Pick<Room, 'width' | 'height'>): BoundaryState {
  const b = itemBounds(item);
  const tol = 0.01;
  const fullyInside =
    b.x >= -tol && b.y >= -tol && b.x + b.width <= room.width + tol && b.y + b.height <= room.height + tol;
  if (fullyInside) return 'inside';
  const noOverlap =
    b.x + b.width <= tol || b.y + b.height <= tol || b.x >= room.width - tol || b.y >= room.height - tol;
  return noOverlap ? 'outside' : 'partial';
}

/** Ids of every item that is not completely inside the room. */
export function findOutside(items: FurnitureItem[], room: Pick<Room, 'width' | 'height'>): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (boundaryState(item, room) !== 'inside') ids.add(item.id);
  }
  return ids;
}

/**
 * The floor area a door needs to swing into, approximated as a square of the
 * door's width sitting just inside the wall. Sliding doors and open doorways
 * need none, and outward swings use the space on the far side of the wall.
 */
export function doorClearanceZone(room: Pick<Room, 'width' | 'height'>, door: Door): Rect | null {
  if (door.type === 'sliding' || door.type === 'opening') return null;
  if (door.swing === 'out-left' || door.swing === 'out-right') return null;

  const centre = pointOnWall(room, door.wall, door.offset);
  const depth = door.width;
  const half = door.width / 2;

  switch (door.wall) {
    case 'top':
      return { x: centre.x - half, y: centre.y, width: door.width, height: depth };
    case 'bottom':
      return { x: centre.x - half, y: centre.y - depth, width: door.width, height: depth };
    case 'left':
      return { x: centre.x, y: centre.y - half, width: depth, height: door.width };
    case 'right':
      return { x: centre.x - depth, y: centre.y - half, width: depth, height: door.width };
  }
}

export interface ClearanceIssue {
  kind: 'gap' | 'door' | 'wall';
  message: string;
  itemIds: string[];
  gap: number;
}

export interface ClearanceReport {
  recommended: number;
  /** Narrowest real walkway found, or null when nothing forms a passage. */
  narrowest: number | null;
  issues: ClearanceIssue[];
  /** Share of the floor left open, 0-1. */
  freeFloorRatio: number;
  ok: boolean;
}

interface Span {
  start: number;
  end: number;
}

function overlapLength(a: Span, b: Span): number {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

/**
 * Estimate walking space using axis-aligned bounding boxes.
 *
 * A "passage" is a gap between two objects (or an object and a wall) that you
 * would actually have to walk through: the two sides must face each other over
 * at least MIN_PASSAGE_DEPTH inches. A narrow sliver beside a wardrobe is not
 * reported, because nobody walks there.
 */
export function computeClearance(
  items: FurnitureItem[],
  room: Pick<Room, 'width' | 'height'>,
  recommended = RECOMMENDED_CLEARANCE,
  doors: Door[] = [],
): ClearanceReport {
  const solid = items.filter((i) => !i.decorative);
  const boxes = solid.map((item) => ({ item, box: itemBounds(item) }));
  const issues: ClearanceIssue[] = [];
  let narrowest: number | null = null;

  const consider = (gap: number, makeIssue: () => ClearanceIssue) => {
    if (gap <= 0) return;
    if (narrowest === null || gap < narrowest) narrowest = gap;
    if (gap < recommended) issues.push(makeIssue());
  };

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const xSpanA: Span = { start: a.box.x, end: a.box.x + a.box.width };
      const xSpanB: Span = { start: b.box.x, end: b.box.x + b.box.width };
      const ySpanA: Span = { start: a.box.y, end: a.box.y + a.box.height };
      const ySpanB: Span = { start: b.box.y, end: b.box.y + b.box.height };

      // Side by side: is the face-to-face overlap deep enough to be a walkway?
      if (overlapLength(ySpanA, ySpanB) >= MIN_PASSAGE_DEPTH) {
        const gap = Math.max(xSpanB.start - xSpanA.end, xSpanA.start - xSpanB.end);
        consider(gap, () => ({
          kind: 'gap',
          gap,
          itemIds: [a.item.id, b.item.id],
          message: `${a.item.name} and ${b.item.name}`,
        }));
      }
      if (overlapLength(xSpanA, xSpanB) >= MIN_PASSAGE_DEPTH) {
        const gap = Math.max(ySpanB.start - ySpanA.end, ySpanA.start - ySpanB.end);
        consider(gap, () => ({
          kind: 'gap',
          gap,
          itemIds: [a.item.id, b.item.id],
          message: `${a.item.name} and ${b.item.name}`,
        }));
      }
    }
  }

  // Gaps between furniture and the facing wall, only where a walkway makes sense.
  const wallLabel: Record<Wall, string> = { top: 'top', right: 'right', bottom: 'bottom', left: 'left' };
  for (const { item, box } of boxes) {
    const checks: Array<{ wall: Wall; gap: number; depth: number }> = [
      { wall: 'left', gap: box.x, depth: box.height },
      { wall: 'right', gap: room.width - (box.x + box.width), depth: box.height },
      { wall: 'top', gap: box.y, depth: box.width },
      { wall: 'bottom', gap: room.height - (box.y + box.height), depth: box.width },
    ];
    for (const check of checks) {
      if (check.depth < MIN_PASSAGE_DEPTH) continue;
      consider(check.gap, () => ({
        kind: 'wall',
        gap: check.gap,
        itemIds: [item.id],
        message: `${item.name} and the ${wallLabel[check.wall]} wall`,
      }));
    }
  }

  // Anything parked in a door's swing area.
  for (const door of doors) {
    const zone = doorClearanceZone(room, door);
    if (!zone) continue;
    for (const { item, box } of boxes) {
      const intersects =
        box.x < zone.x + zone.width &&
        zone.x < box.x + box.width &&
        box.y < zone.y + zone.height &&
        zone.y < box.y + box.height;
      if (intersects) {
        issues.push({
          kind: 'door',
          gap: 0,
          itemIds: [item.id],
          message: `${item.name} blocks the ${door.name.toLowerCase()}`,
        });
      }
    }
  }

  const floor = roomRect(room);
  const floorArea = floor.width * floor.height || 1;
  const usedArea = boxes.reduce((sum, b) => sum + Math.max(0, b.item.width * b.item.height), 0);
  const freeFloorRatio = Math.max(0, Math.min(1, 1 - usedArea / floorArea));

  return {
    recommended,
    narrowest,
    issues,
    freeFloorRatio,
    ok: issues.length === 0,
  };
}
