/**
 * Unit conversion and display formatting.
 *
 * Inches are canonical. Conversions derive from the exact international
 * definition (1 in = 2.54 cm), so round-tripping ft -> in -> ft is stable.
 */

import type { Unit } from './types';
import { UNITS } from './types';

const INCHES_PER: Record<Unit, number> = {
  in: 1,
  ft: 12,
  cm: 1 / 2.54, // 0.393700787...
  m: 100 / 2.54, // 39.3700787...
};

/** Decimal places shown for each display unit. */
const DISPLAY_PRECISION: Record<Unit, number> = {
  ft: 2,
  m: 3,
  in: 1,
  cm: 1,
};

/** Smallest sensible step for the numeric inputs of each unit. */
export const UNIT_STEP: Record<Unit, number> = {
  ft: 0.25,
  m: 0.05,
  in: 1,
  cm: 1,
};

export const UNIT_LABEL: Record<Unit, string> = {
  ft: 'ft',
  m: 'm',
  in: 'in',
  cm: 'cm',
};

export const UNIT_NAME: Record<Unit, string> = {
  ft: 'Feet',
  m: 'Meters',
  in: 'Inches',
  cm: 'Centimeters',
};

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value);
}

/** Convert a value expressed in `unit` into canonical inches. */
export function toInches(value: number, unit: Unit): number {
  return value * INCHES_PER[unit];
}

/** Convert canonical inches into `unit`. */
export function fromInches(inches: number, unit: Unit): number {
  return inches / INCHES_PER[unit];
}

/**
 * Round away floating point fuzz so 12.000000001 renders as 12.
 * Also collapses -0 to 0.
 */
export function clean(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Strip trailing zeros: 12.00 -> "12", 12.50 -> "12.5". */
function trimNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

/** Numeric value for an input field, rounded to that unit's display precision. */
export function displayValue(inches: number, unit: Unit): number {
  return clean(fromInches(inches, unit), DISPLAY_PRECISION[unit]);
}

/** e.g. `formatLength(144, 'ft')` -> "12 ft". */
export function formatLength(inches: number, unit: Unit, withUnit = true): string {
  const value = fromInches(inches, unit);
  const text = trimNumber(clean(value, DISPLAY_PRECISION[unit]), DISPLAY_PRECISION[unit]);
  return withUnit ? `${text} ${UNIT_LABEL[unit]}` : text;
}

/**
 * Friendly imperial form used by the measure tool: `56` -> "4 ft 8 in".
 * Metric units fall back to `formatLength`.
 */
export function formatLengthFriendly(inches: number, unit: Unit): string {
  if (unit === 'm' || unit === 'cm') return formatLength(inches, unit);
  if (unit === 'in') return formatLength(inches, 'in');

  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  let feet = Math.floor(abs / 12);
  let rest = Math.round((abs - feet * 12) * 2) / 2; // nearest half inch
  if (rest >= 12) {
    feet += 1;
    rest -= 12;
  }
  const restText = trimNumber(rest, 1);
  if (feet === 0) return `${sign}${restText} in`;
  if (rest === 0) return `${sign}${feet} ft`;
  return `${sign}${feet} ft ${restText} in`;
}

/** Area label, e.g. "168 sq ft". Metric rooms report m² / cm². */
export function formatArea(squareInches: number, unit: Unit): string {
  const perUnit = INCHES_PER[unit] ** 2;
  const value = squareInches / perUnit;
  const decimals = unit === 'ft' || unit === 'm' ? 2 : 0;
  const text = trimNumber(clean(value, decimals), decimals);
  const suffix = unit === 'm' ? 'm²' : unit === 'cm' ? 'cm²' : `sq ${UNIT_LABEL[unit]}`;
  return `${text} ${suffix}`;
}

/**
 * Parse user input defensively. Returns `null` for anything that is not a
 * finite number, which callers turn into a friendly validation message.
 * Accepts a leading/trailing unit suffix so pasting "12 ft" still works.
 */
export function parseNumber(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[^0-9.\-+eE]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '+') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Clamp with NaN protection.
 *
 * NaN carries no direction so it falls back to `min`; infinities do, and clamp
 * to the bound they are heading towards, which is what a runaway input should
 * do rather than silently jumping to the opposite end of the range.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
