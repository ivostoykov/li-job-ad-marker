const SETTINGS_KEY = 'ljm-options';

const SETTINGS_DEFAULTS = {
  debug: false,
  ageingLimitDays: '',
  treatPromotedAsViewed: false,
  unwantedTitleWords: '',
  colours: {
    viewed: 0.45,
    applied: '#32cd32',
    blacklisted: '#b41e1e'
  }
};

function normaliseAgeingLimitDays(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function getValidAgeingLimitDays(options) {
  const rawValue = normaliseAgeingLimitDays(options?.ageingLimitDays);
  if (!/^\d+$/.test(rawValue)) return null;

  const value = Number.parseInt(rawValue, 10);
  return value >= 1 && value <= 7 ? value : null;
}

function getOptions() {
  return chrome.storage.sync.get(SETTINGS_KEY).then((result) => {
    const stored = result[SETTINGS_KEY] ?? {};
    return {
      ...SETTINGS_DEFAULTS,
      ...stored,
      ageingLimitDays: normaliseAgeingLimitDays(stored.ageingLimitDays),
      colours: { ...SETTINGS_DEFAULTS.colours, ...(stored.colours ?? {}) }
    };
  });
}

function setOptions(options) {
  return chrome.storage.sync.set({ [SETTINGS_KEY]: options });
}
