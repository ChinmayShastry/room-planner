/**
 * The planner engine.
 *
 * Owns the document, the viewport and every canvas interaction. It knows
 * nothing about sidebars or toolbars — `planner-ui.ts` binds those and calls in
 * here. Splitting it this way keeps the drag/zoom maths testable in isolation
 * and lets the homepage demo reuse the engine without any of the chrome.
 */

import { trackEvent } from '@lib/planner/analytics';
import { computeClearance, findOutside, findOverlaps } from '@lib/planner/collision';
import type { ClearanceReport } from '@lib/planner/collision';
import { itemBounds, normalizeAngle, rotatePoint } from '@lib/planner/geometry';
import { History } from '@lib/planner/history';
import { fitViewport, renderScene } from '@lib/planner/render';
import type { Selection, Viewport } from '@lib/planner/render';
import { GRID_INCHES, snapAngle, snapPosition, snapSize, snapValue } from '@lib/planner/snapping';
import {
  addFurniture,
  clampOpeningOffset,
  duplicateItem,
  emptyState,
  reflowOpenings,
} from '@lib/planner/state';
import { clamp } from '@lib/planner/units';
import { LIMITS } from '@lib/planner/types';
import type { FurnitureItem, MeasureLine, PlannerState, Room, Vec2 } from '@lib/planner/types';

export type { Selection, Viewport };

const MIN_SCALE_FACTOR = 0.25;
const MAX_SCALE_FACTOR = 14;
/** Keep at least this much of the room on screen so it can never be lost. */
const PAN_KEEP_VISIBLE = 48;

export interface EngineEvents {
  onStateChange?: (state: PlannerState, reason: string) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  onToast?: (message: string, tone?: 'info' | 'warn' | 'ok') => void;
  /** Fires when the measure tool is toggled or a measurement changes. */
  onMeasureChange?: () => void;
  onDirty?: () => void;
}

export interface EngineOptions extends EngineEvents {
  /** Demo mode drops measuring, keyboard shortcuts and history churn. */
  demo?: boolean;
  initialState?: PlannerState;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; startClient: Vec2; startViewport: Viewport; moved: boolean }
  | {
      kind: 'move';
      id: string;
      pointerOffset: Vec2;
      origin: FurnitureItem;
      moved: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      handle: string;
      origin: FurnitureItem;
    }
  | { kind: 'rotate'; id: string; origin: FurnitureItem }
  | { kind: 'opening'; kindOf: 'door' | 'window'; id: string; moved: boolean };

export class PlannerEngine {
  readonly svg: SVGSVGElement;
  private readonly wrap: HTMLElement;
  private readonly layers: Record<string, SVGGElement> = {};
  private readonly sceneGroup: SVGGElement;
  private readonly lastMarkup: Record<string, string> = {};

  private history: History<PlannerState>;
  state: PlannerState;
  viewport: Viewport = { scale: 1, tx: 0, ty: 0 };
  selection: Selection | null = null;

  overlaps = new Set<string>();
  outside = new Set<string>();
  clearance: ClearanceReport | null = null;
  private clearanceIds = new Set<string>();

  measure: MeasureLine | null = null;
  measureDraft: MeasureLine | null = null;
  measureMode = false;
  private measureAnchor: Vec2 | null = null;

  private drag: DragMode = { kind: 'none' };
  private readonly activePointers = new Map<number, Vec2>();
  private pinchStart: { distance: number; scale: number; centre: Vec2 } | null = null;
  private spaceHeld = false;
  /** Set once the person zooms or pans, after which we stop auto-fitting. */
  private userAdjustedView = false;
  private renderQueued = false;
  private readonly options: EngineOptions;
  private readonly demo: boolean;
  private destroyed = false;

  constructor(svg: SVGSVGElement, options: EngineOptions = {}) {
    this.svg = svg;
    this.options = options;
    this.demo = options.demo ?? false;
    this.wrap = (svg.parentElement as HTMLElement) ?? svg;

    this.state = options.initialState ?? emptyState();
    this.history = new History(this.state, { depth: LIMITS.historyDepth, coalesceMs: 450 });

    this.sceneGroup = this.ensureGroup(svg, 'rp-scene');
    for (const name of ['floor', 'grid', 'walls', 'openings', 'furniture', 'dimensions', 'overlay']) {
      this.layers[name] = this.ensureGroup(this.sceneGroup, `rp-layer-${name}`);
    }

    this.attachPointerHandlers();
    this.attachViewHandlers();
    if (!this.demo) this.attachKeyboardHandlers();

    this.resizeToContainer();
    this.fit();
    this.recomputeDerived();
    this.render();
  }

  // ------------------------------------------------------------- lifecycle

  private ensureGroup(parent: SVGElement, id: string): SVGGElement {
    const existing = parent.querySelector<SVGGElement>(`#${id}`);
    if (existing) return existing;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = id;
    parent.appendChild(g);
    return g;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private resizeObserver: ResizeObserver | null = null;

  private attachViewHandlers(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed) return;
        this.resizeToContainer();
        if (this.userAdjustedView) {
          // Respect a zoom the person chose; just keep the same point centred.
          const before = this.centreInScene();
          this.centreOn(before);
          this.requestRender();
        } else {
          // Still on the automatic view, so re-fit. This also recovers from the
          // first measurement happening before layout has settled.
          this.fit();
        }
      });
      this.resizeObserver.observe(this.wrap);
    }

    this.svg.addEventListener('wheel', this.onWheel, { passive: false });
    this.svg.addEventListener('contextmenu', (event) => {
      if (this.drag.kind === 'pan') event.preventDefault();
    });
  }

  private resizeToContainer(): void {
    const rect = this.wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  private get viewSize(): { width: number; height: number } {
    const rect = this.wrap.getBoundingClientRect();
    return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  // ------------------------------------------------------------ coordinates

  /** Client (screen) coordinates to scene inches. */
  toScene(clientX: number, clientY: number): Vec2 {
    const rect = this.svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: (px - this.viewport.tx) / this.viewport.scale,
      y: (py - this.viewport.ty) / this.viewport.scale,
    };
  }

  private centreInScene(): Vec2 {
    const { width, height } = this.viewSize;
    return {
      x: (width / 2 - this.viewport.tx) / this.viewport.scale,
      y: (height / 2 - this.viewport.ty) / this.viewport.scale,
    };
  }

  private centreOn(point: Vec2): void {
    const { width, height } = this.viewSize;
    this.viewport.tx = width / 2 - point.x * this.viewport.scale;
    this.viewport.ty = height / 2 - point.y * this.viewport.scale;
    this.constrainViewport();
  }

  /**
   * Never let the room leave the screen entirely.
   * The plan always keeps a strip of itself inside the viewport.
   */
  private constrainViewport(): void {
    const { width, height } = this.viewSize;
    const s = this.viewport.scale;
    const roomW = this.state.room.width * s;
    const roomH = this.state.room.height * s;
    const keepX = Math.min(PAN_KEEP_VISIBLE, roomW);
    const keepY = Math.min(PAN_KEEP_VISIBLE, roomH);
    this.viewport.tx = clamp(this.viewport.tx, keepX - roomW, width - keepX);
    this.viewport.ty = clamp(this.viewport.ty, keepY - roomH, height - keepY);
  }

  private get minScale(): number {
    const { width, height } = this.viewSize;
    const base = fitViewport(this.state.room, width, height).scale;
    return base * MIN_SCALE_FACTOR;
  }

  private get maxScale(): number {
    const { width, height } = this.viewSize;
    const base = fitViewport(this.state.room, width, height).scale;
    return Math.max(base * MAX_SCALE_FACTOR, 2);
  }

  fit(): void {
    const { width, height } = this.viewSize;
    this.viewport = fitViewport(this.state.room, width, height, this.demo ? 28 : 64);
    this.userAdjustedView = false;
    this.requestRender();
  }

  /** Zoom around a fixed screen point so the content under the cursor stays put. */
  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const rect = this.svg.getBoundingClientRect();
    const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const next = clamp(this.viewport.scale * factor, this.minScale, this.maxScale);
    if (next === this.viewport.scale) return;
    const scenePoint = {
      x: (px - this.viewport.tx) / this.viewport.scale,
      y: (py - this.viewport.ty) / this.viewport.scale,
    };
    this.viewport.scale = next;
    this.viewport.tx = px - scenePoint.x * next;
    this.viewport.ty = py - scenePoint.y * next;
    this.userAdjustedView = true;
    this.constrainViewport();
    this.requestRender();
  }

  get zoomPercent(): number {
    const { width, height } = this.viewSize;
    const base = fitViewport(this.state.room, width, height, this.demo ? 28 : 64).scale || 1;
    return Math.round((this.viewport.scale / base) * 100);
  }

  // ------------------------------------------------------------- rendering

  requestRender(): void {
    if (this.renderQueued || this.destroyed) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render(): void {
    const layers = renderScene({
      state: this.state,
      viewport: this.viewport,
      selection: this.selection,
      overlaps: this.overlaps,
      outside: this.outside,
      measure: this.measure,
      measureDraft: this.measureDraft,
      clearanceIds: this.clearanceIds,
    });

    this.sceneGroup.setAttribute(
      'transform',
      `translate(${round(this.viewport.tx)} ${round(this.viewport.ty)}) scale(${round(this.viewport.scale, 5)})`,
    );

    // Remember which object had focus so a re-render never steals it.
    const active = document.activeElement;
    const focusedId =
      active instanceof Element && this.svg.contains(active)
        ? active.closest('[data-id]')?.getAttribute('data-id')
        : null;

    for (const [name, markup] of Object.entries(layers)) {
      const target = this.layers[name];
      if (!target) continue;
      if (this.lastMarkup[name] === markup) continue;
      this.lastMarkup[name] = markup;
      target.innerHTML = markup;
    }

    if (focusedId) {
      const next = this.svg.querySelector<SVGGElement>(`[data-id="${cssEscape(focusedId)}"]`);
      if (next && document.activeElement !== next) next.focus({ preventScroll: true });
    }

    this.svg.classList.toggle('is-measuring', this.measureMode);
    this.svg.classList.toggle('is-pan-ready', this.spaceHeld);
  }

  // ------------------------------------------------------------ derived data

  recomputeDerived(): void {
    const overlap = findOverlaps(this.state.furniture);
    this.overlaps = overlap.ids;
    this.outside = findOutside(this.state.furniture, this.state.room);

    if (this.state.settings.showClearance) {
      this.clearance = computeClearance(
        this.state.furniture,
        this.state.room,
        undefined,
        this.state.doors,
      );
      this.clearanceIds = new Set(this.clearance.issues.flatMap((issue) => issue.itemIds));
    } else {
      this.clearance = null;
      this.clearanceIds = new Set();
    }
  }

  // ------------------------------------------------------------- mutations

  /** Apply a mutation, record it in history, re-derive warnings and repaint. */
  commit(label: string, mutate: (state: PlannerState) => void, coalesce = false): void {
    mutate(this.state);
    this.history.push(this.state, label, coalesce);
    this.afterChange(label);
  }

  /** Apply a change without an undo step — used while a drag is in flight. */
  applyTransient(mutate: (state: PlannerState) => void): void {
    mutate(this.state);
    this.recomputeDerived();
    this.requestRender();
  }

  private afterChange(reason: string): void {
    this.recomputeDerived();
    this.requestRender();
    this.options.onStateChange?.(this.state, reason);
    this.options.onHistoryChange?.(this.history.canUndo, this.history.canRedo);
    this.options.onDirty?.();
  }

  /**
   * Swap the whole document — loading a template, opening a saved layout,
   * importing a file, starting a new room.
   *
   * `keepHistory` is the default and matters: without it, one curious click on
   * a template silently destroyed an arranged room with no way back, because
   * the undo stack was reset and autosave overwrote the stored copy moments
   * later. Pushing the swap onto the stack instead makes it plain Ctrl+Z.
   *
   * Only the very first load (nothing to lose yet) resets the stack.
   */
  replaceState(
    next: PlannerState,
    reason: string,
    opts: { resetView?: boolean; keepHistory?: boolean } = {},
  ): void {
    this.state = next;
    if (opts.keepHistory === false) this.history.reset(next, reason);
    else this.history.push(next, reason);

    this.selection = null;
    this.measure = null;
    this.measureDraft = null;
    this.measureAnchor = null;
    // Layer cache must be dropped or unchanged-looking markup would be skipped.
    for (const key of Object.keys(this.lastMarkup)) delete this.lastMarkup[key];
    if (opts.resetView !== false) this.fit();
    this.recomputeDerived();
    this.render();
    this.options.onSelectionChange?.(null);
    this.options.onStateChange?.(this.state, reason);
    this.options.onHistoryChange?.(this.history.canUndo, this.history.canRedo);
    this.options.onDirty?.();
  }

  select(selection: Selection | null): void {
    const same =
      selection?.id === this.selection?.id && selection?.kind === this.selection?.kind;
    if (same) return;
    this.selection = selection;
    this.requestRender();
    this.options.onSelectionChange?.(selection);
  }

  get selectedItem(): FurnitureItem | null {
    if (this.selection?.kind !== 'furniture') return null;
    return this.state.furniture.find((f) => f.id === this.selection?.id) ?? null;
  }

  /**
   * Shared tail for undo and redo.
   *
   * A history step can now cross a whole-document swap, so the room itself may
   * be a different size than the one on screen. When that happens the view is
   * re-fitted, otherwise the restored room would land off-screen or at a
   * nonsensical zoom.
   */
  private applyHistoryStep(next: PlannerState, previousRoom: Room, reason: 'undo' | 'redo'): void {
    const roomChanged =
      next.room.width !== previousRoom.width || next.room.height !== previousRoom.height;

    this.state = next;
    this.ensureSelectionExists();
    this.recomputeDerived();
    if (roomChanged) this.fit();
    this.requestRender();
    this.options.onStateChange?.(this.state, reason);
    this.options.onHistoryChange?.(this.history.canUndo, this.history.canRedo);
    this.options.onSelectionChange?.(this.selection);
    this.options.onDirty?.();
  }

  undo(): void {
    const previousRoom = this.state.room;
    const next = this.history.undo();
    if (!next) return;
    this.applyHistoryStep(next, previousRoom, 'undo');
  }

  redo(): void {
    const previousRoom = this.state.room;
    const next = this.history.redo();
    if (!next) return;
    this.applyHistoryStep(next, previousRoom, 'redo');
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  private ensureSelectionExists(): void {
    if (!this.selection) return;
    const lists = {
      furniture: this.state.furniture,
      door: this.state.doors,
      window: this.state.windows,
    } as const;
    const list: Array<{ id: string }> = lists[this.selection.kind];
    if (!list.some((entry) => entry.id === this.selection?.id)) this.selection = null;
  }

  // --------------------------------------------------------- object actions

  addFurnitureByKey(key: string): FurnitureItem | null {
    const result = addFurniture(this.state, key);
    if (!result.item) {
      if (result.warning) this.options.onToast?.(result.warning, 'warn');
      return null;
    }
    const item = result.item;
    this.commit('Add item', (state) => {
      state.furniture.push(item);
    });
    this.select({ kind: 'furniture', id: item.id });
    if (result.warning) this.options.onToast?.(result.warning, 'warn');
    trackEvent('furniture_added', { item_type: key, count: this.state.furniture.length });
    return item;
  }

  deleteSelected(): void {
    const selection = this.selection;
    if (!selection) return;
    this.commit('Delete', (state) => {
      if (selection.kind === 'furniture') {
        state.furniture = state.furniture.filter((f) => f.id !== selection.id);
      } else if (selection.kind === 'door') {
        state.doors = state.doors.filter((d) => d.id !== selection.id);
      } else {
        state.windows = state.windows.filter((w) => w.id !== selection.id);
      }
    });
    this.select(null);
    trackEvent('furniture_deleted', { kind: selection.kind });
  }

  duplicateSelected(): void {
    const item = this.selectedItem;
    if (!item) return;
    if (this.state.furniture.length >= LIMITS.maxFurniture) {
      this.options.onToast?.(`You have reached the limit of ${LIMITS.maxFurniture} items.`, 'warn');
      return;
    }
    const copy = duplicateItem(this.state, item);
    this.commit('Duplicate', (state) => {
      state.furniture.push(copy);
    });
    this.select({ kind: 'furniture', id: copy.id });
    trackEvent('furniture_duplicated', { item_type: copy.type });
  }

  rotateSelected(delta: number): void {
    const item = this.selectedItem;
    if (!item) return;
    this.updateSelectedItem({ rotation: normalizeAngle(item.rotation + delta) }, 'Rotate');
    trackEvent('furniture_rotated', { item_type: item.type, delta });
  }

  updateSelectedItem(patch: Partial<FurnitureItem>, label: string, coalesce = false): void {
    const id = this.selection?.kind === 'furniture' ? this.selection.id : null;
    if (!id) return;
    this.commit(
      label,
      (state) => {
        const target = state.furniture.find((f) => f.id === id);
        if (!target) return;
        Object.assign(target, sanitizePatch(patch, state));
      },
      coalesce,
    );
  }

  /** Move the selected item by a whole number of inches (keyboard nudge). */
  nudgeSelected(dx: number, dy: number): void {
    const item = this.selectedItem;
    if (!item) return;
    this.updateSelectedItem({ x: item.x + dx, y: item.y + dy }, 'Move', true);
  }

  bringForward(step: number): void {
    const item = this.selectedItem;
    if (!item) return;
    this.updateSelectedItem({ z: item.z + step }, 'Reorder');
  }

  // -------------------------------------------------------------- settings

  setSetting<K extends keyof PlannerState['settings']>(key: K, value: PlannerState['settings'][K]): void {
    this.commit('Change view', (state) => {
      state.settings[key] = value;
    });
  }

  setRoomSize(widthIn: number, heightIn: number, label = 'Resize room'): void {
    const width = clamp(widthIn, LIMITS.minRoomSide, LIMITS.maxRoomSide);
    const height = clamp(heightIn, LIMITS.minRoomSide, LIMITS.maxRoomSide);
    this.commit(label, (state) => {
      state.room.width = width;
      state.room.height = height;
      // Furniture is deliberately left where it is; out-of-room items get a
      // warning instead of being moved or deleted behind the user's back.
      reflowOpenings(state);
    });
    this.fit();
  }

  // ------------------------------------------------------------- measuring

  setMeasureMode(on: boolean): void {
    this.measureMode = on;
    this.measureAnchor = null;
    this.measureDraft = null;
    if (!on) this.measure = null;
    if (on) this.select(null);
    this.requestRender();
    this.options.onMeasureChange?.();
  }

  clearMeasure(): void {
    this.measure = null;
    this.measureDraft = null;
    this.measureAnchor = null;
    this.requestRender();
    this.options.onMeasureChange?.();
  }

  // ------------------------------------------------------- pointer handling

  private attachPointerHandlers(): void {
    this.svg.addEventListener('pointerdown', this.onPointerDown);
    this.svg.addEventListener('pointermove', this.onPointerMove);
    this.svg.addEventListener('pointerup', this.onPointerUp);
    this.svg.addEventListener('pointercancel', this.onPointerUp);
    this.svg.addEventListener('lostpointercapture', this.onPointerUp);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary && this.activePointers.size >= 1) {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.beginPinch();
      return;
    }
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const target = event.target as Element | null;
    const point = this.toScene(event.clientX, event.clientY);

    if (this.measureMode) {
      event.preventDefault();
      this.handleMeasureClick(point);
      return;
    }

    const handle = target?.closest<SVGElement>('[data-handle]');
    const node = target?.closest<SVGGElement>('[data-kind]');

    // Middle button, space-drag or a bare floor drag pans the view.
    const wantsPan = event.button === 1 || this.spaceHeld || (!handle && !node);
    if (wantsPan) {
      event.preventDefault();
      this.svg.setPointerCapture(event.pointerId);
      this.svg.classList.add('is-panning');
      this.drag = {
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: { ...this.viewport },
        moved: false,
      };
      return;
    }

    if (handle && this.selectedItem) {
      event.preventDefault();
      this.svg.setPointerCapture(event.pointerId);
      const role = handle.getAttribute('data-handle')!;
      const origin = { ...this.selectedItem };
      this.drag = role === 'rotate' ? { kind: 'rotate', id: origin.id, origin } : { kind: 'resize', id: origin.id, handle: role, origin };
      return;
    }

    if (!node) return;
    const kind = node.getAttribute('data-kind') as Selection['kind'];
    const id = node.getAttribute('data-id');
    if (!id) return;

    event.preventDefault();
    this.select({ kind, id });
    this.svg.setPointerCapture(event.pointerId);

    if (kind === 'furniture') {
      const item = this.state.furniture.find((f) => f.id === id);
      if (!item) return;
      this.drag = {
        kind: 'move',
        id,
        pointerOffset: { x: point.x - item.x, y: point.y - item.y },
        origin: { ...item },
        moved: false,
      };
    } else {
      this.drag = { kind: 'opening', kindOf: kind, id, moved: false };
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.activePointers.has(event.pointerId)) {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.pinchStart && this.activePointers.size >= 2) {
      event.preventDefault();
      this.updatePinch();
      return;
    }

    if (this.measureMode && this.measureAnchor) {
      this.measureDraft = { a: this.measureAnchor, b: this.toScene(event.clientX, event.clientY) };
      this.requestRender();
      return;
    }

    switch (this.drag.kind) {
      case 'pan': {
        event.preventDefault();
        const dx = event.clientX - this.drag.startClient.x;
        const dy = event.clientY - this.drag.startClient.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          this.drag.moved = true;
          this.userAdjustedView = true;
        }
        this.viewport.tx = this.drag.startViewport.tx + dx;
        this.viewport.ty = this.drag.startViewport.ty + dy;
        this.constrainViewport();
        this.requestRender();
        break;
      }
      case 'move': {
        event.preventDefault();
        this.dragMove(event);
        break;
      }
      case 'resize': {
        event.preventDefault();
        this.dragResize(event);
        break;
      }
      case 'rotate': {
        event.preventDefault();
        this.dragRotate(event);
        break;
      }
      case 'opening': {
        event.preventDefault();
        this.dragOpening(event);
        break;
      }
      default:
        break;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) this.pinchStart = null;

    const drag = this.drag;
    this.svg.classList.remove('is-panning');
    if (this.svg.hasPointerCapture?.(event.pointerId)) {
      this.svg.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === 'pan') {
      // A tap with no movement clears the selection.
      if (!drag.moved) this.select(null);
    } else if (drag.kind === 'move' && drag.moved) {
      this.history.push(this.state, 'Move');
      this.afterChange('move');
      trackEvent('furniture_moved', { item_type: drag.origin.type });
    } else if (drag.kind === 'resize') {
      this.history.push(this.state, 'Resize');
      this.afterChange('resize');
      trackEvent('furniture_resized', { item_type: drag.origin.type });
    } else if (drag.kind === 'rotate') {
      this.history.push(this.state, 'Rotate');
      this.afterChange('rotate');
      trackEvent('furniture_rotated', { item_type: drag.origin.type });
    } else if (drag.kind === 'opening' && drag.moved) {
      this.history.push(this.state, 'Move opening');
      this.afterChange('opening');
    }

    this.drag = { kind: 'none' };
  };

  private dragMove(event: PointerEvent): void {
    if (this.drag.kind !== 'move') return;
    const drag = this.drag;
    const point = this.toScene(event.clientX, event.clientY);
    const item = this.state.furniture.find((f) => f.id === drag.id);
    if (!item) return;

    const desired = { x: point.x - drag.pointerOffset.x, y: point.y - drag.pointerOffset.y };
    if (Math.abs(desired.x - drag.origin.x) > 0.5 || Math.abs(desired.y - drag.origin.y) > 0.5) {
      drag.moved = true;
    }

    // Alt temporarily suspends snapping for fine placement.
    const snapOn = this.state.settings.snap && !event.altKey;
    const snapped = snapPosition(item, desired, {
      enabled: snapOn,
      grid: this.state.settings.grid,
      room: this.state.room,
    });

    this.applyTransient(() => {
      item.x = snapped.x;
      item.y = snapped.y;
    });
  }

  /**
   * Resize in the item's own rotated frame so dragging the right-hand handle of
   * a rotated wardrobe still extends it along its own length.
   */
  private dragResize(event: PointerEvent): void {
    if (this.drag.kind !== 'resize') return;
    const { origin, handle } = this.drag;
    const item = this.state.furniture.find((f) => f.id === origin.id);
    if (!item) return;

    const world = this.toScene(event.clientX, event.clientY);
    const centre = { x: origin.x, y: origin.y };
    const local = rotatePoint(world, centre, -origin.rotation);
    const lx = local.x - centre.x;
    const ly = local.y - centre.y;

    let left = -origin.width / 2;
    let right = origin.width / 2;
    let top = -origin.height / 2;
    let bottom = origin.height / 2;

    const min = LIMITS.minItemSide;
    if (handle.includes('w')) left = Math.min(lx, right - min);
    if (handle.includes('e')) right = Math.max(lx, left + min);
    if (handle.includes('n')) top = Math.min(ly, bottom - min);
    if (handle.includes('s')) bottom = Math.max(ly, top + min);

    const snapOn = this.state.settings.snap && !event.altKey;
    const ctx = { enabled: snapOn, grid: this.state.settings.grid, room: this.state.room };

    let width = clamp(right - left, min, LIMITS.maxItemSide);
    let height = clamp(bottom - top, min, LIMITS.maxItemSide);
    if (handle.includes('w') || handle.includes('e')) width = snapSize(width, ctx, min);
    if (handle.includes('n') || handle.includes('s')) height = snapSize(height, ctx, min);

    // Keep the opposite edge pinned while the dragged edge moves.
    if (handle.includes('w')) left = right - width;
    else right = left + width;
    if (handle.includes('n')) top = bottom - height;
    else bottom = top + height;

    const localCentre = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const worldCentre = rotatePoint(
      { x: centre.x + localCentre.x, y: centre.y + localCentre.y },
      centre,
      origin.rotation,
    );

    this.applyTransient(() => {
      item.width = width;
      item.height = height;
      item.x = worldCentre.x;
      item.y = worldCentre.y;
    });
  }

  private dragRotate(event: PointerEvent): void {
    if (this.drag.kind !== 'rotate') return;
    const { origin } = this.drag;
    const item = this.state.furniture.find((f) => f.id === origin.id);
    if (!item) return;

    const point = this.toScene(event.clientX, event.clientY);
    // The handle sits above the item, so 0 degrees points up.
    const raw = (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI + 90;
    const value = event.altKey ? raw : snapAngle(raw, 15);

    this.applyTransient(() => {
      item.rotation = normalizeAngle(value);
    });
  }

  /** Doors and windows slide along their wall and hop to the nearest wall. */
  private dragOpening(event: PointerEvent): void {
    if (this.drag.kind !== 'opening') return;
    const drag = this.drag;
    const point = this.toScene(event.clientX, event.clientY);
    const room = this.state.room;
    const list = drag.kindOf === 'door' ? this.state.doors : this.state.windows;
    const opening = list.find((o) => o.id === drag.id);
    if (!opening) return;

    const distances: Array<{ wall: typeof opening.wall; d: number; offset: number }> = [
      { wall: 'top', d: Math.abs(point.y), offset: point.x },
      { wall: 'bottom', d: Math.abs(room.height - point.y), offset: room.width - point.x },
      { wall: 'left', d: Math.abs(point.x), offset: room.height - point.y },
      { wall: 'right', d: Math.abs(room.width - point.x), offset: point.y },
    ];
    distances.sort((a, b) => a.d - b.d);
    const best = distances[0]!;

    const step = this.state.settings.snap ? GRID_INCHES[this.state.settings.grid] : 0;
    const raw = step > 0 ? snapValue(best.offset, step) : best.offset;

    drag.moved = true;
    this.applyTransient(() => {
      opening.wall = best.wall;
      opening.offset = clampOpeningOffset(room, best.wall, raw, opening.width);
    });
  }

  private handleMeasureClick(point: Vec2): void {
    if (!this.measureAnchor) {
      this.measureAnchor = point;
      this.measure = null;
      this.measureDraft = { a: point, b: point };
    } else {
      this.measure = { a: this.measureAnchor, b: point };
      this.measureAnchor = null;
      this.measureDraft = null;
      trackEvent('measure_used');
    }
    this.requestRender();
    this.options.onMeasureChange?.();
  }

  // ------------------------------------------------------------ pinch zoom

  private beginPinch(): void {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;
    const [a, b] = points as [Vec2, Vec2];
    this.pinchStart = {
      distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      scale: this.viewport.scale,
      centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    this.drag = { kind: 'none' };
  }

  private updatePinch(): void {
    if (!this.pinchStart) return;
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;
    const [a, b] = points as [Vec2, Vec2];
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const target = clamp(
      (this.pinchStart.scale * distance) / this.pinchStart.distance,
      this.minScale,
      this.maxScale,
    );
    const factor = target / this.viewport.scale;
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.zoomAt(factor, centre.x, centre.y);
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Trackpad pinch arrives as ctrlKey + wheel; both paths zoom.
    const intensity = event.deltaMode === 1 ? 18 : 1;
    const delta = event.deltaY * intensity;
    const factor = Math.exp(-delta * 0.0016);
    this.zoomAt(factor, event.clientX, event.clientY);
  };

  // -------------------------------------------------------------- keyboard

  private attachKeyboardHandlers(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** True when focus is in a text field, where shortcuts must not fire. */
  private isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable ||
      target.getAttribute('role') === 'textbox'
    );
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return;
    const typing = this.isTyping(event.target);
    const mod = event.metaKey || event.ctrlKey;

    if (event.key === ' ' && !typing) {
      this.spaceHeld = true;
      this.svg.classList.add('is-pan-ready');
      // Only swallow the scroll when the canvas is actually in play.
      if (this.svg.contains(document.activeElement) || document.activeElement === document.body) {
        event.preventDefault();
      }
      return;
    }

    if (mod && event.key.toLowerCase() === 'z') {
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }

    if (mod && event.key.toLowerCase() === 'y') {
      if (typing) return;
      event.preventDefault();
      this.redo();
      return;
    }

    if (mod && event.key.toLowerCase() === 'd') {
      if (typing) return;
      event.preventDefault();
      this.duplicateSelected();
      return;
    }

    if (event.key === 'Escape') {
      if (this.measureMode) {
        this.setMeasureMode(false);
        this.options.onToast?.('Measure tool off');
        return;
      }
      if (!typing) this.select(null);
      return;
    }

    if (typing || mod) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!this.selection) return;
      event.preventDefault();
      this.deleteSelected();
      return;
    }

    if (event.key === 'r' || event.key === 'R') {
      if (!this.selectedItem) return;
      event.preventDefault();
      this.rotateSelected(event.shiftKey ? -90 : 90);
      return;
    }

    const arrows: Record<string, Vec2> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = arrows[event.key];
    if (direction && this.selectedItem) {
      event.preventDefault();
      const gridStep = GRID_INCHES[this.state.settings.grid] || 1;
      // Shift is the fine nudge; the default step follows the grid.
      const step = event.shiftKey ? 1 : this.state.settings.snap ? gridStep : 1;
      this.nudgeSelected(direction.x * step, direction.y * step);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      this.spaceHeld = false;
      this.svg.classList.remove('is-pan-ready');
    }
  };
}

// ------------------------------------------------------------------ helpers

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Clamp incoming property-panel values so typed input can never corrupt state. */
function sanitizePatch(patch: Partial<FurnitureItem>, state: PlannerState): Partial<FurnitureItem> {
  const out: Partial<FurnitureItem> = {};
  if (patch.name !== undefined) out.name = String(patch.name).slice(0, 60) || 'Item';
  if (patch.color !== undefined) out.color = patch.color;
  if (patch.labelVisible !== undefined) out.labelVisible = !!patch.labelVisible;
  if (patch.z !== undefined) out.z = Number.isFinite(patch.z) ? patch.z : 0;
  if (patch.rotation !== undefined) out.rotation = normalizeAngle(patch.rotation);
  if (patch.width !== undefined) out.width = clamp(patch.width, LIMITS.minItemSide, LIMITS.maxItemSide);
  if (patch.height !== undefined) out.height = clamp(patch.height, LIMITS.minItemSide, LIMITS.maxItemSide);
  // Objects may sit partly outside the room on purpose, but not in another postcode.
  const slackX = state.room.width;
  const slackY = state.room.height;
  if (patch.x !== undefined) out.x = clamp(patch.x, -slackX, state.room.width + slackX);
  if (patch.y !== undefined) out.y = clamp(patch.y, -slackY, state.room.height + slackY);
  return out;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

export { itemBounds };
