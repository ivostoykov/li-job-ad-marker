let debugEnabled = false;

const _origDebug = console.debug.bind(console);

console.debug = function (...args) {
  if (!debugEnabled) return;
  _origDebug(...args);
};

function setDebugFlag(enabled) {
  debugEnabled = enabled;
}

async function toggleDebug(enabled) {
  try {
    const options = await getOptions();
    if (typeof enabled === 'undefined') { enabled = !options.debug; }
    options.debug = enabled;
    await setOptions(options);
  } catch (e) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to toggle debug:`, e);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[SETTINGS_KEY]) {
    const newOptions = changes[SETTINGS_KEY].newValue;
    if (newOptions?.debug !== undefined) {
      setDebugFlag(newOptions.debug);
    }
  }
});

async function init_log(timeout) {
  if (Date.now() > timeout) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - init_log timed out`);
    return;
  }
  if (typeof getOptions !== 'function') {
    setTimeout(async () => await init_log(timeout), 1000);
    return;
  }
  const options = await getOptions();
  setDebugFlag(options?.debug ?? false);
}

init_log(Date.now() + 120000);
