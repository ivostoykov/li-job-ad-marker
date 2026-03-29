import { describe, it, expect } from 'vitest';

describe('normaliseAgeingLimitDays', () => {
  it('converts a finite number to its string form', () => {
    expect(normaliseAgeingLimitDays(3)).toBe('3');
  });

  it('trims a string value', () => {
    expect(normaliseAgeingLimitDays('  5  ')).toBe('5');
  });

  it('preserves a clean string value', () => {
    expect(normaliseAgeingLimitDays('7')).toBe('7');
  });

  it('returns empty string for null', () => {
    expect(normaliseAgeingLimitDays(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normaliseAgeingLimitDays(undefined)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(normaliseAgeingLimitDays(NaN)).toBe('');
  });

  it('returns empty string for Infinity', () => {
    expect(normaliseAgeingLimitDays(Infinity)).toBe('');
  });

  it('returns empty string for an object', () => {
    expect(normaliseAgeingLimitDays({})).toBe('');
  });
});

describe('getValidAgeingLimitDays', () => {
  it('returns the numeric value for the lower boundary', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '1' })).toBe(1);
  });

  it('returns the numeric value for an in-range integer', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '4' })).toBe(4);
  });

  it('returns the numeric value for the upper boundary', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '7' })).toBe(7);
  });

  it('returns null for zero', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '0' })).toBeNull();
  });

  it('returns null for a value above the upper boundary', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '8' })).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '' })).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: 'abc' })).toBeNull();
  });

  it('returns null for a decimal string', () => {
    expect(getValidAgeingLimitDays({ ageingLimitDays: '3.5' })).toBeNull();
  });

  it('returns null when ageingLimitDays is absent', () => {
    expect(getValidAgeingLimitDays({})).toBeNull();
  });

  it('returns null for a null argument', () => {
    expect(getValidAgeingLimitDays(null)).toBeNull();
  });
});
