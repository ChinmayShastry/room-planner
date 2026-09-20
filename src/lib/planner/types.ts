/**
 * Core data model for Room Planner.
 *
 * Every length in this file is stored in INCHES, the canonical internal unit.
 * Display units are converted at the edges (see `units.ts`) so that repeated
 * unit switching never accumulates rounding error in the stored model.
 *
 * Coordinate system
 * -----------------
 *   (0, 0) is the inside top-left corner of the room.
 *   +x runs right along the top wall, +y runs down the left wall.
 *   Furniture `x`/`y` is the CENTRE of the item, which keeps rotation maths
 *   trivial (rotate about the centre, position is unchanged).
 *   Doors and windows are positioned by their centre `offset` along their wall,
 *   measured from the wall's start corner in clockwise order.
 */

export const UNITS = ['ft', 'm', 'in', 'cm'] as const;
export type Unit = (typeof UNITS)[number];

export const WALLS = ['top', 'right', 'bottom', 'left'] as const;
export type Wall = (typeof WALLS)[number];

export type SwingDirection = 'in-left' | 'in-right' | 'out-left' | 'out-right';

export type DoorType = 'single' | 'double' | 'sliding' | 'opening';
export type WindowType = 'standard' | 'large' | 'sliding';

export type FloorColor = 'light' | 'warm' | 'gray';
export type GridSize = 'off' | 'fine' | 'medium' | 'large';

/** Broad shape family used by the renderer to draw a top-down icon. */
export type FurnitureShape =
  | 'bed'
  | 'bunk-bed'
  | 'sofa'
  | 'sofa-l'
  | 'armchair'
  | 'table'
  | 'round-table'
  | 'chair'
  | 'desk'
  | 'storage'
  | 'wardrobe'
  | 'shelf'
  | 'tv'
  | 'appliance'
  | 'counter'
  | 'sink'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'rug'
  | 'plant'
  | 'lamp'
  | 'mirror'
  | 'box';

export interface Room {
  id: string;
  name: string;
  /** Interior width (along x) in inches. */
  width: number;
  /** Interior length/depth (along y) in inches. */
  height: number;
  /** Unit used for display only — the numbers above are always inches. */
  unit: Unit;
  floorColor: FloorColor;
  /** Wall thickness in inches, drawn outside the interior rectangle. */
  wallThickness: number;
}

export interface FurnitureItem {
  id: string;
  /** Catalog key, e.g. `queen-bed`. Kept so items can be re-matched to the catalog. */
  type: string;
  name: string;
  shape: FurnitureShape;
  category: string;
  /** Centre position in inches. */
  x: number;
  y: number;
  /** Footprint in inches, before rotation. */
  width: number;
  height: number;
  /** Clockwise degrees, 0–359. */
  rotation: number;
  color: string;
  labelVisible: boolean;
  /** Decorative items (rugs, plants) are excluded from overlap warnings. */
  decorative: boolean;
  /** Draw order; higher renders on top. */
  z: number;
}

export interface Door {
  id: string;
  type: DoorType;
  name: string;
  wall: Wall;
  /** Centre offset along the wall, in inches from the wall's start corner. */
  offset: number;
  width: number;
  swing: SwingDirection;
}

export interface WindowItem {
  id: string;
  type: WindowType;
  name: string;
  wall: Wall;
  offset: number;
  width: number;
}

export interface PlannerSettings {
  grid: GridSize;
  snap: boolean;
  showLabels: boolean;
  showDimensions: boolean;
  showClearance: boolean;
}

export interface MeasurePoint {
  x: number;
  y: number;
}

export interface MeasureLine {
  a: MeasurePoint;
  b: MeasurePoint;
}

/** The complete serialisable document. `history` lives outside this on purpose. */
export interface PlannerState {
  room: Room;
  furniture: FurnitureItem[];
  doors: Door[];
  windows: WindowItem[];
  settings: PlannerSettings;
}

export interface SavedLayout {
  id: string;
  name: string;
  /** ISO timestamp. */
  updatedAt: string;
  state: PlannerState;
}

/** Envelope used by both localStorage and JSON import/export. */
export interface LayoutFile {
  app: 'room-planner';
  version: number;
  exportedAt: string;
  layout: {
    name: string;
    state: PlannerState;
  };
}

export const SCHEMA_VERSION = 1;

/** Hard limits that keep the planner responsive and localStorage small. */
export const LIMITS = {
  maxFurniture: 120,
  maxDoors: 12,
  maxWindows: 16,
  /** Inches. 12in x 12in minimum room, 200ft maximum side. */
  minRoomSide: 12,
  maxRoomSide: 2400,
  minItemSide: 2,
  maxItemSide: 2400,
  historyDepth: 60,
  maxSavedLayouts: 24,
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}
