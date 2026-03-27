const SETTINGS_KEY = 'ljm-options';

const SETTINGS_DEFAULTS = {
  debug: false,
  colours: {
    viewed: 0.45,
    applied: '#32cd32',
    blacklisted: '#b41e1e'
  }
};

function getOptions() {
  return chrome.storage.sync.get(SETTINGS_KEY).then((result) => {
    const stored = result[SETTINGS_KEY] ?? {};
    return {
      ...SETTINGS_DEFAULTS,
      ...stored,
      colours: { ...SETTINGS_DEFAULTS.colours, ...(stored.colours ?? {}) }
    };
  });
}

function setOptions(options) {
  return chrome.storage.sync.set({ [SETTINGS_KEY]: options });
}
