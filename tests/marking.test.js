import { describe, it, expect } from 'vitest';

describe('shouldMarkDetailPanelAgeing', () => {
  it('returns false when ageingLimitDays is null', () => {
    expect(shouldMarkDetailPanelAgeing('3 days ago', null)).toBe(false);
  });

  it('returns false when age text is null', () => {
    expect(shouldMarkDetailPanelAgeing(null, 3)).toBe(false);
  });

  it('returns false when age text is not a relative-age string', () => {
    expect(shouldMarkDetailPanelAgeing('Promoted', 3)).toBe(false);
  });

  it('returns false for minutes regardless of limit', () => {
    expect(shouldMarkDetailPanelAgeing('30 minutes ago', 0)).toBe(false);
  });

  it('returns false for hours regardless of limit', () => {
    expect(shouldMarkDetailPanelAgeing('5 hours ago', 1)).toBe(false);
  });

  it('returns false when days equal the limit', () => {
    expect(shouldMarkDetailPanelAgeing('3 days ago', 3)).toBe(false);
  });

  it('returns false when days are within the limit', () => {
    expect(shouldMarkDetailPanelAgeing('2 days ago', 3)).toBe(false);
  });

  it('returns true when days exceed the limit', () => {
    expect(shouldMarkDetailPanelAgeing('4 days ago', 3)).toBe(true);
  });

  it('returns true for any week value (exceeds any reasonable day limit)', () => {
    expect(shouldMarkDetailPanelAgeing('1 week ago', 7)).toBe(true);
  });

  it('returns true for any month value', () => {
    expect(shouldMarkDetailPanelAgeing('1 month ago', 7)).toBe(true);
  });
});

describe('parseUnwantedTitleWords', () => {
  it('returns an empty array for an empty string', () => {
    expect(parseUnwantedTitleWords('')).toEqual([]);
  });

  it('returns an empty array for null', () => {
    expect(parseUnwantedTitleWords(null)).toEqual([]);
  });

  it('returns an empty array for undefined', () => {
    expect(parseUnwantedTitleWords(undefined)).toEqual([]);
  });

  it('returns a single trimmed word', () => {
    expect(parseUnwantedTitleWords('Finance')).toEqual(['Finance']);
  });

  it('splits a comma-separated list', () => {
    expect(parseUnwantedTitleWords('Finance,Manager')).toEqual(['Finance', 'Manager']);
  });

  it('trims whitespace around each entry', () => {
    expect(parseUnwantedTitleWords(' Finance , Manager ')).toEqual(['Finance', 'Manager']);
  });

  it('filters out empty entries from repeated commas', () => {
    expect(parseUnwantedTitleWords(',,,Finance,,')).toEqual(['Finance']);
  });

  it('handles a multi-word phrase as a single entry', () => {
    expect(parseUnwantedTitleWords('Head of Finance')).toEqual(['Head of Finance']);
  });
});

describe('titleMatchesUnwanted', () => {
  it('returns null for an empty words list', () => {
    expect(titleMatchesUnwanted('Finance Director', [])).toBeNull();
  });

  it('returns null for a null title', () => {
    expect(titleMatchesUnwanted(null, ['Finance'])).toBeNull();
  });

  it('returns null when no word matches', () => {
    expect(titleMatchesUnwanted('Senior Engineer', ['Finance', 'Manager'])).toBeNull();
  });

  it('returns the matched substring rule', () => {
    expect(titleMatchesUnwanted('Finance Director', ['Finance'])).toBe('Finance');
  });

  it('is case-insensitive', () => {
    expect(titleMatchesUnwanted('finance director', ['Finance'])).toBe('Finance');
  });

  it('matches a partial word (substring)', () => {
    expect(titleMatchesUnwanted('VP Engineering', ['Engineer'])).toBe('Engineer');
  });

  it('matches on any word in the list', () => {
    expect(titleMatchesUnwanted('Sales Manager', ['Finance', 'Manager'])).toBe('Manager');
  });

  it('matches a multi-word phrase', () => {
    expect(titleMatchesUnwanted('Head of Finance Operations', ['Head of Finance'])).toBe('Head of Finance');
  });

  it('returns null for an empty title string', () => {
    expect(titleMatchesUnwanted('', ['Finance'])).toBeNull();
  });
  it('matches exact rules only against the full title, ignoring case and outer whitespace', () => {
    expect(titleMatchesUnwanted(' Finance Director ', ['=finance director'])).toBe('=finance director');
    expect(titleMatchesUnwanted('Senior Finance Director', ['=Finance Director'])).toBeNull();
  });
});

describe('shouldPromoteState', () => {
  it('promotes null to viewed', () => {
    expect(shouldPromoteState(null, 'viewed')).toBe(true);
  });

  it('promotes null to applied', () => {
    expect(shouldPromoteState(null, 'applied')).toBe(true);
  });

  it('promotes viewed to applied', () => {
    expect(shouldPromoteState('viewed', 'applied')).toBe(true);
  });

  it('does not demote applied to viewed', () => {
    expect(shouldPromoteState('applied', 'viewed')).toBe(false);
  });

  it('does not re-promote an equal state', () => {
    expect(shouldPromoteState('viewed', 'viewed')).toBe(false);
    expect(shouldPromoteState('applied', 'applied')).toBe(false);
  });

  it('returns false when both states are null/unknown', () => {
    expect(shouldPromoteState(null, null)).toBe(false);
  });

  it('returns false when next state is unknown', () => {
    expect(shouldPromoteState('viewed', 'promoted')).toBe(false);
  });
});
