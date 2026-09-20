import { describe, expect, it } from 'vitest';
import {
  checkFitsInRoom,
  fitsThroughOpening,
  itemBounds,
  itemCorners,
  normalizeAngle,
  pointOnWall,
  rectContains,
  rotatedExtent,
  roomArea,
  roomPerimeter,
  wallGaps,
} from '@lib/planner/geometry';

const item = (over: Partial<{ x: number; y: number; width: number; height: number; rotation: number }> = {}) => ({
  x: 50,
  y: 50,
  width: 40,
  height: 20,
  rotation: 0,
  ...over,
});

describe('angles', () => {
  it('normalises into 0-360', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});

describe('item geometry', () => {
  it('returns four corners', () => {
    expect(itemCorners(item())).toHaveLength(4);
  });

  it('bounds an unrotated item exactly', () => {
    expect(itemBounds(item())).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('swaps width and height at 90 degrees', () => {
    const bounds = itemBounds(item({ rotation: 90 }));
    expect(bounds.width).toBeCloseTo(20, 6);
    expect(bounds.height).toBeCloseTo(40, 6);
    // Rotation happens about the centre, so the centre is unchanged.
    expect(bounds.x + bounds.width / 2).toBeCloseTo(50, 6);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(50, 6);
  });

  it('grows the bounding box at 45 degrees', () => {
    const bounds = itemBounds(item({ rotation: 45 }));
    const expected = (40 + 20) * Math.SQRT1_2;
    expect(bounds.width).toBeCloseTo(expected, 6);
    expect(bounds.height).toBeCloseTo(expected, 6);
  });

  it('is unchanged by a full turn', () => {
    expect(itemBounds(item({ rotation: 360 }))).toEqual(itemBounds(item()));
  });
});

describe('room maths', () => {
  const room = { width: 144, height: 168 }; // 12 x 14 ft

  it('computes area', () => {
    expect(roomArea(room)).toBe(144 * 168);
  });

  it('computes perimeter', () => {
    expect(roomPerimeter(room)).toBe(624); // 52 ft
  });

  it('reports wall gaps', () => {
    const gaps = wallGaps(item({ x: 50, y: 50, width: 40, height: 20 }), room);
    expect(gaps.left).toBe(30);
    expect(gaps.top).toBe(40);
    expect(gaps.right).toBe(144 - 70);
    expect(gaps.bottom).toBe(168 - 60);
  });

  it('walks the walls clockwise from the top-left', () => {
    expect(pointOnWall(room, 'top', 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnWall(room, 'top', 144)).toEqual({ x: 144, y: 0 });
    expect(pointOnWall(room, 'bottom', 0)).toEqual({ x: 144, y: 168 });
    expect(pointOnWall(room, 'left', 0)).toEqual({ x: 0, y: 168 });
  });

  it('detects containment', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(
      true,
    );
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 10, width: 20, height: 20 })).toBe(
      false,
    );
  });
});

describe('fit checking', () => {
  it('fits a queen bed in a 12x14 ft bedroom', () => {
    const result = checkFitsInRoom(60, 80, 144, 168);
    expect(result.fitsUpright).toBe(true);
    expect(result.fits).toBe(true);
  });

  it('detects that only the rotated orientation works', () => {
    // 100 in long item in a room that is 80 wide and 120 deep.
    const result = checkFitsInRoom(100, 30, 80, 120);
    expect(result.fitsUpright).toBe(false);
    expect(result.fitsRotated).toBe(true);
    expect(result.fits).toBe(true);
  });

  it('finds a diagonal fit when neither axis works', () => {
    // 110 long, 10 deep, in a 100 x 100 room: only a diagonal works.
    const result = checkFitsInRoom(110, 10, 100, 100);
    expect(result.fitsUpright).toBe(false);
    expect(result.fitsRotated).toBe(false);
    expect(result.fitsDiagonally).toBe(true);
    expect(result.diagonalAngle).toBeGreaterThan(0);
    expect(result.diagonalAngle).toBeLessThan(90);
  });

  it('reports a genuine non-fit', () => {
    const result = checkFitsInRoom(200, 200, 100, 100);
    expect(result.fits).toBe(false);
    expect(result.diagonalAngle).toBeNull();
  });

  it('treats an exact fit as fitting', () => {
    expect(checkFitsInRoom(100, 100, 100, 100).fitsUpright).toBe(true);
  });

  it('measures rotated extent', () => {
    const ext = rotatedExtent(40, 20, 90);
    expect(ext.width).toBeCloseTo(20, 6);
    expect(ext.height).toBeCloseTo(40, 6);
  });
});

describe('doorway checking', () => {
  it('passes when the narrow face clears the opening', () => {
    // A 7 ft sofa that is 3 ft deep goes through a 3 ft 2 in door.
    expect(fitsThroughOpening(84, 36, 38)).toBe(true);
  });

  it('fails when even the narrow face is too wide', () => {
    expect(fitsThroughOpening(84, 36, 30)).toBe(false);
  });

  it('allows an exact fit', () => {
    expect(fitsThroughOpening(84, 36, 36)).toBe(true);
  });
});
