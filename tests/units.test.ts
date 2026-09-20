import { describe, expect, it } from 'vitest';
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
} from '@lib/planner/units';

describe('unit conversion', () => {
  it('converts feet to inches exactly', () => {
    expect(toInches(12, 'ft')).toBe(144);
    expect(toInches(1, 'ft')).toBe(12);
  });

  it('converts metres using the exact 2.54 cm definition', () => {
    expect(toInches(1, 'm')).toBeCloseTo(39.3701, 4);
    expect(toInches(1, 'cm')).toBeCloseTo(0.393701, 6);
  });

  it('round-trips without drift', () => {
    for (const unit of ['ft', 'm', 'in', 'cm'] as const) {
      for (const value of [1, 3.5, 12, 144, 0.25]) {
        expect(fromInches(toInches(value, unit), unit)).toBeCloseTo(value, 9);
      }
    }
  });

  it('survives repeated unit switching without accumulating error', () => {
    let inches = toInches(12, 'ft');
    for (let i = 0; i < 50; i += 1) {
      inches = toInches(fromInches(inches, 'm'), 'm');
      inches = toInches(fromInches(inches, 'cm'), 'cm');
      inches = toInches(fromInches(inches, 'ft'), 'ft');
    }
    expect(inches).toBeCloseTo(144, 6);
    expect(formatLength(inches, 'ft')).toBe('12 ft');
  });
});

describe('formatting', () => {
  it('does not show floating point fuzz', () => {
    expect(formatLength(144.0000001, 'ft')).toBe('12 ft');
    expect(formatLength(143.99999, 'ft')).toBe('12 ft');
  });

  it('keeps meaningful decimals', () => {
    expect(formatLength(150, 'ft')).toBe('12.5 ft');
    expect(formatLength(18, 'in')).toBe('18 in');
  });

  it('formats friendly imperial lengths', () => {
    expect(formatLengthFriendly(56, 'ft')).toBe('4 ft 8 in');
    expect(formatLengthFriendly(48, 'ft')).toBe('4 ft');
    expect(formatLengthFriendly(8, 'ft')).toBe('8 in');
  });

  it('carries over when inches round up to a foot', () => {
    expect(formatLengthFriendly(59.9, 'ft')).toBe('5 ft');
  });

  it('formats areas per unit', () => {
    // 12 ft x 14 ft = 168 sq ft
    expect(formatArea(144 * 168, 'ft')).toBe('168 sq ft');
    expect(formatArea(144 * 168, 'm')).toBe('15.61 m²');
  });

  it('rounds display values to a sensible precision', () => {
    expect(displayValue(144, 'ft')).toBe(12);
    expect(displayValue(145, 'ft')).toBe(12.08);
  });
});

describe('input parsing', () => {
  it('rejects non-numeric input', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  it('rejects NaN and Infinity', () => {
    expect(parseNumber(Number.NaN)).toBeNull();
    expect(parseNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseNumber('Infinity')).toBeNull();
  });

  it('tolerates a pasted unit suffix', () => {
    expect(parseNumber('12 ft')).toBe(12);
    expect(parseNumber('3.5m')).toBe(3.5);
  });

  it('clamps defensively', () => {
    expect(clamp(Number.NaN, 1, 10)).toBe(1);
    expect(clamp(Number.POSITIVE_INFINITY, 1, 10)).toBe(10);
    expect(clamp(5, 1, 10)).toBe(5);
  });

  it('recognises valid units', () => {
    expect(isUnit('ft')).toBe(true);
    expect(isUnit('furlong')).toBe(false);
  });
});
