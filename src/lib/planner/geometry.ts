/**
 * Pure geometry helpers. No DOM, no state — everything here is testable.
 * All lengths are inches, all angles are degrees clockwise unless noted.
 */

import type { FurnitureItem, Rect, Room, Vec2, Wall } from './types';

export const DEG = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG;
}

/** Normalise any angle into [0, 360). */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const value = deg % 360;
  return value < 0 ? value + 360 : value;
}

export function rotatePoint(point: Vec2, origin: Vec2, deg: number): Vec2 {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/** The four corners of an item's rotated footprint, clockwise from top-left. */
export function itemCorners(item: Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Vec2[] {
  const hw = item.width / 2;
  const hh = item.height / 2;
  const centre = { x: item.x, y: item.y };
  const local: Vec2[] = [
    { x: item.x - hw, y: item.y - hh },
    { x: item.x + hw, y: item.y - hh },
    { x: item.x + hw, y: item.y + hh },
    { x: item.x - hw, y: item.y + hh },
  ];
  if (normalizeAngle(item.rotation) === 0) return local;
  return local.map((p) => rotatePoint(p, centre, item.rotation));
}

/** Axis-aligned bounding box of a rotated item. */
export function itemBounds(item: Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Rect {
  const corners = itemCorners(item);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The interior floor rectangle of a room. */
export function roomRect(room: Pick<Room, 'width' | 'height'>): Rect {
  return { x: 0, y: 0, width: room.width, height: room.height };
}

export function roomArea(room: Pick<Room, 'width' | 'height'>): number {
  return room.width * room.height;
}

export function roomPerimeter(room: Pick<Room, 'width' | 'height'>): number {
  return 2 * (room.width + room.height);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function rectsIntersect(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + a.width > b.x + tolerance &&
    b.x + b.width > a.x + tolerance &&
    a.y + a.height > b.y + tolerance &&
    b.y + b.height > a.y + tolerance
  );
}

/** True when `inner` sits completely inside `outer` (small tolerance forgives float fuzz). */
export function rectContains(outer: Rect, inner: Rect, tolerance = 0.01): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** Gap from each wall to the item's bounding box. Negative means it pokes through. */
export function wallGaps(
  item: Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  room: Pick<Room, 'width' | 'height'>,
): Record<Wall, number> {
  const b = itemBounds(item);
  return {
    top: b.y,
    left: b.x,
    right: room.width - (b.x + b.width),
    bottom: room.height - (b.y + b.height),
  };
}

/** Start and end points of a wall, walking the room clockwise from the top-left. */
export function wallSegment(room: Pick<Room, 'width' | 'height'>, wall: Wall): { a: Vec2; b: Vec2 } {
  switch (wall) {
    case 'top':
      return { a: { x: 0, y: 0 }, b: { x: room.width, y: 0 } };
    case 'right':
      return { a: { x: room.width, y: 0 }, b: { x: room.width, y: room.height } };
    case 'bottom':
      return { a: { x: room.width, y: room.height }, b: { x: 0, y: room.height } };
    case 'left':
      return { a: { x: 0, y: room.height }, b: { x: 0, y: 0 } };
  }
}

export function wallLength(room: Pick<Room, 'width' | 'height'>, wall: Wall): number {
  return wall === 'top' || wall === 'bottom' ? room.width : room.height;
}

/** Point at `offset` inches along a wall, measured from the wall's start corner. */
export function pointOnWall(room: Pick<Room, 'width' | 'height'>, wall: Wall, offset: number): Vec2 {
  const { a, b } = wallSegment(room, wall);
  const len = distance(a, b) || 1;
  const t = offset / len;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Outward-facing unit normal of a wall (points away from the room interior). */
export function wallNormal(wall: Wall): Vec2 {
  switch (wall) {
    case 'top':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 1, y: 0 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
  }
}

/**
 * Smallest bounding box an item occupies when rotated by `deg`.
 * Used by the diagonal fit check.
 */
export function rotatedExtent(width: number, height: number, deg: number): { width: number; height: number } {
  const rad = degToRad(deg);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

export interface FitResult {
  fitsUpright: boolean;
  fitsRotated: boolean;
  /** True when some rotation between 0 and 90 degrees lets it sit inside the room. */
  fitsDiagonally: boolean;
  /** The angle that works diagonally, if any. */
  diagonalAngle: number | null;
  fits: boolean;
}

/**
 * Can an item of `width` x `height` sit inside a `roomWidth` x `roomHeight` room?
 * Checks the two axis-aligned orientations plus a swept diagonal search, which
 * matters for long items such as sofas in narrow rooms.
 */
export function checkFitsInRoom(
  width: number,
  height: number,
  roomWidth: number,
  roomHeight: number,
): FitResult {
  const tol = 0.01;
  const fitsUpright = width <= roomWidth + tol && height <= roomHeight + tol;
  const fitsRotated = height <= roomWidth + tol && width <= roomHeight + tol;

  let diagonalAngle: number | null = null;
  if (!fitsUpright && !fitsRotated) {
    // Sweep in half-degree steps; the extent function is smooth so this is ample.
    for (let deg = 0.5; deg < 90; deg += 0.5) {
      const ext = rotatedExtent(width, height, deg);
      if (ext.width <= roomWidth + tol && ext.height <= roomHeight + tol) {
        diagonalAngle = deg;
        break;
      }
    }
  }

  return {
    fitsUpright,
    fitsRotated,
    fitsDiagonally: diagonalAngle !== null,
    diagonalAngle,
    fits: fitsUpright || fitsRotated || diagonalAngle !== null,
  };
}

/**
 * Will an item pass through an opening of `doorWidth`?
 * A 2D planner can only speak to the narrow cross-section: the item must be
 * able to present its smaller face to the opening.
 */
export function fitsThroughOpening(width: number, height: number, doorWidth: number): boolean {
  return Math.min(width, height) <= doorWidth + 0.01;
}
