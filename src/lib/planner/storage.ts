/**
 * Local persistence and JSON import/export.
 *
 * Everything lives in this browser's localStorage — there is no server and no
 * account. Every read is defensive: storage can be unavailable (private mode,
 * blocked cookies), full, or hold data written by an older version of the app.
 */

import { sanitizeState } from './state';
import { SCHEMA_VERSION } from './types';
import type { LayoutFile, PlannerState, SavedLayout } from './types';
import { LIMITS } from './types';

const LAYOUTS_KEY = 'roomplanner.layouts.v1';
const AUTOSAVE_KEY = 'roomplanner.autosave.v1';
const HINTS_KEY = 'roomplanner.hintsDismissed';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touch it — Safari in private mode throws on write, not on access.
    const probe = '__rp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

function readJSON<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted entry — drop it so the app can keep working.
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- Saved layouts

interface LayoutRecord {
  id: string;
  name: string;
  updatedAt: string;
  state: unknown;
}

/** Newest first. Entries that fail validation are silently dropped. */
export function listLayouts(): SavedLayout[] {
  const raw = readJSON<LayoutRecord[]>(LAYOUTS_KEY);
  if (!Array.isArray(raw)) return [];
  const layouts: SavedLayout[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const state = sanitizeState(entry.state);
    if (!state) continue;
    layouts.push({
      id: String(entry.id ?? ''),
      name: String(entry.name ?? 'Untitled').slice(0, 60),
      updatedAt: String(entry.updatedAt ?? new Date().toISOString()),
      state,
    });
  }
  return layouts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function persistLayouts(layouts: SavedLayout[]): boolean {
  return writeJSON(LAYOUTS_KEY, layouts.slice(0, LIMITS.maxSavedLayouts));
}

export interface SaveResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Create or update a saved layout. Passing an existing `id` overwrites it. */
export function saveLayout(name: string, state: PlannerState, id?: string): SaveResult {
  if (!storageAvailable()) {
    return { ok: false, error: 'This browser is blocking local storage, so layouts cannot be saved here.' };
  }
  const layouts = listLayouts();
  const trimmed = name.trim().slice(0, 60) || 'Untitled layout';
  const now = new Date().toISOString();
  const layoutId = id ?? `l_${Date.now().toString(36)}`;

  const existing = layouts.findIndex((l) => l.id === layoutId);
  const record: SavedLayout = { id: layoutId, name: trimmed, updatedAt: now, state };
  if (existing >= 0) layouts[existing] = record;
  else layouts.unshift(record);

  if (layouts.length > LIMITS.maxSavedLayouts) layouts.length = LIMITS.maxSavedLayouts;

  if (!persistLayouts(layouts)) {
    return { ok: false, error: 'There was not enough space to save. Try deleting an older layout.' };
  }
  return { ok: true, id: layoutId };
}

export function getLayout(id: string): SavedLayout | null {
  return listLayouts().find((l) => l.id === id) ?? null;
}

export function renameLayout(id: string, name: string): boolean {
  const layouts = listLayouts();
  const target = layouts.find((l) => l.id === id);
  if (!target) return false;
  target.name = name.trim().slice(0, 60) || target.name;
  target.updatedAt = new Date().toISOString();
  return persistLayouts(layouts);
}

export function deleteLayout(id: string): boolean {
  const layouts = listLayouts().filter((l) => l.id !== id);
  return persistLayouts(layouts);
}

// ----------------------------------------------------------------- Autosave

export interface AutosaveRecord {
  state: PlannerState;
  savedAt: string;
}

export function writeAutosave(state: PlannerState): boolean {
  return writeJSON(AUTOSAVE_KEY, { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), state });
}

export function readAutosave(): AutosaveRecord | null {
  const raw = readJSON<{ savedAt?: string; state?: unknown }>(AUTOSAVE_KEY);
  if (!raw) return null;
  const state = sanitizeState(raw.state);
  if (!state) return null;
  return { state, savedAt: String(raw.savedAt ?? new Date().toISOString()) };
}

export function clearAutosave(): void {
  const store = storage();
  try {
    store?.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

// -------------------------------------------------------------- Onboarding

/** Hints show once per browser session, not once ever. */
export function hintsDismissed(): boolean {
  try {
    return sessionStorage.getItem(HINTS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissHints(): void {
  try {
    sessionStorage.setItem(HINTS_KEY, '1');
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------ Import/export

export function toLayoutFile(state: PlannerState, name: string): LayoutFile {
  return {
    app: 'room-planner',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    layout: { name: name.trim().slice(0, 60) || 'Room layout', state },
  };
}

export type ImportResult =
  | { ok: true; name: string; state: PlannerState }
  | { ok: false; error: string };

/** Byte ceiling for an imported file — a legitimate layout is a few KB. */
const MAX_IMPORT_BYTES = 2_000_000;

/**
 * Parse and validate a layout file.
 * Imported JSON is never trusted: it is parsed, shape-checked, then passed
 * through `sanitizeState`, which clamps every numeric field into range.
 */
export function parseLayoutFile(text: string): ImportResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'That file is empty.' };
  }
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'That file is too large to be a room layout.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON. Pick a layout exported from Room Planner.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'That file does not contain a room layout.' };
  }

  const envelope = parsed as Partial<LayoutFile> & { room?: unknown };

  // Accept both the wrapped export format and a bare state object.
  const candidate = envelope.layout?.state ?? (envelope.room ? envelope : null);
  if (!candidate) {
    return { ok: false, error: 'That file does not contain a room layout.' };
  }

  if (envelope.app && envelope.app !== 'room-planner') {
    return { ok: false, error: 'That layout was exported by a different app.' };
  }
  if (typeof envelope.version === 'number' && envelope.version > SCHEMA_VERSION) {
    return { ok: false, error: 'That layout was made with a newer version of Room Planner.' };
  }

  const state = sanitizeState(candidate);
  if (!state) {
    return { ok: false, error: 'That layout is missing its room dimensions.' };
  }

  const name = typeof envelope.layout?.name === 'string' ? envelope.layout.name.slice(0, 60) : state.room.name;
  return { ok: true, name: name || 'Imported layout', state };
}
