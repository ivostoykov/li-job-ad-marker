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

function normaliseOptions(options) {
  const colours = options?.colours;
  const validColour = (value) => typeof value === 'string' && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
  return {
    debug: typeof options?.debug === 'boolean' ? options.debug : SETTINGS_DEFAULTS.debug,
    ageingLimitDays: normaliseAgeingLimitDays(options?.ageingLimitDays),
    treatPromotedAsViewed: typeof options?.treatPromotedAsViewed === 'boolean'
      ? options.treatPromotedAsViewed : SETTINGS_DEFAULTS.treatPromotedAsViewed,
    unwantedTitleWords: typeof options?.unwantedTitleWords === 'string' ? options.unwantedTitleWords : '',
    colours: {
      viewed: typeof colours?.viewed === 'number' && Number.isFinite(colours.viewed)
        && colours.viewed >= 0 && colours.viewed <= 1 ? colours.viewed : SETTINGS_DEFAULTS.colours.viewed,
      applied: validColour(colours?.applied) ? colours.applied : SETTINGS_DEFAULTS.colours.applied,
      blacklisted: validColour(colours?.blacklisted) ? colours.blacklisted : SETTINGS_DEFAULTS.colours.blacklisted
    }
  };
}

function getOptions() {
  return chrome.storage.sync.get(SETTINGS_KEY).then((result) => normaliseOptions(result[SETTINGS_KEY]));
}

// Routed through the background so saves from any context are serialised with
// backup imports (see `settings.set` in src/background.js).
async function setOptions(options) {
  const response = await chrome.runtime.sendMessage({ action: 'settings.set', options });
  if (!response?.ok) throw new Error(response?.error || 'settings.set failed');
}
