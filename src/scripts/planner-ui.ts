/**
 * DOM wiring for the planner.
 *
 * Every control is found by data attribute and every one of them is optional,
 * so the same script drives the full editor, a cut-down embed, or the homepage
 * demo without branching on page type.
 */

import { trackEvent } from '@lib/planner/analytics';
import { CATALOG, COLOR_PALETTE, getCatalogItem, searchCatalogKeys } from '@lib/planner/catalog';
import { RECOMMENDED_CLEARANCE } from '@lib/planner/collision';
import { exportJson, exportPng, exportSvg, printPlan, renderPrintHost, sharePlan } from '@lib/planner/export';
import { roomArea, roomPerimeter } from '@lib/planner/geometry';
import { GRID_INCHES } from '@lib/planner/snapping';
import {
  addDoor,
  addWindow,
  clampOpeningOffset,
  createState,
  DOOR_PRESETS,
  validateRoom,
  WINDOW_PRESETS,
} from '@lib/planner/state';
import {
  deleteLayout,
  dismissHints,
  hintsDismissed,
  listLayouts,
  parseLayoutFile,
  readAutosave,
  renameLayout,
  saveLayout,
  storageAvailable,
  writeAutosave,
} from '@lib/planner/storage';
import { buildTemplateState } from '@lib/planner/templates';
import {
  clamp,
  displayValue,
  formatArea,
  formatLength,
  formatLengthFriendly,
  fromInches,
  isUnit,
  parseNumber,
  toInches,
  UNIT_LABEL,
  UNIT_STEP,
} from '@lib/planner/units';
import { LIMITS } from '@lib/planner/types';
import type { Door, PlannerState, Unit, Wall, WindowItem } from '@lib/planner/types';
import { PlannerEngine } from './planner-core';
import type { Selection } from './planner-core';

type El = HTMLElement | null;

function $(root: ParentNode, selector: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(selector);
}

function $$(root: ParentNode, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function on<K extends keyof HTMLElementEventMap>(
  el: El,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  el?.addEventListener(type, handler as EventListener);
}

export interface PlannerUIConfig {
  /** Template to load on first open when there is no autosave. */
  template?: string;
  /** Room preset applied when no template and no autosave exist. */
  room?: { name: string; width: number; length: number; unit: Unit };
  autosave?: boolean;
  demo?: boolean;
}

export function initPlanner(root: HTMLElement): PlannerEngine | null {
  const svg = root.querySelector<SVGSVGElement>('[data-rp="canvas"]');
  if (!svg) return null;

  const config: PlannerUIConfig = safeParse(root.dataset.plannerConfig) ?? {};
  const demo = config.demo ?? false;
  const autosaveEnabled = (config.autosave ?? true) && !demo;

  // ------------------------------------------------------- initial document
  //
  // Priority: an explicit ?template= link (the visitor just asked for it) beats
  // the autosaved room, which in turn beats the page's own default.
  let initial: PlannerState | null = null;

  let requestedTemplate: string | null = null;
  if (!demo && typeof window !== 'undefined') {
    try {
      requestedTemplate = new URLSearchParams(window.location.search).get('template');
    } catch {
      requestedTemplate = null;
    }
  }
  if (requestedTemplate) {
    initial = buildTemplateState(requestedTemplate);
    // Drop the parameter so a later refresh does not discard the visitor's work.
    if (initial && typeof history.replaceState === 'function') {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  let restoredFromAutosave = false;
  if (!initial && autosaveEnabled) {
    const restored = readAutosave();
    if (restored) {
      initial = restored.state;
      restoredFromAutosave = true;
    }
  }
  if (!initial && config.template) initial = buildTemplateState(config.template);

  // The page uses this to decide whether to interrupt with the setup dialog:
  // someone coming back to a room they already made should never see it again,
  // even if they have not placed any furniture yet.
  root.dataset.plannerRestored = String(restoredFromAutosave || !!requestedTemplate);
  if (!initial && config.room) {
    const result = validateRoom({
      name: config.room.name,
      width: config.room.width,
      length: config.room.length,
      unit: config.room.unit,
    });
    if (result.room) initial = createState(result.room);
  }

  // Declared before the engine so `onToast` can never fire into a temporal
  // dead zone during construction.
  const toastEl = $(root, '[data-rp="toast"]') ?? $(document, '[data-rp="toast"]');
  let toastTimer = 0;
  function toast(message: string, tone: 'info' | 'warn' | 'ok' = 'info'): void {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.dataset.tone = tone;
    toastEl.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-visible'), 3600);
  }

  const engine = new PlannerEngine(svg, {
    demo,
    initialState: initial ?? undefined,
    onStateChange: () => {
      syncAll();
      if (autosaveEnabled) queueAutosave();
    },
    onSelectionChange: (selection) => syncSelection(selection),
    onHistoryChange: (canUndo, canRedo) => {
      setDisabled('[data-action="undo"]', !canUndo);
      setDisabled('[data-action="redo"]', !canRedo);
    },
    onToast: (message, tone) => toast(message, tone),
    onMeasureChange: () => syncToggles(),
  });

  if (demo) {
    // The demo is a playground; it never writes to storage.
    wireToolbarSubset(root, engine);
    return engine;
  }

  function setDisabled(selector: string, disabled: boolean): void {
    for (const el of $$(root, selector)) {
      if (el instanceof HTMLButtonElement) el.disabled = disabled;
    }
  }

  // -------------------------------------------------------------- autosave
  const saveStatus = $(root, '[data-rp="save-status"]');
  let autosaveTimer = 0;
  let currentLayoutId: string | null = null;

  function setSaveStatus(text: string, tone: 'idle' | 'saving' | 'saved' | 'error' = 'idle'): void {
    if (!saveStatus) return;
    saveStatus.textContent = text;
    saveStatus.dataset.tone = tone;
  }

  function queueAutosave(): void {
    if (!autosaveEnabled) return;
    if (!storageAvailable()) {
      setSaveStatus('Not saved — storage is blocked', 'error');
      return;
    }
    setSaveStatus('Saving…', 'saving');
    window.clearTimeout(autosaveTimer);
    // Debounced so a drag does not hammer localStorage.
    autosaveTimer = window.setTimeout(() => {
      const ok = writeAutosave(engine.state);
      setSaveStatus(ok ? 'Saved on this device' : 'Could not save — storage is full', ok ? 'saved' : 'error');
    }, 700);
  }

  // -------------------------------------------------------------- toolbar
  const actions: Record<string, () => void | Promise<void>> = {
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    'zoom-in': () => engine.zoomAt(1.25),
    'zoom-out': () => engine.zoomAt(0.8),
    'zoom-fit': () => engine.fit(),
    measure: () => {
      const next = !engine.measureMode;
      engine.setMeasureMode(next);
      toast(next ? 'Click two points to measure' : 'Measure tool off');
    },
    'clear-measure': () => engine.clearMeasure(),
    'rotate-left': () => engine.rotateSelected(-90),
    'rotate-right': () => engine.rotateSelected(90),
    duplicate: () => engine.duplicateSelected(),
    delete: () => engine.deleteSelected(),
    'bring-forward': () => engine.bringForward(1),
    'send-backward': () => engine.bringForward(-1),
    print: () => {
      printPlan(engine.state, { showLabels: engine.state.settings.showLabels });
      trackEvent('layout_printed');
    },
    'export-png': async () => {
      try {
        toast('Preparing your image…');
        await exportPng(engine.state, { showLabels: engine.state.settings.showLabels });
        toast('Image downloaded', 'ok');
        trackEvent('layout_exported', { format: 'png' });
      } catch {
        toast('Sorry — the image could not be created in this browser.', 'warn');
      }
    },
    'export-svg': () => {
      try {
        exportSvg(engine.state, { showLabels: engine.state.settings.showLabels });
        toast('SVG downloaded', 'ok');
        trackEvent('layout_exported', { format: 'svg' });
      } catch {
        toast('Sorry — the SVG could not be created.', 'warn');
      }
    },
    'export-json': () => {
      exportJson(engine.state, engine.state.room.name);
      toast('Layout file downloaded', 'ok');
      trackEvent('layout_exported', { format: 'json' });
    },
    share: async () => {
      try {
        const outcome = await sharePlan(engine.state, { showLabels: engine.state.settings.showLabels });
        if (outcome === 'downloaded') toast('Sharing is not available here, so the image was downloaded.', 'ok');
        if (outcome === 'shared') trackEvent('layout_shared');
      } catch {
        toast('Sorry — the plan could not be shared.', 'warn');
      }
    },
    import: () => importInput?.click(),
    save: () => saveCurrentLayout(),
    'new-room': () => openSetup(),
    'clear-room': () => {
      if (engine.state.furniture.length === 0) return;
      engine.commit('Clear furniture', (state) => {
        state.furniture = [];
      });
      engine.select(null);
      toast('Furniture removed. Undo brings it back.', 'ok');
    },
  };

  for (const el of $$(root, '[data-action]')) {
    const name = el.dataset.action;
    if (!name || !(name in actions)) continue;
    el.addEventListener('click', (event) => {
      event.preventDefault();
      // Close the dropdown the control lives in, so the menu does not sit open
      // over the canvas after you pick something from it.
      el.closest('details')?.removeAttribute('open');
      void actions[name]!();
    });
  }

  // -------------------------------------------------------- settings toggles
  on($(root, '[data-setting="grid"]'), 'change', (event) => {
    const value = (event.target as HTMLSelectElement).value as PlannerState['settings']['grid'];
    engine.setSetting('grid', value);
  });

  for (const key of ['snap', 'labels', 'dimensions', 'clearance'] as const) {
    on($(root, `[data-setting="${key}"]`), 'change', (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      if (key === 'snap') engine.setSetting('snap', checked);
      if (key === 'labels') engine.setSetting('showLabels', checked);
      if (key === 'dimensions') engine.setSetting('showDimensions', checked);
      if (key === 'clearance') {
        engine.setSetting('showClearance', checked);
        if (checked) trackEvent('clearance_checked');
      }
    });
  }

  // ------------------------------------------------------------- library
  const search = $(root, '[data-rp="furniture-search"]') as HTMLInputElement | null;
  on(search, 'input', () => filterLibrary(search?.value ?? ''));

  function filterLibrary(query: string): void {
    const q = query.trim().toLowerCase();
    const matches = q === '' ? new Set<string>() : searchCatalogKeys(q);
    let visibleTotal = 0;
    for (const group of $$(root, '[data-library-group]')) {
      let visible = 0;
      for (const button of $$(group, '[data-add="furniture"]')) {
        // Match through the catalog rather than the rendered text, so everyday
        // words with no on-screen equivalent still find something: "couch"
        // returns the sofas, "closet" returns the wardrobe.
        const match = q === '' || matches.has(button.dataset.key ?? '');
        button.hidden = !match;
        if (match) visible += 1;
      }
      group.hidden = visible === 0;
      visibleTotal += visible;
    }
    const empty = $(root, '[data-rp="library-empty"]');
    if (empty) empty.hidden = visibleTotal > 0;
  }

  for (const button of $$(root, '[data-add]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.add;
      const key = button.dataset.key ?? '';
      if (kind === 'furniture') {
        engine.addFurnitureByKey(key);
        closeMobilePanels();
        return;
      }
      if (kind === 'door') {
        const preset = DOOR_PRESETS.find((p) => p.type === key) ?? DOOR_PRESETS[0]!;
        const door = addDoor(engine.state, preset);
        if (!door) {
          toast(`You can add up to ${LIMITS.maxDoors} doors.`, 'warn');
          return;
        }
        engine.commit('Add door', (state) => {
          state.doors.push(door);
        });
        engine.select({ kind: 'door', id: door.id });
        trackEvent('door_added', { door_type: door.type });
        closeMobilePanels();
        return;
      }
      if (kind === 'window') {
        const preset = WINDOW_PRESETS.find((p) => p.type === key) ?? WINDOW_PRESETS[0]!;
        const win = addWindow(engine.state, preset);
        if (!win) {
          toast(`You can add up to ${LIMITS.maxWindows} windows.`, 'warn');
          return;
        }
        engine.commit('Add window', (state) => {
          state.windows.push(win);
        });
        engine.select({ kind: 'window', id: win.id });
        trackEvent('window_added', { window_type: win.type });
        closeMobilePanels();
      }
    });
  }

  /**
   * Replacing the whole document is undoable, but that is only reassuring if
   * people know it. Say so — and only when there was actually work to lose.
   */
  function undoHint(base: string): string {
    return engine.state.furniture.length > 0 ? `${base} · Ctrl+Z to go back` : base;
  }

  // ------------------------------------------------------------- templates
  for (const button of $$(root, '[data-template]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.template!;
      const state = buildTemplateState(id);
      if (!state) return;
      const hint = undoHint(`${state.room.name} template loaded`);
      engine.replaceState(state, 'Template');
      currentLayoutId = null;
      queueAutosave();
      toast(hint, 'ok');
      trackEvent('template_selected', { template: id });
      closeMobilePanels();
    });
  }

  // ------------------------------------------------------------ room setup
  const setup = $(root, '[data-rp="setup"]') as HTMLDialogElement | HTMLElement | null;
  const setupForm = $(root, '[data-rp="setup-form"]') as HTMLFormElement | null;

  function openSetup(): void {
    if (!setup) return;
    if (setup instanceof HTMLDialogElement) setup.showModal();
    else setup.hidden = false;
    const first = setup.querySelector<HTMLInputElement>('input[name="width"]');
    window.setTimeout(() => first?.focus(), 30);
  }

  function closeSetup(): void {
    if (!setup) return;
    if (setup instanceof HTMLDialogElement) setup.close();
    else setup.hidden = true;
  }

  for (const el of $$(root, '[data-action="close-setup"]')) {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      closeSetup();
    });
  }

  for (const button of $$(root, '[data-preset]')) {
    button.addEventListener('click', () => {
      if (!setupForm) return;
      const w = Number(button.dataset.presetWidth);
      const l = Number(button.dataset.presetLength);
      const name = button.dataset.presetName ?? 'My Room';
      setField(setupForm, 'width', String(w));
      setField(setupForm, 'length', String(l));
      setField(setupForm, 'name', name);
      setField(setupForm, 'unit', 'ft');
    });
  }

  on(setupForm, 'submit', (event) => {
    event.preventDefault();
    if (!setupForm) return;
    const data = new FormData(setupForm);
    const unitValue = String(data.get('unit') ?? 'ft');
    const unit: Unit = isUnit(unitValue) ? unitValue : 'ft';
    const width = parseNumber(String(data.get('width') ?? ''));
    const length = parseNumber(String(data.get('length') ?? ''));

    const result = validateRoom({
      name: String(data.get('name') ?? ''),
      width: width ?? Number.NaN,
      length: length ?? Number.NaN,
      unit,
    });

    showFieldError(setupForm, 'width', result.errors.width);
    showFieldError(setupForm, 'length', result.errors.length);
    if (!result.ok || !result.room) return;

    const newRoomHint = undoHint('Room created. Add furniture from the left panel.');
    engine.replaceState(createState(result.room, engine.state.settings), 'New room');
    currentLayoutId = null;
    queueAutosave();
    closeSetup();
    toast(newRoomHint, 'ok');
    trackEvent('room_created', { unit, width_in: result.room.width, height_in: result.room.height });
  });

  // -------------------------------------------------------------- room form
  const roomInputs = {
    name: $(root, '[data-room="name"]') as HTMLInputElement | null,
    width: $(root, '[data-room="width"]') as HTMLInputElement | null,
    length: $(root, '[data-room="length"]') as HTMLInputElement | null,
    unit: $(root, '[data-room="unit"]') as HTMLSelectElement | null,
    floor: $(root, '[data-room="floor"]') as HTMLSelectElement | null,
  };

  on(roomInputs.name, 'input', () => {
    const value = roomInputs.name?.value ?? '';
    engine.commit(
      'Rename room',
      (state) => {
        state.room.name = value.slice(0, 60) || 'My Room';
      },
      true,
    );
  });

  function applyRoomSize(): void {
    const unit = engine.state.room.unit;
    const w = parseNumber(roomInputs.width?.value ?? '');
    const l = parseNumber(roomInputs.length?.value ?? '');
    if (w === null || l === null) return;
    const widthIn = toInches(w, unit);
    const lengthIn = toInches(l, unit);
    const bad =
      widthIn < LIMITS.minRoomSide ||
      lengthIn < LIMITS.minRoomSide ||
      widthIn > LIMITS.maxRoomSide ||
      lengthIn > LIMITS.maxRoomSide;
    setInvalid(roomInputs.width, widthIn < LIMITS.minRoomSide || widthIn > LIMITS.maxRoomSide);
    setInvalid(roomInputs.length, lengthIn < LIMITS.minRoomSide || lengthIn > LIMITS.maxRoomSide);
    if (bad) return;

    engine.setRoomSize(widthIn, lengthIn);
    const stillOutside = engine.outside.size;
    if (stillOutside > 0) {
      toast(
        `${stillOutside} ${stillOutside === 1 ? 'item is' : 'items are'} now outside the room. Drag ${
          stillOutside === 1 ? 'it' : 'them'
        } back in.`,
        'warn',
      );
    }
  }

  on(roomInputs.width, 'change', applyRoomSize);
  on(roomInputs.length, 'change', applyRoomSize);

  on(roomInputs.unit, 'change', () => {
    const value = roomInputs.unit?.value ?? 'ft';
    if (!isUnit(value)) return;
    // Only the display unit changes — stored inches are untouched.
    engine.commit('Change units', (state) => {
      state.room.unit = value;
    });
    syncAll();
  });

  on(roomInputs.floor, 'change', () => {
    const value = roomInputs.floor?.value as PlannerState['room']['floorColor'];
    engine.commit('Floor color', (state) => {
      state.room.floorColor = value;
    });
  });

  // -------------------------------------------------------- property panel
  const props = {
    panel: $(root, '[data-rp="properties"]'),
    empty: $(root, '[data-rp="properties-empty"]'),
    opening: $(root, '[data-rp="opening-props"]'),
    title: $(root, '[data-rp="prop-title"]'),
    subtitle: $(root, '[data-rp="prop-subtitle"]'),
    name: $(root, '[data-prop="name"]') as HTMLInputElement | null,
    width: $(root, '[data-prop="width"]') as HTMLInputElement | null,
    height: $(root, '[data-prop="height"]') as HTMLInputElement | null,
    x: $(root, '[data-prop="x"]') as HTMLInputElement | null,
    y: $(root, '[data-prop="y"]') as HTMLInputElement | null,
    rotation: $(root, '[data-prop="rotation"]') as HTMLInputElement | null,
    label: $(root, '[data-prop="labelVisible"]') as HTMLInputElement | null,
  };

  function bindLengthProp(input: HTMLInputElement | null, key: 'width' | 'height' | 'x' | 'y'): void {
    on(input, 'input', () => {
      const unit = engine.state.room.unit;
      const value = parseNumber(input?.value ?? '');
      if (value === null) return;
      const inches = toInches(value, unit);
      const min = key === 'width' || key === 'height' ? LIMITS.minItemSide : -LIMITS.maxRoomSide;
      if (inches < min) {
        setInvalid(input, true);
        return;
      }
      setInvalid(input, false);
      engine.updateSelectedItem({ [key]: inches }, key === 'x' || key === 'y' ? 'Move' : 'Resize', true);
    });
  }

  bindLengthProp(props.width, 'width');
  bindLengthProp(props.height, 'height');
  bindLengthProp(props.x, 'x');
  bindLengthProp(props.y, 'y');

  on(props.name, 'input', () => {
    engine.updateSelectedItem({ name: props.name?.value ?? '' }, 'Rename', true);
  });

  on(props.rotation, 'input', () => {
    const value = parseNumber(props.rotation?.value ?? '');
    if (value === null) return;
    engine.updateSelectedItem({ rotation: value }, 'Rotate', true);
  });

  on(props.label, 'change', () => {
    engine.updateSelectedItem({ labelVisible: !!props.label?.checked }, 'Toggle label');
  });

  for (const button of $$(root, '[data-rotate-to]')) {
    button.addEventListener('click', () => {
      engine.updateSelectedItem({ rotation: Number(button.dataset.rotateTo) || 0 }, 'Rotate');
    });
  }

  for (const button of $$(root, '[data-color]')) {
    button.addEventListener('click', () => {
      engine.updateSelectedItem({ color: button.dataset.color! }, 'Change color');
    });
  }

  // --------------------------------------------------- door/window controls
  const openingInputs = {
    width: $(root, '[data-opening="width"]') as HTMLInputElement | null,
    offset: $(root, '[data-opening="offset"]') as HTMLInputElement | null,
    wall: $(root, '[data-opening="wall"]') as HTMLSelectElement | null,
    swing: $(root, '[data-opening="swing"]') as HTMLSelectElement | null,
    swingRow: $(root, '[data-rp="swing-row"]'),
    title: $(root, '[data-rp="opening-title"]'),
  };

  function currentOpening(): { kind: 'door' | 'window'; value: Door | WindowItem } | null {
    const sel = engine.selection;
    if (!sel || sel.kind === 'furniture') return null;
    if (sel.kind === 'door') {
      const door = engine.state.doors.find((d) => d.id === sel.id);
      return door ? { kind: 'door', value: door } : null;
    }
    const win = engine.state.windows.find((w) => w.id === sel.id);
    return win ? { kind: 'window', value: win } : null;
  }

  function updateOpening(mutate: (opening: Door | WindowItem) => void, label: string, coalesce = false): void {
    const current = currentOpening();
    if (!current) return;
    const id = current.value.id;
    engine.commit(
      label,
      (state) => {
        const list: Array<Door | WindowItem> = current.kind === 'door' ? state.doors : state.windows;
        const target = list.find((o) => o.id === id);
        if (!target) return;
        mutate(target);
        target.offset = clampOpeningOffset(state.room, target.wall, target.offset, target.width);
      },
      coalesce,
    );
  }

  on(openingInputs.width, 'input', () => {
    const unit = engine.state.room.unit;
    const value = parseNumber(openingInputs.width?.value ?? '');
    if (value === null) return;
    const inches = clamp(toInches(value, unit), 12, LIMITS.maxRoomSide);
    updateOpening((opening) => {
      opening.width = inches;
    }, 'Resize opening', true);
  });

  on(openingInputs.offset, 'input', () => {
    const unit = engine.state.room.unit;
    const value = parseNumber(openingInputs.offset?.value ?? '');
    if (value === null) return;
    updateOpening((opening) => {
      opening.offset = toInches(value, unit);
    }, 'Move opening', true);
  });

  on(openingInputs.wall, 'change', () => {
    const value = openingInputs.wall?.value as Wall;
    updateOpening((opening) => {
      opening.wall = value;
    }, 'Move opening');
  });

  on(openingInputs.swing, 'change', () => {
    const value = openingInputs.swing?.value as Door['swing'];
    updateOpening((opening) => {
      if ('swing' in opening) opening.swing = value;
    }, 'Change swing');
  });

  // ------------------------------------------------------------ saved layouts
  const layoutName = $(root, '[data-rp="layout-name"]') as HTMLInputElement | null;
  const layoutList = $(root, '[data-rp="layout-list"]');
  const importInput = $(root, '[data-rp="import-file"]') as HTMLInputElement | null;

  function saveCurrentLayout(): void {
    const name = layoutName?.value?.trim() || engine.state.room.name;
    const result = saveLayout(name, engine.state, currentLayoutId ?? undefined);
    if (!result.ok) {
      toast(result.error ?? 'Could not save.', 'warn');
      return;
    }
    currentLayoutId = result.id ?? null;
    renderLayoutList();
    toast(`Saved “${name}” on this device`, 'ok');
    trackEvent('layout_saved', { items: engine.state.furniture.length });
  }

  function renderLayoutList(): void {
    if (!layoutList) return;
    const layouts = listLayouts();
    if (layouts.length === 0) {
      layoutList.innerHTML =
        '<p class="text-sm text-ink-faint">No saved layouts yet. Save one to come back to it later.</p>';
      return;
    }
    layoutList.innerHTML = layouts
      .map((layout) => {
        const when = new Date(layout.updatedAt);
        const label = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString();
        const size = `${formatLength(layout.state.room.width, layout.state.room.unit, false)} × ${formatLength(
          layout.state.room.height,
          layout.state.room.unit,
        )}`;
        return `<div class="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5">
  <button type="button" class="min-w-0 flex-1 text-left" data-layout-open="${escapeAttr(layout.id)}">
    <span class="block truncate text-sm font-medium text-ink">${escapeHtml(layout.name)}</span>
    <span class="block text-xs text-ink-faint">${escapeHtml(size)}${label ? ` · ${escapeHtml(label)}` : ''}</span>
  </button>
  <button type="button" class="rp-icon-btn !h-7 !w-7" data-layout-rename="${escapeAttr(layout.id)}" aria-label="Rename ${escapeAttr(layout.name)}" title="Rename">${ICONS.pencil}</button>
  <button type="button" class="rp-icon-btn !h-7 !w-7" data-layout-delete="${escapeAttr(layout.id)}" aria-label="Delete ${escapeAttr(layout.name)}" title="Delete">${ICONS.trash}</button>
</div>`;
      })
      .join('');
  }

  on(layoutList, 'click', (event) => {
    const target = event.target as HTMLElement;
    const openId = target.closest<HTMLElement>('[data-layout-open]')?.dataset.layoutOpen;
    if (openId) {
      const layouts = listLayouts();
      const match = layouts.find((l) => l.id === openId);
      if (!match) return;
      const openHint = undoHint(`Opened “${match.name}”`);
      engine.replaceState(match.state, 'Open layout');
      currentLayoutId = match.id;
      if (layoutName) layoutName.value = match.name;
      queueAutosave();
      toast(openHint, 'ok');
      trackEvent('layout_opened');
      closeMobilePanels();
      return;
    }

    const renameId = target.closest<HTMLElement>('[data-layout-rename]')?.dataset.layoutRename;
    if (renameId) {
      const match = listLayouts().find((l) => l.id === renameId);
      const next = window.prompt('Rename layout', match?.name ?? '');
      if (next && next.trim()) {
        renameLayout(renameId, next.trim());
        renderLayoutList();
      }
      return;
    }

    const deleteId = target.closest<HTMLElement>('[data-layout-delete]')?.dataset.layoutDelete;
    if (deleteId) {
      const match = listLayouts().find((l) => l.id === deleteId);
      if (!window.confirm(`Delete “${match?.name ?? 'this layout'}”? This cannot be undone.`)) return;
      deleteLayout(deleteId);
      if (currentLayoutId === deleteId) currentLayoutId = null;
      renderLayoutList();
      toast('Layout deleted');
    }
  });

  on(importInput, 'change', () => {
    const file = importInput?.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      toast('That file is too large to be a room layout.', 'warn');
      importInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast('That file could not be read.', 'warn');
    reader.onload = () => {
      const result = parseLayoutFile(String(reader.result ?? ''));
      if (!result.ok) {
        toast(result.error, 'warn');
        return;
      }
      const importHint = undoHint(`Imported “${result.name}”`);
      engine.replaceState(result.state, 'Import');
      currentLayoutId = null;
      if (layoutName) layoutName.value = result.name;
      queueAutosave();
      toast(importHint, 'ok');
      trackEvent('layout_imported', { items: result.state.furniture.length });
      closeMobilePanels();
    };
    reader.readAsText(file);
    importInput.value = '';
  });

  // -------------------------------------------------------- panels / sheets
  //
  // The same markup serves both breakpoints. On desktop each group is a column
  // that always shows exactly one open panel; on mobile every panel is a bottom
  // sheet and all of them can be closed at once.
  const panels = $$(root, '[data-panel]');
  const scrim = $(root, '[data-rp="scrim"]');
  /** Remembers the desktop selection per column so resizing restores it. */
  const activeByGroup: Record<string, string> = { left: 'furniture', right: 'properties' };

  function isMobile(): boolean {
    return window.matchMedia('(max-width: 1023px)').matches;
  }

  function groupOf(panel: HTMLElement): string {
    return panel.dataset.panelGroup ?? 'left';
  }

  function paintPanels(openNames: Set<string>): void {
    for (const panel of panels) {
      const name = panel.dataset.panel ?? '';
      const open = openNames.has(name);
      panel.dataset.open = String(open);
      panel.setAttribute('aria-hidden', String(!open));
    }
    for (const tab of $$(root, '[data-panel-tab]')) {
      tab.setAttribute('aria-pressed', String(openNames.has(tab.dataset.panelTab ?? '')));
    }
    scrim?.classList.toggle('is-open', isMobile() && openNames.size > 0);
  }

  function openPanel(name: string): void {
    const panel = panels.find((p) => p.dataset.panel === name);
    if (!panel) return;
    const group = groupOf(panel);
    activeByGroup[group] = name;

    if (isMobile()) {
      paintPanels(new Set([name]));
      // Move focus into the sheet so keyboard and screen-reader users follow it.
      const focusable = panel.querySelector<HTMLElement>(
        'input, select, button, [tabindex]:not([tabindex="-1"])',
      );
      window.setTimeout(() => focusable?.focus({ preventScroll: true }), 60);
      return;
    }
    paintPanels(new Set(Object.values(activeByGroup)));
  }

  function closeMobilePanels(): void {
    if (!isMobile()) return;
    paintPanels(new Set());
  }

  for (const tab of $$(root, '[data-panel-tab]')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset.panelTab!;
      const alreadyOpen = tab.getAttribute('aria-pressed') === 'true';
      if (alreadyOpen && isMobile()) closeMobilePanels();
      else openPanel(name);
    });
  }

  for (const button of $$(root, '[data-action="close-panel"]')) {
    button.addEventListener('click', () => closeMobilePanels());
  }

  on(scrim, 'click', () => closeMobilePanels());

  function applyLayoutMode(): void {
    if (isMobile()) closeMobilePanels();
    else paintPanels(new Set(Object.values(activeByGroup)));
  }
  window.addEventListener('resize', debounce(applyLayoutMode, 150));
  applyLayoutMode();

  // A tap that lands on an object should show that object's properties. Gated
  // on a movement threshold so dragging furniture or panning the canvas — both
  // of which also end in a pointerup — never throws the sheet over the plan.
  {
    let pressedAt: { x: number; y: number } | null = null;
    const TAP_SLOP = 6;

    svg.addEventListener('pointerdown', (event) => {
      pressedAt = { x: event.clientX, y: event.clientY };
    });

    svg.addEventListener('pointerup', (event) => {
      const start = pressedAt;
      pressedAt = null;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
      // Let the engine settle its own selection on this same pointerup first.
      window.setTimeout(() => revealPropertiesOnMobile(engine.selection), 0);
    });
  }

  // ----------------------------------------------------------- onboarding
  const hints = $(root, '[data-rp="hints"]');
  if (hints) {
    if (hintsDismissed()) hints.hidden = true;
    for (const button of $$(root, '[data-action="dismiss-hints"]')) {
      button.addEventListener('click', () => {
        hints.hidden = true;
        dismissHints();
      });
    }
  }

  // ------------------------------------------------------------- syncing
  const objectList = $(root, '[data-rp="object-list"]');

  function syncToggles(): void {
    const measureBtns = $$(root, '[data-action="measure"]');
    for (const btn of measureBtns) btn.setAttribute('aria-pressed', String(engine.measureMode));
    const clearBtn = $(root, '[data-action="clear-measure"]');
    if (clearBtn) clearBtn.hidden = !engine.measure;

    const grid = $(root, '[data-setting="grid"]') as HTMLSelectElement | null;
    if (grid) grid.value = engine.state.settings.grid;
    setChecked('[data-setting="snap"]', engine.state.settings.snap);
    setChecked('[data-setting="labels"]', engine.state.settings.showLabels);
    setChecked('[data-setting="dimensions"]', engine.state.settings.showDimensions);
    setChecked('[data-setting="clearance"]', engine.state.settings.showClearance);

    const zoom = $(root, '[data-rp="zoom-level"]');
    if (zoom) zoom.textContent = `${engine.zoomPercent}%`;
  }

  function setChecked(selector: string, value: boolean): void {
    const el = $(root, selector);
    if (el instanceof HTMLInputElement) el.checked = value;
  }

  function syncRoomForm(): void {
    const room = engine.state.room;
    if (roomInputs.name && document.activeElement !== roomInputs.name) roomInputs.name.value = room.name;
    if (roomInputs.width && document.activeElement !== roomInputs.width) {
      roomInputs.width.value = String(displayValue(room.width, room.unit));
      roomInputs.width.step = String(UNIT_STEP[room.unit]);
    }
    if (roomInputs.length && document.activeElement !== roomInputs.length) {
      roomInputs.length.value = String(displayValue(room.height, room.unit));
      roomInputs.length.step = String(UNIT_STEP[room.unit]);
    }
    if (roomInputs.unit) roomInputs.unit.value = room.unit;
    if (roomInputs.floor) roomInputs.floor.value = room.floorColor;
    for (const el of $$(root, '[data-unit-label]')) el.textContent = UNIT_LABEL[room.unit];
  }

  function syncStats(): void {
    const room = engine.state.room;
    setText('[data-rp="stat-area"]', formatArea(roomArea(room), room.unit));
    setText('[data-rp="stat-perimeter"]', formatLength(roomPerimeter(room), room.unit));
    setText('[data-rp="stat-count"]', String(engine.state.furniture.length));

    // The empty state only makes sense before anything has been placed.
    const empty = $(root, '[data-rp="empty-state"]');
    if (empty) empty.hidden = engine.state.furniture.length > 0;
    setText(
      '[data-rp="stat-size"]',
      `${formatLength(room.width, room.unit, false)} × ${formatLength(room.height, room.unit)}`,
    );
    setText('[data-rp="room-title"]', room.name);
  }

  function setText(selector: string, value: string): void {
    for (const el of $$(root, selector)) el.textContent = value;
  }

  function syncWarnings(): void {
    const warningsEl = $(root, '[data-rp="warnings"]');
    if (!warningsEl) return;
    const messages: string[] = [];
    if (engine.overlaps.size > 0) {
      messages.push(
        `${engine.overlaps.size} ${engine.overlaps.size === 1 ? 'item overlaps' : 'items overlap'} another item.`,
      );
    }
    if (engine.outside.size > 0) {
      messages.push(
        `${engine.outside.size} ${engine.outside.size === 1 ? 'item is' : 'items are'} partly outside the room.`,
      );
    }
    warningsEl.hidden = messages.length === 0;
    warningsEl.textContent = messages.join(' ');
  }

  function syncClearance(): void {
    const el = $(root, '[data-rp="clearance-report"]');
    if (!el) return;
    if (!engine.state.settings.showClearance || !engine.clearance) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const report = engine.clearance;
    const unit = engine.state.room.unit;
    const narrowest =
      report.narrowest === null ? 'No walkways detected yet' : `Narrowest walkway: ${formatLengthFriendly(report.narrowest, unit)}`;
    const recommended = `Recommended: about ${formatLengthFriendly(RECOMMENDED_CLEARANCE, unit)}`;

    const issues = report.issues
      .slice(0, 4)
      .map((issue) => {
        const detail =
          issue.kind === 'door'
            ? escapeHtml(issue.message)
            : `${escapeHtml(issue.message)} — ${escapeHtml(formatLengthFriendly(issue.gap, unit))}`;
        return `<li class="flex gap-1.5"><span aria-hidden="true" class="text-warn">•</span><span>${detail}</span></li>`;
      })
      .join('');

    el.innerHTML = `
      <p class="text-sm font-medium text-ink">${escapeHtml(narrowest)}</p>
      <p class="mt-0.5 text-xs text-ink-faint">${escapeHtml(recommended)}</p>
      ${
        report.issues.length > 0
          ? `<p class="mt-2 text-xs font-semibold uppercase tracking-wide text-warn">Limited walking space</p>
             <ul class="mt-1 space-y-1 text-xs text-ink-soft">${issues}</ul>
             ${report.issues.length > 4 ? `<p class="mt-1 text-xs text-ink-faint">and ${report.issues.length - 4} more</p>` : ''}`
          : '<p class="mt-2 text-xs text-ok">Walkways look comfortable.</p>'
      }
      <p class="mt-2 text-[11px] leading-snug text-ink-faint">Planning guideline, not a building-code assessment.</p>`;
  }

  function syncObjectList(): void {
    if (!objectList) return;
    const items = [...engine.state.furniture].sort((a, b) => b.z - a.z);
    if (items.length === 0) {
      objectList.innerHTML = '<p class="px-1 text-sm text-ink-faint">Nothing placed yet.</p>';
      return;
    }
    const unit = engine.state.room.unit;
    objectList.innerHTML = items
      .map((item) => {
        const selected = engine.selection?.kind === 'furniture' && engine.selection.id === item.id;
        const flag = engine.overlaps.has(item.id)
          ? '<span class="ml-1 text-warn" title="Overlapping">●</span>'
          : engine.outside.has(item.id)
            ? '<span class="ml-1 text-warn" title="Outside the room">●</span>'
            : '';
        return `<button type="button" role="option" aria-selected="${selected}" data-select-item="${escapeAttr(
          item.id,
        )}" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          selected ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-sunk'
        }">
  <span class="h-3 w-3 shrink-0 rounded-[3px] border border-black/15" style="background:${escapeAttr(item.color)}"></span>
  <span class="min-w-0 flex-1 truncate">${escapeHtml(item.name)}${flag}</span>
  <span class="shrink-0 text-xs text-ink-faint">${escapeHtml(
    `${formatLength(item.width, unit, false)}×${formatLength(item.height, unit, false)}`,
  )}</span>
</button>`;
      })
      .join('');
  }

  on(objectList, 'click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-select-item]')?.dataset.selectItem;
    if (id) engine.select({ kind: 'furniture', id });
  });

  /**
   * On a phone the properties live in a sheet that is closed by default, so
   * tapping an item selected it and then appeared to do nothing — you had to
   * know to tap "Selected" as a second step. Surface the sheet on the first
   * selection of a gesture instead.
   *
   * Only when the person taps the canvas: opening it during a drag would cover
   * the thing they are dragging, and doing it for a pick from the object list
   * would fight the panel they are already looking at.
   */
  function revealPropertiesOnMobile(selection: Selection | null): void {
    if (!selection || !isMobile()) return;
    if (document.activeElement?.closest('[data-panel]')) return;
    const panel = panels.find((p) => p.dataset.panel === 'properties');
    if (panel?.dataset.open === 'true') return;
    openPanel('properties');
  }

  function syncSelection(selection: Selection | null): void {
    const item = engine.selectedItem;
    const opening = currentOpening();
    const unit = engine.state.room.unit;

    if (props.empty) props.empty.hidden = !!selection;
    if (props.panel) props.panel.hidden = !item;
    if (props.opening) props.opening.hidden = !opening;

    setDisabled('[data-requires-selection]', !selection);
    for (const el of $$(root, '[data-requires-item]')) {
      if (el instanceof HTMLButtonElement) el.disabled = !item;
    }

    if (item) {
      if (props.title) props.title.textContent = item.name;
      if (props.subtitle) {
        props.subtitle.textContent = `${formatLength(item.width, unit, false)} × ${formatLength(item.height, unit)}`;
      }
      setValueIfBlurred(props.name, item.name);
      setValueIfBlurred(props.width, String(displayValue(item.width, unit)));
      setValueIfBlurred(props.height, String(displayValue(item.height, unit)));
      setValueIfBlurred(props.x, String(displayValue(item.x, unit)));
      setValueIfBlurred(props.y, String(displayValue(item.y, unit)));
      setValueIfBlurred(props.rotation, String(Math.round(item.rotation)));
      if (props.label) props.label.checked = item.labelVisible;
      for (const input of [props.width, props.height, props.x, props.y]) {
        if (input) input.step = String(UNIT_STEP[unit]);
      }
      for (const button of $$(root, '[data-color]')) {
        button.setAttribute('aria-pressed', String(button.dataset.color === item.color));
      }
      for (const button of $$(root, '[data-rotate-to]')) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.rotateTo) === Math.round(item.rotation)));
      }
    }

    if (opening) {
      if (openingInputs.title) openingInputs.title.textContent = opening.value.name;
      setValueIfBlurred(openingInputs.width, String(displayValue(opening.value.width, unit)));
      setValueIfBlurred(openingInputs.offset, String(displayValue(opening.value.offset, unit)));
      if (openingInputs.wall) openingInputs.wall.value = opening.value.wall;
      const isDoor = opening.kind === 'door' && 'swing' in opening.value;
      if (openingInputs.swingRow) {
        openingInputs.swingRow.hidden = !isDoor || (opening.value as Door).type === 'sliding';
      }
      if (isDoor && openingInputs.swing) openingInputs.swing.value = (opening.value as Door).swing;
      for (const input of [openingInputs.width, openingInputs.offset]) {
        if (input) input.step = String(UNIT_STEP[unit]);
      }
    }

    syncObjectList();
  }

  function syncAll(): void {
    syncToggles();
    syncRoomForm();
    syncStats();
    syncWarnings();
    syncClearance();
    syncSelection(engine.selection);
  }

  // Wire the zoom readout to viewport changes that do not touch state.
  const zoomObserver = () => {
    const zoom = $(root, '[data-rp="zoom-level"]');
    if (zoom) zoom.textContent = `${engine.zoomPercent}%`;
  };
  svg.addEventListener('wheel', () => requestAnimationFrame(zoomObserver), { passive: true });
  for (const name of ['zoom-in', 'zoom-out', 'zoom-fit']) {
    for (const el of $$(root, `[data-action="${name}"]`)) {
      el.addEventListener('click', () => requestAnimationFrame(zoomObserver));
    }
  }

  // ------------------------------------------------------------ first paint
  if (layoutName && !layoutName.value) layoutName.value = engine.state.room.name;
  renderLayoutList();
  filterLibrary('');
  syncAll();
  setDisabled('[data-action="undo"]', !engine.canUndo);
  setDisabled('[data-action="redo"]', !engine.canRedo);

  if (!storageAvailable()) {
    setSaveStatus('Not saved — storage is blocked', 'error');
  } else if (autosaveEnabled) {
    setSaveStatus('Saved on this device', 'saved');
  }

  // Ctrl+P bypasses the toolbar button, and print CSS hides the whole app, so
  // the print container has to be filled before any print begins.
  window.addEventListener('beforeprint', () => {
    renderPrintHost(engine.state, { showLabels: engine.state.settings.showLabels });
  });

  // Warn before losing unsaved work only when there is work to lose.
  window.addEventListener('beforeunload', () => {
    if (autosaveEnabled && engine.state.furniture.length > 0) writeAutosave(engine.state);
  });

  return engine;
}

/** The homepage demo gets zoom and fit only — no chrome to wire. */
function wireToolbarSubset(root: HTMLElement, engine: PlannerEngine): void {
  const map: Record<string, () => void> = {
    'zoom-in': () => engine.zoomAt(1.25),
    'zoom-out': () => engine.zoomAt(0.8),
    'zoom-fit': () => engine.fit(),
    'rotate-right': () => engine.rotateSelected(90),
    delete: () => engine.deleteSelected(),
  };
  for (const el of $$(root, '[data-action]')) {
    const name = el.dataset.action;
    if (!name || !(name in map)) continue;
    el.addEventListener('click', (event) => {
      event.preventDefault();
      map[name]!();
    });
  }
}

// ------------------------------------------------------------------ helpers

function safeParse<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function setValueIfBlurred(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  // Never clobber a field someone is mid-way through typing into.
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

function setInvalid(input: HTMLInputElement | null, invalid: boolean): void {
  if (!input) return;
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function setField(form: HTMLFormElement, name: string, value: string): void {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
}

function showFieldError(form: HTMLFormElement, name: string, message?: string): void {
  const errorEl = form.querySelector<HTMLElement>(`[data-error="${name}"]`);
  const field = form.elements.namedItem(name);
  if (errorEl) {
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }
  if (field instanceof HTMLInputElement) {
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): T {
  let timer = 0;
  return ((...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  }) as T;
}

const ICONS = {
  pencil:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5z"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/></svg>',
};

export { CATALOG, COLOR_PALETTE, getCatalogItem, GRID_INCHES, fromInches };
