let debugEnabled = false;

const LOG_MARKER = '\u270E';
const LOG_BADGES = {
  error: '\u{1F7E5}',
  warn: '\u{1F7E7}',
  log: '\u{1F7E9}',
  debug: '\u{1F7E3}'
};

const _origDebug = console.debug.bind(console);
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

function getLogMethod(level) {
  if (level === 'error') return _origError;
  if (level === 'warn') return _origWarn;
  if (level === 'debug') return _origDebug;
  return _origLog;
}

function getLogPrefix(level, skipNames = []) {
  const badge = LOG_BADGES[level] ?? LOG_BADGES.log;
  const lineNumber = getLineNumber([
    getLogPrefix.name,
    logMessage.name,
    logDebug.name,
    logInfo.name,
    logWarn.name,
    logError.name,
    consoleDebug.name,
    ...skipNames
  ]);

  return `${LOG_MARKER} ${badge} ${manifest?.name ?? ''} - [${lineNumber}] -`;
}

function logMessage(level, message, ...args) {
  if (level === 'debug' && !debugEnabled) return;
  const method = getLogMethod(level);
  method(`${getLogPrefix(level)} ${message}`, ...args);
}

function logDebug(message, ...args) {
  logMessage('debug', message, ...args);
}

function logInfo(message, ...args) {
  logMessage('log', message, ...args);
}

function logWarn(message, ...args) {
  logMessage('warn', message, ...args);
}

function logError(message, ...args) {
  logMessage('error', message, ...args);
}

function consoleDebug(...args) {
  if (!debugEnabled) return;
  _origDebug(getLogPrefix('debug', [consoleDebug.name]), ...args);
}

console.debug = consoleDebug;

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
    logError('Failed to toggle debug:', e);
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
  try {
    if (Date.now() > timeout) {
      logError('init_log timed out');
      return;
    }
    if (typeof getOptions !== 'function') {
      setTimeout(async () => await init_log(timeout), 1000);
      return;
    }
    const options = await getOptions();
    setDebugFlag(options?.debug ?? false);
  } catch (e) {
    logError('Failed to initialise logging:', e);
  }
}

init_log(Date.now() + 120000);
