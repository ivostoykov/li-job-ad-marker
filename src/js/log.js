let debugEnabled = false;

const originalDebug = console.debug.bind(console);

console.debug = function consoleDebug(...args) {
  if (!debugEnabled) return;
  originalDebug(`${LOG_MARKER} ${LOG_BADGE_DEBUG} ${manifest?.name ?? ''} - [${getLineNumber(['consoleDebug'])}] -`, ...args);
};

function setDebugFlag(enabled) {
  console.debug(`Debugging is now ${enabled ? 'ON' : 'OFF'}.`);
  debugEnabled = enabled;
}

async function toggleDebug(enabled) {
  try {
    const options = await getOptions();
    if (typeof enabled === 'undefined') { enabled = !options.debug; }
    options.debug = enabled;
    await setOptions(options);
  } catch (e) {
    console.error(`${LOG_MARKER} ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to toggle debug:`, e);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[SETTINGS_KEY]) {
    const newOptions = changes[SETTINGS_KEY].newValue;
    if (newOptions?.debug !== undefined) {
      debugEnabled = newOptions.debug;
    }
  }
});

async function init_log(timeout) {
  if (Date.now() > timeout) {
    console.error(`${LOG_MARKER} ${manifest?.name ?? ''} - [${getLineNumber()}] - init_log timed out`);
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
