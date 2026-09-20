import { describe, expect, it } from 'vitest';
import { History } from '@lib/planner/history';
import {
  effectiveGridStep,
  GRID_INCHES,
  snapAngle,
  snapPosition,
  snapSize,
  snapValue,
  WALL_SNAP_DISTANCE,
} from '@lib/planner/snapping';
import {
  addDoor,
  addFurniture,
  addWindow,
  clampOpeningOffset,
  createRoom,
  createState,
  DOOR_PRESETS,
  duplicateItem,
  reflowOpenings,
  sanitizeState,
  validateRoom,
  WINDOW_PRESETS,
} from '@lib/planner/state';
import { buildTemplateState, TEMPLATES } from '@lib/planner/templates';
import { parseLayoutFile, toLayoutFile } from '@lib/planner/storage';
import { itemBounds } from '@lib/planner/geometry';
import { findOverlaps } from '@lib/planner/collision';
import { buildStandaloneSvg } from '@lib/planner/render';
import { LIMITS } from '@lib/planner/types';
import type { PlannerState } from '@lib/planner/types';

function bedroom(): PlannerState {
  return createState(createRoom({ name: 'Bedroom', width: 12, length: 14, unit: 'ft' }));
}

// ------------------------------------------------------------- room creation

describe('room creation', () => {
  it('creates a room in canonical inches', () => {
    const result = validateRoom({ name: 'Bedroom', width: 12, length: 14, unit: 'ft' });
    expect(result.ok).toBe(true);
    expect(result.room?.width).toBe(144);
    expect(result.room?.height).toBe(168);
    expect(result.room?.unit).toBe('ft');
  });

  it('accepts metric input', () => {
    const result = validateRoom({ name: 'Room', width: 3, length: 4, unit: 'm' });
    expect(result.room?.width).toBeCloseTo(118.11, 2);
  });

  it('rejects zero and negative dimensions', () => {
    expect(validateRoom({ width: 0, length: 10, unit: 'ft' }).ok).toBe(false);
    expect(validateRoom({ width: -5, length: 10, unit: 'ft' }).ok).toBe(false);
    expect(validateRoom({ width: 10, length: 0, unit: 'ft' }).ok).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(validateRoom({ width: Number.NaN, length: 10, unit: 'ft' }).ok).toBe(false);
    expect(validateRoom({ width: Number.POSITIVE_INFINITY, length: 10, unit: 'ft' }).ok).toBe(false);
  });

  it('rejects absurd sizes with a friendly message', () => {
    const tooBig = validateRoom({ width: 5000, length: 10, unit: 'ft' });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.errors.width).toMatch(/200 ft/);
  });

  it('falls back to a default name', () => {
    expect(validateRoom({ name: '   ', width: 10, length: 10, unit: 'ft' }).room?.name).toBe('My Room');
  });
});

// ---------------------------------------------------------- placing furniture

describe('furniture placement', () => {
  it('places the first item in the centre of the room', () => {
    const state = bedroom();
    const { item } = addFurniture(state, 'queen-bed');
    expect(item).not.toBeNull();
    expect(item!.x).toBe(72);
    expect(item!.y).toBe(84);
    expect(item!.width).toBe(60);
    expect(item!.height).toBe(80);
  });

  it('finds a free spot instead of stacking items', () => {
    const state = bedroom();
    const first = addFurniture(state, 'nightstand').item!;
    state.furniture.push(first);
    const second = addFurniture(state, 'nightstand').item!;
    state.furniture.push(second);
    expect(findOverlaps(state.furniture).ids.size).toBe(0);
  });

  it('warns but still adds an item bigger than the room', () => {
    const state = createState(createRoom({ name: 'Tiny', width: 4, length: 4, unit: 'ft' }));
    const result = addFurniture(state, 'king-bed');
    expect(result.item).not.toBeNull();
    expect(result.warning).toMatch(/larger than the available room/);
  });

  it('auto-rotates when only the sideways orientation fits', () => {
    // 6 ft wide, 20 ft deep: a 7 ft sofa only fits turned.
    const state = createState(createRoom({ name: 'Hall', width: 6, length: 20, unit: 'ft' }));
    const result = addFurniture(state, 'sofa-3');
    expect(result.item?.rotation).toBe(90);
  });

  it('refuses unknown catalog keys', () => {
    expect(addFurniture(bedroom(), 'flying-carpet').item).toBeNull();
  });

  it('enforces the item limit', () => {
    const state = bedroom();
    for (let i = 0; i < LIMITS.maxFurniture; i += 1) {
      state.furniture.push(addFurniture(state, 'plant').item!);
    }
    const result = addFurniture(state, 'plant');
    expect(result.item).toBeNull();
    expect(result.warning).toMatch(/limit/);
  });

  it('offsets a duplicate so both copies are visible', () => {
    const state = bedroom();
    const original = addFurniture(state, 'nightstand').item!;
    state.furniture.push(original);
    const copy = duplicateItem(state, original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.x).not.toBe(original.x);
    expect(copy.z).toBeGreaterThan(original.z);
  });
});

// --------------------------------------------------------------- transforms

describe('moving, rotating and resizing', () => {
  it('moving changes only position', () => {
    const state = bedroom();
    const item = addFurniture(state, 'queen-bed').item!;
    const before = { ...item };
    item.x = 30;
    item.y = 45;
    expect(item.width).toBe(before.width);
    expect(item.height).toBe(before.height);
    expect(itemBounds(item)).toEqual({ x: 0, y: 5, width: 60, height: 80 });
  });

  it('rotating swaps the footprint but keeps the centre', () => {
    const state = bedroom();
    const item = addFurniture(state, 'bedroom-desk').item!;
    item.rotation = 90;
    const bounds = itemBounds(item);
    expect(bounds.width).toBeCloseTo(24, 6);
    expect(bounds.height).toBeCloseTo(48, 6);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(item.x, 6);
  });

  it('resizing keeps the item centred on its own position', () => {
    const state = bedroom();
    const item = addFurniture(state, 'bedroom-desk').item!;
    item.width = 60;
    const bounds = itemBounds(item);
    expect(bounds.width).toBe(60);
    expect(bounds.x + 30).toBeCloseTo(item.x, 6);
  });
});

// ----------------------------------------------------------------- snapping

describe('grid snapping', () => {
  it('snaps to the nearest increment', () => {
    expect(snapValue(13, 12)).toBe(12);
    expect(snapValue(19, 12)).toBe(24);
    expect(snapValue(7, 6)).toBe(6);
  });

  it('is a no-op when the step is zero', () => {
    expect(snapValue(13.7, 0)).toBe(13.7);
  });

  it('aligns the item edge, not its centre', () => {
    const item = { x: 0, y: 0, width: 30, height: 20, rotation: 0 };
    const result = snapPosition(item, { x: 61, y: 61 }, {
      enabled: true,
      grid: 'large',
      room: { width: 240, height: 240 },
    });
    // Left edge lands on a 12 in grid line, so the centre sits at edge + 15.
    const bounds = itemBounds({ ...item, x: result.x, y: result.y });
    expect(bounds.x % 12).toBeCloseTo(0, 6);
  });

  it('snaps flush to a nearby wall in preference to the grid', () => {
    const item = { x: 0, y: 0, width: 30, height: 20, rotation: 0 };
    const result = snapPosition(item, { x: 15 + WALL_SNAP_DISTANCE - 1, y: 100 }, {
      enabled: true,
      grid: 'large',
      room: { width: 240, height: 240 },
    });
    const bounds = itemBounds({ ...item, x: result.x, y: result.y });
    expect(bounds.x).toBeCloseTo(0, 6);
    expect(result.snappedWalls).toContain('left');
  });

  it('does nothing when snapping is off', () => {
    const item = { x: 0, y: 0, width: 30, height: 20, rotation: 0 };
    const result = snapPosition(item, { x: 61.3, y: 42.7 }, {
      enabled: false,
      grid: 'large',
      room: { width: 240, height: 240 },
    });
    expect(result.x).toBe(61.3);
    expect(result.y).toBe(42.7);
  });

  it('never snaps a size below the minimum', () => {
    const ctx = { enabled: true, grid: 'large' as const, room: { width: 240, height: 240 } };
    expect(snapSize(3, ctx, 2)).toBeGreaterThanOrEqual(2);
  });

  it('snaps rotation to 15 degree steps', () => {
    expect(snapAngle(47)).toBe(45);
    expect(snapAngle(8)).toBe(15);
  });

  it('coarsens the drawn grid when zoomed out', () => {
    expect(effectiveGridStep('large', 1)).toBe(GRID_INCHES.large);
    // At 0.05 px per inch a 12 in grid would be 0.6 px apart, so it doubles up.
    expect(effectiveGridStep('large', 0.05)).toBeGreaterThan(GRID_INCHES.large);
    expect(effectiveGridStep('off', 1)).toBe(0);
  });
});

// ------------------------------------------------------------ doors/windows

describe('doors and windows', () => {
  it('adds a door centred on its wall', () => {
    const state = bedroom();
    const door = addDoor(state, DOOR_PRESETS[0]!, 'bottom')!;
    expect(door.width).toBe(36);
    expect(door.wall).toBe('bottom');
    expect(door.offset).toBeCloseTo(72, 6);
  });

  it('keeps an opening on its wall', () => {
    const room = createRoom({ width: 12, length: 14, unit: 'ft' });
    expect(clampOpeningOffset(room, 'top', -50, 36)).toBeGreaterThanOrEqual(18);
    expect(clampOpeningOffset(room, 'top', 500, 36)).toBeLessThanOrEqual(144 - 18);
  });

  it('shrinks an opening that is wider than its wall', () => {
    const state = createState(createRoom({ width: 2, length: 10, unit: 'ft' }));
    const door = addDoor(state, DOOR_PRESETS[1]!, 'top')!;
    expect(door.width).toBeLessThanOrEqual(24);
  });

  it('reflows openings when the room shrinks', () => {
    const state = bedroom();
    const window = addWindow(state, WINDOW_PRESETS[1]!, 'top')!;
    state.windows.push(window);
    state.room.width = 48;
    reflowOpenings(state);
    expect(state.windows[0]!.width).toBeLessThanOrEqual(48);
    expect(state.windows[0]!.offset).toBeLessThanOrEqual(48);
    expect(state.windows[0]!.offset).toBeGreaterThanOrEqual(0);
  });

  it('enforces the door limit', () => {
    const state = bedroom();
    for (let i = 0; i < LIMITS.maxDoors; i += 1) state.doors.push(addDoor(state, DOOR_PRESETS[0]!)!);
    expect(addDoor(state, DOOR_PRESETS[0]!)).toBeNull();
  });
});

// ------------------------------------------------------------ undo / redo

describe('history', () => {
  it('starts with nothing to undo', () => {
    const history = new History({ n: 0 });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('undoes and redoes', () => {
    const history = new History({ n: 0 });
    history.push({ n: 1 }, 'one');
    history.push({ n: 2 }, 'two');
    expect(history.current).toEqual({ n: 2 });
    expect(history.undo()).toEqual({ n: 1 });
    expect(history.undo()).toEqual({ n: 0 });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual({ n: 1 });
    expect(history.redo()).toEqual({ n: 2 });
  });

  it('clears the redo stack on a new edit', () => {
    const history = new History({ n: 0 });
    history.push({ n: 1 }, 'one');
    history.undo();
    history.push({ n: 9 }, 'nine');
    expect(history.canRedo).toBe(false);
  });

  it('stores snapshots, not references', () => {
    const state = { items: [1] };
    const history = new History(state);
    state.items.push(2);
    expect(history.current.items).toEqual([1]);
  });

  it('stays within its depth limit', () => {
    const history = new History({ n: 0 }, { depth: 5 });
    for (let i = 1; i <= 20; i += 1) history.push({ n: i }, `step ${i}`);
    expect(history.size.past).toBe(5);
    expect(history.current).toEqual({ n: 20 });
  });

  it('coalesces rapid edits of the same kind', () => {
    const history = new History({ n: 0 }, { coalesceMs: 5000 });
    history.push({ n: 1 }, 'Move', true);
    history.push({ n: 2 }, 'Move', true);
    history.push({ n: 3 }, 'Move', true);
    expect(history.size.past).toBe(1);
    expect(history.undo()).toEqual({ n: 0 });
  });

  it('does not coalesce across different labels', () => {
    const history = new History({ n: 0 }, { coalesceMs: 5000 });
    history.push({ n: 1 }, 'Move', true);
    history.push({ n: 2 }, 'Resize', true);
    expect(history.size.past).toBe(2);
  });

  it('resets cleanly for a new document', () => {
    const history = new History({ n: 0 });
    history.push({ n: 1 }, 'one');
    history.reset({ n: 100 });
    expect(history.canUndo).toBe(false);
    expect(history.current).toEqual({ n: 100 });
  });
});

// -------------------------------------------------------------- persistence

describe('import and export', () => {
  it('round-trips a layout', () => {
    const state = buildTemplateState('bedroom')!;
    const file = toLayoutFile(state, 'My bedroom');
    const parsed = parseLayoutFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name).toBe('My bedroom');
    expect(parsed.state.room.width).toBe(state.room.width);
    expect(parsed.state.furniture).toHaveLength(state.furniture.length);
  });

  it('rejects malformed JSON', () => {
    const result = parseLayoutFile('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid JSON/);
  });

  it('rejects empty input', () => {
    expect(parseLayoutFile('').ok).toBe(false);
    expect(parseLayoutFile('   ').ok).toBe(false);
  });

  it('rejects JSON with no room', () => {
    expect(parseLayoutFile('{"app":"room-planner","layout":{"state":{}}}').ok).toBe(false);
  });

  it('rejects a file from another app', () => {
    const result = parseLayoutFile('{"app":"something-else","layout":{"state":{"room":{}}}}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/different app/);
  });

  it('rejects a newer schema version', () => {
    const result = parseLayoutFile('{"app":"room-planner","version":99,"layout":{"state":{"room":{}}}}');
    expect(result.ok).toBe(false);
  });

  it('accepts a bare state object', () => {
    const state = buildTemplateState('bedroom')!;
    const result = parseLayoutFile(JSON.stringify(state));
    expect(result.ok).toBe(true);
  });

  it('rejects an oversized file', () => {
    const huge = `{"room":{"width":144},"padding":"${'x'.repeat(2_100_000)}"}`;
    const result = parseLayoutFile(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/);
  });
});

describe('sanitising untrusted state', () => {
  it('clamps hostile numbers into range', () => {
    const state = sanitizeState({
      room: { width: 1e9, height: -50, unit: 'parsec' },
      furniture: [
        { type: 'queen-bed', x: Number.POSITIVE_INFINITY, y: Number.NaN, width: -10, rotation: 100000 },
      ],
    })!;
    expect(state.room.width).toBeLessThanOrEqual(LIMITS.maxRoomSide);
    expect(state.room.height).toBeGreaterThanOrEqual(LIMITS.minRoomSide);
    expect(state.room.unit).toBe('ft');
    const item = state.furniture[0]!;
    expect(Number.isFinite(item.x)).toBe(true);
    expect(Number.isFinite(item.y)).toBe(true);
    expect(item.width).toBeGreaterThanOrEqual(LIMITS.minItemSide);
    expect(item.rotation).toBeGreaterThanOrEqual(0);
    expect(item.rotation).toBeLessThan(360);
  });

  it('caps array lengths', () => {
    const state = sanitizeState({
      room: { width: 144, height: 168 },
      furniture: Array.from({ length: 500 }, () => ({ type: 'plant' })),
      doors: Array.from({ length: 100 }, () => ({ type: 'single' })),
    })!;
    expect(state.furniture.length).toBeLessThanOrEqual(LIMITS.maxFurniture);
    expect(state.doors.length).toBeLessThanOrEqual(LIMITS.maxDoors);
  });

  it('rejects a colour that is not a hex value', () => {
    const state = sanitizeState({
      room: { width: 144, height: 168 },
      furniture: [{ type: 'plant', color: 'javascript:alert(1)' }],
    })!;
    expect(state.furniture[0]!.color).toMatch(/^#/);
  });

  it('returns null for input that is not a state at all', () => {
    expect(sanitizeState(null)).toBeNull();
    expect(sanitizeState('hello')).toBeNull();
    expect(sanitizeState({})).toBeNull();
    expect(sanitizeState({ room: 'not an object' })).toBeNull();
  });

  it('restores the shape from the catalog rather than trusting the file', () => {
    const state = sanitizeState({
      room: { width: 144, height: 168 },
      furniture: [{ type: 'queen-bed', shape: 'toilet' }],
    })!;
    expect(state.furniture[0]!.shape).toBe('bed');
  });
});

// ----------------------------------------------------------------- templates

describe('templates', () => {
  it('builds every template without error', () => {
    for (const template of TEMPLATES) {
      const state = buildTemplateState(template.id);
      expect(state, template.id).not.toBeNull();
      expect(state!.furniture.length, template.id).toBeGreaterThan(0);
      expect(state!.room.width, template.id).toBe(template.widthFt * 12);
      expect(state!.room.height, template.id).toBe(template.lengthFt * 12);
    }
  });

  it('keeps every template item inside its room', () => {
    for (const template of TEMPLATES) {
      const state = buildTemplateState(template.id)!;
      for (const item of state.furniture) {
        const bounds = itemBounds(item);
        expect(bounds.x, `${template.id}/${item.name}`).toBeGreaterThanOrEqual(-0.01);
        expect(bounds.y, `${template.id}/${item.name}`).toBeGreaterThanOrEqual(-0.01);
        expect(bounds.x + bounds.width, `${template.id}/${item.name}`).toBeLessThanOrEqual(
          state.room.width + 0.01,
        );
        expect(bounds.y + bounds.height, `${template.id}/${item.name}`).toBeLessThanOrEqual(
          state.room.height + 0.01,
        );
      }
    }
  });

  it('does not ship a template with overlapping furniture', () => {
    for (const template of TEMPLATES) {
      const state = buildTemplateState(template.id)!;
      const report = findOverlaps(state.furniture);
      expect([...report.ids], `${template.id}: ${report.pairs.map((p) => p.join('+')).join(', ')}`).toEqual(
        [],
      );
    }
  });

  it('returns null for an unknown template', () => {
    expect(buildTemplateState('mansion')).toBeNull();
  });
});

// -------------------------------------------------------------------- export

describe('svg export', () => {
  it('produces a standalone document', () => {
    const state = buildTemplateState('bedroom')!;
    const svg = buildStandaloneSvg(state, { width: 1200 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1200"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('includes the room name and size in the legend', () => {
    const state = buildTemplateState('bedroom')!;
    const svg = buildStandaloneSvg(state);
    expect(svg).toContain('Bedroom');
    expect(svg).toContain('12 ft');
  });

  it('omits selection handles and the grid', () => {
    const state = buildTemplateState('bedroom')!;
    const svg = buildStandaloneSvg(state);
    expect(svg).not.toContain('rp-handle');
    expect(svg).not.toContain('data-handle');
  });

  it('can hide labels', () => {
    const state = buildTemplateState('bedroom')!;
    const withLabels = buildStandaloneSvg(state, { showLabels: true });
    const without = buildStandaloneSvg(state, { showLabels: false });
    expect(withLabels).toContain('Queen Bed');
    expect(without).not.toContain('>Queen Bed<');
  });

  it('escapes names so a layout cannot inject markup', () => {
    const state = buildTemplateState('bedroom')!;
    state.furniture[1]!.name = '<script>bad()</script>';
    const svg = buildStandaloneSvg(state);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
