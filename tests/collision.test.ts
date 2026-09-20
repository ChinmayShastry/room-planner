import { describe, expect, it } from 'vitest';
import {
  boundaryState,
  computeClearance,
  doorClearanceZone,
  findOutside,
  findOverlaps,
  itemsOverlap,
  RECOMMENDED_CLEARANCE,
} from '@lib/planner/collision';
import type { Door, FurnitureItem } from '@lib/planner/types';

function make(over: Partial<FurnitureItem> & { id: string }): FurnitureItem {
  return {
    type: 'box',
    name: 'Item',
    shape: 'box',
    category: 'other',
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    rotation: 0,
    color: '#CBBBA6',
    labelVisible: true,
    decorative: false,
    z: 1,
    ...over,
  };
}

const room = { width: 144, height: 168 };

describe('overlap detection', () => {
  it('detects clearly overlapping items', () => {
    const a = make({ id: 'a', x: 50, y: 50 });
    const b = make({ id: 'b', x: 60, y: 60 });
    expect(itemsOverlap(a, b)).toBe(true);
  });

  it('leaves separated items alone', () => {
    const a = make({ id: 'a', x: 20, y: 20 });
    const b = make({ id: 'b', x: 100, y: 100 });
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('does not flag items that merely touch', () => {
    const a = make({ id: 'a', x: 20, y: 20, width: 40, height: 40 });
    const b = make({ id: 'b', x: 60, y: 20, width: 40, height: 40 });
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('handles rotated items via the separating-axis test', () => {
    // Two long thin bars crossing at 90 degrees definitely overlap.
    const a = make({ id: 'a', x: 50, y: 50, width: 80, height: 4, rotation: 45 });
    const b = make({ id: 'b', x: 50, y: 50, width: 80, height: 4, rotation: 135 });
    expect(itemsOverlap(a, b)).toBe(true);
  });

  it('separates rotated items that clear each other', () => {
    const a = make({ id: 'a', x: 20, y: 20, width: 20, height: 20, rotation: 30 });
    const b = make({ id: 'b', x: 120, y: 120, width: 20, height: 20, rotation: 30 });
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('ignores decorative items such as rugs', () => {
    const rug = make({ id: 'rug', x: 50, y: 50, width: 96, height: 60, decorative: true });
    const table = make({ id: 'table', x: 50, y: 50, width: 40, height: 20 });
    const report = findOverlaps([rug, table]);
    expect(report.ids.size).toBe(0);
  });

  it('collects every id involved in an overlap', () => {
    const a = make({ id: 'a', x: 50, y: 50 });
    const b = make({ id: 'b', x: 60, y: 50 });
    const c = make({ id: 'c', x: 130, y: 150, width: 10, height: 10 });
    const report = findOverlaps([a, b, c]);
    expect([...report.ids].sort()).toEqual(['a', 'b']);
    expect(report.pairs).toHaveLength(1);
  });
});

describe('boundary detection', () => {
  it('recognises an item fully inside', () => {
    expect(boundaryState(make({ id: 'a', x: 50, y: 50 }), room)).toBe('inside');
  });

  it('recognises an item hanging over an edge', () => {
    expect(boundaryState(make({ id: 'a', x: 10, y: 50 }), room)).toBe('partial');
  });

  it('recognises an item entirely outside', () => {
    expect(boundaryState(make({ id: 'a', x: -100, y: 50 }), room)).toBe('outside');
  });

  it('accounts for rotation', () => {
    // A 40x20 item at x=15 fits, but rotated 90 degrees its bounds reach x=-5.
    const upright = make({ id: 'a', x: 50, y: 15, width: 40, height: 20 });
    expect(boundaryState(upright, room)).toBe('inside');
    const rotated = { ...upright, rotation: 90 };
    expect(boundaryState(rotated, room)).toBe('partial');
  });

  it('lists outside ids', () => {
    const inside = make({ id: 'in', x: 50, y: 50 });
    const outside = make({ id: 'out', x: 140, y: 160 });
    expect([...findOutside([inside, outside], room)]).toEqual(['out']);
  });
});

describe('clearance analysis', () => {
  it('reports comfortable walkways as fine', () => {
    const bed = make({ id: 'bed', name: 'Bed', x: 72, y: 40, width: 60, height: 80 });
    const report = computeClearance([bed], room);
    expect(report.recommended).toBe(RECOMMENDED_CLEARANCE);
    // 42 in each side of a 60 in bed in a 144 in room.
    expect(report.narrowest).not.toBeNull();
    expect(report.ok).toBe(true);
  });

  it('flags a gap narrower than the recommendation', () => {
    const a = make({ id: 'a', name: 'Wardrobe', x: 30, y: 84, width: 40, height: 60 });
    const b = make({ id: 'b', name: 'Bed', x: 80, y: 84, width: 40, height: 60 });
    const report = computeClearance([a, b], room);
    expect(report.ok).toBe(false);
    const gapIssue = report.issues.find((issue) => issue.kind === 'gap');
    expect(gapIssue).toBeDefined();
    expect(gapIssue!.gap).toBeCloseTo(10, 6);
  });

  it('ignores slivers too shallow to walk through', () => {
    // Two small items side by side: they face each other over only 4 inches.
    const a = make({ id: 'a', x: 40, y: 84, width: 20, height: 4 });
    const b = make({ id: 'b', x: 70, y: 84, width: 20, height: 4 });
    const report = computeClearance([a, b], room);
    expect(report.issues.some((issue) => issue.itemIds.includes('a') && issue.kind === 'gap')).toBe(false);
  });

  it('flags furniture parked in a door swing', () => {
    const door: Door = {
      id: 'd1',
      type: 'single',
      name: 'Single Door',
      wall: 'bottom',
      offset: 72,
      width: 36,
      swing: 'in-right',
    };
    const zone = doorClearanceZone(room, door)!;
    expect(zone).toBeDefined();
    const blocker = make({
      id: 'blocker',
      name: 'Cabinet',
      x: zone.x + zone.width / 2,
      y: zone.y + zone.height / 2,
      width: 30,
      height: 20,
    });
    const report = computeClearance([blocker], room, undefined, [door]);
    expect(report.issues.some((issue) => issue.kind === 'door')).toBe(true);
  });

  it('gives sliding doors no swing zone', () => {
    const sliding: Door = {
      id: 'd2',
      type: 'sliding',
      name: 'Sliding Door',
      wall: 'top',
      offset: 72,
      width: 60,
      swing: 'in-right',
    };
    expect(doorClearanceZone(room, sliding)).toBeNull();
  });

  it('reports free floor as a ratio', () => {
    const report = computeClearance([make({ id: 'a', x: 72, y: 84, width: 72, height: 84 })], room);
    // A quarter of the floor is used.
    expect(report.freeFloorRatio).toBeCloseTo(0.75, 6);
  });

  it('handles an empty room', () => {
    const report = computeClearance([], room);
    expect(report.narrowest).toBeNull();
    expect(report.issues).toHaveLength(0);
    expect(report.freeFloorRatio).toBe(1);
  });
});
