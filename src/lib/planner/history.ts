/**
 * Bounded snapshot undo/redo.
 *
 * The planner document is small (a few dozen objects), so whole-state snapshots
 * are simpler and far less bug-prone than command inversion, and still cheap.
 * Rapid repeated edits of the same kind (dragging a number input) coalesce so a
 * single undo steps back over the whole gesture rather than one pixel of it.
 */

export interface HistoryEntry<T> {
  state: T;
  label: string;
  at: number;
}

export interface HistoryOptions {
  /** Maximum number of undoable steps kept in memory. */
  depth?: number;
  /** Same-label edits closer together than this merge into one step (ms). */
  coalesceMs?: number;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export class History<T> {
  private past: Array<HistoryEntry<T>> = [];
  private future: Array<HistoryEntry<T>> = [];
  private present: HistoryEntry<T>;
  private readonly depth: number;
  private readonly coalesceMs: number;

  constructor(initial: T, options: HistoryOptions = {}) {
    this.depth = Math.max(1, options.depth ?? 60);
    this.coalesceMs = Math.max(0, options.coalesceMs ?? 0);
    this.present = { state: deepClone(initial), label: 'start', at: Date.now() };
  }

  /** The live document. Always a clone, so callers cannot mutate history. */
  get current(): T {
    return deepClone(this.present.state);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.present.label === 'start' ? null : this.present.label;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  /**
   * Record a new state.
   * `coalesce` merges this edit into the previous one when they share a label
   * and arrive within `coalesceMs` — used for continuous gestures.
   */
  push(state: T, label: string, coalesce = false): void {
    const now = Date.now();
    const mergeable =
      coalesce &&
      this.coalesceMs > 0 &&
      this.present.label === label &&
      now - this.present.at < this.coalesceMs;

    if (mergeable) {
      this.present = { state: deepClone(state), label, at: now };
      this.future = [];
      return;
    }

    this.past.push(this.present);
    if (this.past.length > this.depth) this.past.shift();
    this.present = { state: deepClone(state), label, at: now };
    this.future = [];
  }

  /** Replace the current state without creating an undo step (autosave rehydrate). */
  replace(state: T, label = this.present.label): void {
    this.present = { state: deepClone(state), label, at: Date.now() };
  }

  /** Discard all history and restart from `state` (new room, opened layout). */
  reset(state: T, label = 'start'): void {
    this.past = [];
    this.future = [];
    this.present = { state: deepClone(state), label, at: Date.now() };
  }

  undo(): T | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.present);
    this.present = previous;
    return this.current;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.present);
    this.present = next;
    return this.current;
  }

  /** Steps available in each direction, for debugging and tests. */
  get size(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }
}
