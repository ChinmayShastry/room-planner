/**
 * Grid and wall snapping.
 *
 * Snapping aligns an item's bounding-box EDGES to the grid rather than its
 * centre. Lining the edge of a wardrobe up with a grid line is what people
 * expect; a centre-snapped item with an odd width would sit half a unit off.
 */

import { itemBounds } from './geometry';
import type { FurnitureItem, GridSize, Room, Vec2 } from './types';

/** Grid spacing in inches. */
export const GRID_INCHES: Record<GridSize, number> = {
  off: 0,
  fine: 1,
  medium: 6,
  large: 12,
};

export const GRID_LABEL: Record<GridSize, string> = {
  off: 'Off',
  fine: 'Fine (1 in)',
  medium: 'Medium (6 in)',
  large: 'Large (1 ft)',
};

/** How close (inches) an edge must be to a wall before it snaps flush. */
export const WALL_SNAP_DISTANCE = 5;

export function snapValue(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export interface SnapContext {
  enabled: boolean;
  grid: GridSize;
  room: Pick<Room, 'width' | 'height'>;
}

type Placed = Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

export interface SnapResult {
  x: number;
  y: number;
  /** Which walls the item snapped flush against, for the drag hint UI. */
  snappedWalls: Array<'top' | 'right' | 'bottom' | 'left'>;
}

/**
 * Snap a proposed centre position.
 *
 * Walls win over the grid: if an edge is within WALL_SNAP_DISTANCE of a wall we
 * push it flush, because "against the wall" is the single most common intent in
 * a room layout and a 1 in grid offset there looks like a mistake.
 */
export function snapPosition(item: Placed, desired: Vec2, ctx: SnapContext): SnapResult {
  const snappedWalls: SnapResult['snappedWalls'] = [];
  if (!ctx.enabled) return { x: desired.x, y: desired.y, snappedWalls };

  const bounds = itemBounds({ ...item, x: desired.x, y: desired.y });
  // Offset from the desired centre to the bounding-box origin.
  const offsetX = bounds.x - desired.x;
  const offsetY = bounds.y - desired.y;

  const step = GRID_INCHES[ctx.grid];
  let left = bounds.x;
  let top = bounds.y;

  if (step > 0) {
    left = snapValue(left, step);
    top = snapValue(top, step);
  }

  const right = left + bounds.width;
  const bottom = top + bounds.height;

  if (Math.abs(bounds.x) <= WALL_SNAP_DISTANCE) {
    left = 0;
    snappedWalls.push('left');
  } else if (Math.abs(ctx.room.width - (bounds.x + bounds.width)) <= WALL_SNAP_DISTANCE) {
    left = ctx.room.width - bounds.width;
    snappedWalls.push('right');
  }

  if (Math.abs(bounds.y) <= WALL_SNAP_DISTANCE) {
    top = 0;
    snappedWalls.push('top');
  } else if (Math.abs(ctx.room.height - (bounds.y + bounds.height)) <= WALL_SNAP_DISTANCE) {
    top = ctx.room.height - bounds.height;
    snappedWalls.push('bottom');
  }

  void right;
  void bottom;

  return { x: left - offsetX, y: top - offsetY, snappedWalls };
}

/** Snap a size to the grid, never dropping below `min`. */
export function snapSize(value: number, ctx: SnapContext, min: number): number {
  if (!ctx.enabled) return Math.max(min, value);
  const step = GRID_INCHES[ctx.grid];
  if (step <= 0) return Math.max(min, value);
  return Math.max(min, snapValue(value, step));
}

/** Rotation snaps to 15 degree increments while dragging the rotate handle. */
export function snapAngle(deg: number, step = 15): number {
  return snapValue(deg, step);
}

/**
 * Choose a sensible grid spacing for the current zoom so the canvas never
 * renders thousands of hairlines. Returns 0 when the grid should be hidden.
 */
export function effectiveGridStep(grid: GridSize, pixelsPerInch: number): number {
  const base = GRID_INCHES[grid];
  if (base <= 0) return 0;
  let step = base;
  // Keep grid lines at least 6 screen pixels apart.
  while (step * pixelsPerInch < 6 && step < 1200) step *= 2;
  return step;
}
