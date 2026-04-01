let debugEnabled = false;

const originalDebug = console.debug.bind(console);

function getLogPrefix(level = 'log') {
  const badges = { error: '\u{1F7E5}', warn: '\u{1F7E7}', log: '\u{1F7E9}', debug: '\u{1F7E3}', consoleDebug: '\u{1F7E3}' };
  return `\u270E ${badges[level] ?? badges.log} - ${manifest?.name ?? ''}`;
}

console.debug = function consoleDebug(...args) {
  if (!debugEnabled) return;
  originalDebug(...args);
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
    console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - Failed to toggle debug:`, e);
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
    console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - init_log timed out`);
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
