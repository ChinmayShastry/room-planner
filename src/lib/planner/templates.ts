/**
 * Ready-made rooms.
 *
 * A template sets the room size and drops in a plausible starting layout, so
 * someone can go from "open the site" to "move my bed around" in one click.
 * Every position here is in inches from the room's top-left interior corner and
 * refers to the CENTRE of the item.
 */

import { getCatalogItem } from './catalog';
import { createId, createRoom, createState, clampOpeningOffset } from './state';
import type { Door, DoorType, FurnitureItem, PlannerState, Wall, WindowItem, WindowType } from './types';

interface TemplateItem {
  key: string;
  x: number;
  y: number;
  rotation?: number;
}

interface TemplateDoor {
  type: DoorType;
  name: string;
  wall: Wall;
  offset: number;
  width: number;
  swing?: Door['swing'];
}

interface TemplateWindow {
  type: WindowType;
  name: string;
  wall: Wall;
  offset: number;
  width: number;
}

export interface RoomTemplate {
  id: string;
  name: string;
  /** One-line summary shown on the template card. */
  description: string;
  roomName: string;
  /** Room size in feet. */
  widthFt: number;
  lengthFt: number;
  items: TemplateItem[];
  doors: TemplateDoor[];
  windows: TemplateWindow[];
}

const SINGLE_DOOR = (wall: Wall, offset: number, swing: Door['swing'] = 'in-right'): TemplateDoor => ({
  type: 'single',
  name: 'Single Door',
  wall,
  offset,
  width: 36,
  swing,
});

const WINDOW = (wall: Wall, offset: number, width = 36): TemplateWindow => ({
  type: width >= 60 ? 'large' : 'standard',
  name: width >= 60 ? 'Large Window' : 'Standard Window',
  wall,
  offset,
  width,
});

export const TEMPLATES: RoomTemplate[] = [
  {
    id: 'bedroom',
    name: 'Bedroom',
    description: '12 × 14 ft — queen bed, nightstands, wardrobe and a desk.',
    roomName: 'Bedroom',
    widthFt: 12,
    lengthFt: 14,
    items: [
      { key: 'rug', x: 72, y: 110 },
      { key: 'queen-bed', x: 72, y: 40 },
      { key: 'nightstand', x: 26, y: 9 },
      { key: 'nightstand', x: 118, y: 9 },
      { key: 'wardrobe', x: 12, y: 116, rotation: 90 },
      { key: 'bedroom-desk', x: 108, y: 156 },
      { key: 'bedroom-chair', x: 108, y: 128 },
    ],
    doors: [SINGLE_DOOR('bottom', 110)],
    windows: [WINDOW('top', 72)],
  },
  {
    id: 'small-bedroom',
    name: 'Small Bedroom',
    description: '10 × 10 ft — single bed, wardrobe and a compact desk.',
    roomName: 'Small Bedroom',
    widthFt: 10,
    lengthFt: 10,
    items: [
      { key: 'single-bed', x: 20, y: 39 },
      { key: 'nightstand', x: 50, y: 10 },
      { key: 'wardrobe', x: 108, y: 52, rotation: 90 },
      { key: 'bedroom-desk', x: 84, y: 108 },
      { key: 'bedroom-chair', x: 84, y: 86 },
      { key: 'plant', x: 14, y: 108 },
    ],
    doors: [SINGLE_DOOR('bottom', 100)],
    windows: [WINDOW('top', 60)],
  },
  {
    id: 'living-room',
    name: 'Living Room',
    description: '16 × 20 ft — sofa, coffee table, TV wall and two armchairs.',
    roomName: 'Living Room',
    widthFt: 16,
    lengthFt: 20,
    items: [
      { key: 'rug', x: 96, y: 180 },
      { key: 'tv-stand', x: 96, y: 9 },
      { key: 'tv', x: 96, y: 22 },
      { key: 'coffee-table', x: 96, y: 168 },
      { key: 'sofa-3', x: 96, y: 222, rotation: 180 },
      { key: 'armchair', x: 20, y: 168, rotation: 90 },
      { key: 'armchair', x: 172, y: 168, rotation: 270 },
      { key: 'bookshelf', x: 186, y: 60, rotation: 90 },
      { key: 'plant', x: 176, y: 24 },
    ],
    doors: [SINGLE_DOOR('bottom', 30)],
    windows: [WINDOW('left', 120, 72)],
  },
  {
    id: 'home-office',
    name: 'Home Office',
    description: '10 × 12 ft — desk under the window, shelving and storage.',
    roomName: 'Home Office',
    widthFt: 10,
    lengthFt: 12,
    items: [
      { key: 'rug', x: 60, y: 80 },
      { key: 'office-desk', x: 60, y: 18 },
      { key: 'office-chair', x: 60, y: 52 },
      { key: 'office-bookshelf', x: 6, y: 60, rotation: 90 },
      { key: 'filing-cabinet', x: 105, y: 21 },
      { key: 'printer', x: 105, y: 52 },
      { key: 'plant', x: 106, y: 120 },
    ],
    doors: [SINGLE_DOOR('bottom', 30)],
    windows: [WINDOW('top', 60)],
  },
  {
    id: 'dining-room',
    name: 'Dining Room',
    description: '12 × 14 ft — six-seater table with chairs and a sideboard.',
    roomName: 'Dining Room',
    widthFt: 12,
    lengthFt: 14,
    items: [
      { key: 'table-6', x: 72, y: 84 },
      { key: 'dining-chair', x: 48, y: 52 },
      { key: 'dining-chair', x: 96, y: 52 },
      { key: 'dining-chair', x: 48, y: 116, rotation: 180 },
      { key: 'dining-chair', x: 96, y: 116, rotation: 180 },
      { key: 'dining-chair', x: 20, y: 84, rotation: 90 },
      { key: 'dining-chair', x: 124, y: 84, rotation: 270 },
      { key: 'cabinet', x: 72, y: 9 },
      { key: 'plant', x: 128, y: 152 },
    ],
    doors: [SINGLE_DOOR('bottom', 36)],
    windows: [WINDOW('left', 84)],
  },
  {
    id: 'studio-apartment',
    name: 'Studio Apartment',
    description: '20 × 20 ft — sleeping, living, dining and kitchen zones.',
    roomName: 'Studio',
    widthFt: 20,
    lengthFt: 20,
    items: [
      { key: 'rug', x: 170, y: 150 },
      { key: 'queen-bed', x: 58, y: 44 },
      { key: 'nightstand', x: 100, y: 13 },
      { key: 'wardrobe', x: 12, y: 150, rotation: 90 },
      { key: 'tv-stand', x: 160, y: 9 },
      { key: 'tv', x: 160, y: 22 },
      { key: 'coffee-table', x: 160, y: 52 },
      { key: 'sofa-3', x: 160, y: 100, rotation: 180 },
      { key: 'table-4', x: 60, y: 150 },
      { key: 'dining-chair', x: 48, y: 125 },
      { key: 'dining-chair', x: 72, y: 125 },
      { key: 'dining-chair', x: 48, y: 175, rotation: 180 },
      { key: 'dining-chair', x: 72, y: 175, rotation: 180 },
      { key: 'kitchen-counter', x: 227, y: 180, rotation: 90 },
      { key: 'refrigerator', x: 225, y: 105, rotation: 90 },
    ],
    doors: [SINGLE_DOOR('bottom', 40)],
    windows: [WINDOW('top', 120, 72), WINDOW('left', 60)],
  },
  {
    id: 'kids-room',
    name: 'Kids Room',
    description: '10 × 12 ft — bunk bed, homework desk and toy storage.',
    roomName: 'Kids Room',
    widthFt: 10,
    lengthFt: 12,
    items: [
      { key: 'rug', x: 60, y: 105 },
      { key: 'bunk-bed', x: 23, y: 41 },
      { key: 'bedroom-desk', x: 86, y: 14 },
      { key: 'bedroom-chair', x: 86, y: 40 },
      { key: 'storage-box', x: 100, y: 92 },
      { key: 'shelf', x: 114, y: 60, rotation: 90 },
      { key: 'plant', x: 14, y: 130 },
    ],
    doors: [SINGLE_DOOR('bottom', 30)],
    windows: [WINDOW('top', 60)],
  },
  {
    id: 'gaming-room',
    name: 'Gaming Room',
    description: '12 × 12 ft — long desk setup, couch and a screen wall.',
    roomName: 'Gaming Room',
    widthFt: 12,
    lengthFt: 12,
    items: [
      { key: 'rug', x: 86, y: 95 },
      { key: 'office-desk', x: 16, y: 40, rotation: 90 },
      { key: 'office-chair', x: 48, y: 40 },
      { key: 'tv-stand', x: 100, y: 60 },
      { key: 'tv', x: 100, y: 73 },
      { key: 'sofa-2', x: 100, y: 126, rotation: 180 },
      { key: 'bookshelf', x: 138, y: 24, rotation: 90 },
      { key: 'plant', x: 16, y: 130 },
    ],
    doors: [SINGLE_DOOR('bottom', 120)],
    windows: [WINDOW('right', 72)],
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): RoomTemplate | undefined {
  return BY_ID.get(id);
}

/**
 * Turn a template into a live document.
 * Unknown catalog keys are skipped rather than throwing, so the planner still
 * opens if the library ever changes underneath a saved template.
 */
export function buildTemplateState(id: string): PlannerState | null {
  const template = BY_ID.get(id);
  if (!template) return null;

  const room = createRoom({
    name: template.roomName,
    width: template.widthFt,
    length: template.lengthFt,
    unit: 'ft',
  });
  const state = createState(room);

  let z = 1;
  for (const entry of template.items) {
    const base = getCatalogItem(entry.key);
    if (!base) continue;
    const item: FurnitureItem = {
      id: createId('f'),
      type: base.key,
      name: base.name,
      shape: base.shape,
      category: base.category,
      x: entry.x,
      y: entry.y,
      width: base.width,
      height: base.height,
      rotation: entry.rotation ?? 0,
      color: base.color,
      labelVisible: true,
      decorative: base.decorative ?? false,
      z: base.z ?? z,
    };
    z += 1;
    state.furniture.push(item);
  }

  for (const d of template.doors) {
    const door: Door = {
      id: createId('d'),
      type: d.type,
      name: d.name,
      wall: d.wall,
      offset: d.offset,
      width: d.width,
      swing: d.swing ?? 'in-right',
    };
    door.offset = clampOpeningOffset(room, door.wall, door.offset, door.width);
    state.doors.push(door);
  }

  for (const w of template.windows) {
    const win: WindowItem = {
      id: createId('w'),
      type: w.type,
      name: w.name,
      wall: w.wall,
      offset: w.offset,
      width: w.width,
    };
    win.offset = clampOpeningOffset(room, win.wall, win.offset, win.width);
    state.windows.push(win);
  }

  return state;
}

/** The bedroom shown in the homepage demo. */
export const DEMO_TEMPLATE_ID = 'bedroom';
