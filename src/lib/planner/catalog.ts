/**
 * The furniture library.
 *
 * Dimensions are stored in INCHES and reflect common real-world sizes, so a
 * plan is useful before anyone reaches for a tape measure. Everything is
 * editable after placement.
 *
 * `width` runs left-to-right and `height` front-to-back in the item's own
 * unrotated frame, matching how a top-down icon is drawn.
 */

import type { FurnitureShape } from './types';

export interface ColorSwatch {
  id: string;
  name: string;
  value: string;
}

/** The muted palette from the design system. Furniture is a little stronger
 *  than the UI chrome so a floor plan stays readable at a glance. */
export const COLOR_PALETTE: ColorSwatch[] = [
  { id: 'neutral', name: 'Neutral', value: '#CBBBA6' },
  { id: 'wood', name: 'Wood', value: '#B78454' },
  { id: 'white', name: 'White', value: '#F0EBE1' },
  { id: 'black', name: 'Black', value: '#3D3935' },
  { id: 'gray', name: 'Gray', value: '#A6A29B' },
  { id: 'blue', name: 'Blue', value: '#7E9DBD' },
  { id: 'green', name: 'Green', value: '#8DA886' },
];

export const DEFAULT_COLOR = COLOR_PALETTE[0]!.value;

export interface CatalogItem {
  /** Stable key stored on placed furniture. */
  key: string;
  name: string;
  category: CategoryId;
  shape: FurnitureShape;
  width: number;
  height: number;
  color: string;
  /** Decorative items sit under others and are exempt from overlap warnings. */
  decorative?: boolean;
  /** Draw order hint; rugs go to the bottom, lamps to the top. */
  z?: number;
  /** Short helper text shown in the library. */
  hint?: string;
}

export type CategoryId =
  | 'bedroom'
  | 'living'
  | 'dining'
  | 'office'
  | 'kitchen'
  | 'bathroom'
  | 'storage'
  | 'other';

export interface Category {
  id: CategoryId;
  name: string;
}

export const CATEGORIES: Category[] = [
  { id: 'bedroom', name: 'Bedroom' },
  { id: 'living', name: 'Living Room' },
  { id: 'dining', name: 'Dining' },
  { id: 'office', name: 'Office' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'bathroom', name: 'Bathroom' },
  { id: 'storage', name: 'Storage' },
  { id: 'other', name: 'Other' },
];

const WOOD = '#B78454';
const NEUTRAL = '#CBBBA6';
const GRAY = '#A6A29B';
const WHITE = '#F0EBE1';
const BLUE = '#7E9DBD';
const GREEN = '#8DA886';
const DARK = '#3D3935';

export const CATALOG: CatalogItem[] = [
  // ---------------------------------------------------------------- Bedroom
  { key: 'bed', name: 'Bed', category: 'bedroom', shape: 'bed', width: 54, height: 75, color: BLUE, hint: 'Double' },
  { key: 'single-bed', name: 'Single Bed', category: 'bedroom', shape: 'bed', width: 36, height: 75, color: BLUE },
  { key: 'double-bed', name: 'Double Bed', category: 'bedroom', shape: 'bed', width: 54, height: 75, color: BLUE },
  { key: 'queen-bed', name: 'Queen Bed', category: 'bedroom', shape: 'bed', width: 60, height: 80, color: BLUE },
  { key: 'king-bed', name: 'King Bed', category: 'bedroom', shape: 'bed', width: 72, height: 80, color: BLUE },
  { key: 'bunk-bed', name: 'Bunk Bed', category: 'bedroom', shape: 'bunk-bed', width: 42, height: 78, color: BLUE },
  { key: 'nightstand', name: 'Nightstand', category: 'bedroom', shape: 'storage', width: 20, height: 18, color: WOOD },
  { key: 'wardrobe', name: 'Wardrobe', category: 'bedroom', shape: 'wardrobe', width: 72, height: 24, color: WOOD },
  { key: 'dresser', name: 'Dresser', category: 'bedroom', shape: 'storage', width: 60, height: 20, color: WOOD },
  { key: 'bedroom-desk', name: 'Desk', category: 'bedroom', shape: 'desk', width: 48, height: 24, color: WOOD },
  { key: 'bedroom-chair', name: 'Chair', category: 'bedroom', shape: 'chair', width: 18, height: 18, color: NEUTRAL },
  { key: 'mirror', name: 'Mirror', category: 'bedroom', shape: 'mirror', width: 24, height: 4, color: GRAY },

  // ------------------------------------------------------------ Living room
  { key: 'sofa', name: 'Sofa', category: 'living', shape: 'sofa', width: 84, height: 36, color: GREEN, hint: '3 seats' },
  { key: 'sofa-2', name: '2-Seater Sofa', category: 'living', shape: 'sofa', width: 60, height: 34, color: GREEN },
  { key: 'sofa-3', name: '3-Seater Sofa', category: 'living', shape: 'sofa', width: 84, height: 36, color: GREEN },
  { key: 'sofa-l', name: 'L-Shaped Sofa', category: 'living', shape: 'sofa-l', width: 100, height: 76, color: GREEN },
  { key: 'coffee-table', name: 'Coffee Table', category: 'living', shape: 'table', width: 48, height: 24, color: WOOD },
  { key: 'tv-stand', name: 'TV Stand', category: 'living', shape: 'storage', width: 60, height: 18, color: WOOD },
  { key: 'tv', name: 'TV', category: 'living', shape: 'tv', width: 49, height: 4, color: DARK },
  { key: 'bookshelf', name: 'Bookshelf', category: 'living', shape: 'shelf', width: 36, height: 12, color: WOOD },
  { key: 'armchair', name: 'Armchair', category: 'living', shape: 'armchair', width: 33, height: 34, color: GREEN },

  // ----------------------------------------------------------------- Dining
  { key: 'dining-table', name: 'Dining Table', category: 'dining', shape: 'table', width: 72, height: 36, color: WOOD },
  { key: 'table-2', name: '2-Seater Table', category: 'dining', shape: 'round-table', width: 30, height: 30, color: WOOD },
  { key: 'table-4', name: '4-Seater Table', category: 'dining', shape: 'table', width: 48, height: 30, color: WOOD },
  { key: 'table-6', name: '6-Seater Table', category: 'dining', shape: 'table', width: 72, height: 36, color: WOOD },
  { key: 'table-8', name: '8-Seater Table', category: 'dining', shape: 'table', width: 96, height: 40, color: WOOD },
  { key: 'dining-chair', name: 'Dining Chair', category: 'dining', shape: 'chair', width: 18, height: 20, color: NEUTRAL },

  // ----------------------------------------------------------------- Office
  { key: 'office-desk', name: 'Office Desk', category: 'office', shape: 'desk', width: 60, height: 30, color: WOOD },
  { key: 'office-chair', name: 'Office Chair', category: 'office', shape: 'chair', width: 26, height: 26, color: DARK },
  { key: 'office-bookshelf', name: 'Bookshelf', category: 'office', shape: 'shelf', width: 36, height: 12, color: WOOD },
  { key: 'filing-cabinet', name: 'Filing Cabinet', category: 'office', shape: 'storage', width: 18, height: 24, color: GRAY },
  { key: 'printer', name: 'Printer', category: 'office', shape: 'appliance', width: 18, height: 16, color: GRAY },

  // ---------------------------------------------------------------- Kitchen
  { key: 'kitchen-counter', name: 'Kitchen Counter', category: 'kitchen', shape: 'counter', width: 96, height: 25, color: WHITE },
  { key: 'refrigerator', name: 'Refrigerator', category: 'kitchen', shape: 'appliance', width: 36, height: 30, color: GRAY },
  { key: 'oven', name: 'Oven', category: 'kitchen', shape: 'appliance', width: 30, height: 26, color: GRAY },
  { key: 'kitchen-sink', name: 'Sink', category: 'kitchen', shape: 'sink', width: 33, height: 22, color: WHITE },
  { key: 'island', name: 'Island', category: 'kitchen', shape: 'counter', width: 72, height: 36, color: WHITE },

  // --------------------------------------------------------------- Bathroom
  { key: 'bathtub', name: 'Bathtub', category: 'bathroom', shape: 'bathtub', width: 60, height: 30, color: WHITE },
  { key: 'shower', name: 'Shower', category: 'bathroom', shape: 'shower', width: 36, height: 36, color: WHITE },
  { key: 'toilet', name: 'Toilet', category: 'bathroom', shape: 'toilet', width: 20, height: 28, color: WHITE },
  { key: 'bathroom-sink', name: 'Sink', category: 'bathroom', shape: 'sink', width: 24, height: 20, color: WHITE },
  { key: 'bathroom-cabinet', name: 'Cabinet', category: 'bathroom', shape: 'storage', width: 30, height: 21, color: WHITE },

  // ---------------------------------------------------------------- Storage
  { key: 'cabinet', name: 'Cabinet', category: 'storage', shape: 'storage', width: 36, height: 18, color: WOOD },
  { key: 'shelf', name: 'Shelf', category: 'storage', shape: 'shelf', width: 36, height: 12, color: WOOD },
  { key: 'storage-box', name: 'Storage Box', category: 'storage', shape: 'box', width: 24, height: 18, color: NEUTRAL },

  // ------------------------------------------------------------------ Other
  { key: 'rug', name: 'Rug', category: 'other', shape: 'rug', width: 96, height: 60, color: NEUTRAL, decorative: true, z: -10 },
  { key: 'plant', name: 'Plant', category: 'other', shape: 'plant', width: 18, height: 18, color: GREEN, decorative: true, z: 10 },
  { key: 'lamp', name: 'Lamp', category: 'other', shape: 'lamp', width: 14, height: 14, color: NEUTRAL, decorative: true, z: 10 },
  { key: 'pet-bed', name: 'Pet Bed', category: 'other', shape: 'box', width: 30, height: 22, color: NEUTRAL, decorative: true },
];

const BY_KEY = new Map(CATALOG.map((item) => [item.key, item]));

export function getCatalogItem(key: string): CatalogItem | undefined {
  return BY_KEY.get(key);
}

export function catalogByCategory(category: CategoryId): CatalogItem[] {
  return CATALOG.filter((item) => item.category === category);
}

/**
 * Everyday words people actually type that do not appear in any catalog name.
 * Searching "couch" used to return nothing at all, which reads as a missing
 * feature rather than a vocabulary gap. Keys are what someone types; values are
 * the catalog keys they should find.
 */
const SYNONYMS: Record<string, string[]> = {
  couch: ['sofa', 'sofa-2', 'sofa-3', 'sofa-l'],
  settee: ['sofa', 'sofa-2', 'sofa-3'],
  loveseat: ['sofa-2'],
  sectional: ['sofa-l'],
  recliner: ['armchair'],
  closet: ['wardrobe'],
  almirah: ['wardrobe'],
  'chest of drawers': ['dresser'],
  bureau: ['dresser'],
  'bedside table': ['nightstand'],
  'side table': ['nightstand'],
  'end table': ['nightstand'],
  nightstand: ['nightstand'],
  cot: ['single-bed'],
  crib: ['single-bed'],
  twin: ['single-bed'],
  full: ['double-bed'],
  fridge: ['refrigerator'],
  freezer: ['refrigerator'],
  stove: ['oven'],
  cooker: ['oven'],
  range: ['oven'],
  hob: ['oven'],
  television: ['tv', 'tv-stand'],
  telly: ['tv'],
  monitor: ['tv'],
  worktop: ['kitchen-counter'],
  countertop: ['kitchen-counter'],
  basin: ['bathroom-sink', 'kitchen-sink'],
  washbasin: ['bathroom-sink'],
  lavatory: ['toilet'],
  loo: ['toilet'],
  wc: ['toilet'],
  bath: ['bathtub'],
  tub: ['bathtub'],
  carpet: ['rug'],
  mat: ['rug'],
  bookcase: ['bookshelf', 'office-bookshelf'],
  shelving: ['shelf', 'bookshelf'],
  cabinet: ['cabinet', 'bathroom-cabinet', 'filing-cabinet'],
  cupboard: ['cabinet', 'wardrobe'],
  table: ['dining-table', 'coffee-table', 'table-4', 'table-6'],
  seat: ['chair', 'dining-chair', 'armchair'],
  stool: ['bedroom-chair', 'dining-chair'],
  workstation: ['office-desk'],
  plant: ['plant'],
  pot: ['plant'],
};

/**
 * Case-insensitive search across names, categories, shapes and the synonym map.
 * Order is preserved from CATALOG so results stay grouped sensibly.
 */
export function searchCatalog(query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG;

  const viaSynonym = new Set<string>();
  for (const [word, keys] of Object.entries(SYNONYMS)) {
    if (word.includes(q) || q.includes(word)) keys.forEach((key) => viaSynonym.add(key));
  }

  return CATALOG.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.category.includes(q) ||
      item.shape.includes(q) ||
      viaSynonym.has(item.key),
  );
}

/** The catalog keys a query matches, for the library's DOM-level filter. */
export function searchCatalogKeys(query: string): Set<string> {
  return new Set(searchCatalog(query).map((item) => item.key));
}
