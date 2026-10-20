import { describe, it, expect, vi, afterEach } from 'vitest';

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


describe('settings storage validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([null, [], 'bad', { debug: 'false', treatPromotedAsViewed: 1,
    unwantedTitleWords: [], colours: { viewed: '0.2', applied: '#fff', blacklisted: '#123456; color: red' } }])(
    'defaults malformed settings on read and write: %j', async (stored) => {
      vi.spyOn(chrome.storage.sync, 'get').mockResolvedValue({ 'ljm-options': stored });
      const write = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue();
      expect(await getOptions()).toEqual(globalThis._testExports.SETTINGS_DEFAULTS);
      await setOptions(stored);
      expect(write).toHaveBeenCalledWith({ 'ljm-options': globalThis._testExports.SETTINGS_DEFAULTS });
    });

  it.each([NaN, Infinity, -0.01, 1.01, null, '0.5'])(
    'rejects invalid opacity %s through storage reads', async (viewed) => {
      vi.spyOn(chrome.storage.sync, 'get').mockResolvedValue({ 'ljm-options': { colours: { viewed } } });
      expect((await getOptions()).colours.viewed).toBe(0.45);
    });

  it.each([0, 1, 0.5])('preserves valid settings including opacity %s', async (viewed) => {
    const options = { debug: true, treatPromotedAsViewed: true, ageingLimitDays: '3',
      unwantedTitleWords: '=Engineer', colours: { viewed, applied: '#ABCdef', blacklisted: '#000000' } };
    vi.spyOn(chrome.storage.sync, 'get').mockResolvedValue({ 'ljm-options': options });
    const write = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue();
    expect(await getOptions()).toEqual(options);
    await setOptions(options);
    expect(write).toHaveBeenCalledWith({ 'ljm-options': options });
  });
});


describe('strict imported colour syntax', () => {
  it.each(['#123456\n', ' #123456', '#123456 ', '#fff', '#12345678', 'red', null, 123456])(
    'rejects %j', (applied) => {
      expect(normaliseOptions({ colours: { applied } }).colours.applied).toBe('#32cd32');
    });
});
