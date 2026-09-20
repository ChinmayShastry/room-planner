/**
 * State construction, validation and safe mutation helpers.
 *
 * Every function here returns plain data; none of them touch the DOM. The
 * planner controller owns the live document and calls into these.
 */

import { DEFAULT_COLOR, getCatalogItem } from './catalog';
import { itemsOverlap } from './collision';
import { checkFitsInRoom, itemBounds, normalizeAngle } from './geometry';
import { clamp, toInches } from './units';
import { LIMITS, UNITS, WALLS } from './types';
import type {
  Door,
  DoorType,
  FloorColor,
  FurnitureItem,
  GridSize,
  PlannerSettings,
  PlannerState,
  Room,
  Unit,
  Vec2,
  Wall,
  WindowItem,
  WindowType,
} from './types';

export function createId(prefix = 'i'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  grid: 'large',
  snap: true,
  showLabels: true,
  showDimensions: true,
  showClearance: false,
};

export const DEFAULT_WALL_THICKNESS = 5; // inches, a typical interior stud wall

export interface RoomPreset {
  id: string;
  name: string;
  /** Display size in feet; converted to inches by `createRoom`. */
  widthFt: number;
  lengthFt: number;
  description: string;
}

export const ROOM_PRESETS: RoomPreset[] = [
  { id: 'small-bedroom', name: 'Small Bedroom', widthFt: 10, lengthFt: 10, description: '10 × 10 ft' },
  { id: 'bedroom', name: 'Bedroom', widthFt: 12, lengthFt: 14, description: '12 × 14 ft' },
  { id: 'master-bedroom', name: 'Master Bedroom', widthFt: 14, lengthFt: 16, description: '14 × 16 ft' },
  { id: 'living-room', name: 'Living Room', widthFt: 16, lengthFt: 20, description: '16 × 20 ft' },
  { id: 'office', name: 'Office', widthFt: 10, lengthFt: 12, description: '10 × 12 ft' },
  { id: 'studio', name: 'Studio', widthFt: 20, lengthFt: 20, description: '20 × 20 ft' },
];

export interface CreateRoomInput {
  name?: string;
  /** In `unit`, not inches. */
  width: number;
  length: number;
  unit: Unit;
  floorColor?: FloorColor;
}

export interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<'width' | 'length' | 'name', string>>;
  /** Present when `ok` is true. */
  room?: Room;
}

/**
 * Validate room setup input and build a Room.
 * Rejects zero, negative, NaN, Infinity and absurd sizes with friendly copy.
 */
export function validateRoom(input: CreateRoomInput): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const unit: Unit = UNITS.includes(input.unit) ? input.unit : 'ft';

  const widthIn = toInches(input.width, unit);
  const lengthIn = toInches(input.length, unit);

  if (!Number.isFinite(input.width) || input.width <= 0) {
    errors.width = 'Enter a width greater than zero.';
  } else if (widthIn < LIMITS.minRoomSide) {
    errors.width = 'That is smaller than we can draw. Try at least 1 ft.';
  } else if (widthIn > LIMITS.maxRoomSide) {
    errors.width = 'That is larger than we can draw. Try 200 ft or less.';
  }

  if (!Number.isFinite(input.length) || input.length <= 0) {
    errors.length = 'Enter a length greater than zero.';
  } else if (lengthIn < LIMITS.minRoomSide) {
    errors.length = 'That is smaller than we can draw. Try at least 1 ft.';
  } else if (lengthIn > LIMITS.maxRoomSide) {
    errors.length = 'That is larger than we can draw. Try 200 ft or less.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const name = (input.name ?? '').trim().slice(0, 60) || 'My Room';
  return {
    ok: true,
    errors: {},
    room: {
      id: createId('room'),
      name,
      width: widthIn,
      height: lengthIn,
      unit,
      floorColor: input.floorColor ?? 'light',
      wallThickness: DEFAULT_WALL_THICKNESS,
    },
  };
}

export function createRoom(input: CreateRoomInput): Room {
  const result = validateRoom(input);
  if (result.room) return result.room;
  // Callers that skip validation still get a usable room rather than a crash.
  return {
    id: createId('room'),
    name: (input.name ?? 'My Room').trim() || 'My Room',
    width: toInches(12, 'ft'),
    height: toInches(14, 'ft'),
    unit: input.unit ?? 'ft',
    floorColor: input.floorColor ?? 'light',
    wallThickness: DEFAULT_WALL_THICKNESS,
  };
}

export function createState(room: Room, settings?: Partial<PlannerSettings>): PlannerState {
  return {
    room,
    furniture: [],
    doors: [],
    windows: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

export function emptyState(): PlannerState {
  return createState(createRoom({ name: 'Bedroom', width: 12, length: 14, unit: 'ft' }));
}

/** Next z value so newly added items land on top of existing ones. */
function nextZ(items: FurnitureItem[], hint?: number): number {
  if (typeof hint === 'number') return hint;
  return items.reduce((max, item) => Math.max(max, item.z), 0) + 1;
}

export interface AddFurnitureResult {
  item: FurnitureItem | null;
  /** Friendly message when the item could not be added or does not fit. */
  warning: string | null;
}

/**
 * Build a furniture item from a catalog key and find somewhere sensible for it.
 * Oversized items are still added — people are allowed to experiment — but the
 * caller gets a warning to surface.
 */
export function addFurniture(state: PlannerState, key: string, at?: Vec2): AddFurnitureResult {
  const template = getCatalogItem(key);
  if (!template) return { item: null, warning: 'That item is not in the library.' };
  if (state.furniture.length >= LIMITS.maxFurniture) {
    return { item: null, warning: `You have reached the limit of ${LIMITS.maxFurniture} items in one room.` };
  }

  const fit = checkFitsInRoom(template.width, template.height, state.room.width, state.room.height);
  const base: FurnitureItem = {
    id: createId('f'),
    type: template.key,
    name: template.name,
    shape: template.shape,
    category: template.category,
    x: state.room.width / 2,
    y: state.room.height / 2,
    width: template.width,
    height: template.height,
    rotation: 0,
    color: template.color || DEFAULT_COLOR,
    labelVisible: true,
    decorative: template.decorative ?? false,
    z: nextZ(state.furniture, template.z),
  };

  // Rotate automatically when only the sideways orientation fits.
  if (!fit.fitsUpright && fit.fitsRotated) base.rotation = 90;

  const position = at ?? findPlacement(state, base);
  base.x = position.x;
  base.y = position.y;

  const warning = fit.fits ? null : 'This item is larger than the available room.';
  return { item: base, warning };
}

/**
 * Look for an open spot, starting at the centre and spiralling outward.
 * Falls back to the room centre so an item is always visible and grabbable.
 */
export function findPlacement(state: PlannerState, item: FurnitureItem): Vec2 {
  const { room } = state;
  const centre = { x: room.width / 2, y: room.height / 2 };
  const solid = state.furniture.filter((f) => !f.decorative);
  if (item.decorative || solid.length === 0) return centre;

  const step = 12;
  const maxRings = Math.ceil(Math.max(room.width, room.height) / step);

  const isFree = (pos: Vec2): boolean => {
    const candidate = { ...item, x: pos.x, y: pos.y };
    const bounds = itemBounds(candidate);
    if (bounds.x < 0 || bounds.y < 0) return false;
    if (bounds.x + bounds.width > room.width || bounds.y + bounds.height > room.height) return false;
    return !solid.some((other) => itemsOverlap(candidate, other));
  };

  if (isFree(centre)) return centre;

  for (let ring = 1; ring <= maxRings; ring += 1) {
    const r = ring * step;
    // Sample the ring at 16 angles — enough to find a gap without being slow.
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const pos = { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r };
      if (isFree(pos)) return pos;
    }
  }
  return centre;
}

/** Copy an item, nudged down-right so both copies are visible. */
export function duplicateItem(state: PlannerState, item: FurnitureItem): FurnitureItem {
  const offset = 8;
  return {
    ...item,
    id: createId('f'),
    x: clamp(item.x + offset, -state.room.width, state.room.width * 2),
    y: clamp(item.y + offset, -state.room.height, state.room.height * 2),
    z: nextZ(state.furniture),
  };
}

// --------------------------------------------------------------- Doors

export interface DoorPreset {
  type: DoorType;
  name: string;
  width: number;
}

export const DOOR_PRESETS: DoorPreset[] = [
  { type: 'single', name: 'Single Door', width: 36 },
  { type: 'double', name: 'Double Door', width: 60 },
  { type: 'sliding', name: 'Sliding Door', width: 60 },
  { type: 'opening', name: 'Open Doorway', width: 42 },
];

export const WINDOW_PRESETS: Array<{ type: WindowType; name: string; width: number }> = [
  { type: 'standard', name: 'Standard Window', width: 36 },
  { type: 'large', name: 'Large Window', width: 72 },
  { type: 'sliding', name: 'Sliding Window', width: 60 },
];

function wallSpan(room: Room, wall: Wall): number {
  return wall === 'top' || wall === 'bottom' ? room.width : room.height;
}

/** Keep an opening fully on its wall, leaving a small return at each corner. */
export function clampOpeningOffset(room: Room, wall: Wall, offset: number, width: number): number {
  const span = wallSpan(room, wall);
  const usable = Math.max(0, span - width);
  if (usable <= 0) return span / 2;
  const margin = Math.min(4, usable / 2);
  return clamp(offset, width / 2 + margin, span - width / 2 - margin);
}

export function addDoor(state: PlannerState, preset: DoorPreset, wall: Wall = 'bottom'): Door | null {
  if (state.doors.length >= LIMITS.maxDoors) return null;
  const span = wallSpan(state.room, wall);
  const width = Math.min(preset.width, Math.max(12, span - 8));
  return {
    id: createId('d'),
    type: preset.type,
    name: preset.name,
    wall,
    offset: clampOpeningOffset(state.room, wall, span / 2, width),
    width,
    swing: 'in-right',
  };
}

export function addWindow(
  state: PlannerState,
  preset: { type: WindowType; name: string; width: number },
  wall: Wall = 'top',
): WindowItem | null {
  if (state.windows.length >= LIMITS.maxWindows) return null;
  const span = wallSpan(state.room, wall);
  const width = Math.min(preset.width, Math.max(12, span - 8));
  return {
    id: createId('w'),
    type: preset.type,
    name: preset.name,
    wall,
    offset: clampOpeningOffset(state.room, wall, span / 2, width),
    width,
  };
}

/** Re-clamp every opening after the room is resized so nothing hangs off a wall. */
export function reflowOpenings(state: PlannerState): void {
  for (const door of state.doors) {
    door.width = Math.min(door.width, Math.max(12, wallSpan(state.room, door.wall) - 8));
    door.offset = clampOpeningOffset(state.room, door.wall, door.offset, door.width);
  }
  for (const win of state.windows) {
    win.width = Math.min(win.width, Math.max(12, wallSpan(state.room, win.wall) - 8));
    win.offset = clampOpeningOffset(state.room, win.wall, win.offset, win.width);
  }
}

// ---------------------------------------------------- Validation / sanitising

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback: string, maxLength = 80): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const FLOOR_COLORS = ['light', 'warm', 'gray'] as const;
const GRID_SIZES = ['off', 'fine', 'medium', 'large'] as const;
const DOOR_TYPES = ['single', 'double', 'sliding', 'opening'] as const;
const WINDOW_TYPES = ['standard', 'large', 'sliding'] as const;
const SWINGS = ['in-left', 'in-right', 'out-left', 'out-right'] as const;

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Turn arbitrary parsed JSON into a PlannerState we are willing to render.
 *
 * Imported files and old localStorage entries are never trusted: every field is
 * coerced into range, unknown keys are dropped, and array lengths are capped.
 */
export function sanitizeState(input: unknown): PlannerState | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const rawRoom = raw.room;
  if (!rawRoom || typeof rawRoom !== 'object') return null;
  const r = rawRoom as Record<string, unknown>;

  const width = clamp(num(r.width, 144), LIMITS.minRoomSide, LIMITS.maxRoomSide);
  const height = clamp(num(r.height, 168), LIMITS.minRoomSide, LIMITS.maxRoomSide);

  const room: Room = {
    id: str(r.id, createId('room'), 40),
    name: str(r.name, 'My Room', 60),
    width,
    height,
    unit: oneOf<Unit>(r.unit, UNITS, 'ft'),
    floorColor: oneOf<FloorColor>(r.floorColor, FLOOR_COLORS, 'light'),
    wallThickness: clamp(num(r.wallThickness, DEFAULT_WALL_THICKNESS), 1, 24),
  };

  const rawFurniture = Array.isArray(raw.furniture) ? raw.furniture : [];
  const furniture: FurnitureItem[] = rawFurniture
    .slice(0, LIMITS.maxFurniture)
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f, index) => {
      const key = str(f.type, 'box', 40);
      const template = getCatalogItem(key);
      return {
        id: str(f.id, createId('f'), 40),
        type: key,
        name: str(f.name, template?.name ?? 'Item', 60),
        shape: (template?.shape ?? oneOf(f.shape, ['box'] as const, 'box')) as FurnitureItem['shape'],
        category: str(f.category, template?.category ?? 'other', 30),
        x: clamp(num(f.x, room.width / 2), -LIMITS.maxRoomSide, LIMITS.maxRoomSide * 2),
        y: clamp(num(f.y, room.height / 2), -LIMITS.maxRoomSide, LIMITS.maxRoomSide * 2),
        width: clamp(num(f.width, template?.width ?? 24), LIMITS.minItemSide, LIMITS.maxItemSide),
        height: clamp(num(f.height, template?.height ?? 24), LIMITS.minItemSide, LIMITS.maxItemSide),
        rotation: normalizeAngle(num(f.rotation, 0)),
        color: typeof f.color === 'string' && HEX.test(f.color) ? f.color : (template?.color ?? DEFAULT_COLOR),
        labelVisible: f.labelVisible !== false,
        decorative: typeof f.decorative === 'boolean' ? f.decorative : (template?.decorative ?? false),
        z: num(f.z, index + 1),
      };
    });

  // `shape` must come from the catalog or fall back to a plain box.
  for (const item of furniture) {
    const template = getCatalogItem(item.type);
    if (template) item.shape = template.shape;
  }

  const rawDoors = Array.isArray(raw.doors) ? raw.doors : [];
  const doors: Door[] = rawDoors
    .slice(0, LIMITS.maxDoors)
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => {
      const wall = oneOf<Wall>(d.wall, WALLS, 'bottom');
      const span = wall === 'top' || wall === 'bottom' ? room.width : room.height;
      const doorWidth = clamp(num(d.width, 36), 12, Math.max(12, span));
      return {
        id: str(d.id, createId('d'), 40),
        type: oneOf<DoorType>(d.type, DOOR_TYPES, 'single'),
        name: str(d.name, 'Door', 40),
        wall,
        offset: clamp(num(d.offset, span / 2), 0, span),
        width: doorWidth,
        swing: oneOf(d.swing, SWINGS, 'in-right'),
      };
    });

  const rawWindows = Array.isArray(raw.windows) ? raw.windows : [];
  const windows: WindowItem[] = rawWindows
    .slice(0, LIMITS.maxWindows)
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => {
      const wall = oneOf<Wall>(w.wall, WALLS, 'top');
      const span = wall === 'top' || wall === 'bottom' ? room.width : room.height;
      const winWidth = clamp(num(w.width, 36), 12, Math.max(12, span));
      return {
        id: str(w.id, createId('w'), 40),
        type: oneOf<WindowType>(w.type, WINDOW_TYPES, 'standard'),
        name: str(w.name, 'Window', 40),
        wall,
        offset: clamp(num(w.offset, span / 2), 0, span),
        width: winWidth,
      };
    });

  const rawSettings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Record<
    string,
    unknown
  >;
  const settings: PlannerSettings = {
    grid: oneOf<GridSize>(rawSettings.grid, GRID_SIZES, DEFAULT_SETTINGS.grid),
    snap: rawSettings.snap !== false,
    showLabels: rawSettings.showLabels !== false,
    showDimensions: rawSettings.showDimensions !== false,
    showClearance: rawSettings.showClearance === true,
  };

  const state: PlannerState = { room, furniture, doors, windows, settings };
  reflowOpenings(state);
  return state;
}
