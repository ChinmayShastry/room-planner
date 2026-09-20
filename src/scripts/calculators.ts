/**
 * The two standalone calculators.
 *
 * Both share the planner's geometry and unit code, so a "fits" answer here and
 * a layout in the editor can never disagree with each other.
 */

import { trackEvent } from '@lib/planner/analytics';
import { checkFitsInRoom, fitsThroughOpening, roomArea, roomPerimeter } from '@lib/planner/geometry';
import { formatArea, formatLength, formatLengthFriendly, isUnit, parseNumber, toInches } from '@lib/planner/units';
import type { Unit } from '@lib/planner/types';

function field(root: ParentNode, name: string): HTMLInputElement | HTMLSelectElement | null {
  return root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-calc="${name}"]`);
}

function out(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-out="${name}"]`);
}

function readLength(root: ParentNode, name: string, unit: Unit): number | null {
  const el = field(root, name);
  const value = parseNumber(el?.value ?? '');
  if (value === null || value <= 0) return null;
  return toInches(value, unit);
}

function currentUnit(root: ParentNode): Unit {
  const raw = field(root, 'unit')?.value ?? 'ft';
  return isUnit(raw) ? raw : 'ft';
}

function setVerdict(el: HTMLElement | null, ok: boolean, headline: string, detail: string): void {
  if (!el) return;
  el.dataset.state = ok ? 'ok' : 'warn';
  el.innerHTML = `<p class="rp-verdict-head">${headline}</p><p class="rp-verdict-detail">${detail}</p>`;
}

// --------------------------------------------------------- Will it fit?

export function initFitCalculator(root: HTMLElement): void {
  const form = root.querySelector('form');
  const results = out(root, 'results');

  function compute(): void {
    const unit = currentUnit(root);
    const itemWidth = readLength(root, 'item-width', unit);
    const itemDepth = readLength(root, 'item-depth', unit);
    const roomWidth = readLength(root, 'room-width', unit);
    const roomLength = readLength(root, 'room-length', unit);
    const doorWidth = readLength(root, 'door-width', unit);

    const missing = itemWidth === null || itemDepth === null || roomWidth === null || roomLength === null;
    if (results) results.hidden = missing;
    if (missing) return;

    const fit = checkFitsInRoom(itemWidth, itemDepth, roomWidth, roomLength);

    // --- room verdict
    const roomEl = out(root, 'room-verdict');
    if (fit.fitsUpright) {
      const spareW = roomWidth - itemWidth;
      const spareL = roomLength - itemDepth;
      setVerdict(
        roomEl,
        true,
        'It fits in the room',
        `Leaves ${formatLengthFriendly(spareW, unit)} across and ${formatLengthFriendly(spareL, unit)} front to back.`,
      );
    } else if (fit.fitsRotated) {
      setVerdict(
        roomEl,
        true,
        'It fits, turned sideways',
        `Rotate it 90°. It will not fit the way round you entered it, but it does the other way.`,
      );
    } else if (fit.fitsDiagonally && fit.diagonalAngle !== null) {
      setVerdict(
        roomEl,
        true,
        'It only fits at an angle',
        `At roughly ${Math.round(fit.diagonalAngle)}° it will squeeze in, but there will be very little usable space left around it.`,
      );
    } else {
      const overW = Math.max(0, itemWidth - roomWidth);
      const overL = Math.max(0, itemDepth - roomLength);
      const over = Math.max(overW, overL);
      setVerdict(
        roomEl,
        false,
        'It does not fit in the room',
        `It is about ${formatLengthFriendly(over, unit)} too big for the room, in any orientation.`,
      );
    }

    // --- doorway verdict
    const doorEl = out(root, 'door-verdict');
    if (doorEl) {
      if (doorWidth === null) {
        doorEl.dataset.state = 'idle';
        doorEl.innerHTML =
          '<p class="rp-verdict-head">Doorway not checked</p><p class="rp-verdict-detail">Enter a doorway width to check whether it can get into the room.</p>';
      } else {
        const narrow = Math.min(itemWidth, itemDepth);
        const passes = fitsThroughOpening(itemWidth, itemDepth, doorWidth);
        setVerdict(
          doorEl,
          passes,
          passes ? 'It goes through the doorway' : 'It will not go through the doorway',
          passes
            ? `Its narrowest face is ${formatLengthFriendly(narrow, unit)}, against a ${formatLengthFriendly(doorWidth, unit)} opening. Remember to check stair turns and hallway corners too.`
            : `Its narrowest face is ${formatLengthFriendly(narrow, unit)}, but the opening is only ${formatLengthFriendly(doorWidth, unit)}. You are ${formatLengthFriendly(narrow - doorWidth, unit)} short.`,
        );
      }
    }

    // --- floor share
    const shareEl = out(root, 'floor-share');
    if (shareEl) {
      const share = (itemWidth * itemDepth) / (roomWidth * roomLength);
      shareEl.textContent = `${Math.round(share * 100)}%`;
    }
    const areaEl = out(root, 'item-area');
    if (areaEl) areaEl.textContent = formatArea(itemWidth * itemDepth, unit);
    const roomAreaEl = out(root, 'room-area');
    if (roomAreaEl) roomAreaEl.textContent = formatArea(roomWidth * roomLength, unit);
  }

  root.addEventListener('input', compute);
  root.addEventListener('change', compute);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    compute();
    trackEvent('fit_check_used');
  });

  compute();
}

// ------------------------------------------------------ Room size calculator

export function initRoomSizeCalculator(root: HTMLElement): void {
  const form = root.querySelector('form');
  const results = out(root, 'results');

  function compute(): void {
    const unit = currentUnit(root);
    const width = readLength(root, 'room-width', unit);
    const length = readLength(root, 'room-length', unit);

    const missing = width === null || length === null;
    if (results) results.hidden = missing;
    if (missing) return;

    const room = { width, height: length };
    const area = roomArea(room);
    const perimeter = roomPerimeter(room);

    const set = (name: string, value: string) => {
      const el = out(root, name);
      if (el) el.textContent = value;
    };

    set('area', formatArea(area, unit));
    set('perimeter', formatLength(perimeter, unit));
    set('size', `${formatLength(width, unit, false)} × ${formatLength(length, unit)}`);

    // A few genuinely useful derived numbers rather than a wall of them.
    set('area-sqft', formatArea(area, 'ft'));
    set('area-sqm', formatArea(area, 'm'));
    set('diagonal', formatLengthFriendly(Math.hypot(width, length), unit));

    // 10% waste is the usual trade allowance for flooring offcuts.
    const flooringEl = out(root, 'flooring');
    if (flooringEl) flooringEl.textContent = formatArea(area * 1.1, unit);

    const rugEl = out(root, 'rug');
    if (rugEl) {
      const suggestion = suggestRug(width, length);
      rugEl.textContent = suggestion;
    }
  }

  root.addEventListener('input', compute);
  root.addEventListener('change', compute);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    compute();
  });

  compute();
}

/** Pick the largest standard rug that leaves a sensible border of bare floor. */
function suggestRug(widthIn: number, lengthIn: number): string {
  const STANDARD: Array<[number, number, string]> = [
    [36, 60, '3 × 5 ft'],
    [60, 84, '5 × 7 ft'],
    [72, 108, '6 × 9 ft'],
    [96, 120, '8 × 10 ft'],
    [108, 144, '9 × 12 ft'],
    [144, 180, '12 × 15 ft'],
  ];
  const border = 18; // inches of bare floor on each side
  let best = 'No standard rug leaves a clear border — a runner may suit better';
  for (const [w, l, label] of STANDARD) {
    if (w + border * 2 <= widthIn && l + border * 2 <= lengthIn) best = label;
    else if (l + border * 2 <= widthIn && w + border * 2 <= lengthIn) best = `${label} (turned)`;
  }
  return best;
}

// ---------------------------------------------------------------- bootstrap

export function initCalculators(): void {
  const fit = document.querySelector<HTMLElement>('[data-calculator="fit"]');
  if (fit) initFitCalculator(fit);
  const size = document.querySelector<HTMLElement>('[data-calculator="room-size"]');
  if (size) initRoomSizeCalculator(size);
}
