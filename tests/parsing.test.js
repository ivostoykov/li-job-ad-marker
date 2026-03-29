import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('isRelativeAgeText', () => {
  it.each([
    ['1 minute ago', true],
    ['3 minutes ago', true],
    ['1 hour ago', true],
    ['5 hours ago', true],
    ['1 day ago', true],
    ['3 days ago', true],
    ['1 week ago', true],
    ['2 weeks ago', true],
    ['1 month ago', true],
    ['2 months ago', true],
  ])('returns true for "%s"', (text, expected) => {
    expect(isRelativeAgeText(text)).toBe(expected);
  });

  it.each([
    ['Promoted'],
    ['Viewed'],
    ['Applied'],
    ['4days ago'],
    [''],
    [null],
    [undefined],
    ['2 fortnights ago'],
    ['just now'],
  ])('returns false for "%s"', (text) => {
    expect(isRelativeAgeText(text)).toBe(false);
  });
});

describe('parseRelativeAgeText', () => {
  it.each([
    ['1 minute ago',  { value: 1, unit: 'minute' }],
    ['3 minutes ago', { value: 3, unit: 'minute' }],
    ['1 hour ago',    { value: 1, unit: 'hour' }],
    ['5 hours ago',   { value: 5, unit: 'hour' }],
    ['1 day ago',     { value: 1, unit: 'day' }],
    ['4 days ago',    { value: 4, unit: 'day' }],
    ['1 week ago',    { value: 1, unit: 'week' }],
    ['2 weeks ago',   { value: 2, unit: 'week' }],
    ['1 month ago',   { value: 1, unit: 'month' }],
    ['3 months ago',  { value: 3, unit: 'month' }],
  ])('parses "%s" correctly', (text, expected) => {
    expect(parseRelativeAgeText(text)).toEqual(expected);
  });

  it.each([
    ['invalid'],
    [''],
    [null],
    [undefined],
    ['Promoted'],
  ])('returns null for "%s"', (text) => {
    expect(parseRelativeAgeText(text)).toBeNull();
  });
});

describe('parseDateFromDatetime', () => {
  it('parses a valid ISO date string', () => {
    const result = parseDateFromDatetime('2026-03-15');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // 0-indexed
    expect(result.getDate()).toBe(15);
  });

  it('accepts a datetime string with trailing time component', () => {
    const result = parseDateFromDatetime('2026-01-01T00:00:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it('returns null for an invalid month', () => {
    expect(parseDateFromDatetime('2026-13-01')).toBeNull();
  });

  it('returns null for an invalid day', () => {
    expect(parseDateFromDatetime('2026-02-30')).toBeNull();
  });

  it('returns null for a non-date string', () => {
    expect(parseDateFromDatetime('invalid')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseDateFromDatetime('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseDateFromDatetime(null)).toBeNull();
  });
});

describe('getAgeInDays', () => {
  beforeAll(() => {
    vi.useFakeTimers({ now: new Date('2026-03-29') });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('returns 0 for today', () => {
    expect(getAgeInDays('2026-03-29')).toBe(0);
  });

  it('returns 1 for yesterday', () => {
    expect(getAgeInDays('2026-03-28')).toBe(1);
  });

  it('returns 7 for one week ago', () => {
    expect(getAgeInDays('2026-03-22')).toBe(7);
  });

  it('returns null for a future date', () => {
    expect(getAgeInDays('2026-03-30')).toBeNull();
  });

  it('returns null for an invalid datetime string', () => {
    expect(getAgeInDays('not-a-date')).toBeNull();
  });

  it('returns null for null', () => {
    expect(getAgeInDays(null)).toBeNull();
  });
});
